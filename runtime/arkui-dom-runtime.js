/*
 * ArkUI → DOM 运行时（②：支持自定义组件 / @Prop / @Link / If / ForEach）
 *
 * 设计依据：读 ets-loader 的转换产物反推（见 docs/surface-measurement.md）。
 * 本文件是"经典脚本"，加载后把 ArkUI 全局装到 globalThis：
 *   ViewPU(含静态 create) / ObservedPropertySimplePU / ObservedPropertyObjectPU
 *   SynchedPropertySimpleOneWayPU / SynchedPropertySimpleTwoWayPU
 *   SubscriberManager / registerNamedRoute / ViewStackProcessor
 *   Text Column Row Stack List ListItem Button If ForEach RelativeContainer
 *   __arkui_dom_loadRoute(pagePath, rootEl)
 *
 * 与官方运行时的对应（关键约定，错一处就崩）：
 *   observeComponentCreation2(updateFunc, componentClassOrName)
 *     · 分配 elmtId、记录 updateFunc、立即执行一次完成首渲染
 *     · 第二参数：内置组件传组件类，自定义组件传 {name:"X"}  —— 两种都要接受
 *   Component.create(...)   首次建 DOM 节点；重渲染时【复用同一 elmtId 的节点】并更新内容
 *   Component.<factory>(...)  工厂名不统一（Button 用 createWithLabel）→ 以 /^create/ 识别
 *   Component.<attr>(v)     作用在栈顶节点
 *   Component.pop()         弹栈（只在 initialRender 里出现）
 *   If.create() + ifElseBranchUpdateFunction + If.pop()
 *   ForEach.create() + forEachUpdateFunction + ForEach.pop()；ListItem.create(deepFn, true)
 *   静态 ViewPU.create(childView) 挂载自定义组件；updateStateVarsOfChildByElmtId 推送参数
 *   @Link：父传自己的状态实例；@Prop：单向，靠 reset() 接收
 */
(function (global) {
  'use strict';

  // ───────────────────────── 基础设施 ─────────────────────────
  let elmtIdSeq = 0;
  const elmtRecords = new Map();   // elmtId -> {node, parentNode, updateFunc, childView,
                                   //            activeBranch, forEachSnapshot}
  const deepRendering = new Set(); // 正在执行 deepRender 的 elmtId，防止递归再进入
  const propDeps = new Map();      // ObservedProperty -> Set<elmtId>
  let currentNodeElmtId = null;    // 正在执行哪个 elmtId 的渲染（依赖追踪 + If/ForEach 归属）
  let rootNode = null;
  let viewSeq = 0;

  // 组件栈：官方命名，产物里的 ViewStackProcessor.StartGetAccessRecordingFor/Stop… 由它承载
  const ViewStackProcessor = {
    stack: [],
    push(n) { this.stack.push(n); return n; },
    pop() { return this.stack.pop(); },
    top() { return this.stack.length ? this.stack[this.stack.length - 1] : null; },
    snapshot() { return this.stack.slice(); },
    restore(snap) { this.stack.length = 0; for (const n of snap) this.stack.push(n); },
    StartGetAccessRecordingFor(elmtId) { this._recording = elmtId; currentNodeElmtId = elmtId; },
    StopGetAccessRecording() { this._recording = null; },
  };

  const parentOfTop = () => ViewStackProcessor.top() || rootNode;

  function recordDep(prop) {
    if (currentNodeElmtId == null) return;
    let s = propDeps.get(prop);
    if (!s) propDeps.set(prop, (s = new Set()));
    s.add(currentNodeElmtId);
  }

  function dropPropDeps(elmtId) {
    for (const [prop, s] of propDeps) s.delete(elmtId);
  }

  // ─────────────────── 状态管理（4 个类） ───────────────────
  // 共同协议：get / set / reset(可选) / resetSource(可选) / purgeDependencyOnElmtId / aboutToBeDeleted
  class ObservedPropertySimplePU {
    constructor(value, owner, name) {
      this._value = value; this._owner = owner; this._name = name; this._watches = [];
    }
    get() { recordDep(this); return this._value; }
    set(v) {
      if (Object.is(this._value, v)) return;
      this._value = v;
      markDependentsDirty(this);
      this._fireWatches();                       // @Watch：值变了才回调（同一属性名作为入参）
    }
    reset(v) { this.set(v); }
    watch(cb) { this._watches.push(cb); }        // declareWatch 挂载点
    _fireWatches() { for (const cb of this._watches) cb(this._name); }
    purgeDependencyOnElmtId(elmtId) { const s = propDeps.get(this); if (s) s.delete(elmtId); }
    aboutToBeDeleted() { propDeps.delete(this); }
  }

  // @State 用于对象/数组类型
  class ObservedPropertyObjectPU {
    constructor(value, owner, name) {
      this._value = value; this._owner = owner; this._name = name; this._watches = [];
    }
    get() { recordDep(this); return this._value; }
    set(v) {
      if (Object.is(this._value, v)) return;
      this._value = v;
      markDependentsDirty(this);
      this._fireWatches();
    }
    reset(v) { this.set(v); }
    watch(cb) { this._watches.push(cb); }
    _fireWatches() { for (const cb of this._watches) cb(this._name); }
    purgeDependencyOnElmtId(elmtId) { const s = propDeps.get(this); if (s) s.delete(elmtId); }
    aboutToBeDeleted() { propDeps.delete(this); }
  }

  // @Prop：单向。父通过 updateStateVarsOfChildByElmtId → reset(新值)
  class SynchedPropertySimpleOneWayPU {
    constructor(value, owner, name) {
      this._value = value; this._owner = owner; this._name = name; this._deps = new Set();
    }
    get() {
      if (currentNodeElmtId != null) this._deps.add(currentNodeElmtId);
      return this._value;
    }
    set(v) { this.reset(v); }
    reset(v) {
      if (Object.is(this._value, v)) return;
      this._value = v;
      for (const id of [...this._deps]) markDirty(id);
    }
    purgeDependencyOnElmtId(elmtId) { this._deps.delete(elmtId); }
    aboutToBeDeleted() { this._deps.clear(); }
  }

  // @Link：双向。父把自己的状态实例传进来，双方共享同一数据源
  class SynchedPropertySimpleTwoWayPU {
    constructor(source, owner, name) {
      this._source = source; this._owner = owner; this._name = name;
    }
    get() { return this._source.get(); }        // 依赖记在 source 上（父 set 能触发子的 elmtId）
    set(v) { this._source.set(v); }             // 写回 source（双向）
    resetSource(source) { this._source = source; }
    purgeDependencyOnElmtId(elmtId) {
      if (this._source && this._source.purgeDependencyOnElmtId) {
        this._source.purgeDependencyOnElmtId(elmtId);
      }
    }
    aboutToBeDeleted() { this._source = null; }
  }

  // ───────────── V1 深度观测：@Observed 类 + @ObjectLink ─────────────
  //
  // 与 v2 的 @Trace 不同，V1 的 @Observed 标在【整个类】上，产物里【不带任何字段
  // 装饰器】：
  //     @Observed class Item { name: string; count: number; }   // 字段上什么都没有
  //     Item = __decorate([Observed], Item);                    // 类装饰器，2 个实参
  //
  // 没有字段名可用 → 装不了原型访问器 → 只能用 **Proxy** 拦截 set。
  // （ArkUI 真机也是这么做的：ObservedObject.createNew 返回一个 Proxy。）
  //
  // 订阅侧：@ObjectLink 编译成
  //     this.__item = new SynchedPropertyNesedObjectPU(params.item, this, "item")
  //   注意类名里的 `Nesed` 是【官方拼写错误】（应为 Nested）。别"顺手改对"——产物里
  //   写的就是这个名字，改了就直接 ReferenceError。
  //   产物【不会】自己调 subscribe：订阅必须由运行时在构造 at 时完成。
  //
  // 观测语义（与真机一致）：
  //   ✓ @Observed 类实例的【自身字段】写入 → 通知订阅者
  //   ✗ 嵌套的【非 @Observed】对象内部写入 → 不通知（本用例里有负向断言守着）

  const observedCells = new WeakMap();   // Proxy -> 通知单元（复用 propDeps 机制）
  const OBSERVED_CELL = Symbol('arkui.observedCell');
  const OBSERVED_TAG = Symbol('arkui.isObserved');

  function makeObservedProxy(target) {
    const cell = { __observed: true, __name: target && target.constructor ? target.constructor.name : '?' };
    const proxy = new Proxy(target, {
      get(t, k, r) {
        if (k === OBSERVED_CELL) return cell;
        if (k === OBSERVED_TAG) return true;
        return Reflect.get(t, k, r);
      },
      set(t, k, v, r) {
        const had = Object.prototype.hasOwnProperty.call(t, k) || k in t;
        const before = t[k];
        const ok = Reflect.set(t, k, v, r);
        // 只在真的变了时通知（与状态类一致：同值写入不触发重渲染）
        if (ok && had && !Object.is(before, v)) markDependentsDirty(cell);
        return ok;
      },
    });
    observedCells.set(proxy, cell);
    return proxy;
  }

  // 类装饰器：__decorate([Observed], Cls) 只有 2 个实参 → 助手把返回值当作类本身，
  // 所以这里【必须返回一个类】。用子类把构造返回值换成 Proxy。
  function Observed(Base) {
    const ObservedClass = class extends Base {
      constructor(...args) {
        super(...args);
        return makeObservedProxy(this);
      }
    };
    // 保持 name 与静态成员可读（排查时 `Item.name` 不该变成 ''）
    try { Object.defineProperty(ObservedClass, 'name', { value: Base.name, configurable: true }); } catch (_) {}
    return ObservedClass;
  }

  function observedCellOf(obj) {
    if (obj === null || typeof obj !== 'object') return null;
    return observedCells.get(obj) || null;
  }

  // @ObjectLink：子组件持有父侧 @Observed 实例的【引用】，只订阅、不复制值。
  class SynchedPropertyNesedObjectPU {
    constructor(source, owner, name) {
      this._owner = owner; this._name = name; this._source = undefined;
      this._cell = null;
      this.set(source);
    }
    get() {
      if (this._cell) recordDep(this._cell);   // 读对象 = 依赖它的字段变更
      return this._source;
    }
    set(source) {
      const nextCell = observedCellOf(source);
      if (!nextCell && source !== undefined && source !== null) {
        // 不静默：@ObjectLink 绑到非 @Observed 对象上时，改它的字段不会触发任何更新
        layoutWarnings.push(
          `@ObjectLink('${this._name}') 绑定到非 @Observed 对象，字段变更不会触发重渲染`);
      }
      const prev = this._cell;
      this._source = source;
      this._cell = nextCell;
      // 换成了另一个对象：让原先的依赖者重渲染一次以便重新记录依赖
      if (prev && prev !== nextCell) markDependentsDirty(prev);
    }
    purgeDependencyOnElmtId(elmtId) {
      if (this._cell) { const s = propDeps.get(this._cell); if (s) s.delete(elmtId); }
    }
    aboutToBeDeleted() { this._source = undefined; this._cell = null; }
  }

  // ─────────────────── 脏标记 / 批量重渲染 ───────────────────
  const dirty = new Set();
  let flushScheduled = false;

  function markDependentsDirty(prop) {
    const s = propDeps.get(prop);
    if (s) for (const id of [...s]) markDirty(id);
  }
  function markDirty(elmtId) {
    dirty.add(elmtId);
    if (flushScheduled) return;
    flushScheduled = true;
    Promise.resolve().then(() => { flushScheduled = false; flush(); });
  }
  function flush() {
    const ids = [...dirty].sort((a, b) => a - b);
    dirty.clear();
    for (const id of ids) rerenderElmt(id);
  }

  function rerenderElmt(elmtId) {
    const rec = elmtRecords.get(elmtId);
    if (!rec || !rec.updateFunc || !rec.node) return;
    const savedStack = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    ViewStackProcessor.restore([]);
    if (rec.parentNode) ViewStackProcessor.push(rec.parentNode);
    currentNodeElmtId = elmtId;
    rec.updateFunc(elmtId, false);
    ViewStackProcessor.restore(savedStack);
    currentNodeElmtId = savedElmt;
    // R22：若有动画窗口开着，记下【这次真的被重渲染】的节点 —— 动画只挂这些节点，
    // 而不是"整个子树"或"碰巧同名的所有元素"（谁变了就动谁）
    if (animWindow && rec.node) animWindow.els.push(rec.node);
    syncAlignRules(rootNode);          // 重渲染后几何可能变，重新同步
    syncDrawings(rootNode);            // 弧形要用真实尺寸重画
    syncAreas(rootNode);               // onAreaChange 要按真实几何派发
    syncNavChrome(rootNode);           // 标题栏高度/分栏宽度/Auto 模式判定都要真实尺寸
  }

  // 分支切换/列表重建后，把已脱离 DOM 树的记录清掉，避免 elmtId 泄漏与重复节点
  function purgeDetachedRecords() {
    if (!rootNode) return;
    for (const [id, rec] of [...elmtRecords]) {
      if (rec.node && !rootNode.contains(rec.node)) {
        if (rec.updateFunc) dropPropDeps(id);
        elmtRecords.delete(id);
      }
    }
  }

  // ────────────────────── 显式动画：animateTo / animateToImmediately（R22） ──────────────────────
  //
  // ⚠️ 调用约定（实测的产物）：源码里写全局 `animateTo(...)`，编译后是 **`Context.animateTo(...)`**
  // （`Context` 是自由变量）。所以必须提供全局 `Context` 对象 —— 只挂裸名 `animateTo` 会 ReferenceError。
  //
  // 语义：`animateTo(param, fn)` = "把 fn() 引起的状态变更变成一次过渡"。DOM 里能表达的是 CSS transition
  // （不是 ArkUI 的插值引擎）：
  //   · fn() 改状态 → 同步 flush → 把【这次真的被重渲染的节点】找出来（rerenderElmt 里收集），
  //     给它们挂 `transition: all <duration>ms <curve> <delay>ms`
  //   · 窗口结束（时长+延迟到点）时清掉，并调 onFinish
  //   · `duration: 0` → **不进动画**（不挂 transition），但状态变更照常落地
  // 已知限制：CSS transition 表达不了 `iterations`/`playMode`/`tempo`/`expectedFrameRateRange` 与
  // "弹簧"曲线（ICurve）→ 一律写 layoutWarnings（出声，不静默）。
  const CURVE_NAMES = [
    'Linear', 'Ease', 'EaseIn', 'EaseOut', 'EaseInOut', 'FastOutSlowIn', 'LinearOutSlowIn',
    'FastOutLinearIn', 'ExtremeDeceleration', 'Sharp', 'Rhythm', 'Smooth', 'Friction',
  ];
  const Curve = {};
  CURVE_NAMES.forEach((n, i) => { Curve[n] = i; });
  // ArkUI 的曲线名 → CSS 等价物（名字对得上的直接透传）
  const CURVE_CSS = {
    Linear: 'linear', Ease: 'ease', EaseIn: 'ease-in', EaseOut: 'ease-out', EaseInOut: 'ease-in-out',
    FastOutSlowIn: 'cubic-bezier(0.4, 0, 0.2, 1)', LinearOutSlowIn: 'cubic-bezier(0, 0, 0.2, 1)',
    FastOutLinearIn: 'cubic-bezier(0.4, 0, 1, 1)', ExtremeDeceleration: 'cubic-bezier(0, 0, 0, 1)',
    Sharp: 'cubic-bezier(0.33, 0, 0.67, 1)', Rhythm: 'cubic-bezier(0.7, 0, 0.2, 1)',
    Smooth: 'cubic-bezier(0.4, 0, 0.4, 1)', Friction: 'cubic-bezier(0.2, 0, 0.2, 1)',
  };
  const PlayMode = { Normal: 0, Reverse: 1, Alternate: 2, AlternateReverse: 3 };

  // ────────────────────── transition：组件出现/消失动画（R22 收口） ──────────────────────
  //
  // 实测产物（fixtures/pages/TransitionDemo.ts）：
  //   Text.transition({ opacity: 0, translate: { x: 0, y: 40 } });                    ← TransitionOptions
  //   Text.transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ x: 20, y: 0 }))
  //                       .animation({ duration: 200, curve: Curve.Linear }));         ← TransitionEffect
  //   Text.transition(TransitionEffect.asymmetric(A, B), (transitionIn) => {…});      ← 两参重载
  //   Text.transition({ type: TransitionType.Insert, opacity: 0 });                   ← 显式方向
  // 即：`transition` 是**属性**（走 builder 栈，两参重载要把第二个参数一起传进来），
  // 而 `TransitionEffect`/`TransitionType` 是**自由变量**（必须由运行时提供全局）。
  //
  // 语义（只用 CSS transition 能表达的部分）：
  //   · 触发时机 = 组件被【插入/删除】。插入点 = mountNode；删除点 = 分支切换/ForEach 重建。
  //     删除**不能**立刻 remove：要么带着过渡留在 DOM 里到点再摘，要么就根本没有消失动画。
  //   · 方向：Insert = 从"偏离态"过渡到常态；Delete = 从常态过渡到"偏离态"。
  //   · 时长来源有**两档**（最要紧的差别）：TransitionEffect 自带 `.animation()` → 用它；
  //     TransitionOptions 自己没有时间字段 → 用【外层 animateTo 窗口】的参数；
  //     两者都没有 → AnimateParam 的默认（duration 1000 / Linear），并把 source 记成 'default'
  //     （可自省，不假装是"按设备来的"）。
  //   · `TransitionEffect.IDENTITY`、或 type 与方向不匹配 → **不动**（仍记一条 skipped，可自省）。
  //   · CSS 表达不了的（`rotate.centerX/centerY`、`translate.z`）→ 出声。
  const TransitionType = { All: 0, Insert: 1, Delete: 2 };
  const TRANSITION_DIR_NAME = { [TransitionType.All]: 'All', [TransitionType.Insert]: 'Insert', [TransitionType.Delete]: 'Delete' };

  class TransitionEffect {
    constructor(kind, value) { this.kind = kind; this.value = value; this.anim = undefined; this.next = null; }
    static get IDENTITY() { return new TransitionEffect('identity', undefined); }
    static get OPACITY() { return new TransitionEffect('opacity', 0); }
    static get SLIDE() { return new TransitionEffect('slide', undefined); }
    static get SLIDE_SWITCH() { return new TransitionEffect('slideSwitch', undefined); }
    static translate(o) { return new TransitionEffect('translate', o); }
    static rotate(o) { return new TransitionEffect('rotate', o); }
    static scale(o) { return new TransitionEffect('scale', o); }
    static opacity(a) { return new TransitionEffect('opacity', a); }
    static move(e) { return new TransitionEffect('move', e); }
    static asymmetric(appear, disappear) { return new TransitionEffect('asymmetric', { appear: appear, disappear: disappear }); }
    // `.animation()` / `.combine()` 都返回**新实例**：静态常量（OPACITY/SLIDE…）是共享的，
    // 若就地改会把别的页面用到的同一个常量污染掉。两者都必须**整链深拷贝** ——
    // 只拷自己会把 combine 出来的链丢掉（第一版就这么错的：`.a().combine(b).animation()` 之后链没了）。
    _deepCopy() {
      const head = new TransitionEffect(this.kind, this.value);
      head.anim = this.anim;
      let tail = head;
      for (const n of _effectChain(this).slice(1)) {
        tail.next = new TransitionEffect(n.kind, n.value);
        tail = tail.next;
        tail.anim = n.anim;
      }
      return head;
    }
    animation(p) { const c = this._deepCopy(); c.anim = p; return c; }
    combine(e) {
      const head = this._deepCopy();
      let tail = head;
      while (tail.next) tail = tail.next;
      for (const n of _effectChain(e)) { tail.next = n._deepCopy(); tail = tail.next; }
      return head;
    }
  }
  function _effectChain(e) { const out = []; for (let t = e; t; t = t.next) out.push(t); return out; }
  function _effectAnim(e) { for (const n of _effectChain(e)) if (n.anim) return n.anim; return undefined; }
  function _effectSummary(e) { return _effectChain(e).map((n) => n.kind).join('+'); }

  const transitionRegistered = [];         // 登记过的 transition（自省用）
  const transitionRuns = [];               // 每次真的跑过的出现/消失（自省用）
  let transitionSeq = 0;
  let transitionRunSeq = 0;

  // 偏离态 → CSS（ArkUI 的裸数字 = vp，这里 1vp=1px，与项目其它地方一致）
  function _offStyleOf(effectOrOptions, isEffect) {
    const out = { opacity: undefined, transforms: [], warnings: [] };
    const list = isEffect ? _effectChain(effectOrOptions) : [{ kind: 'options', value: effectOrOptions }];
    for (const item of list) {
      const kind = item.kind;
      const v = item.value;
      if (kind === 'identity') continue;
      if (kind === 'options') {                       // TransitionOptions：opacity/translate/scale/rotate
        const o = v || {};
        if (o.opacity !== undefined) out.opacity = Number(o.opacity);
        if (o.translate) out.transforms.push(`translate(${Number(o.translate.x || 0)}px, ${Number(o.translate.y || 0)}px)`);
        if (o.translate && o.translate.z) out.warnings.push('transition 的 translate.z（3D）未实现');
        if (o.scale) {
          out.transforms.push(`scale(${o.scale.x !== undefined ? o.scale.x : 1}, ${o.scale.y !== undefined ? o.scale.y : 1})`);
          if (o.scale.centerX !== undefined || o.scale.centerY !== undefined) {
            out.warnings.push('transition 的 scale.centerX/centerY 未实现（CSS 走 transform-origin，未接入）');
          }
        }
        if (o.rotate) {
          out.transforms.push(`rotate(${Number(o.rotate.angle || 0)}deg)`);
          if (o.rotate.centerX !== undefined || o.rotate.centerY !== undefined) {
            out.warnings.push('transition 的 rotate.centerX/centerY 未实现');
          }
        }
        continue;
      }
      if (kind === 'opacity') { out.opacity = Number(v); continue; }
      if (kind === 'translate') { out.transforms.push(`translate(${Number((v && v.x) || 0)}px, ${Number((v && v.y) || 0)}px)`); continue; }
      if (kind === 'scale') { out.transforms.push(`scale(${v && v.x !== undefined ? v.x : 1}, ${v && v.y !== undefined ? v.y : 1})`); continue; }
      if (kind === 'rotate') { out.transforms.push(`rotate(${Number((v && v.angle) || 0)}deg)`); continue; }
      if (kind === 'move') {                      // 从某条边滑入/滑出
        const edge = v;
        const pct = edge === TransitionEdge.Left ? 'translate(-100%, 0)'
          : edge === TransitionEdge.Right ? 'translate(100%, 0)'
            : edge === TransitionEdge.Top ? 'translate(0, -100%)' : 'translate(0, 100%)';
        out.transforms.push(pct);
        continue;
      }
      if (kind === 'slide') { out.transforms.push('translate(-100%, 0)'); continue; }        // 推断：从左滑入
      if (kind === 'slideSwitch') {                                                          // 推断：缩小+淡出
        out.transforms.push('scale(0.8)');
        if (out.opacity === undefined) out.opacity = 0;
        out.warnings.push('TransitionEffect.SLIDE_SWITCH 的具体参数 .d.ts 未给出 → 按 scale(0.8)+opacity 0 近似（推断）');
        continue;
      }
      out.warnings.push(`TransitionEffect 的 ${kind} 未实现（本次不动这一项）`);
    }
    return out;
  }
  const TransitionEdge = { Top: 0, Bottom: 1, Left: 2, Right: 3 };
  // 自省用的"偏离态"文本（断言据此核对 translate/scale/opacity 真的被算进去了）
  function _offText(off) {
    const parts = [];
    if (off.opacity !== undefined) parts.push('opacity=' + off.opacity);
    if (off.transforms.length) parts.push('transform=' + off.transforms.join(' '));
    return parts.join(' ');
  }

  // 把一次 transition 解析成"某方向要不要动、怎么动、多久"
  function transitionPlanFor(el, dir) {          // dir: 'enter' | 'exit'
    const spec = el && el.__arkuiTransition;
    if (!spec) return null;
    const wantInsert = spec.isEffect ? true : (spec.type === TransitionType.All || spec.type === TransitionType.Insert);
    const wantDelete = spec.isEffect ? true : (spec.type === TransitionType.All || spec.type === TransitionType.Delete);
    const want = dir === 'enter' ? wantInsert : wantDelete;
    const typeName = spec.isEffect ? 'All(effect)' : (TRANSITION_DIR_NAME[spec.type] || String(spec.type));
    if (!want) return { skip: `type=${typeName} 不含 ${dir === 'enter' ? 'Insert' : 'Delete'}` };
    let payload = spec.payload;
    if (spec.isEffect && spec.payload && spec.payload.kind === 'asymmetric') {
      payload = dir === 'enter' ? spec.payload.value.appear : spec.payload.value.disappear;
    }
    const isEffect = spec.isEffect;
    const off = _offStyleOf(payload, isEffect);
    if (!off.transforms.length && off.opacity === undefined) {
      return { skip: 'IDENTITY（没有可动的属性）' };
    }
    // 时长：effect 自带 > 外层 animateTo 窗口 > AnimateParam 默认
    const own = isEffect ? _effectAnim(payload) : undefined;
    let duration; let delay; let curveCss; let source; let curveName;
    if (own) {
      duration = own.duration === undefined ? 1000 : Number(own.duration);
      delay = own.delay === undefined ? 0 : Number(own.delay);
      curveCss = animCurveCss(own.curve);
      curveName = animCurveName(own.curve);
      source = 'effect';
    } else if (animWindow) {
      // 窗口对象的曲线在 `win.rec.curveCss`（窗口本身只带 duration/delay）—— 别读错字段，
      // 读错不会报错，只会把 curve 弄丢（CSS 静默回落到 ease），这类"静默降级"最难发现
      duration = animWindow.duration; delay = animWindow.delay;
      curveCss = (animWindow.rec && animWindow.rec.curveCss) || 'linear';
      curveName = (animWindow.rec && animWindow.rec.curve) || 'Linear';
      source = 'animateTo';
    } else {
      duration = 1000; delay = 0; curveCss = 'linear'; source = 'default';
    }
    return {
      off, duration, delay, curveCss, curveName, source, typeName,
      identifier: el.id || '(无 id)', onFinish: spec.onFinish,
    };
  }

  const transitionTimers = new Set();
  function _transitionWitness(el, run) {         // 与 animateTo 一样：transitionend 只当"见证"，不当收口依据
    const fn = () => { run.sawTransitionEnd = true; };
    el.addEventListener('transitionend', fn, { once: true });
    return () => el.removeEventListener('transitionend', fn);
  }
  function _finishTransitionRun(el, run, plan, cleanup) {
    run.endedBy = 'timer';
    cleanup();
    el.style.transitionProperty = '';
    el.style.transitionDuration = '';
    el.style.transitionTimingFunction = '';
    el.style.transitionDelay = '';
    delete el.dataset.arkuiTransition;
    if (plan && typeof plan.onFinish === 'function') {
      try { plan.onFinish(run.dir === 'enter'); }
      catch (e) { layoutWarnings.push(`transition 的 onFinish 抛错：${e && e.message}`); }
    }
  }
  function runEnterTransition(el, plan) {
    const run = {
      seq: ++transitionRunSeq, dir: 'enter', id: plan.identifier, target: 'identity',
      duration: plan.duration, delay: plan.delay, curve: plan.curveName, curveCss: plan.curveCss, source: plan.source,
      offText: _offText(plan.off), endedBy: null, sawTransitionEnd: false,
    };
    transitionRuns.push(run);
    const offOpacity = plan.off.opacity;
    const offTransform = plan.off.transforms.join(' ');
    for (const w of plan.off.warnings) layoutWarnings.push(`transition(${plan.identifier}): ${w}`);
    // 先落到"偏离态"，**强制一次重排**把起始值提交掉，再带 transition 回到常态 ——
    // 这样不依赖 rAF（headless 里 rAF 节流不确定，见坑表 ⑧）
    if (offOpacity !== undefined) el.style.opacity = String(offOpacity);
    if (offTransform) el.style.transform = offTransform;
    el.dataset.arkuiTransition = 'enter';
    void el.offsetHeight;
    const stopWitness = _transitionWitness(el, run);
    el.style.transitionProperty = 'opacity, transform';
    el.style.transitionDuration = plan.duration + 'ms';
    el.style.transitionTimingFunction = plan.curveCss;
    el.style.transitionDelay = plan.delay + 'ms';
    if (offOpacity !== undefined) el.style.opacity = '';
    if (offTransform) el.style.transform = '';
    const cleanup = () => { stopWitness(); transitionTimers.delete(timer); };
    const timer = setTimeout(() => _finishTransitionRun(el, run, plan, cleanup),
      Math.max(0, plan.duration + plan.delay) + 30);
    transitionTimers.add(timer);
  }
  function runExitTransition(el, plan) {
    const run = {
      seq: ++transitionRunSeq, dir: 'exit', id: plan.identifier, target: 'off',
      duration: plan.duration, delay: plan.delay, curve: plan.curveName, curveCss: plan.curveCss, source: plan.source,
      offText: _offText(plan.off), endedBy: null, sawTransitionEnd: false,
    };
    transitionRuns.push(run);
    const offOpacity = plan.off.opacity;
    const offTransform = plan.off.transforms.join(' ');
    for (const w of plan.off.warnings) layoutWarnings.push(`transition(${plan.identifier}): ${w}`);
    el.dataset.arkuiTransition = 'exit';
    const stopWitness = _transitionWitness(el, run);
    el.style.transitionProperty = 'opacity, transform';
    el.style.transitionDuration = plan.duration + 'ms';
    el.style.transitionTimingFunction = plan.curveCss;
    el.style.transitionDelay = plan.delay + 'ms';
    if (offOpacity !== undefined) el.style.opacity = String(offOpacity);
    if (offTransform) el.style.transform = offTransform;
    const cleanup = () => { stopWitness(); transitionTimers.delete(timer); };
    const timer = setTimeout(() => {
      _finishTransitionRun(el, run, plan, cleanup);
      el.remove();                                // 过渡走完才真的摘掉
      purgeDetachedRecords();
    }, Math.max(0, plan.duration + plan.delay) + 30);
    transitionTimers.add(timer);
  }

  // 拆容器时：带"消失过渡"的子节点留在 DOM 里把动画走完，其余立刻摘
  function detachChildren(container) {
    if (!container) return;
    for (const child of [...container.children]) {
      const plan = transitionPlanFor(child, 'exit');
      if (plan && !plan.skip) runExitTransition(child, plan);
      else child.remove();
    }
  }

  // 登记：属性管线把 `.transition(...)` 的实参原样交过来
  function registerTransition(node, value, onFinish) {
    if (!node) return;
    let spec;
    if (value instanceof TransitionEffect) {
      spec = { isEffect: true, payload: value, summary: _effectSummary(value), type: TransitionType.All };
    } else if (value && typeof value === 'object') {
      spec = {
        isEffect: false, payload: value, type: value.type === undefined ? TransitionType.All : value.type,
        summary: Object.keys(value).filter((k) => k !== 'type').join(',') || '(空)',
      };
      if (value.type !== undefined && TRANSITION_DIR_NAME[value.type] === undefined) {
        layoutWarnings.push(`transition 的 type=${value.type} 不是 TransitionType 的成员，按 All 处理`);
      }
    } else {
      layoutWarnings.push(`transition 收到不支持的值类型（${typeof value}）—— 本次不产生动画`);
      return;
    }
    spec.onFinish = typeof onFinish === 'function' ? onFinish : undefined;
    spec.seq = ++transitionSeq;
    node.__arkuiTransition = spec;
    transitionRegistered.push({
      seq: spec.seq, id: node.id || '(无 id)', kind: spec.isEffect ? 'TransitionEffect' : 'TransitionOptions',
      type: TRANSITION_DIR_NAME[spec.type] || String(spec.type), summary: spec.summary,
      hasOnFinish: !!spec.onFinish,
    });
    // 刚挂上的节点（本轮渲染新建的）→ 现在就跑"出现"过渡。重渲染时不会带这个标记，
    // 所以不会出现"每次重渲染都重新播一遍出现动画"。
    if (node.__arkuiFreshMount) {
      delete node.__arkuiFreshMount;
      const plan = transitionPlanFor(node, 'enter');
      if (plan && !plan.skip) runEnterTransition(node, plan);
    }
  }
  function transitionsDescribe() {
    return {
      registered: transitionRegistered.map((r) => Object.assign({}, r)),
      runs: transitionRuns.map((r) => Object.assign({}, r)),
      pending: transitionTimers.size,
      text: () => transitionRegistered.map((r) => `#${r.id} ${r.kind}/${r.type}/${r.summary}`
        + (r.hasOnFinish ? '+onFinish' : '')).join(' | '),
      runsText: () => transitionRuns.map((r) => `${r.dir}:${r.id}/${r.duration}+${r.delay}/${r.source}/${r.endedBy}`
        + `/te=${r.sawTransitionEnd}`).join(' | '),
    };
  }

  let animWindow = null;                 // 当前开着的动画窗口（rerenderElmt 会往里收集节点）
  const animHistory = [];
  let animSeq = 0;
  let onFinishCount = 0;

  function animCurveCss(curve) {
    if (typeof curve === 'string' && curve) return curve;      // CSS 关键字 / cubic-bezier(...)
    if (typeof curve === 'number' && CURVE_NAMES[curve] !== undefined) {
      return CURVE_CSS[CURVE_NAMES[curve]] || 'ease-in-out';
    }
    if (curve && typeof curve === 'object') {
      layoutWarnings.push('animateTo 的 curve 是 ICurve（弹簧/自定义插值）：CSS transition 表达不了，'
        + '本次退化为 ease-in-out —— 真机上会按 interpolate 逐帧插值');
      return 'ease-in-out';
    }
    return 'ease-in-out';                                      // .d.ts 默认 Curve.EaseInOut
  }
  function animCurveName(curve) {
    if (typeof curve === 'number' && CURVE_NAMES[curve] !== undefined) return CURVE_NAMES[curve];
    if (typeof curve === 'string' && curve) return curve;
    if (curve && typeof curve === 'object') return 'ICurve';
    return 'EaseInOut(默认)';
  }

  function animFireFinish(win) {
    onFinishCount++;
    if (typeof win.onFinish !== 'function') return;
    // 回调一律异步（同 AsyncCallback 的规矩）
    Promise.resolve().then(() => {
      try { win.onFinish(); } catch (e) {
        layoutWarnings.push(`animateTo 的 onFinish 抛错：${e && e.message}`);
      }
    });
  }

  function animFinish(win, how) {
    if (!win || win.done) return;
    win.done = true;
    if (win.timer) clearTimeout(win.timer);
    for (const el of win.els) {
      const s = el.__animStyle || {};
      el.style.transitionProperty = s.prop || '';
      el.style.transitionDuration = s.dur || '';
      el.style.transitionTimingFunction = s.curve || '';
      el.style.transitionDelay = s.delay || '';
      el.removeAttribute('data-arkui-anim');
      delete el.__animStyle;
    }
    for (const [el, fn] of win.listeners) el.removeEventListener('transitionend', fn);
    win.listeners.length = 0;
    win.rec.endedBy = how;
    win.rec.sawTransitionEnd = !!win.sawTransitionEnd;
    win.rec.els = win.els.length;
    animFireFinish(win);
  }

  function runExplicitAnimation(param, fn, api) {
    if (typeof fn !== 'function') {
      // .d.ts: animateTo(value: AnimateParam, event: () => void) —— event 是必填
      throw bizError(401, `${api}(value, event): 缺少 event 闭包（.d.ts 里它是必填的 () => void）`);
    }
    const p = (param && typeof param === 'object') ? param : {};
    const duration = (p.duration === undefined || p.duration === null) ? 1000 : Number(p.duration);  // @default 1000
    const delay = (p.delay === undefined || p.delay === null) ? 0 : Number(p.delay);
    // CSS transition 表达不了的参数：出声
    if (p.iterations !== undefined && p.iterations !== 1) {
      layoutWarnings.push(`animateTo 的 iterations=${p.iterations} 无法用 CSS transition 表达`
        + '（transition 只跑一次）—— 本次按 1 次执行');
    }
    if (p.playMode !== undefined && p.playMode !== 0) {
      layoutWarnings.push(`animateTo 的 playMode=${p.playMode} 无法用 CSS transition 表达`
        + '（单向位移没有"反向/交替"的概念）—— 本次按 Normal 执行');
    }
    if (p.tempo !== undefined && p.tempo !== 1) {
      layoutWarnings.push(`animateTo 的 tempo=${p.tempo} 未实现（需要缩放时长，请直接改 duration）`);
    }
    if (p.expectedFrameRateRange !== undefined) {
      layoutWarnings.push('animateTo 的 expectedFrameRateRange 未实现（帧率由浏览器决定）');
    }
    // 同一时刻只维护一个窗口：上一个还没结束就先收口（否则两个窗口会互相清 transition）
    if (animWindow) animFinish(animWindow, 'superseded');

    const rec = {
      seq: ++animSeq, api, duration, delay,
      curve: animCurveName(p.curve), curveCss: animCurveCss(p.curve),
      els: 0, endedBy: null, sawTransitionEnd: false,
    };
    animHistory.push(rec);

    if (!(duration > 0)) {
      fn();                                    // duration:0 → 不进动画
      flush();
      rec.endedBy = 'duration-0';
      animFireFinish({ onFinish: p.onFinish });
      return undefined;
    }

    const win = {
      seq: rec.seq, api, duration, delay, onFinish: p.onFinish, rec,
      els: [], listeners: [], sawTransitionEnd: false, done: false,
    };
    animWindow = win;
    try {
      fn();
    } finally {
      flush();                                 // 同步落地（不变量 7 允许关键路径同步 flush）
      animWindow = null;
    }
    const els = [...new Set(win.els)].filter((el) => el && el.style);
    win.els = els;
    if (els.length === 0) {
      // fn() 没引起任何重渲染 → 没有可动画的节点。这不该静默：多半是写错了（比如在 aboutToAppear 里调用）
      layoutWarnings.push(`${api} 的 fn() 没有引起任何节点重渲染 → 没有可动画的属性`
        + '（.d.ts 明确警告不要在 aboutToAppear/aboutToDisappear 里用它）');
      animFinish(win, 'no-target');
      return undefined;
    }
    for (const el of els) {
      el.__animStyle = {
        prop: el.style.transitionProperty, dur: el.style.transitionDuration,
        curve: el.style.transitionTimingFunction, delay: el.style.transitionDelay,
      };
      el.style.transitionProperty = 'all';
      el.style.transitionDuration = duration + 'ms';
      el.style.transitionTimingFunction = rec.curveCss;
      el.style.transitionDelay = delay + 'ms';
      el.setAttribute('data-arkui-anim', String(win.seq));
      const onEnd = (ev) => {
        if (ev && ev.target === el) win.sawTransitionEnd = true;   // 浏览器真的跑了过渡（无头环境下可能不来）
      };
      el.addEventListener('transitionend', onEnd);
      win.listeners.push([el, onEnd]);
    }
    rec.els = els.length;
    // 结束时间 = duration + delay（稍加余量）；transitionend 只作为"浏览器真跑了"的旁证记录，
    // 不用它来清理 —— 否则多属性/无头环境下会清早或清晚
    win.timer = setTimeout(() => animFinish(win, 'timer'), Math.max(0, duration) + Math.max(0, delay) + 30);
    return undefined;
  }

  const Context = {
    animateTo: (param, fn) => runExplicitAnimation(param, fn, 'animateTo'),
    // animateToImmediately 与 animateTo 在 DOM 里等价：CSS transition 本来就是"下一帧开始"。
    // 真机差异（不等 vsync 立即投递）在 CSS 里没有对应物，见 docs 已知限制。
    animateToImmediately: (param, fn) => runExplicitAnimation(param, fn, 'animateToImmediately'),
  };

  // ────────────────────── 手势（R23） ──────────────────────
  //
  // ⚠️ 调用约定（实测产物）：**两层栈**，全部走自由变量（不走 import）：
  //
  //   globalThis.Gesture.create(GesturePriority.LOW);   // ① 打开手势作用域
  //   PanGesture.create({fingers, direction, distance});
  //   PanGesture.onActionStart(cb); PanGesture.onActionUpdate(cb); PanGesture.onActionEnd(cb);
  //   PanGesture.pop();                                  // ② 收一个手势
  //   globalThis.Gesture.pop();                          // ③ 关作用域 → 挂到"当前节点"上
  //
  // 「当前节点」= 组件栈顶：手势作用域嵌在组件的构建器里（`Row…Gesture.create…Gesture.pop…Row.pop`），
  // 关作用域时栈顶正是那个组件，所以不需要 `.gesture()` 这样的属性方法（产物里也没有）。
  //
  // 识别器全部基于真实 DOM **pointer 事件**（pointerdown/move/up/cancel）+ setPointerCapture，
  // 这样合成事件（dispatchEvent）与真实指针走的是同一条路。
  const PanDirection = { None: 0, Horizontal: 1, Left: 2, Right: 3, Vertical: 4, Up: 5, Down: 6, All: 7 };
  const SwipeDirection = { None: 0, Horizontal: 1, Vertical: 2, All: 3 };
  // GesturePriority 有【两套名字】，必须同时提供：
  //  · 产物实发的是 ets-loader 的约定名（sdk/.../ets-loader/lib/pre_define.js）：
  //      GESTURE_ENUM_KEY="GesturePriority"、GESTURE_ENUM_VALUE_LOW/HIGH/PARALLEL="Low"/"High"/"Parallel"，
  //      .gesture() / .priorityGesture() / .parallelGesture() 三个属性经 gestureMap 映射成这三个成员
  //      （实测见 fixtures/pages/GestureGroupDemo.ts：create(GesturePriority.Low|High|Parallel)）。
  //  · .d.ts 里 `declare enum GesturePriority { NORMAL = 0, PRIORITY = 1 }` 是【另一套】（API 12 的
  //      addGesture 用的）；源码里手写 NORMAL/PRIORITY 会被 loader 原样透传，所以也得支持。
  //  对齐关系：NORMAL=Low、PRIORITY=High；Parallel 是产物独有的第三档（父子并列响应，不参与独占仲裁）。
  //  ⚠️ 旧实现只定义了 {NORMAL, PRIORITY} → 产物的 `GesturePriority.Low` 是 undefined，三个属性在
  //     运行时**完全区分不开**（都退化成默认档）。这是本轮修掉的 bug。
  const GesturePriority = { NORMAL: 0, PRIORITY: 1, Low: 0, High: 1, Parallel: 2 };
  // .d.ts：GestureMask.Normal = 子组件手势按默认顺序参战；IgnoreInternal = **禁用子组件手势**
  // （含 List 这类内置手势；父子区域部分重叠时只禁重叠区）。后者在仲裁里按"压制所有后代"实现。
  const GestureMask = { Normal: 0, IgnoreInternal: 1 };
  // .d.ts 声明顺序即取值：Sequence / Parallel / Exclusive
  const GestureMode = { Sequence: 0, Parallel: 1, Exclusive: 2 };

  const gestureScopes = [];              // Gesture.create/pop 的作用域栈
  const gestureBuild = [];               // 正在构建的手势记录栈（各手势 + 手势组的 create/pop）
  const TAP_SLOP_PX = 10;                // 超过这个位移就不算 tap（ArkUI 内部也有类似的容差）
  const TAP_WINDOW_MS = 300;             // 连续点击的归组窗口

  function gestureEvent(extra) {
    // GestureEvent 的字段（.d.ts）：repeat/fingerList/offsetX/offsetY/angle/speed/scale/
    // pinchCenterX/pinchCenterY/velocityX/velocityY/velocity + BaseEvent 的 timestamp
    return Object.assign({
      repeat: false, fingerList: [], offsetX: 0, offsetY: 0, angle: 0, speed: 0,
      scale: 1, pinchCenterX: 0, pinchCenterY: 0,
      velocityX: 0, velocityY: 0, velocity: 0, timestamp: Date.now(),
    }, extra || {});
  }

  // ── 手势仲裁（R23 收口）──
  // 三条规则各有 .d.ts 原文依据，互不干扰：
  //  ① 元素级（父子包含链）—— CommonMethod 的文档原文：
  //      · `gesture`：      「By default, the child component preferentially recognizes the gesture
  //                         specified by gesture」→ 默认【子优先】
  //      · `priorityGesture`：「the parent component preferentially recognizes the gesture specified by
  //                         priorityGesture (if set)」→ 父档位高，压过内层
  //      · `parallelGesture`：「the gesture event is not a bubbling event. When parallelGesture is set
  //                         for a component, both it and its child component can respond to the same
  //                         gesture events」→ 准冒泡，父子都触发
  //      · `GestureMask.IgnoreInternal`：「The gestures of child components are disabled, including the
  //                         built-in gestures」→ 压制所有后代
  //  ② 组级（GestureGroup 三态）—— 见 fireGesture 里的分档处理
  //  ③ 元素内多个作用域：按元素取最高档（block > high > parallel > low），不做逐手势区分
  //
  // 元素级仲裁必须在任何识别结果【之前】定下来：pointer 事件由内向外冒泡，所以内层先"认领"，
  // 外层后到、可以覆盖；识别循环之后只查 isEligible()，不再参与决策。
  const ARB_BLOCK = 'block', ARB_HIGH = 'high', ARB_PARALLEL = 'parallel', ARB_LOW = 'low';
  const gestureSessions = new Map();   // pointerId -> {chain:[el], ownerEl, ownerClass, captureEl}

  function gestureArbClass(records) {
    let high = false, par = false, block = false;
    for (const r of records) {
      if (r.__mask === GestureMask.IgnoreInternal) block = true;
      if (r.__priority === GesturePriority.High) high = true;
      if (r.__priority === GesturePriority.Parallel) par = true;
    }
    return block ? ARB_BLOCK : (high ? ARB_HIGH : (par ? ARB_PARALLEL : ARB_LOW));
  }

  function participate(el, st, ev) {
    let s = gestureSessions.get(ev.pointerId);
    if (!s) {
      s = { chain: [], ownerEl: null, ownerClass: null, captureEl: null };
      gestureSessions.set(ev.pointerId, s);
    }
    if (s.chain.indexOf(el) >= 0) return;          // 同一指针不重复参战
    s.chain.push(el);
    const cls = st.arbClass;
    if (cls === ARB_BLOCK || cls === ARB_HIGH) {
      // block 能压过内层任意档；high 只压过内层 low（内层同为 high 时按"内层优先"）
      if (s.ownerEl && (cls === ARB_BLOCK || s.ownerClass === ARB_LOW)) s.ownerEl = null;
      if (!s.ownerEl) { s.ownerEl = el; s.ownerClass = cls; }
    } else if (cls === ARB_PARALLEL) {
      // 不参与独占，但始终可触发（见 gestureArbState）
    } else if (!s.ownerEl) {
      s.ownerEl = el; s.ownerClass = ARB_LOW;
    }
    // 指针捕获只交给【最先见到的那一个】（=最内层）：捕获只改事件的 target，事件仍沿祖先链冒泡，
    // 所以链上每个元素都还收得到；交给最内层，才能让"最内层是 parallel 的子元素"继续收到移动。
    if (!s.captureEl) {
      s.captureEl = el;
      try { el.setPointerCapture(ev.pointerId); } catch (_) { /* 合成事件可能不支持 */ }
    }
  }

  // 元素对外的仲裁结论（也是内省用的口径）：
  //   owner=本次会话归它 / parallel=并列参战 / suppressed=被压制 / idle=没有活跃会话
  function gestureArbState(st) {
    let seen = false;
    for (const s of gestureSessions.values()) {
      if (s.chain.indexOf(st.el) < 0) continue;
      seen = true;
      if (s.ownerEl === st.el) return 'owner';
      if (st.arbClass === ARB_PARALLEL) return 'parallel';
    }
    return seen ? 'suppressed' : 'idle';
  }

  // 会话只能由【冒泡路径上最后参战的那个元素】来删：pointerup 会继续往外冒泡，
  // 外层元素还要读同一份仲裁结论。若最内层先删，被压制的祖先就会查不到结论而误触发。
  function isSessionTail(st, ev) {
    const s = gestureSessions.get(ev.pointerId);
    return !s || s.chain[s.chain.length - 1] === st.el;
  }

  // "识别完成"对应的回调名（Exclusive 靠它判先后、Sequence 靠它推进阶段）
  const GESTURE_RECOG_KIND = {
    tap: 'onAction', longPress: 'onAction', pan: 'onActionStart',
    pinch: 'onActionStart', rotation: 'onActionStart', swipe: 'onAction',
  };
  const GESTURE_MODE_NAME = ['Sequence', 'Parallel', 'Exclusive'];
  const GESTURE_MASK_NAME = ['Normal', 'IgnoreInternal'];

  function flattenGestures(records, out) {
    const acc = out || [];
    for (const r of records) {
      if (r && r.__isGroup) flattenGestures(r.gestures, acc);
      else if (r) acc.push(r);
    }
    return acc;
  }

  function fireGroupCancel(g) {
    if (typeof g.onCancel !== 'function') return;
    try { g.onCancel(); } catch (e) {
      layoutWarnings.push(`手势组 onCancel 回调抛错：${e && e.message}`);
    }
  }

  // 会话收尾（所有指头都抬起 / 被系统取消）：
  //  · Sequence 没走完 = 「某一步没认出 → 后面的不再认」，按文档触发该组 onCancel；
  //  · 指针被 pointercancel 掉、而该组已认出过成员 → 也触发 onCancel。
  // 无论是否触发，都把组状态归零，免得下一次手势继承了上一次的 winner/stage。
  function settleGroups(st, cancelled) {
    for (const g of st.gestures) {
      if (!g.__isGroup) continue;
      let fire = false;
      if (g.mode === GestureMode.Sequence) fire = g.stage > 0 && g.stage < g.gestures.length;
      else fire = cancelled && !!g.anyRecognized;
      g.winner = null; g.stage = 0; g.anyRecognized = false;
      if (fire) fireGroupCancel(g);
    }
  }

  // 返回值 = 这次回调【有没有被仲裁放行】。识别器只在这个返回 true 时才推进内部状态：
  // 否则会出现"手势标成已开始、但 start 从没发出去"的错位（Sequence 的门控尤其致命）。
  function fireGesture(st, rec, kind, ev) {
    if (!rec) return false;
    if (gestureArbState(st) === 'suppressed') return false;  // ① 元素级（父子链）
    const g = rec.__group;
    if (g) {                                                 // ② 组级
      const recog = GESTURE_RECOG_KIND[rec.type] === kind;
      if (g.mode === GestureMode.Exclusive) {
        if (g.winner && g.winner !== rec) return false;      // 先认出者独占，其余作废
        if (!g.winner && recog) { g.winner = rec; g.anyRecognized = true; }
      } else if (g.mode === GestureMode.Sequence) {
        const i = g.gestures.indexOf(rec);
        if (i > g.stage) return false;                       // 还没轮到它
        if (kind === 'onActionEnd' && i < g.gestures.length - 1) return false;  // 只有最后一个能收 End
        if (i === g.stage && recog) { g.stage = i + 1; g.anyRecognized = true; }
      } else if (recog) {
        g.anyRecognized = true;                              // Parallel：互不影响，只记账
      }
    }
    if (typeof rec[kind] === 'function') {
      try { rec[kind](ev); } catch (e) {
        layoutWarnings.push(`手势 ${rec.type}.${kind} 回调抛错：${e && e.message}`);
      }
    }
    return true;
  }

  function gestureDirOk(rec, dx, dy) {
    const d = (rec.params.direction === undefined || rec.params.direction === null)
      ? null : Number(rec.params.direction);
    const horiz = Math.abs(dx) >= Math.abs(dy);
    switch (d) {
      case null: case PanDirection.All: return true;
      case PanDirection.Horizontal: return horiz;
      case PanDirection.Vertical: return !horiz;
      case PanDirection.Left: return dx < 0 && horiz;
      case PanDirection.Right: return dx > 0 && horiz;
      case PanDirection.Up: return dy < 0 && !horiz;
      case PanDirection.Down: return dy > 0 && !horiz;
      default: return true;
    }
  }
  function swipeDirOk(rec, dx, dy) {
    const d = (rec.params.direction === undefined || rec.params.direction === null)
      ? SwipeDirection.All : Number(rec.params.direction);
    const horiz = Math.abs(dx) >= Math.abs(dy);
    if (d === SwipeDirection.All) return true;
    if (d === SwipeDirection.Horizontal) return horiz;
    if (d === SwipeDirection.Vertical) return !horiz;
    return true;
  }

  // RotationGesture 的角度（.d.ts 原文）：
  //   "the line connecting the two fingers is identified as the starting line ... The rotation angle is
  //    calculated as arctan2(cy2-cy1, cx2-cx1) - arctan2(y2-y1, x2-x1). With the starting line as the
  //    reference axis, clockwise rotation ranges from 0 to 180 degrees, and counterclockwise ... 0 to -180"
  // 屏幕坐标 y 向下，故 atan2 的顺时针为正，正好对上；归一化到 [−180, 180]。
  const RAD2DEG = 180 / Math.PI;
  const lineDeg = (p, q) => Math.atan2(q.y - p.y, q.x - p.x) * RAD2DEG;
  const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  function rotationDeltaDeg(startLine, p0, p1) {
    if (!startLine) return 0;
    return norm180(lineDeg(p0, p1) - lineDeg({ x: startLine.x1, y: startLine.y1 },
      { x: startLine.x2, y: startLine.y2 }));
  }

  function detachGestures(el) {
    const st = el && el.__arkuiGestureState;
    if (!st) return;
    for (const [k, fn] of st.listeners) el.removeEventListener(k, fn);
    for (const rs of st.longPress) if (rs.timer) clearTimeout(rs.timer);
    if (st.tapTimer) clearTimeout(st.tapTimer);
    el.__arkuiGestureState = null;
  }
  function gestureTypes(el) {
    const st = el && el.__arkuiGestureState;
    return st ? st.gestures.map((g) => (g.__isGroup ? 'group' : g.type)) : [];
  }
  function gestureGroups(el) {
    const st = el && el.__arkuiGestureState;
    if (!st) return [];
    return st.gestures.filter((g) => g.__isGroup).map((g) => ({
      mode: GESTURE_MODE_NAME[g.mode] || String(g.mode),
      members: flattenGestures(g.gestures).map((x) => x.type),
    }));
  }

  function attachGestures(el, gestures) {
    detachGestures(el);
    const st = {
      el,
      gestures: gestures.slice(), listeners: [], longPress: [],
      ptrs: new Map(), recState: new Map(), tapCount: 0, tapTimer: null,
    };
    st.arbClass = gestureArbClass(st.gestures);
    // 识别循环一律跑【摊平后】的手势表：组只是登记层，识别与回调仍在元素这一层做
    const flat = flattenGestures(st.gestures);
    el.__arkuiGestureState = st;
    const on = (k, fn) => { el.addEventListener(k, fn); st.listeners.push([k, fn]); };
    const primary = () => {
      let best = null;
      for (const p of st.ptrs.values()) if (!best || p.seq < best.seq) best = p;
      return best;
    };
    const clearLongPress = () => {
      for (const rs of st.longPress) { if (rs.timer) clearTimeout(rs.timer); rs.timer = null; }
      st.longPress = [];
    };

    const onDown = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      st.ptrs.set(ev.pointerId, {
        seq: st.ptrs.size, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY,
        x: ev.clientX, y: ev.clientY, t: Date.now(),
      });
      // 先定仲裁（内含指针捕获，见 participate），再让识别器开局
      participate(el, st, ev);
      for (const rec of flat) {
        if (rec.type === 'longPress') {
          const dur = rec.params.duration === undefined ? 500 : Number(rec.params.duration);
          const rs = { rec, timer: null, fired: 0, dur };
          const tick = () => {
            fireGesture(st, rec, 'onAction', gestureEvent({ repeat: rs.fired > 0 }));
            rs.fired++;
            if (rec.params.repeat === true) rs.timer = setTimeout(tick, dur);
          };
          rs.timer = setTimeout(tick, dur);
          st.longPress.push(rs);
        } else if (rec.type === 'pinch') {
          // d0（初始两指距离）必须在【第二个指针按下时】取，而不是"第一次 move" ——
          // 否则第一帧的移动会被当成基准，scale 永远从 1 开始（实测踩到）
          let d0 = 0;
          if (st.ptrs.size >= 2) {
            const arr = [...st.ptrs.values()].sort((a, b) => a.seq - b.seq);
            d0 = Math.hypot(arr[1].x - arr[0].x, arr[1].y - arr[0].y);
          }
          st.recState.set(rec, { started: false, d0 });
        } else if (rec.type === 'pan') {
          st.recState.set(rec, { started: false });
        } else if (rec.type === 'rotation') {
          // 起始线取【第二指按下时】的两指连线 —— 与 pinch 的 d0 同一时机。
          // （.d.ts 说"detected 时"，但那一刻基准已被首帧位移吃掉；取按下时刻更确定，
          //   两者差异的上界恰好就是 angle 阈值本身。）
          let startLine = null;
          if (st.ptrs.size >= 2) {
            const arr = [...st.ptrs.values()].sort((a, b) => a.seq - b.seq);
            startLine = { x1: arr[0].x, y1: arr[0].y, x2: arr[1].x, y2: arr[1].y };
          }
          st.recState.set(rec, { started: false, startLine });
        }
      }
    };

    const onMove = (ev) => {
      const p = st.ptrs.get(ev.pointerId);
      if (!p) return;
      p.x = ev.clientX; p.y = ev.clientY;
      const first = primary();
      const dx = first ? first.x - first.x0 : 0;
      const dy = first ? first.y - first.y0 : 0;
      const dist = Math.hypot(dx, dy);
      if (dist > TAP_SLOP_PX) clearLongPress();            // 动了就不算长按
      for (const rec of flat) {
        if (rec.type === 'pan') {
          const th = rec.params.distance === undefined ? 5 : Number(rec.params.distance);
          const rs = st.recState.get(rec) || { started: false };
          st.recState.set(rec, rs);
          if (!rs.started) {
            // 只有回调真的发出去（没被组仲裁挡下）才把识别器标成已开始
            if (dist >= th && gestureDirOk(rec, dx, dy)
              && fireGesture(st, rec, 'onActionStart', gestureEvent({ offsetX: dx, offsetY: dy }))) {
              rs.started = true;
            }
          } else if (gestureDirOk(rec, dx, dy)) {
            fireGesture(st, rec, 'onActionUpdate', gestureEvent({ offsetX: dx, offsetY: dy }));
          }
        } else if (rec.type === 'pinch' && st.ptrs.size >= 2) {
          const arr = [...st.ptrs.values()].sort((a, b) => a.seq - b.seq);
          const d = Math.hypot(arr[1].x - arr[0].x, arr[1].y - arr[0].y);
          const rs = st.recState.get(rec) || { started: false, d0: 0 };
          st.recState.set(rec, rs);
          const th = rec.params.distance === undefined ? 5 : Number(rec.params.distance);
          if (!rs.started) {
            if (rs.d0 === 0) rs.d0 = d;
            else if (Math.abs(d - rs.d0) >= th
              && fireGesture(st, rec, 'onActionStart', gestureEvent({
                scale: d / rs.d0,
                pinchCenterX: (arr[0].x + arr[1].x) / 2, pinchCenterY: (arr[0].y + arr[1].y) / 2,
              }))) {
              rs.started = true;
            }
          } else {
            fireGesture(st, rec, 'onActionUpdate', gestureEvent({
              scale: d / rs.d0,
              pinchCenterX: (arr[0].x + arr[1].x) / 2, pinchCenterY: (arr[0].y + arr[1].y) / 2,
            }));
          }
        } else if (rec.type === 'rotation' && st.ptrs.size >= 2) {
          const arr = [...st.ptrs.values()].sort((a, b) => a.seq - b.seq);
          const rs = st.recState.get(rec) || { started: false, startLine: null };
          st.recState.set(rec, rs);
          if (!rs.startLine) {
            rs.startLine = { x1: arr[0].x0, y1: arr[0].y0, x2: arr[1].x0, y2: arr[1].y0 };
          }
          rs.angle = rotationDeltaDeg(rs.startLine, arr[0], arr[1]);
          const th = rec.params.angle === undefined ? 1 : Number(rec.params.angle);
          if (!rs.started) {
            if (Math.abs(rs.angle) >= th
              && fireGesture(st, rec, 'onActionStart', gestureEvent({ angle: rs.angle }))) {
              rs.started = true;
            }
          } else {
            fireGesture(st, rec, 'onActionUpdate', gestureEvent({ angle: rs.angle }));
          }
        }
      }
    };

    const onUp = (ev) => {
      const p = st.ptrs.get(ev.pointerId);
      if (!p) return;
      st.ptrs.delete(ev.pointerId);
      const dx = ev.clientX - p.x0;
      const dy = ev.clientY - p.y0;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, Date.now() - p.t);
      clearLongPress();
      const isLast = st.ptrs.size === 0;
      for (const rec of flat) {
        if (rec.type === 'pan') {
          const rs = st.recState.get(rec) || {};
          if (rs.started) {
            fireGesture(st, rec, 'onActionEnd', gestureEvent({ offsetX: dx, offsetY: dy }));
            rs.started = false;
          }
        } else if (rec.type === 'pinch') {
          const rs = st.recState.get(rec) || {};
          if (rs.started && st.ptrs.size < 2) {
            fireGesture(st, rec, 'onActionEnd', gestureEvent({ scale: rs.d0 ? 1 : 1 }));
            rs.started = false;
          }
        } else if (rec.type === 'rotation') {
          const rs = st.recState.get(rec) || {};
          if (rs.started && st.ptrs.size < 2) {
            // 结束时用【最后一次算出的角度】——抬手后再没有两指连线可算
            fireGesture(st, rec, 'onActionEnd', gestureEvent({ angle: rs.angle || 0 }));
            rs.started = false;
          }
        } else if (rec.type === 'tap') {
          if (dist <= TAP_SLOP_PX) {
            const count = rec.params.count === undefined ? 1 : Number(rec.params.count);
            st.tapCount++;
            if (st.tapTimer) clearTimeout(st.tapTimer);
            st.tapTimer = setTimeout(() => { st.tapCount = 0; st.tapTimer = null; }, TAP_WINDOW_MS);
            if (st.tapCount % count === 0) {
              fireGesture(st, rec, 'onAction', gestureEvent({ repeat: st.tapCount > count }));
            }
          }
        } else if (rec.type === 'swipe' && isLast) {
          // .d.ts：speed 单位 vp/s；angle 以水平向右为基准，顺时针 0~180、逆时针 0~-180
          const speed = (dist / dt) * 1000;
          const th = rec.params.speed === undefined ? 100 : Number(rec.params.speed);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (speed >= th && swipeDirOk(rec, dx, dy)) {
            fireGesture(st, rec, 'onAction', gestureEvent({ angle, speed }));
          }
        }
      }
      // 收尾必须在识别循环【之后】：tap 的识别就发生在本次 pointerup 里，
      // Sequence 的"有没有走完"要看到它刚推进过的阶段。
      if (isLast) settleGroups(st, false);
      if (isLast && isSessionTail(st, ev)) gestureSessions.delete(ev.pointerId);
    };

    const onCancel = (ev) => {
      const p = st.ptrs.get(ev.pointerId);
      if (p) st.ptrs.delete(ev.pointerId);
      clearLongPress();
      for (const rec of flat) {
        const rs = st.recState.get(rec) || {};
        if ((rec.type === 'pan' || rec.type === 'pinch' || rec.type === 'rotation') && rs.started) {
          fireGesture(st, rec, 'onActionCancel', gestureEvent({}));
          rs.started = false;
        }
      }
      if (st.ptrs.size === 0) settleGroups(st, true);
      if (st.ptrs.size === 0 && isSessionTail(st, ev)) gestureSessions.delete(ev.pointerId);
    };

    on('pointerdown', onDown);
    on('pointermove', onMove);
    on('pointerup', onUp);
    on('pointercancel', onCancel);
    return st;
  }

  // 手势构建器：`XxxGesture.create(params)` → `.on*（cb）` → `.pop()`
  const GESTURE_TYPES = {
    TapGesture: 'tap', LongPressGesture: 'longPress', PanGesture: 'pan',
    SwipeGesture: 'swipe', PinchGesture: 'pinch', RotationGesture: 'rotation',
  };
  // 收一个手势/手势组：归入【最近一层容器】——有手势组就进组，否则进当前手势作用域。
  // 产物里组是嵌套的（组内 `XxxGesture.pop()` 之后才 `GestureGroup.pop()`），
  // 所以要从栈顶往下找最近的组，而不是只看栈顶。
  function pushGestureRecord(rec) {
    if (!rec) return;
    for (let i = gestureBuild.length - 1; i >= 0; i--) {
      if (gestureBuild[i].__isGroup) { gestureBuild[i].gestures.push(rec); rec.__group = gestureBuild[i]; return; }
    }
    const scope = gestureScopes[gestureScopes.length - 1];
    if (!scope) {
      layoutWarnings.push(`${rec.name || rec.type}.pop() 不在任何 Gesture.create() 作用域里 —— 手势无处挂载`);
      return;
    }
    rec.__priority = scope.priority;
    rec.__mask = scope.mask;
    scope.list.push(rec);
  }

  function makeGestureBuilder(name) {
    const type = GESTURE_TYPES[name];
    const impl = {
      create(params) {
        const rec = { type, name, params: (params && typeof params === 'object') ? params : {}, seq: gestureSeq++ };
        gestureBuild.push(rec);
        return rec;
      },
      pop() {
        pushGestureRecord(gestureBuild.pop());
      },
    };
    // 未列举的 on* 方法一律当"回调 setter"（onAction/onActionStart/onActionUpdate/onActionEnd/onActionCancel）
    return new Proxy(impl, {
      get(target, key) {
        if (key in target) return target[key];
        if (typeof key === 'symbol') return undefined;
        let fn = target['__' + String(key)];
        if (!fn) {
          fn = function (cb) {
            const rec = gestureBuild[gestureBuild.length - 1];
            if (!rec) {
              layoutWarnings.push(`${name}.${String(key)}() 不在任何手势的 create 之后 —— 回调无处安放`);
              return undefined;
            }
            rec[String(key)] = cb;
            return undefined;
          };
          target['__' + String(key)] = fn;
        }
        return fn;
      },
    });
  }
  // GestureGroup 走同一套 create/on*/pop 协议，但它是【容器】：产物里
  //   GestureGroup.create(mode) → GestureGroup.onCancel(cb) → 组内各手势 create/on*/pop → GestureGroup.pop()
  // 组状态（winner/stage/anyRecognized）挂在组记录上，识别时由 rec.__group 反查（见 fireGesture）。
  const GestureGroup = new Proxy({
    create(mode) {
      const g = {
        __isGroup: true, name: 'GestureGroup', type: 'group',
        mode: mode === undefined ? GestureMode.Sequence : mode,
        gestures: [], winner: null, stage: 0, anyRecognized: false, seq: gestureSeq++,
      };
      gestureBuild.push(g);
      return g;
    },
    pop() {
      const g = gestureBuild.pop();
      for (let i = gestureBuild.length - 1; i >= 0; i--) {
        if (gestureBuild[i].__isGroup) {
          gestureBuild[i].gestures.push(g); g.__group = gestureBuild[i];
          return;
        }
      }
      const scope = gestureScopes[gestureScopes.length - 1];
      if (!scope) {
        layoutWarnings.push('GestureGroup.pop() 不在任何 Gesture.create() 作用域里 —— 手势组无处挂载');
        return;
      }
      g.__priority = scope.priority;
      g.__mask = scope.mask;
      scope.list.push(g);
    },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      let fn = target['__' + String(key)];
      if (!fn) {
        fn = function (cb) {
          const g = gestureBuild[gestureBuild.length - 1];
          if (!g || !g.__isGroup) {
            layoutWarnings.push(`GestureGroup.${String(key)}() 不在任何 GestureGroup.create() 之后 —— 回调无处安放`);
            return undefined;
          }
          g[String(key)] = cb;
          return undefined;
        };
        target['__' + String(key)] = fn;
      }
      return fn;
    },
  });
  let gestureSeq = 0;
  const gestureBuilders = {};
  for (const name of Object.keys(GESTURE_TYPES)) gestureBuilders[name] = makeGestureBuilder(name);

  const Gesture = {
    // 产物是两参形式：Gesture.create(GesturePriority.Low|High|Parallel[, GestureMask.Xxx])
    create(priority, mask) {
      gestureScopes.push({
        priority: priority === undefined ? GesturePriority.Low : priority,
        mask: mask === undefined ? GestureMask.Normal : mask,
        list: [],
      });
    },
    pop() {
      const scope = gestureScopes.pop();
      if (!scope) {
        layoutWarnings.push('Gesture.pop() 没有对应的 Gesture.create()');
        return;
      }
      const el = ViewStackProcessor.top();
      if (!el) {
        layoutWarnings.push(`Gesture.pop() 时组件栈是空的 —— 手势（${scope.list.map((g) => g.type).join(',')}）无处可挂`);
        return;
      }
      scheduleGestureAttach(el, scope.list);
    },
  };
  let gestureAttachCount = 0;
  // 同一元素上可能开了多个手势作用域（`.gesture` 之外还有 priorityGesture/parallelGesture 之类），
  // 所以先按元素累积、到微任务再一次性挂载 —— 这样"一次渲染"里是【合并】，
  // 而"下一次渲染"是【替换】（否则重渲染会把回调叠成两份，回调被触发两次）。
  const pendingGestureAttach = new Map();
  let pendingAttachScheduled = false;
  function scheduleGestureAttach(el, records) {
    const list = pendingGestureAttach.get(el) || [];
    for (const r of records) list.push(r);
    pendingGestureAttach.set(el, list);
    if (pendingAttachScheduled) return;
    pendingAttachScheduled = true;
    Promise.resolve().then(() => {
      pendingAttachScheduled = false;
      for (const [element, recs] of pendingGestureAttach) {
        attachGestures(element, recs);
        gestureAttachCount++;
      }
      pendingGestureAttach.clear();
    });
  }

  // ─────────────────────────── ViewPU ───────────────────────────
  class ViewPU {
    constructor(parent, localStorage, elmtId = -1, extraInfo) {
      this.__viewId = ++viewSeq;
      this.__parent = parent;
      this.__localStorage = localStorage;
      this.__elmtId = elmtId;      // 挂载点 elmtId（自定义组件用）
      this.__extraInfo = extraInfo;
    }
    id__() { return this.__viewId; }
    aboutToBeDeletedInternal() {}
    updateStateVars() {}
    purgeVariableDependenciesOnElmtId() {}
    finalizeConstruction() {}
    updateDirtyElements() { flush(); }
    rerender() { this.updateDirtyElements(); }

    observeComponentCreation2(updateFunc, componentClassOrName) {
      const elmtId = ++elmtIdSeq;
      const parent = parentOfTop();
      const isFirst = !elmtRecords.has(elmtId);
      const rec = elmtRecords.get(elmtId) || { node: null };
      rec.parentNode = parent;
      rec.updateFunc = updateFunc;
      rec.componentClass = componentClassOrName;  // 内置组件是类，自定义组件是 {name}
      elmtRecords.set(elmtId, rec);

      const savedElmt = currentNodeElmtId;
      currentNodeElmtId = elmtId;
      updateFunc(elmtId, isFirst);   // 不动组件栈：首渲染由生成的 pop() 收尾
      currentNodeElmtId = savedElmt;
      return elmtId;
    }

    // 自定义组件：父重渲染时把新参数推给子视图
    updateStateVarsOfChildByElmtId(elmtId, params) {
      const rec = elmtRecords.get(elmtId);
      if (rec && rec.childView && typeof rec.childView.updateStateVars === 'function') {
        rec.childView.updateStateVars(params);
      }
    }

    // ── @Provide / @Consume（按名字沿视图链解析） ──
    addProvidedVar(name, prop, allowOverride) {
      if (!this.__providedVars) this.__providedVars = new Map();
      if (this.__providedVars.has(name) && !allowOverride) {
        layoutWarnings.push(`@Provide('${name}') 重复声明且 allowOverride=false`);
      }
      this.__providedVars.set(name, prop);
    }
    _findProvided(name) {
      let v = this.__parent;                 // 从父视图向上找（@Consume 必须位于后代）
      while (v) {
        if (v.__providedVars && v.__providedVars.has(name)) return v.__providedVars.get(name);
        v = v.__parent;
      }
      return null;
    }
    initializeConsume(name, propName) {
      const found = this._findProvided(name);
      if (found) return found;               // 关键：返回的【就是提供者的属性实例】→ 依赖追踪天然生效
      layoutWarnings.push(`@Consume('${name}') 未找到祖先 @Provide，退化为本地占位属性`);
      const fallback = new ObservedPropertySimplePU(undefined, this, propName);
      this['__' + propName] = fallback;
      return fallback;
    }
    reInitializeConsume__Internal(name, propName) {
      const found = this._findProvided(name);
      if (found) this['__' + propName] = found;
      else layoutWarnings.push(`@Consume('${name}') 重绑定时未找到祖先 @Provide`);
    }

    // ── @Watch（把回调挂到属性实例上，set 时触发） ──
    declareWatch(propName, cb) {
      const prop = this['__' + propName];
      if (prop && typeof prop.watch === 'function') prop.watch(cb.bind(this));
      else layoutWarnings.push(`@Watch('${propName}') 未找到属性实例，回调未挂载`);
    }

    // if/else：同一 elmtId 下按 branchId 换子树，切换时销毁旧分支
    ifElseBranchUpdateFunction(branchId, branchFunc) {
      const elmtId = currentNodeElmtId;
      const rec = elmtRecords.get(elmtId);
      if (!rec || !rec.node) return;
      if (rec.activeBranch !== branchId) {
        rec.activeBranch = branchId;
        // 拆旧分支：带"消失过渡"的子节点会留在 DOM 里把动画走完再摘（R22 收口），其余立刻摘
        detachChildren(rec.node);
        purgeDetachedRecords();
      }
      const savedStack = ViewStackProcessor.snapshot();
      const savedElmt = currentNodeElmtId;
      ViewStackProcessor.restore([]);
      ViewStackProcessor.push(rec.node);
      currentNodeElmtId = elmtId;
      branchFunc();                            // 分支内自己 create/pop 平衡
      ViewStackProcessor.restore(savedStack);
      currentNodeElmtId = savedElmt;
    }

    // ForEach：数组变化才整体重建（键级 diff 留待后续优化）
    forEachUpdateFunction(elmtId, arr, itemGenFunc, keyGenFunc) {
      const rec = elmtRecords.get(elmtId);
      if (!rec || !rec.node) return;
      const snap = (arr || []).slice();
      const changed = !rec.forEachSnapshot
        || rec.forEachSnapshot.length !== snap.length
        || rec.forEachSnapshot.some((v, i) => !Object.is(v, snap[i]));
      if (changed && rec.forEachSnapshot) {
        // 同理：列表重建时，带"消失过渡"的项先把动画走完（R22 收口）
        detachChildren(rec.node);
        purgeDetachedRecords();
      }
      rec.forEachSnapshot = snap;

      const savedStack = ViewStackProcessor.snapshot();
      const savedElmt = currentNodeElmtId;
      ViewStackProcessor.restore([]);
      ViewStackProcessor.push(rec.node);
      currentNodeElmtId = elmtId;
      for (const item of snap) {
        if (changed) itemGenFunc(item);        // 逐项生成（内部各自分配 elmtId）
      }
      ViewStackProcessor.restore(savedStack);
      currentNodeElmtId = savedElmt;
    }

    // 自定义组件挂载：把子视图渲染到当前父位置
    static create(childView) {
      const elmtId = childView.__elmtId;
      const rec = elmtRecords.get(elmtId) || { node: null };
      elmtRecords.set(elmtId, rec);

      const container = document.createElement('div');
      container.style.display = 'contents';   // 布局透明，不引入额外盒子
      container.dataset.arkuiChildView = 'true';
      parentOfTop().appendChild(container);
      rec.node = container;
      rec.parentNode = parentOfTop();
      rec.childView = childView;

      const savedStack = ViewStackProcessor.snapshot();
      const savedElmt = currentNodeElmtId;
      ViewStackProcessor.push(container);
      childView.initialRender();
      ViewStackProcessor.restore(savedStack);
      currentNodeElmtId = savedElmt;

      // R17：定义了 onMeasureSize 的组件走【自定义布局协议】——由它自己测量/摆放子节点。
      // 必须在 initialRender() 之后（那时子节点才存在，measure() 才有东西可量）。
      if (typeof childView.onMeasureSize === 'function') {
        runCustomLayout(childView, container, rec.parentNode);
      }
    }
  }

  // ────────────────────── 属性映射 ──────────────────────
  const resolveResource = (v) => {
    if (v && typeof v === 'object' && 'id' in v && 'type' in v) {
      const table = global.__arkui_dom_resources || {};
      return table[v.id] !== undefined ? table[v.id] : DEFAULT_RESOURCES[v.type];
    }
    return v;
  };
  const DEFAULT_RESOURCES = { 10002: 16, 10003: '' };
  const toCssSize = (v) => {
    const r = resolveResource(v);
    return typeof r === 'number' ? r + 'px' : String(r);
  };

  const cssPropSize = {
    fontSize: 'fontSize', fontColor: 'color', backgroundColor: 'backgroundColor',
    width: 'width', height: 'height', borderWidth: 'borderWidth',
    borderRadius: 'borderRadius', padding: 'padding', margin: 'margin',
    letterSpacing: 'letterSpacing', lineHeight: 'lineHeight',
    // Grid 的双向间距（Length → px）。缺这两个时它们只会落进 data-*，版式静默错。
    columnsGap: 'columnGap', rowsGap: 'rowGap',
  };
  const cssPropRaw = {
    fontWeight: 'fontWeight', opacity: 'opacity', zIndex: 'zIndex',
    flexGrow: 'flexGrow', flexShrink: 'flexShrink', aspectRatio: 'aspectRatio',
  };
  // 枚举类属性：取值为枚举（FlexAlign/TextAlign/HorizontalAlign…），枚举值本身就是 CSS 值，原样透传
  const cssPropEnum = {
    justifyContent: 'justifyContent', alignItems: 'alignItems', alignSelf: 'alignSelf',
    alignContent: 'alignContent', textAlign: 'textAlign', fontStyle: 'fontStyle',
    textTransform: 'textTransform', whiteSpace: 'whiteSpace', position: 'position',
    textDecoration: 'textDecoration', overflow: 'overflow', visibility: 'visibility',
  };

  // ── Grid 轨道模板 ──
  // ArkUI 的轨道尺寸里【裸数字是 vp】，而 CSS 必须带单位 —— 直接透传会得到
  // 'grid-template-columns: 100 1fr'，浏览器整条声明作废（不报错、只是没生效，最难查）。
  // 归一化：vp/fp/lpx → px；裸数字 → px；1fr/auto/%/minmax()/repeat() 原样保留。
  // 注：vp→px 是 1:1 近似（本项目一贯做法，密度≠1 的设备上会有偏差）。
  const normalizeTrackList = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/(\d+(?:\.\d+)?)(vp|fp|lpx)\b/g, '$1px')
    .replace(/(?<![\w.%-])(\d+(?:\.\d+)?)(?![\w.%-])/g, '$1px');
  const GRID_TRACK_PROPS = { columnsTemplate: 'gridTemplateColumns', rowsTemplate: 'gridTemplateRows' };
  // Grid 的"无模板"布局参数：cellLength/maxCount/minCount/layoutDirection 决定轨道如何划分，
  // 本实现不做 —— 静默忽略会让页面版式错得看不出原因，所以显式记诊断（值仍落 data-*）。
  const GRID_UNSUPPORTED = new Set(['cellLength', 'maxCount', 'minCount', 'layoutDirection']);

  // 切多面板：只显示 active 那一项（Tabs 与后续 Swiper 共用）
  const onlyOneVisible = (entries, active) => {
    entries.forEach((e, k) => { e.el.style.display = k === active ? 'block' : 'none'; });
  };


  // create({ space: n }) —— ArkUI 容器的 space 语义映射为 flex gap
  function applyCreateArgs(node, args) {
    const a = args && args[0];
    if (!a || typeof a !== 'object') return;
    if (typeof a.space === 'number') node.style.gap = a.space + 'px';
    // Stack({alignContent}) 是【create 选项】而非属性 setter —— 这条路径容易漏（踩过）
    if (a.alignContent !== undefined) applyAlignment(node, a.alignContent);
  }

  // 生成组件的"原生控件参数"映射：把 create({...}) 的常用键落到真实控件属性上
  function applyNativeArgs(el, args, meta) {
    const a = args && args[0];
    const tag = (meta && meta.tag) || '';
    if (a && typeof a === 'string') {
      el.dataset.content = a;                       // 未知字符串参数（如 QRCode('x')）不丢信息
      return;
    }
    if (!a || typeof a !== 'object') return;
    if (tag === 'input' || tag === 'textarea') {
      if (a.text !== undefined) el.value = String(a.text);
      if (a.placeholder !== undefined) el.placeholder = String(a.placeholder);
    }
    if (tag === 'input' && meta.inputType === 'range') {
      for (const k of ['min', 'max', 'step', 'value']) {
        if (a[k] !== undefined) el[k] = String(a[k]);
      }
    }
    if (tag === 'progress') {
      if (a.value !== undefined) el.value = Number(a.value);
      if (a.total !== undefined) el.max = Number(a.total);
    }
    if (a.columnsTemplate !== undefined) el.style.gridTemplateColumns = normalizeTrackList(a.columnsTemplate);
    if (a.rowsTemplate !== undefined) el.style.gridTemplateRows = normalizeTrackList(a.rowsTemplate);
  }

  // ─────────────── 布局：alignRules / Guideline / bias / 文本截断 / 叠放 / Scroller ───────────────
  // ArkUI 的 measure/layout 规则在 DOM 上无法 1:1 复刻；这里实现"容器锚点 + 兄弟锚点 + Guideline"
  // 三类相对定位、bias 插值、文本截断与叠放对齐，并保留 warnings 以暴露未支持项（不是静默忽略）。
  const layoutWarnings = (global.__arkui_dom_layout_warnings = []);
  // 锚点解析会在不动点迭代里跑多趟，同一问题只该留一条痕（否则一条缺失锚点会变成 12 条）
  const warnOnce = (msg) => { if (!layoutWarnings.includes(msg)) layoutWarnings.push(msg); };

  // Guideline 的方向（轴）。两者极易记反，以 .d.ts 的 JSDoc 为准：
  //   Axis.Vertical   → 【竖线】→ 只能锚子组件的【水平】位置（position.start 是距【左】边的距离）
  //   Axis.Horizontal → 【横线】→ 只能锚子组件的【垂直】位置（position.start 是距【上】边的距离）
  //   错轴使用 → 值恒为 0（JSDoc："the value is 0 when it is used as the anchor in the …"）
  // enums.d.ts 里枚举顺序是 Vertical=0 / Horizontal=1，所以也接受数字。
  const Axis = { Vertical: 'vertical', Horizontal: 'horizontal' };
  const isHorizontalAxis = (v) => v === 'horizontal' || v === 1;

  // 注意：ArkUI 有两套对齐词汇 —— 水平是 start/end 或 left/right，垂直是 top/bottom。
  // 两者都映射到 0/0.5/1 的分数，同时 dx/dy 的判定也要认这两种写法（踩过的坑）。
  const ALIGN_FRAC = { start: 0, top: 0, center: 0.5, end: 1, bottom: 1 };
  const isStart = (a) => a === 'start' || a === 'top';
  const isEnd = (a) => a === 'end' || a === 'bottom';
  const edgeAt = (base, size, align) => base + size * (ALIGN_FRAC[align] !== undefined ? ALIGN_FRAC[align] : 0);
  // 键 → 轴。LocalizedAlignRuleOptions 用 start/end/middle（水平）+ top/bottom/center（垂直）；
  // 老版 AlignRuleOption 用 left/right/middle + top/bottom/center。两套都认（否则 start/end 会漏支持）。
  const H_KEYS = new Set(['left', 'start', 'middle', 'right', 'end']);

  // Dimension → px：number 是 vp，字符串可带 %（'30%' 按容器对应尺寸换算）
  function dimOf(v, total) {
    if (v === undefined || v === null) return 0;
    const s = String(resolveResource(v));
    if (s.endsWith('%')) return (parseFloat(s) / 100) * total;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  // 容器里所有 Guideline 的位置（相对容器）。只依赖容器尺寸，所以每轮 sync 重算一次即可。
  // ⚠️ 本 SDK 的 GuideLinePosition 只有 start/end（没有旧版的 percent）。
  function applyGuideLines(container) {
    const specs = container.__guideLines;
    if (!specs) return;
    const pw = container.offsetWidth, ph = container.offsetHeight;
    const map = {};
    for (const g of specs) {
      if (!g || !g.id) { warnOnce('guideLine: 缺少 id，已跳过'); continue; }
      const pos = g.position || {};
      if (pos.percent !== undefined) {
        warnOnce(`guideLine['${g.id}'].position.percent 不是本 SDK 的字段（本版只有 start/end），已忽略`);
      }
      if (isHorizontalAxis(g.direction)) {
        // 横线：锚垂直位置。start 距顶，end 距底
        const y = pos.start !== undefined ? dimOf(pos.start, ph) : ph - dimOf(pos.end, ph);
        map[g.id] = { x: 0, y, w: pw, h: 0, axis: 'h' };
      } else {
        // 竖线：锚水平位置。start 距左，end 距右
        const x = pos.start !== undefined ? dimOf(pos.start, pw) : pw - dimOf(pos.end, pw);
        map[g.id] = { x, y: 0, w: 0, h: ph, axis: 'v' };
      }
    }
    container.__guideLineBoxes = map;
  }

  // 锚点解析：'__container__' / Guideline / 兄弟组件，三种
  function alignBoxOf(parent, anchor, key, pw, ph) {
    if (!anchor || anchor === '__container__') return { x: 0, y: 0, w: pw, h: ph };
    const g = parent.__guideLineBoxes && parent.__guideLineBoxes[anchor];
    if (g) {
      const needAxis = H_KEYS.has(key) ? 'v' : 'h';   // 要定水平位置 → 需要【竖线】
      if (g.axis !== needAxis) return { x: 0, y: 0, w: 0, h: 0 };   // 错轴：值恒为 0
      return g;
    }
    const sel = (global.CSS && CSS.escape) ? CSS.escape(anchor) : anchor;
    const sib = parent.querySelector('#' + sel);
    if (!sib) return null;
    return { x: sib.offsetLeft, y: sib.offsetTop, w: sib.offsetWidth, h: sib.offsetHeight };
  }

  function applyAlignRules(el) {
    const rules = el.__alignRules;
    const parent = el.parentElement;
    if (!rules || !parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    el.style.position = 'absolute';
    applyGuideLines(parent);                  // 幂等；保证 guideline 锚点已就绪
    const pw = parent.offsetWidth, ph = parent.offsetHeight;
    let dx = 0, dy = 0;                       // 百分比位移：把自身对应边贴到锚点上
    let leftVal = null, rightVal = null, topVal = null, bottomVal = null;
    // ArkUI 的键分两组（这点极易记错）：
    //   水平: left/start(左边缘) / middle(水平中心) / right/end(右边缘)
    //   垂直: top(上边缘)       / center(垂直中心) / bottom(下边缘)
    for (const key of Object.keys(rules)) {
      if (key === 'bias') continue;           // bias 要等两侧都解析完再算
      const rule = rules[key];
      if (!rule) continue;
      const box = alignBoxOf(parent, rule.anchor, key, pw, ph);
      if (!box) { warnOnce(`alignRules.${key}: 找不到锚点 '${rule.anchor}'`); continue; }
      const a = rule.align;
      if (key === 'left' || key === 'start') {
        leftVal = edgeAt(box.x, box.w, a);
        el.style.left = leftVal + 'px';
        if (a === 'center') dx = -50; else if (isEnd(a)) dx = -100;
      } else if (key === 'middle') {
        leftVal = edgeAt(box.x, box.w, a);
        el.style.left = leftVal + 'px';
        dx = -50;
      } else if (key === 'right' || key === 'end') {
        rightVal = pw - edgeAt(box.x, box.w, a);
        el.style.right = rightVal + 'px';
        if (a === 'center') dx = 50; else if (isStart(a)) dx = 100;
      } else if (key === 'top') {
        topVal = edgeAt(box.y, box.h, a);
        el.style.top = topVal + 'px';
        if (a === 'center') dy = -50; else if (isEnd(a)) dy = -100;
      } else if (key === 'center') {
        topVal = edgeAt(box.y, box.h, a);
        el.style.top = topVal + 'px';
        dy = -50;
      } else if (key === 'bottom') {
        bottomVal = ph - edgeAt(box.y, box.h, a);
        el.style.bottom = bottomVal + 'px';
        if (a === 'center') dy = 50; else if (isStart(a)) dy = 100;
      } else {
        warnOnce(`alignRules.${key}: 暂不支持该轴`
          + '（可用 left/start/middle/right/end 与 top/center/bottom）');
      }
    }
    if (dx || dy) el.style.transform = `translate(${dx}%, ${dy}%)`;
    applyBias(el, rules.bias, pw, ph, leftVal, rightVal, topVal, bottomVal);
  }

  // bias：当【同一轴的两侧都被锚定】时，在可行区间里按比例定位。
  // 权威默认值来自 common.d.ts 的 JSDoc：`@default {horizontal:0.5,vertical:0.5}`
  // —— 所以"两侧都锚定但没写 bias"就是【居中】，不是"不生效"。
  // 语义原话："ratio of the distance to the left/upper anchor to the total distance between anchors"。
  // 只锚一侧时 CSS 本身就有唯一解，bias 无意义（不记警告）。
  // 注：JSDoc 只要求 >= 0，所以 >1 会外推到锚点之外——按原文只做下界钳制。
  function applyBias(el, bias, pw, ph, leftVal, rightVal, topVal, bottomVal) {
    const bt = bias && typeof bias === 'object' ? bias : {};
    const ratio = (v) => (v === undefined ? 0.5 : Math.max(0, Number(v) || 0));
    if (leftVal !== null && rightVal !== null) {
      const lo = leftVal, hi = (pw - rightVal) - el.offsetWidth;      // 左边缘的可行区间
      el.style.left = (lo + ratio(bt.horizontal) * (hi - lo)) + 'px';
      el.style.right = 'auto';
    }
    if (topVal !== null && bottomVal !== null) {
      const lo = topVal, hi = (ph - bottomVal) - el.offsetHeight;
      el.style.top = (lo + ratio(bt.vertical) * (hi - lo)) + 'px';
      el.style.bottom = 'auto';
    }
  }

  // 首渲染与每次重渲染后同步一遍：兄弟锚点要等兄弟有几何信息才能算。
  // 锚链可能是【逆序声明】的（c 锚 b、b 锚 a，而 c 写在最前），单趟解析会读到兄弟的旧位置
  // —— 所以反复扫到不动点为止（链长 N 需要 N 趟）。
  function syncAlignRules(rootEl) {
    const r = rootEl || rootNode;
    if (!r || !r.querySelectorAll) return;
    const all = [...r.querySelectorAll('*')];
    for (const c of all) if (c.__guideLines) applyGuideLines(c);
    const targets = all.filter((el) => el.__alignRules);
    if (!targets.length) return;
    const snap = () => targets.map((el) => el.offsetLeft + ',' + el.offsetTop).join('|');
    const maxPass = Math.min(targets.length + 2, 12);
    let prev = null;
    for (let pass = 0; pass < maxPass; pass++) {
      for (const el of targets) applyAlignRules(el);
      const now = snap();
      if (prev !== null && now === prev) return;    // 到不动点
      prev = now;
    }
    warnOnce(`alignRules: 锚链在 ${maxPass} 趟内未收敛（可能存在环状锚定），结果可能不正确`);
  }

  const TEXT_OVERFLOW_CSS = { none: 'clip', clip: 'clip', ellipsis: 'ellipsis', marquee: 'clip' };

  function applyTextClamp(node, maxLines, overflow) {
    if (maxLines === 1) {
      node.style.overflow = 'hidden';
      node.style.whiteSpace = 'nowrap';
      node.style.textOverflow = TEXT_OVERFLOW_CSS[overflow] || 'clip';
    } else if (maxLines > 1) {
      node.style.overflow = 'hidden';
      node.style.display = '-webkit-box';
      node.style.webkitLineClamp = String(maxLines);
      node.style.webkitBoxOrient = 'vertical';
    }
  }

  const TextOverflow = { None: 'none', Clip: 'clip', Ellipsis: 'ellipsis', MARQUEE: 'marquee' };

  const Alignment = {
    TopStart: 'top-start', Top: 'top', TopEnd: 'top-end',
    Start: 'start', Center: 'center', End: 'end',
    BottomStart: 'bottom-start', Bottom: 'bottom', BottomEnd: 'bottom-end',
  };

  function applyAlignment(node, v) {
    const s = String(v || 'center');
    const vertical = s.indexOf('top') === 0 ? 'start' : s.indexOf('bottom') === 0 ? 'end' : 'center';
    const horizontal = /start$/.test(s) ? 'start' : /end$/.test(s) ? 'end' : 'center';
    node.style.alignItems = vertical;
    node.style.justifyItems = horizontal;
  }

  // Scroller：真实滚动定位（List/Grid/Scroll 的 scroller 选项会把它绑到容器元素上）
  // lazyMeta: 虚拟列表的 容器元素 → { total, estItemH }，供 scrollToIndex 在目标【未渲染】时换算
  const lazyMeta = new Map();
  let scrollerSeq = 0;
  class Scroller {
    constructor() { this._id = ++scrollerSeq; this._el = null; }
    _bind(el) { this._el = el; }
    scrollToIndex(i, smooth) {
      const el = this._el;
      if (!el) { layoutWarnings.push(`Scroller.scrollToIndex(${i}): 未绑定容器`); return; }
      // ForEach/If 的包裹层是 display:contents，ListItem 是【孙子】而非直接子节点；
      // 所以优先按组件标记查，再退回直接子节点。容器已设 position:relative → offsetTop 以它为基准。
      const items = el.querySelectorAll('[data-arkui-comp="ListItem"]');
      // 虚拟列表的 `items` 是【当前窗口】的渲染项，不是全量列表：
      // 窗口内第 k 个渲染项对应的索引是 window[0]+k。第一版直接取 items[i]，
      // 于是 scrollToIndex(0) 会滚到"当前窗口第一个渲染项"（实测跳到了 100 段）。
      const holder = el.querySelector('[data-arkui-lazyforeach]');
      const meta = holder && lazyMeta.get(holder);
      const win = meta && meta.window;
      const k = win ? i - win[0] : i;
      const target = (k >= 0 && k < items.length) ? items[k] : null;
      if (target) {
        el.scrollTop = target.offsetTop;
      } else if (meta) {
        // 目标没渲染 → 用【累计偏移】换算（而不是"统一行高 × 序号"：变高列表下后者会偏出几十上百像素）
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        const want = typeof meta.offsetOf === 'function' ? meta.offsetOf(i) : meta.estItemH * i;
        el.scrollTop = Math.min(want, max);
        if (typeof meta.flush === 'function') meta.flush();      // 同步刷新窗口（确定性）
        el.dispatchEvent(new Event('scroll'));
      } else {
        layoutWarnings.push(`Scroller.scrollToIndex(${i}): 目标不存在且非虚拟列表`);
        return;
      }
      if (smooth) el.scrollTo({ top: el.scrollTop, behavior: 'smooth' });
    }
    scrollTo(opt) {
      if (!this._el || !opt) return;
      if (opt.x !== undefined) this._el.scrollLeft = Number(resolveResource(opt.x));
      if (opt.y !== undefined) this._el.scrollTop = Number(resolveResource(opt.y));
    }
    scrollEdge() { }
    currentOffset() {
      return this._el ? { x: this._el.scrollLeft, y: this._el.scrollTop } : { x: 0, y: 0 };
    }
  }

  // 统一的挂载点：记录 elmtId→节点，处理 Stack 叠放，并给节点打上可查询的组件标记
  function mountNode(node, rec) {
    const parentEl = parentOfTop();
    if (node.__arkuiComp) node.setAttribute('data-arkui-comp', node.__arkuiComp);
    if (rec) { rec.node = node; rec.parentNode = parentEl; }
    parentEl.appendChild(node);
    if (parentEl.__arkuiComp === 'Stack') node.style.gridArea = '1 / 1';
    // R22 收口：标"刚挂上"。【出现过渡不能在这里跑】—— 实测产物顺序是
    // `Text.create('A') → Text.id('a') → Text.transition({…})`，规格要等挂载之后才到，
    // 所以真正的触发点是 registerTransition（它看到这个标记就跑出现动画并清标记）。
    node.__arkuiFreshMount = true;
    return node;
  }

  // ────────────────── UIContext（R30）──────────────────
  //
  // 产物形态（实测 fixtures/pages/UiContextDemo.ts）：`this.getUIContext()` 是组件实例上的
  // 普通方法调用（编译器不改写），返回 UIContext 对象面。本轮只实现【实测用到】的面：
  //   animateTo(param, fn) / animateToImmediately —— 与 Context.animateTo 同一显式动画管道
  //   getRouter() → @ohos:router 垫片对象（Router.pushUrl 形态，@ohos.arkui.UIContext.d.ts 原文）
  //   getPromptAction() → @ohos:promptAction 垫片
  //   runScopedTask(cb) → 立即执行（真机是"UI 作用域内执行"，DOM 里无作用域差异，取舍已记录）
  // ViewV2 extends ViewPU，@ComponentV2 组件同样继承 getUIContext。
  function makeUIContext() {
    return {
      animateTo: (param, fn) => runExplicitAnimation(param, fn, 'animateTo'),
      // 与 Context.animateToImmediately 同理：DOM 里两者等价（CSS transition 本来就"下一帧开始"）
      animateToImmediately: (param, fn) => runExplicitAnimation(param, fn, 'animateToImmediately'),
      getRouter: () => ohosRequire('@ohos:router'),
      getPromptAction: () => ohosRequire('@ohos:promptAction'),
      runScopedTask: (cb) => {
        try { cb(); }
        catch (e) { layoutWarnings.push(`runScopedTask 回调抛错：${e && e.message}`); }
      },
    };
  }
  ViewPU.prototype.getUIContext = function () { return makeUIContext(); };

  // ────────────────── Tabs / TabContent（多面板切换）──────────────────
  //
  // 产物形式（实测 fixtures/pages/TabsGrid.ts）：
  //   Tabs.create({ barPosition: BarPosition.Start, index: 0, controller: this.tabCtrl });
  //   Tabs.onChange((i) => {…});  Tabs.width(…);  Tabs.height(…);  Tabs.id(…);
  //   TabContent.create(deepFn);   ← 子构建器【当构造参数传】（与 GridItem/ListItem 的
  //                                  create(()=>{}, false) + 外部 observedDeepRender 不同）
  //   TabContent.tabBar('T0');  TabContent.pop();  …  Tabs.pop();
  //
  // DOM 结构（Tabs 自身在组件栈上，属性/Tabs.pop 都作用于它）：
  //   <div data-arkui-comp="Tabs">           flex column
  //     <div data-arkui-tabs-bar>            barPosition=Start 在前 / End 在后
  //     <div data-arkui-tabs-content>        TabContent 挂在这里（不是 Tabs 本身）
  //
  // 为什么 TabContent 要"跳过"父节点另挂：若直接挂进 Tabs 包装元素，就会和 tab bar 同级，
  // 且 Tabs.width()/height() 会作用到内容区而不是整体。故由 TabContent 主动认领内容区。
  const BarPosition = { Start: 'start', End: 'end' };
  const BarMode = { Fixed: 'fixed', Scrollable: 'scrollable' };

  // Tabs 的语义性属性里本实现未覆盖的部分。回调类尤其不能静默——写上去却永远不触发，
  // 比报错更难查。纯外观项（颜色/模糊/divider/fadingEdge）不在此列。
  const TABS_UNSUPPORTED = new Set([
    'vertical', 'barMode', 'barWidth', 'barHeight', 'barOverlap', 'barGridAlign',
    'animationDuration', 'animationMode', 'animationCurve', 'customContentTransition',
    'pageFlipMode', 'edgeEffect', 'cachedMaxCount',
    'onTabBarClick', 'onSelected', 'onUnselected',
    'onAnimationStart', 'onAnimationEnd', 'onGestureSwipe', 'onContentWillChange',
  ]);

  let tabsSeq = 0;
  class TabsController {
    constructor() { this._id = ++tabsSeq; this._state = null; }
    changeIndex(i) {
      const st = this._state;
      if (!st) { layoutWarnings.push('TabsController.changeIndex: 尚未绑定到任何 Tabs'); return false; }
      return setActiveTab(st, Number(i), true);
    }
    preloadItems() {
      // 本实现里所有 TabContent 都是即时构建的（无懒加载），无需预载——语义等价，故不报警告。
      return Promise.resolve();
    }
  }

  function createTabsState(node, opt) {
    const st = {
      node, index: 0, barPosition: 'start', controller: null,
      contents: [], onChange: [], barEl: null, contentEl: null,
    };
    node.__tabsState = st;
    node.style.display = 'flex';
    node.style.flexDirection = 'column';
    node.style.overflow = 'hidden';

    st.barEl = document.createElement('div');
    st.barEl.setAttribute('data-arkui-tabs-bar', st.barPosition);
    st.barEl.style.display = 'flex';
    st.barEl.style.flexDirection = 'row';
    st.barEl.style.flex = 'none';

    st.contentEl = document.createElement('div');
    st.contentEl.setAttribute('data-arkui-tabs-content', '');
    st.contentEl.style.flex = '1 1 auto';
    st.contentEl.style.position = 'relative';
    st.contentEl.style.overflow = 'hidden';

    node.appendChild(st.barEl);
    node.appendChild(st.contentEl);
    applyTabsOptions(st, opt);
    return st;
  }

  function applyTabsOptions(st, opt) {
    if (!opt || typeof opt !== 'object') return;
    if (opt.barPosition !== undefined) {
      st.barPosition = String(resolveResource(opt.barPosition));
      st.barEl.setAttribute('data-arkui-tabs-bar', st.barPosition);
    }
    if (opt.index !== undefined) st.index = Number(resolveResource(opt.index)) || 0;
    if (opt.controller) {
      if (opt.controller._state && opt.controller._state !== st) {
        layoutWarnings.push('同一个 TabsController 被绑定到多个 Tabs（后绑定的生效）');
      }
      opt.controller._state = st;
      st.controller = opt.controller;
    }
  }

  function setActiveTab(st, i, fire) {
    const n = st.contents.length;
    if (!n || !Number.isInteger(i) || i < 0 || i >= n) {
      layoutWarnings.push(`Tabs.changeIndex(${i}): 越界（共 ${n} 个 TabContent）`);
      return false;
    }
    st.index = i;
    onlyOneVisible(st.contents, i);
    [...st.barEl.children].forEach((b, k) => {
      b.setAttribute('data-arkui-tabbar-active', k === i ? 'true' : 'false');
    });
    if (fire) {
      for (const cb of st.onChange) {
        try { cb(i); } catch (e) { layoutWarnings.push(`Tabs.onChange 抛错：${e && e.message}`); }
      }
    }
    return true;
  }

  // Tabs.pop() 之后才知道有几个 TabContent、各自的标签是什么 → 那时才建 bar
  function finalizeTabs(st) {
    const n = st.node;
    if (st.barPosition === 'end') {
      if (n.lastElementChild !== st.barEl) n.appendChild(st.barEl);
    } else if (n.firstElementChild !== st.barEl) {
      n.insertBefore(st.barEl, st.contentEl);
    }
    st.barEl.textContent = '';                       // 重建（重渲染时不会残留旧项）
    st.contents.forEach((c, i) => {
      const item = document.createElement('div');
      item.setAttribute('data-arkui-tabbar-item', String(i));
      item.setAttribute('data-arkui-tabbar-active', 'false');
      item.textContent = c.label === undefined || c.label === null ? '' : String(c.label);
      item.style.flex = '1';
      item.style.textAlign = 'center';
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => setActiveTab(st, i, true));
      st.barEl.appendChild(item);
    });
    const idx = Math.min(Math.max(0, st.index), Math.max(0, st.contents.length - 1));
    if (!st.contents.length) {
      layoutWarnings.push('Tabs 内没有任何 TabContent，无法确定活动面板');
      return;
    }
    setActiveTab(st, idx, false);
  }

  function applyTabBar(node, value) {
    const st = node.__tabContentOf;
    if (!st) { layoutWarnings.push('TabContent.tabBar: 未找到所属 Tabs'); return; }
    const entry = st.contents.find((c) => c.el === node);
    if (typeof value === 'string' || typeof value === 'number') {
      const label = String(resolveResource(value));
      node.__tabBarLabel = label;             // 同时记在节点上，供重渲染后补登记
      if (entry) entry.label = label;
      return;
    }
    layoutWarnings.push('TabContent.tabBar 目前只支持字符串标签'
      + '（SubTabBarStyle / BottomTabBarStyle / 自定义 builder 未实现）');
    node.__tabBarLabel = '';
    if (entry) entry.label = '';
  }

  // TabContent 挂载：认领所属 Tabs 的内容区（不压栈——压栈由 create 统一收尾，与 ListItem 一致）
  function mountTabContent(rec) {
    let node = rec && rec.node && rec.node.__arkuiComp === 'TabContent' ? rec.node : null;
    if (!node) {
      node = document.createElement('div');
      node.__arkuiComp = 'TabContent';
      // mountNode 会打这个标记；这里走的是自定义挂载点，必须自己打（否则外部查不到该组件）
      node.setAttribute('data-arkui-comp', 'TabContent');
      node.style.display = 'block';
      node.style.height = '100%';
      const parent = parentOfTop();
      const host = parent && parent.__tabsContentEl ? parent.__tabsContentEl : parent;
      const st = parent && parent.__tabsState;
      if (st) node.__tabContentOf = st;
      else layoutWarnings.push('TabContent 的父节点不是 Tabs（ArkUI 要求 TabContent 只能放在 Tabs 内）');
      // rec.parentNode 必须指向【内容区】：重渲染时靠它恢复挂载点，指错会重建整个 bar
      if (rec) { rec.node = node; rec.parentNode = host; }
      host.appendChild(node);
    }
    // Tabs 重渲染会清空 contents，此处在复用路径上补登记，避免标签/可见性丢失
    const st = node.__tabContentOf;
    if (st && !st.contents.some((c) => c.el === node)) {
      st.contents.push({ el: node, label: node.__tabBarLabel === undefined ? '' : node.__tabBarLabel });
    }
    return node;
  }

  // ────────────────── Swiper（轮播）──────────────────
  //
  // 产物形式（实测 fixtures/pages/SwiperDemo.ts）：
  //   Swiper.create(this.ctrl);      ← create 的参数就是【控制器实例本身】
  //   Swiper.index(0); Swiper.loop(false); Swiper.autoPlay(false);
  //   Swiper.indicator(true); Swiper.interval(50); Swiper.onChange(cb);
  //   Swiper.width(…); Swiper.height(…); Swiper.id(…);
  //   { 每个子组件 = 一页 }          ← 直接挂进 Swiper 元素（不像 TabContent 要另找内容区）
  //   Swiper.pop();
  // 本 SDK 的签名是 Swiper(controller?: SwiperController)（不是 options 对象，与 Tabs 不同）——
  // index/loop/autoPlay 全是属性 setter。这条是编译器判错后才查出来的，别凭印象写。
  const SWIPER_UNSUPPORTED = new Set([
    'vertical', 'displayArrow', 'displayMode', 'displayCount', 'effectMode', 'nextMargin', 'prevMargin',
    'itemSpace', 'cachedCount', 'disableSwipe', 'curve', 'duration', 'customContentTransition',
    'pageFlipMode', 'nestedScroll', 'maintainVisibleContentPosition', 'indicatorStyle', 'indicatorInteractive',
    'onAnimationStart', 'onAnimationEnd', 'onGestureSwipe', 'onContentDidScroll', 'onContentWillScroll',
    'onSelected', 'onUnselected', 'onScrollStateChanged',
  ]);

  let swiperSeq = 0;
  class SwiperController {
    constructor() { this._id = ++swiperSeq; this._state = null; }
    showNext() { return stepSwiper(this._state, +1); }
    showPrevious() { return stepSwiper(this._state, -1); }
    changeIndex(i, useAnimation) {
      if (useAnimation === true) layoutWarnings.push('SwiperController.changeIndex(useAnimation=true)：无动画实现，已忽略动画');
      return this._state ? setActiveSwiper(this._state, Number(i), true) : false;
    }
    finishAnimation(cb) { if (typeof cb === 'function') cb(); }   // 无动画 → 立即完成
    preloadItems() { return Promise.resolve(); }                  // 所有页都是即时构建的，语义等价
  }

  function bindSwiperController(st, ctl) {
    if (!ctl || typeof ctl !== 'object') return;
    if (typeof ctl.changeIndex !== 'function') {
      layoutWarnings.push('Swiper.create 的参数不是 SwiperController（本 SDK 的签名是 Swiper(controller?)）');
      return;
    }
    if (ctl._state && ctl._state !== st) {
      layoutWarnings.push('同一个 SwiperController 被绑定到多个 Swiper（后绑定的生效）');
    }
    ctl._state = st;
    st.controller = ctl;
  }

  function createSwiperState(node, args) {
    const st = {
      node, index: 0, count: 0, entries: [],
      loop: true,                      // ArkUI 默认开启循环
      autoPlay: false, interval: 3000, // 默认间隔 3000ms
      indicatorWanted: false, controller: null, onChange: [], timer: 0,
      dots: [], indicatorEl: null,
    };
    node.__swiperState = st;
    node.style.position = 'relative';
    node.style.overflow = 'hidden';
    node.style.display = 'block';
    bindSwiperController(st, args && args[0]);
    return st;
  }

  function setActiveSwiper(st, i, fire) {
    const n = st.entries.length;
    if (!n) { layoutWarnings.push('Swiper 内没有任何子组件，无法确定当前页'); return false; }
    let idx = Number(i);
    if (!Number.isInteger(idx)) { layoutWarnings.push(`Swiper.changeIndex(${i}): 不是整数`); return false; }
    if (st.loop) {
      idx = ((idx % n) + n) % n;                    // 循环：越界即回卷
    } else if (idx < 0 || idx >= n) {
      layoutWarnings.push(`Swiper.changeIndex(${idx}): 越界（共 ${n} 页，loop=false）`);
      return false;
    }
    st.index = idx;
    onlyOneVisible(st.entries, idx);
    st.dots.forEach((d, k) => d.setAttribute('data-arkui-swiper-dot-active', k === idx ? 'true' : 'false'));
    if (fire) {
      for (const cb of st.onChange) {
        try { cb(idx); } catch (e) { layoutWarnings.push(`Swiper.onChange 抛错：${e && e.message}`); }
      }
    }
    return true;
  }

  // showNext / showPrevious：loop=false 且在边界时【停住】（这是合法语义，所以不记 warning）
  function stepSwiper(st, delta) {
    if (!st) { layoutWarnings.push('SwiperController 尚未绑定到任何 Swiper'); return false; }
    const n = st.entries.length;
    if (!n) { layoutWarnings.push('Swiper 内没有任何子组件'); return false; }
    const next = st.index + delta;
    if (!st.loop && (next < 0 || next >= n)) return false;
    return setActiveSwiper(st, next, true);
  }

  function startSwiperAutoPlay(st) {
    if (st.timer) { clearInterval(st.timer); st.timer = 0; }
    if (!st.autoPlay) return;
    st.timer = setInterval(() => {
      // 页面被卸载（router 换页 / clearRoot）后自己停掉，避免跨页面的计时器泄漏
      if (!st.node.isConnected) { clearInterval(st.timer); st.timer = 0; return; }
      setActiveSwiper(st, st.index + 1, true);
    }, st.interval || 3000);
  }

  // Swiper.pop() 之后才知道有几页、每页是谁
  function finalizeSwiper(st) {
    const kids = [...st.node.children].filter((el) => !el.hasAttribute('data-arkui-swiper-indicator'));
    for (const el of kids) {
      if (getComputedStyle(el).display === 'contents') {
        layoutWarnings.push('Swiper 的直接子项是 display:contents 包裹层（如 ForEach）——'
          + '页面边界无法识别，请把 ForEach 移到 Swiper 之外，或用 @Builder 展开');
      }
    }
    st.entries = kids.map((el) => {
      el.setAttribute('data-arkui-swiper-page', '');
      el.style.width = '100%';
      el.style.height = '100%';
      return { el };
    });
    st.count = st.entries.length;

    if (st.indicatorWanted) st.indicatorEl = buildSwiperIndicator(st);

    if (!st.entries.length) {
      layoutWarnings.push('Swiper 内没有任何子组件');
    } else {
      const start = st.loop ? st.index : Math.min(Math.max(0, st.index), st.count - 1);
      setActiveSwiper(st, start, false);
    }
    startSwiperAutoPlay(st);
  }

  function buildSwiperIndicator(st) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-arkui-swiper-indicator', '');
    wrap.style.position = 'absolute';
    wrap.style.left = '0';
    wrap.style.right = '0';
    wrap.style.bottom = '2px';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'row';
    wrap.style.justifyContent = 'center';
    wrap.style.gap = '4px';
    st.dots = st.entries.map((_e, k) => {
      const d = document.createElement('div');
      d.setAttribute('data-arkui-swiper-dot', String(k));
      d.setAttribute('data-arkui-swiper-dot-active', 'false');
      d.style.width = '6px';
      d.style.height = '6px';
      d.style.borderRadius = '50%';
      d.style.background = '#bbb';
      d.style.cursor = 'pointer';
      d.addEventListener('click', () => setActiveSwiper(st, k, true));
      wrap.appendChild(d);
      return d;
    });
    st.node.appendChild(wrap);
    return wrap;
  }

  // Swiper 的语义属性：值要进 state 而不是 DOM
  const SWIPER_ATTRS = {
    index: (st, v) => { st.index = Number(resolveResource(v)) || 0; },
    loop: (st, v) => { st.loop = !!v; },
    autoPlay: (st, v) => { st.autoPlay = !!v; },
    interval: (st, v) => { st.interval = Number(resolveResource(v)) || st.interval; },
    indicator: (st, v) => {
      if (typeof v === 'boolean') { st.indicatorWanted = v; return; }
      // DotIndicator/DigitIndicator 是带 builder 的对象，运行时读不到其配置
      st.indicatorWanted = true;
      layoutWarnings.push('Swiper.indicator 只支持 boolean；DotIndicator/DigitIndicator 的配置未实现（已退化为默认圆点）');
    },
  };

  // ────────────────── Navigation / NavDestination（栈导航）──────────────────
  //
  // 产物形式（实测 fixtures/pages/NavDemo.ts）：
  //   Navigation.create(this.stack, { moduleName, pagePath, isUserCreateStack: true });
  //   Navigation.title('Home');
  //   Navigation.navDestination({ builder: this.PageMap.bind(this) });   ← 包一层对象取 .builder
  //   Navigation.mode(NavigationMode.Stack); Navigation.width('…'); Navigation.id('…');
  //   { 根内容子组件 }                     ← 直接挂进 Navigation 元素
  //   Navigation.pop();
  //
  // builder 由【运行时】在压栈时调用（不在 initialRender 里）：
  //   builder(name, param, parent?)
  //     → NavDestination.create(deepFn, extraInfo);   ← 子构建器同样是构造参数
  //       NavDestination.title(name);
  //       NavDestination.onWillAppear/…/onWillDisappear(cb);
  //       NavDestination.pop();
  //
  // DOM 结构：
  //   <div data-arkui-comp="Navigation">        position:relative; overflow:hidden
  //     …根内容…                                 （被覆盖但不销毁 —— "状态保留"就靠这条）
  //     <div data-arkui-nav-destinations>        绝对定位覆盖层，空栈时 display:none
  //       <div data-arkui-comp="NavDestination"> 只有栈顶那个可见
  const NavigationMode = { Stack: 'stack', Split: 'split', Auto: 'auto' };
  // 标题栏相关枚举：产物里都是【自由变量】引用（`NavigationTitleMode.Full` 这样），必须挂 global
  // NavigationTitleMode 的取值照 .d.ts 声明顺序：Free = 0, Full, Mini
  const NavigationTitleMode = { Free: 0, Full: 1, Mini: 2 };
  const NavBarPosition = { Start: 0, End: 1 };
  const TitleHeight = { MainOnly: 0, MainWithSub: 1 };

  // 标题栏高度（vp→px 1:1，本项目一贯近似）。数字直接来自 navigation.d.ts 里 NavigationTitleMode
  // 的 JSDoc 原文：
  //   Full：「If there is only a main title, the title bar height is 112 vp; if there is both a main
  //          title and a subtitle, the title bar height is 138 vp」
  //   Mini：「Since API version 12, the title bar height is 56 vp」
  //   Free（默认 = 0）：「In the non-scrolling state, the height of the title bar is the same as in
  //          Full mode」—— 本实现不做滚动收缩，所以 Free 恒等于 Full。
  // TitleHeight 的数值 .d.ts 没给；按它自己的 JSDoc 措辞（"only main title" / "main title and
  // subtitle are both available"）对应到 Full 那两个已文档化的数字（112 / 138）。**这是推断**，
  // 已写进 docs 的已知限制。
  const NAV_TITLE_H = { main: 112, mainSub: 138, mini: 56 };
  const TITLE_HEIGHT_VALUE = { 0: NAV_TITLE_H.main, 1: NAV_TITLE_H.mainSub };
  const NAV_DIVIDER_PX = 1;               // 分栏时的分割线宽度
  const NAV_DEFAULT_BAR_W = 240;          // navBarWidth 默认 240vp（.d.ts JSDoc 原文）
  // push/pop 的系统转场（R25）。.d.ts 对默认转场只说"有"（pop 的 JSDoc："Whether to enable the
  // transition animation ... Default value: true"），没给时长与曲线 —— 目的地从右滑入/滑出、
  // 300ms、ease-out 族曲线是本实现的 DOM 化选择（**推断**，已写进 docs 已知限制）。
  const NAV_TRANS_MS = 300;
  const NAV_TRANS_CURVE = 'cubic-bezier(0.2, 0.0, 0.0, 1.0)';
  // 转场运行记录（测试轮询"挂着的转场"用，与 animation.js 的 transitionRuns 同思想）
  const navTransRuns = [];
  let navTransRunSeq = 0;
  function navTransDescribe() {
    let pending = 0;
    navTransRuns.forEach((r) => { if (!r.done) pending++; });
    return { runs: navTransRuns.map((r) => ({ ...r })), pending };
  }
  function navWitness(el, run) {          // transitionend 只当"见证"，不当收口依据（坑 ⑧ 同源）
    const fn = () => { run.sawTransitionEnd = true; };
    el.addEventListener('transitionend', fn, { once: true });
    return () => el.removeEventListener('transitionend', fn);
  }
  function navEndTransStyle(el) {
    el.style.transitionProperty = '';
    el.style.transitionDuration = '';
    el.style.transitionTimingFunction = '';
    delete el.dataset.arkuiNavTrans;
  }

  // NavDestination 的生命周期回调：属性名 → state 键
  const NAVDEST_LIFECYCLE = {
    onWillAppear: 'willAppear', onWillShow: 'willShow', onShown: 'shown', onReady: 'ready',
    onWillHide: 'willHide', onHidden: 'hidden', onWillDisappear: 'willDisappear',
    onBackPressed: 'backPressed',
  };
  // Navigation/NavDestination 上【仍未】覆盖的语义项（只列 .d.ts 里真实存在、而本实现没做的）。
  // 标题栏/工具栏/分栏已于 R12 收口实现（见下面的 navSyncChrome）—— 未实现的仍然不能静默。
  const NAV_UNSUPPORTED = new Set([
    // onTitleModeChange 已于 R25 实现（Free 滚动联动，见 navOnContentScroll）
    'onNavBarStateChange',      // 长按隐藏导航栏
    'navBarWidthRange', 'minNavBarWidth', 'hideNavBar', 'enableDragBar',
    'ignoreLayoutSafeArea', 'systemBarStyle', 'onNavigationModeChange',
    'customNavContentTransition', 'recoverable', 'enableModeChangeAnimation',
    'enableToolBarAdaptation', 'splitPlaceholder',
  ]);

  const animOf = (v) => (typeof v === 'boolean' ? v : !!(v && typeof v === 'object' && v.animated));

  class NavPathStack {
    constructor() { this._nav = null; this._paths = []; this._noAnim = false; }

    // ── 查询 ──
    size() { return this._paths.length; }
    getAllPathName() { return this._paths.map((p) => p.name); }
    getParamByIndex(i) { const p = this._paths[i]; return p ? p.param : undefined; }
    getParamByName(name) { return this._paths.filter((p) => p.name === name).map((p) => p.param); }
    getIndexByName(name) {
      const out = [];
      this._paths.forEach((p, i) => { if (p.name === name) out.push(i); });
      return out;
    }
    getPathStack() { return this._paths.map((p) => ({ name: p.name, param: p.param, onPop: p.onPop })); }
    getParent() {
      layoutWarnings.push('NavPathStack.getParent 未实现（嵌套 Navigation 的父栈未建模）');
      return undefined;
    }
    setInterception() { layoutWarnings.push('NavPathStack.setInterception 未实现（路由拦截未建模）'); }
    setPathStack(paths) {
      navClearAll(this);
      (paths || []).forEach((p) => navPushRec(this, { name: p.name, param: p.param, onPop: p.onPop }, false));
      navSyncVisibility(this._nav);
    }

    // ── 压栈 ──（animated 一律透传原值，默认 true 的解释在 navWantAnim）
    pushPath(info, options) {
      navPushRec(this, info || {}, options && typeof options === 'object' ? options.animated : options);
    }
    pushPathByName(name, param, a3, a4) {
      // .d.ts 重载：(name, param, animated?) / (name, param, onPop, animated?)。
      // a3 是函数 → a4 才是 animated；a3 是布尔 → a3 就是 animated（三参形态）；
      // a3=undefined（如 (name, param, undefined, false)）→ 看 a4。
      const onPop = typeof a3 === 'function' ? a3 : undefined;
      const animated = typeof a3 === 'function' ? a4 : (typeof a3 === 'boolean' ? a3 : a4);
      navPushRec(this, { name, param, onPop }, animated);
    }
    pushDestination(info) {
      navPushRec(this, info || {}, info && typeof info === 'object' ? info.animated : undefined);
      return Promise.resolve();
    }
    pushDestinationByName(name, param) {
      navPushRec(this, { name, param }, arguments[2]);
      return Promise.resolve();
    }

    // ── 弹栈 ──
    // .d.ts 重载：pop(animated?) / pop(result, animated?)；popToName/Index(name, result?, animated?)
    // 都有 "Whether to enable the transition animation ... Default value: true"
    pop(a1, a2) {
      if (!this._paths.length) return undefined;
      const result = a1 !== undefined && typeof a1 !== 'boolean' ? a1 : undefined;
      const animated = typeof a1 === 'boolean' ? a1 : a2;
      const rec = this._paths[this._paths.length - 1];
      navPopRange(this, this._paths.length - 1, 1, result, animated);
      return { name: rec.name, param: rec.param };
    }
    popToName(name, a2, a3) {
      const idx = this.getIndexByName(name);
      if (!idx.length) {
        layoutWarnings.push(`NavPathStack.popToName('${name}')：栈里没有该 name（约定返回 -1）`);
        return -1;
      }
      const target = idx[idx.length - 1];
      const result = a2 !== undefined && typeof a2 !== 'boolean' ? a2 : undefined;
      const animated = typeof a2 === 'boolean' ? a2 : a3;
      navPopRange(this, target + 1, this._paths.length - target - 1, result, animated);
      return target;
    }
    popToIndex(index, a2, a3) {
      const n = this._paths.length;
      if (!Number.isInteger(index) || index < 0 || index >= n) {
        layoutWarnings.push(`NavPathStack.popToIndex(${index})：越界（共 ${n} 项）`);
        return;
      }
      const result = a2 !== undefined && typeof a2 !== 'boolean' ? a2 : undefined;
      const animated = typeof a2 === 'boolean' ? a2 : a3;
      navPopRange(this, index + 1, n - index - 1, result, animated);
    }

    // ── 改写 ──
    replacePath(info, options) { navReplaceTop(this, info || {}, animOf(options)); }
    replacePathByName(name, param) { navReplaceTop(this, { name, param }, animOf(arguments[2])); }
    replaceDestination(info) { navReplaceTop(this, info || {}, animOf(arguments[1])); return Promise.resolve(); }
    removeByName(name) {
      const idx = [];
      this._paths.forEach((p, i) => { if (p.name === name) idx.push(i); });
      if (!idx.length) return 0;
      idx.slice().reverse().forEach((i) => navPopRange(this, i, 1, undefined));
      return idx.length;
    }
    removeByIndexes(indexes) {
      const valid = (indexes || []).filter((i) => Number.isInteger(i) && i >= 0 && i < this._paths.length);
      valid.slice().sort((a, b) => b - a).forEach((i) => navPopRange(this, i, 1, undefined));
      return valid.length;
    }
    removeByNavDestinationId() {
      layoutWarnings.push('NavPathStack.removeByNavDestinationId 未实现（本实现没有 NavDestination id 概念）');
      return 0;
    }
    moveToTop(name) {
      const idx = this.getIndexByName(name);
      if (!idx.length) {
        layoutWarnings.push(`NavPathStack.moveToTop('${name}')：栈里没有该 name`);
        return -1;
      }
      const rec = this._paths.splice(idx[idx.length - 1], 1)[0];
      this._paths.push(rec);
      // 复用原实例（与真机一致）：只调 DOM 顺序，不重建、不销毁
      if (rec.el && rec.el.parentNode) rec.el.parentNode.appendChild(rec.el);
      navSyncVisibility(this._nav);
      return this._paths.length - 1;
    }
    moveIndexToTop(index) {
      const rec = this._paths[index];
      if (!rec) { layoutWarnings.push(`NavPathStack.moveIndexToTop(${index})：越界`); return; }
      this.moveToTop(rec.name);
    }
    clear() { navClearAll(this); navSyncVisibility(this._nav); }
    disableAnimation(value) { this._noAnim = !!value; }
  }

  // ── 标题栏 / 工具栏 / 分栏（R12 收口）──
  //
  // 产物形态（实测 fixtures/pages/NavBarDemo.ts）：
  //   Navigation.title('T1');                                              ← string
  //   Navigation.title({ main: 'M2', sub: 'S2' });                        ← NavigationCommonTitle
  //   Navigation.title({ builder: this.TB.bind(this) }, { backgroundColor: '#eeeeee' });
  //   Navigation.title({ builder: this.TB.bind(this), height: TitleHeight.MainWithSub });
  //   Navigation.titleMode(NavigationTitleMode.Full);                     ← 自由变量枚举
  //   Navigation.hideTitleBar(true); Navigation.hideBackButton(true);
  //   Navigation.mode(NavigationMode.Split); Navigation.navBarWidth(200);
  //   Navigation.navBarPosition(NavBarPosition.Start);
  //   NavDestination.title('DT1'); NavDestination.menus([{ value, action }]);
  //   NavDestination.toolbarConfiguration([{ value, action }]); NavDestination.hideBackButton(true);
  // ⚠️ CustomBuilder 也是以 **{ builder } 对象** 传进来的（loader 会把 CustomBuilder 归一化成对象），
  //    所以"是不是自定义标题"看的是【有没有 builder 字段】，不是实参类型。

  function navParseTitle(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object' && typeof v.builder === 'function') {
      return { kind: 'builder', builder: v.builder, height: v.height };
    }
    if (typeof v === 'object' && (v.main !== undefined || v.sub !== undefined)) {
      return { kind: 'common', main: resolveResource(v.main), sub: resolveResource(v.sub) };
    }
    return { kind: 'text', text: String(resolveResource(v)) };
  }

  // 标题栏高度（px）。NavigationCustomTitle.height 优先 —— .d.ts 原文：
  // "When the NavigationCustomTitle type is used to set the height, titleMode does not take effect."
  function navTitleBarH(spec, titleMode) {
    if (spec && spec.height !== undefined && spec.height !== null) {
      if (typeof spec.height === 'number' && TITLE_HEIGHT_VALUE[spec.height] !== undefined) {
        return TITLE_HEIGHT_VALUE[spec.height];        // TitleHeight 枚举（数值推断，见常量注释）
      }
      const n = dimOf(spec.height, 0);
      if (n > 0) return n;                             // 显式 Length
    }
    if (titleMode === NavigationTitleMode.Mini) return NAV_TITLE_H.mini;
    const hasSub = !!(spec && spec.kind === 'common' && spec.sub !== undefined && spec.sub !== null
      && String(spec.sub) !== '');
    return hasSub ? NAV_TITLE_H.mainSub : NAV_TITLE_H.main;   // Full；Free 非滚动态等同 Full
  }

  // 滚动联动的生效条件（三条都来自 .d.ts 原文）：
  //   ① titleMode 必须 Free —— onTitleModeChange 的 JSDoc："Triggered when titleMode is set to
  //      NavigationTitleMode.Free and the title bar mode changes as content scrolls."
  //   ② NavigationCustomTitle.height 显式给过就不联动 —— "When the NavigationCustomTitle type
  //      is used to set the height, titleMode does not take effect."
  //   ③ 标题栏整个藏了（hideTitleBar）自然没有联动。
  function navCollapseAllowed(st) {
    return st.titleMode === NavigationTitleMode.Free && !st.hideTitleBar
      && !(st.titleSpec && st.titleSpec.height !== undefined && st.titleSpec.height !== null);
  }

  // 内容滚动 → 标题栏收缩（capture 监听挂在 Navigation 上，见 createNavState）。
  // 进度 p∈[0,1]：0 = 全高（Free 非滚动态等同 Full），1 = 收到 Mini；
  // 滚动距离与收缩进度线性，滚满 (Full−Mini) px 收到底 —— 该换算是本实现的选择
  //（.d.ts 只说 "the main title shrinks as the content scrolls down ... and restores
  // as the content scrolls up to the top"，没给阈值）。
  function navOnContentScroll(st, e) {
    const t = e.target;
    if (!t || t === st.node) return;
    if (st.areaEl && (t === st.areaEl || st.areaEl.contains(t))) return;   // 目的地自己滚不算
    if (!navCollapseAllowed(st)) return;
    const fullH = navTitleBarH(st.titleSpec, NavigationTitleMode.Full);
    if (fullH <= NAV_TITLE_H.mini) return;
    const p = Math.max(0, Math.min(1, (t.scrollTop || 0) / (fullH - NAV_TITLE_H.mini)));
    if (p === st.collapseP) return;
    st.collapseP = p;
    // 模式切换只发生在两个端点（阈值点 .d.ts 没写，端点判定是本实现的选择）：
    // 收到底 → Mini；滚回顶 → Full（"restores as the content scrolls up to the top"）。
    const s = p >= 1 ? 'mini' : (p <= 0 ? 'full' : st.tmcState);
    if (s !== st.tmcState) {
      st.tmcState = s;
      if (typeof st.tmc === 'function') {
        try {
          st.tmc(s === 'mini' ? NavigationTitleMode.Mini : NavigationTitleMode.Full);
        } catch (err) { layoutWarnings.push(`onTitleModeChange 回调抛错：${err && err.message}`); }
      }
    }
    syncOneNav(st.node);     // 高度/内边距/标题内部视觉统一走 syncOneNav，不维护两份几何
  }

  // 把 builder 建出来的节点收进 host（复用 NavDestination 深渲染那套：压栈 + 保存/还原 elmtId）
  function runBuilderInto(host, builder, what) {
    const saved = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    ViewStackProcessor.push(host);
    try { builder(); } catch (e) {
      layoutWarnings.push(`${what} 的 builder 抛错：${e && e.message}`);
    }
    ViewStackProcessor.restore(saved);
    currentNodeElmtId = savedElmt;
  }

  function navMenuBar(items) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-arkui-nav-menus', '');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    (items || []).forEach((m, i) => {
      const el = document.createElement('div');
      el.setAttribute('data-arkui-nav-menu', String(i));
      el.style.cursor = 'pointer';
      el.style.padding = '0 4px';
      el.textContent = String(resolveResource(m.value === undefined ? m.icon : m.value));
      el.addEventListener('click', () => {
        if (typeof m.action === 'function') {
          try { m.action(); } catch (e) { layoutWarnings.push(`菜单 action 抛错：${e && e.message}`); }
        }
      });
      wrap.appendChild(el);
    });
    return wrap;
  }

  function navBackButton(onBack, icon) {
    const btn = document.createElement('div');
    btn.setAttribute('data-arkui-nav-back', '');
    btn.style.cursor = 'pointer';
    btn.style.padding = '0 8px 0 0';
    btn.style.flexShrink = '0';
    if (icon) { btn.setAttribute('data-arkui-nav-back-icon', String(icon)); }
    btn.textContent = icon ? '‹' : '←';
    btn.addEventListener('click', onBack);
    return btn;
  }

  // 往 host 里画一条标题栏（Navigation 的导航栏 / NavDestination 的标题栏共用）
  function drawTitleBar(host, spec, opts) {
    const o = opts || {};
    host.textContent = '';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.boxSizing = 'border-box';
    if (o.backgroundColor !== undefined && o.backgroundColor !== null) {
      host.style.backgroundColor = String(colorOf(o.backgroundColor));
    }
    if (o.showBack) host.appendChild(navBackButton(o.onBack, o.backIcon));
    if (!spec) return;
    if (spec.kind === 'builder') {
      const holder = document.createElement('div');
      holder.setAttribute('data-arkui-nav-title-slot', '');
      holder.style.flex = '1';
      holder.style.minWidth = '0';
      host.appendChild(holder);
      runBuilderInto(holder, spec.builder, 'Navigation.title');
    } else if (spec.kind === 'common') {
      const box = document.createElement('div');
      box.setAttribute('data-arkui-nav-title-slot', '');
      box.style.flex = '1';
      box.style.minWidth = '0';
      const main = document.createElement('div');
      main.setAttribute('data-arkui-nav-title-main', '');
      main.style.fontSize = '16px';
      main.textContent = String(spec.main === undefined || spec.main === null ? '' : spec.main);
      box.appendChild(main);
      const sub = document.createElement('div');
      sub.setAttribute('data-arkui-nav-title-sub', '');
      sub.style.fontSize = '12px';
      sub.style.opacity = '0.7';
      sub.textContent = String(spec.sub === undefined || spec.sub === null ? '' : spec.sub);
      box.appendChild(sub);
      host.appendChild(box);
    } else {
      const t = document.createElement('div');
      t.setAttribute('data-arkui-nav-title-text', '');
      t.style.flex = '1';
      t.style.minWidth = '0';
      t.style.overflow = 'hidden';
      t.textContent = spec.text;
      host.appendChild(t);
    }
    if (o.menus && o.menus.length) host.appendChild(navMenuBar(o.menus));
  }

  // 工具栏（NavDestination 底部）：ToolbarItem[] → 一行可点项
  function drawToolbar(host, items) {
    host.textContent = '';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    host.style.boxSizing = 'border-box';
    host.style.gap = '16px';
    (items || []).forEach((it, i) => {
      const el = document.createElement('div');
      el.setAttribute('data-arkui-nav-toolbar-item', String(i));
      el.setAttribute('data-arkui-nav-toolbar-status', String(it.status === undefined ? 0 : it.status));
      el.style.cursor = 'pointer';
      el.textContent = String(resolveResource(it.value));
      el.addEventListener('click', () => {
        if (typeof it.action === 'function') {
          try { it.action(); } catch (e) { layoutWarnings.push(`工具栏 action 抛错：${e && e.message}`); }
        }
      });
      host.appendChild(el);
    });
  }

  function createNavState(node, stack) {
    const st = {
      node, stack: null, builder: null, areaEl: null, mode: 'stack', visible: null, paths: null,
      // 标题栏 / 工具栏 / 分栏（R12 收口）
      titleSpec: null, titleOptions: null, titleMode: NavigationTitleMode.Free,
      hideTitleBar: false, hideBackButton: false, menus: null,
      navBarWidth: null, navBarPosition: NavBarPosition.Start, minContentWidth: null,
      barEl: null, titleEl: null, dividerEl: null, titleDrawn: null, effectiveMode: 'stack',
      // R25：Free 滚动联动 + 转场
      tmc: null,              // onTitleModeChange 回调
      collapseP: 0,           // 收缩进度 0(=Full)…1(=Mini)，随内容滚动更新
      tmcState: 'full',       // 已通知的模式端点：'full' | 'mini'
    };
    node.__navState = st;
    node.style.position = 'relative';
    node.style.overflow = 'hidden';
    // 导航栏（含标题栏）必须是【第一个子节点】：根内容是直接子节点、在其后挂载，
    // 目标区最后创建。三者的定位关系由 syncOneNav 按模式统一摆（绝对定位，不参与文档流）。
    const bar = document.createElement('div');
    bar.setAttribute('data-arkui-nav-bar', '');
    bar.style.position = 'absolute';
    bar.style.zIndex = '2';
    bar.style.boxSizing = 'border-box';
    const title = document.createElement('div');
    title.setAttribute('data-arkui-nav-titlebar', '');
    title.style.position = 'absolute';
    title.style.left = '0';
    title.style.right = '0';
    title.style.top = '0';
    title.style.padding = '0 8px';
    title.style.fontSize = '16px';
    title.style.overflow = 'hidden';      // Free 收缩时内容随高度裁剪
    bar.appendChild(title);
    st.barEl = bar;
    st.titleEl = title;
    node.insertBefore(bar, node.firstChild);
    const divider = document.createElement('div');
    divider.setAttribute('data-arkui-nav-divider', '');
    divider.style.position = 'absolute';
    divider.style.display = 'none';
    divider.style.background = '#e5e5e5';
    st.dividerEl = divider;
    node.insertBefore(divider, bar.nextSibling);
    // Free 滚动联动：scroll 不冒泡，用 capture 在 Navigation 子树里接（List/Scroll 的滚动
    // 容器都在里面）。目的地自己滚不该动 Navigation 的标题栏 —— navOnContentScroll 里排除。
    node.addEventListener('scroll', (e) => navOnContentScroll(st, e), true);
    bindNavStack(st, stack);
    return st;
  }

  // 本轮该按哪种模式布局：Auto 用【真实宽度】判（.d.ts：宽度 ≥ 600vp 走 Split，
  // 600 = minNavBarWidth 240 + minContentWidth 360）。用元素自身宽度而不是 window：
  // 同一页可以有多个 Navigation（本项目的测量页正是这样），窗口宽度无法区分它们。
  function navEffectiveMode(st) {
    const m = String(st.mode || 'stack');
    if (m === 'split') return 'split';
    if (m === 'stack') return 'stack';
    const w = st.node ? st.node.offsetWidth : 0;             // auto
    return w >= 600 ? 'split' : 'stack';
  }

  // 标题栏 / 工具栏 / 分栏的布局同步：与 syncAlignRules 同一时机（首渲染后 + 每次重渲染后）。
  // 为什么必须晚一步（不变量 18）：分栏宽度与 Auto 的模式判定都要用【真实尺寸】。
  // builder 的场景用【身份】比内容比靠谱：JSON.stringify 会把函数丢掉，两个不同的 builder
  // 会退化成同一个签名（于是标题栏再也不重建）。
  const builderIds = new WeakMap();
  let builderIdSeq = 0;
  const builderIdOf = (fn) => {
    if (!builderIds.has(fn)) builderIds.set(fn, ++builderIdSeq);
    return builderIds.get(fn);
  };

  function syncOneNav(node) {
    const st = node.__navState;
    if (!st || !st.barEl || !st.barEl.isConnected) return;
    const sel = !!st.stack && st.paths && st.paths.length > 0;
    st.navStackNonEmpty = sel;
    // ① 标题栏内容（只在规格变了才重建：builder 重建会遗留旧的 elmtId 记录）
    const specSig = !st.titleSpec ? 'none'
      : (st.titleSpec.kind === 'builder'
        ? `b#${builderIdOf(st.titleSpec.builder)}#${st.titleSpec.height}`
        : JSON.stringify(st.titleSpec));
    const sig = `${specSig}|${JSON.stringify(st.titleOptions)}|${st.hideBackButton}|${st.hideTitleBar}|${sel}`;
    if (st.titleDrawn !== sig) {
      st.titleDrawn = sig;
      drawTitleBar(st.titleEl, st.titleSpec, {
        // 没有可回退的栈（或显式 hideBackButton）就不渲染返回键 —— 与"无处可回就没有返回键"一致
        showBack: !st.hideBackButton && sel,
        onBack: () => { if (st.stack) st.stack.pop(); },
        backIcon: st.backButtonIcon,
        menus: st.menus,
        backgroundColor: st.titleOptions && st.titleOptions.backgroundColor,
      });
    }
    st.titleEl.style.display = st.hideTitleBar ? 'none' : 'flex';
    // ② 高度与分栏几何。Free 联动时高度在 Full 与 Mini 之间随收缩进度插值（R25）
    const H0 = st.hideTitleBar ? 0 : navTitleBarH(st.titleSpec, st.titleMode);
    const col = !st.hideTitleBar && navCollapseAllowed(st) && H0 > NAV_TITLE_H.mini ? st.collapseP : 0;
    const H = H0 - (H0 - NAV_TITLE_H.mini) * col;
    st.barHeight = H;
    st.effectiveMode = navEffectiveMode(st);
    const split = st.effectiveMode === 'split';
    node.setAttribute('data-arkui-nav-mode', st.effectiveMode);
    node.setAttribute('data-arkui-nav-mode-declared', String(st.mode));
    const W = st.navBarWidth === null ? NAV_DEFAULT_BAR_W : dimOf(st.navBarWidth, node.offsetWidth);
    const end = st.navBarPosition === NavBarPosition.End;
    st.navBarWidthPx = W;
    // 用 paddingTop/Left/Right 单边赋值，不写 padding 简写 —— 免得把用户自己设的 padding 抹掉
    if (split) {
      st.barEl.style.top = '0';
      st.barEl.style.bottom = '0';
      st.barEl.style.height = '';
      st.barEl.style.width = `${W + NAV_DIVIDER_PX}px`;
      st.barEl.style.left = end ? '' : '0';
      st.barEl.style.right = end ? '0' : '';
      st.titleEl.style.height = `${H}px`;
      node.style.paddingTop = `${H}px`;
      node.style.paddingLeft = end ? '0' : `${W + NAV_DIVIDER_PX}px`;
      node.style.paddingRight = end ? `${W + NAV_DIVIDER_PX}px` : '0';
      st.dividerEl.style.display = 'block';
      st.dividerEl.style.top = '0';
      st.dividerEl.style.bottom = '0';
      st.dividerEl.style.width = `${NAV_DIVIDER_PX}px`;
      st.dividerEl.style.left = `${W}px`;
    } else {
      st.barEl.style.top = '0';
      st.barEl.style.bottom = '';
      st.barEl.style.height = `${H}px`;
      st.barEl.style.width = '';
      st.barEl.style.left = '0';
      st.barEl.style.right = '0';
      st.titleEl.style.height = `${H}px`;
      node.style.paddingTop = `${H}px`;
      node.style.paddingLeft = '0';
      node.style.paddingRight = '0';
      st.dividerEl.style.display = 'none';
    }
    // Free 收缩的标题内部视觉（Free JSDoc）：主标题随滚动缩小、副标题淡出但尺寸不变 ——
    // 只对 text/common 形态生效（"effective only when title is set to ResourceStr or
    // NavigationCommonTitle"）；builder 等其他形态只随高度变小（"changes in mere location"）。
    // 缩放比取高度比（Full 112→Mini 56 即缩到一半），是 DOM 化映射的选择。
    const shrinkEl = st.titleEl.querySelector('[data-arkui-nav-title-main],[data-arkui-nav-title-text]');
    if (shrinkEl) {
      const k = H0 > 0 ? H / H0 : 1;
      shrinkEl.style.transformOrigin = 'left center';
      shrinkEl.style.transform = col > 0 && k < 1 ? `scale(${k})` : '';
    }
    const subEl = st.titleEl.querySelector('[data-arkui-nav-title-sub]');
    if (subEl) subEl.style.opacity = col > 0 ? String(0.7 * (1 - col)) : '';
    // ③ 目标区：Split 时只占内容列（右侧/左侧），Stack 时铺满整个 Navigation
    if (st.areaEl) {
      if (split) {
        st.areaEl.style.top = '0';
        st.areaEl.style.bottom = '0';
        st.areaEl.style.left = end ? '0' : `${W + NAV_DIVIDER_PX}px`;
        st.areaEl.style.right = end ? `${W + NAV_DIVIDER_PX}px` : '0';
      } else {
        st.areaEl.style.inset = '0';
      }
    }
  }

  // NavDestination 的标题栏 / 工具栏（同一时机同步）。它没有 titleMode，高度恒为紧凑 56vp（推断）。
  function syncOneDest(node) {
    const d = node.__navDest;
    if (!d || !d.barEl || !d.barEl.isConnected) return;
    const own = navStateOfDest(node);    // 目的地自己没有 navState：返回键要走【所属 Navigation 的栈】
    const hasBack = !!own && own.paths && own.paths.length > 0;
    const sig = `${d.titleSpec ? (d.titleSpec.kind === 'builder'
      ? `b#${builderIdOf(d.titleSpec.builder)}#${d.titleSpec.height}` : JSON.stringify(d.titleSpec)) : 'none'}`
      + `|${JSON.stringify(d.menus)}|${d.hideBackButton}|${d.hideTitleBar}|${hasBack}`;
    if (d.titleDrawn !== sig) {
      d.titleDrawn = sig;
      d.barEl.style.display = d.hideTitleBar ? 'none' : 'flex';
      drawTitleBar(d.barEl, d.titleSpec, {
        showBack: hasBack && !d.hideBackButton,
        onBack: () => { if (own) own.stack.pop(); },
        backIcon: d.backButtonIcon,
        menus: d.menus,
      });
    }
    node.style.paddingTop = d.hideTitleBar ? '0' : `${NAV_TITLE_H.mini}px`;
    // 工具栏：hideToolBar 或没有条目时不显示
    const items = Array.isArray(d.toolbar) ? d.toolbar : [];
    const showTb = !d.hideToolBar && items.length > 0;
    d.toolbarEl.style.display = showTb ? 'flex' : 'none';
    node.style.paddingBottom = showTb ? '56px' : '0';
    const tbSig = `${items.length}|${items.map((i) => String(i.value)).join(',')}|${d.hideToolBar}`;
    if (d.toolbarDrawn !== tbSig) {
      d.toolbarDrawn = tbSig;
      drawToolbar(d.toolbarEl, items);
    }
    node.setAttribute('data-arkui-dest-title', d.titleSpec && d.titleSpec.text ? d.titleSpec.text : '');
  }

  // 目的地所属的 Navigation 状态（目标区 → Navigation 元素）
  function navStateOfDest(node) {
    let p = node.parentElement;
    while (p) {
      if (p.__navState) return p.__navState;
      p = p.parentElement;
    }
    return null;
  }

  function syncNavChrome(rootEl) {
    const scope = rootEl || document;
    if (scope.__navState) syncOneNav(scope);
    if (scope.__navDest) syncOneDest(scope);
    if (scope.querySelectorAll) {
      scope.querySelectorAll('[data-arkui-comp="Navigation"]').forEach(syncOneNav);
      scope.querySelectorAll('[data-arkui-comp="NavDestination"]').forEach(syncOneDest);
    }
  }


  function bindNavStack(st, stack) {
    if (!stack || typeof stack.pushPathByName !== 'function') {
      layoutWarnings.push('Navigation.create 的第一个参数不是 NavPathStack');
      return;
    }
    if (stack._nav && stack._nav !== st) {
      layoutWarnings.push('同一个 NavPathStack 被绑定到多个 Navigation（后绑定的生效）');
    }
    stack._nav = st;
    st.stack = stack;
    st.paths = stack._paths;          // 与栈对象共用同一个数组，避免两份状态漂移
  }

  // 目标区：Navigation.pop() 时创建（空栈时内容为空且隐藏）
  function ensureNavArea(st) {
    if (st.areaEl && st.areaEl.isConnected) return st.areaEl;
    const area = document.createElement('div');
    area.setAttribute('data-arkui-nav-destinations', '');
    area.style.position = 'absolute';
    area.style.left = '0';
    area.style.top = '0';
    area.style.right = '0';
    area.style.bottom = '0';
    area.style.background = '#fff';
    area.style.display = 'none';
    st.areaEl = area;
    st.node.appendChild(area);
    return area;
  }

  function ensureBuilder(st) {
    if (!st.builder) {
      layoutWarnings.push('Navigation 没有 navDestination builder：无法创建 NavDestination。'
        + '请加 .navDestination(this.PageMap)，且 builder 里的 if/else 要覆盖该 name');
      return false;
    }
    return true;
  }

  // animated：boolean | {animated} | undefined。.d.ts（pop 的 JSDoc，push 同）：
  // "Whether to enable the transition animation ... Default value: true" —— 未给就默认开。
  function navWantAnim(stack, animated) {
    if (stack._noAnim) return false;                       // disableAnimation(true)
    if (animated === undefined || animated === null) return true;
    return animOf(animated);
  }

  // push 转场（R25）：新栈顶从右滑入、盖在上一个栈顶上；上一个栈顶在滑入期间保持可见，
  // 结束才藏。样式收口与 animation.js 同一约定：先提交起始值（强制重排，坑 ⑧），
  // transitionend 只当见证，真正收口靠定时器。
  function navSlidePush(st, rec, prev) {
    const el = rec.el;
    if (!el) return;
    const showPrev = !!(prev && prev.el && prev !== rec);
    if (showPrev) prev.el.style.display = 'block';         // navSyncVisibility 刚把它藏掉
    const run = { seq: ++navTransRunSeq, kind: 'push', name: rec.name, done: false, sawTransitionEnd: false, endedBy: null };
    navTransRuns.push(run);
    if (navTransRuns.length > 50) navTransRuns.shift();
    el.dataset.arkuiNavTrans = 'push';
    el.style.transform = 'translateX(100%)';
    void el.offsetHeight;
    const stopWitness = navWitness(el, run);
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
    el.style.transitionTimingFunction = NAV_TRANS_CURVE;
    el.style.transform = '';
    const timer = setTimeout(() => {
      run.endedBy = 'timer';
      navEndTransStyle(el);
      stopWitness();
      run.done = true;
      // 期间若有新栈操作，可见性已由那次的 sync 接管：只藏"现在仍然不是栈顶"的前任
      if (showPrev && prev !== st.visible) prev.el.style.display = 'none';
    }, NAV_TRANS_MS + 30);
  }

  function navPushRec(stack, info, animated) {
    const st = stack._nav;
    if (!st) { layoutWarnings.push('NavPathStack 尚未绑定到任何 Navigation'); return false; }
    if (!info || !info.name) { layoutWarnings.push('NavPathStack 压栈缺少 name'); return false; }
    if (!ensureBuilder(st)) return false;
    const prev = st.paths.length ? st.paths[st.paths.length - 1] : null;   // push 前的栈顶
    const rec = { name: info.name, param: info.param, onPop: info.onPop, el: null, cbs: {}, everShown: false };
    // 先入栈再建树：builder 里若读 size()/getAllPathName() 应看到新状态
    stack._paths.push(rec);
    if (!navBuildDest(st, rec)) { stack._paths.pop(); return false; }   // 建不出来不留幽灵路径项
    navSyncVisibility(st);
    // 转场（R25）：栈空 → 首个目的地也滑（真机如此）；disableAnimation / animated:false 不滑
    if (navWantAnim(stack, animated)) navSlidePush(st, rec, prev);
    return true;
  }

  function navBuildDest(st, rec) {
    const area = ensureNavArea(st);
    const savedStack = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    // 目的地未必是目标区的【直接子节点】：builder 里的 if/else 会生成 `If` 包装层
    // （display:contents），目的地是"孙子辈"。所以不能只看 lastElementChild ——
    // 旧实现就这么写的，遇到带 if 分支的 PageMap 会误判成"没建出来"并把栈项弹掉
    // （R12 收口的新页面正是这种 builder，断言当场抓住）。改成按"本次新建的节点"认领。
    area.querySelectorAll('[data-arkui-comp="NavDestination"]')
      .forEach((n) => { n.__arkuiNavNew = false; });
    ViewStackProcessor.push(area);          // 让 NavDestination 挂进目标区
    try {
      st.builder(rec.name, rec.param, undefined);
    } catch (e) {
      layoutWarnings.push(`Navigation 的 builder 抛错（name=${rec.name}）：${e && e.message}`);
    }
    ViewStackProcessor.restore(savedStack);
    currentNodeElmtId = savedElmt;
    const el = Array.from(area.querySelectorAll('[data-arkui-comp="NavDestination"]'))
      .find((n) => n.__arkuiNavNew);
    if (!el) {
      layoutWarnings.push(`Navigation 的 builder 没有为 name='${rec.name}' 创建 NavDestination：`
        + '检查 builder 里的 if/else 是否覆盖了该 name');
      return false;
    }
    rec.el = el;
    rec.cbs = el.__navDestCbs || {};
    return true;
  }

  function navDestroyDest(rec) {
    if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    rec.el = null;
  }

  function navFire(rec, kind) {
    const cb = rec.cbs && rec.cbs[kind];
    if (typeof cb !== 'function') return;
    try { cb(); } catch (e) { layoutWarnings.push(`NavDestination.${kind} 回调抛错：${e && e.message}`); }
  }

  // 隐藏：willHide → hidden（JSDoc：前者"即将隐藏"，后者"已隐藏"）
  function navHideDest(rec) {
    if (!rec || !rec.el) return;
    navFire(rec, 'willHide');
    rec.el.style.display = 'none';
    navFire(rec, 'hidden');
  }

  // 显示：首次挂载 willAppear → willShow → shown → ready；再次显示只走 willShow → shown
  function navShowDest(rec) {
    if (!rec || !rec.el) return;
    if (!rec.everShown) { navFire(rec, 'willAppear'); rec.everShown = true; }
    navFire(rec, 'willShow');
    rec.el.style.display = 'block';
    navFire(rec, 'shown');
    if (rec.cbs.ready && !rec.readyFired) { rec.readyFired = true; navFire(rec, 'ready'); }
  }

  // 把可见性与生命周期对齐到"只有栈顶可见"
  function navSyncVisibility(st) {
    if (!st) return;
    const top = st.paths.length ? st.paths[st.paths.length - 1] : null;
    if (st.visible && st.visible !== top) navHideDest(st.visible);
    st.paths.forEach((p) => { if (p.el && p !== top) p.el.style.display = 'none'; });
    if (top && top !== st.visible) navShowDest(top);
    st.visible = top;
    if (st.areaEl) st.areaEl.style.display = st.paths.length ? 'block' : 'none';
    // push/pop 不一定伴随重渲染（纯栈操作时没有状态变更），所以这里必须主动同步一次
    // 标题栏/工具栏 —— 否则目的地画出来却没有标题栏（首版就是这样，断言当场抓住）。
    if (typeof syncNavChrome === 'function') syncNavChrome(st.node);
  }

  // pop 转场（R25）：栈顶向右滑出、露出新栈顶（或空栈时的根内容）。状态层回调照旧立刻发
  //（willHide → hidden → willDisappear，顺序与立即版一致），DOM 摘除推迟到滑出结束 ——
  // 这是"动画期间目的地还在"与"生命周期语义不变"的唯一交点，已写进 docs。
  function navPopAnimated(stack, rec, result) {
    const st = stack._nav;
    const el = rec.el;
    navFire(rec, 'willHide');
    navFire(rec, 'hidden');
    navFire(rec, 'willDisappear');
    if (typeof rec.onPop === 'function') {
      try { rec.onPop({ info: { name: rec.name, param: rec.param }, result }); }
      catch (e) { layoutWarnings.push(`NavPathStack 的 onPop 回调抛错：${e && e.message}`); }
    }
    const idx = st.paths.indexOf(rec);
    if (idx >= 0) st.paths.splice(idx, 1);
    purgeDetachedRecords();
    navSyncVisibility(st);                 // 露出新栈顶 / 根内容（在滑出层的下面）
    if (!el) return;
    if (st.areaEl) st.areaEl.style.display = 'block';   // 空栈时 sync 会藏目标区——滑出期间撑住
    const run = { seq: ++navTransRunSeq, kind: 'pop', name: rec.name, done: false, sawTransitionEnd: false, endedBy: null };
    navTransRuns.push(run);
    if (navTransRuns.length > 50) navTransRuns.shift();
    el.dataset.arkuiNavTrans = 'pop';
    el.style.display = 'block';
    el.style.zIndex = '3';                 // DOM 顺序上新栈顶在后面（盖住它），滑出期间要反超
    el.style.transform = '';
    void el.offsetHeight;
    const stopWitness = navWitness(el, run);
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
    el.style.transitionTimingFunction = NAV_TRANS_CURVE;
    el.style.transform = 'translateX(100%)';
    const timer = setTimeout(() => {
      run.endedBy = 'timer';
      navEndTransStyle(el);
      stopWitness();
      run.done = true;
      el.style.zIndex = '';
      el.style.transform = '';
      navDestroyDest(rec);
      purgeDetachedRecords();
      // 目标区的显隐以【当下】的栈为准（滑出期间可能有新 push）
      if (st.areaEl && !st.paths.length) st.areaEl.style.display = 'none';
    }, NAV_TRANS_MS + 30);
  }

  // 弹出 [from, from+count)：从【栈顶向下】处理，保证生命周期顺序
  function navPopRange(stack, from, count, result, animated) {
    const st = stack._nav;
    if (count <= 0) return;
    // 转场只给"从可见栈顶弹出 1 项"的典型 pop（pop(animated) 的语义）；范围弹栈（popToName/
    // popToIndex/clear/setPathStack）照旧立即销毁 —— 真机对范围弹栈也只动画栈顶。
    const topIdx = from + count - 1;
    const rec = st.paths[topIdx];
    if (count === 1 && rec && rec.el && st.visible === rec && navWantAnim(stack, animated)) {
      navPopAnimated(stack, rec, result);
      return;
    }
    for (let i = from + count - 1; i >= from; i--) {
      const rec = st.paths[i];
      if (!rec) continue;
      if (st.visible === rec) navHideDest(rec);
      navFire(rec, 'willDisappear');
      navDestroyDest(rec);
      if (typeof rec.onPop === 'function') {
        try { rec.onPop({ info: { name: rec.name, param: rec.param }, result }); }
        catch (e) { layoutWarnings.push(`NavPathStack 的 onPop 回调抛错：${e && e.message}`); }
      }
    }
    st.paths.splice(from, count);
    purgeDetachedRecords();          // 回收被销毁目标占用的 elmtId 记录
    navSyncVisibility(st);
  }

  function navClearAll(stack) {
    const st = stack._nav;
    if (!st) { stack._paths.length = 0; return; }
    navPopRange(stack, 0, st.paths.length, undefined);
  }

  function navReplaceTop(stack, info, _animated) {
    const st = stack._nav;
    if (!st) { layoutWarnings.push('NavPathStack 尚未绑定到任何 Navigation'); return; }
    if (!st.paths.length) { layoutWarnings.push('NavPathStack.replacePath：栈为空，无可替换项'); return; }
    if (!info || !info.name) { layoutWarnings.push('NavPathStack.replacePath 缺少 name'); return; }
    if (!ensureBuilder(st)) return;
    const topIdx = st.paths.length - 1;
    const old = st.paths[topIdx];
    // "替换"不是"弹出"：不派发 onPop，但旧实例要销毁
    if (st.visible === old) { navHideDest(old); st.visible = null; }
    navFire(old, 'willDisappear');
    navDestroyDest(old);
    const rec = { name: info.name, param: info.param, onPop: info.onPop, el: null, cbs: {}, everShown: false };
    st.paths[topIdx] = rec;
    if (!navBuildDest(st, rec)) {
      st.paths.splice(topIdx, 1);
      purgeDetachedRecords();
    }
    navSyncVisibility(st);
  }

  function updateNavStack(st, v) { bindNavStack(st, v); }

  // NavDestination 挂载：认领目标区（先按 none 挂上，可见性交给 navSyncVisibility）
  function mountNavDestination(rec, deepFn, elmtId) {
    let node = rec && rec.node && rec.node.__arkuiComp === 'NavDestination' ? rec.node : null;
    if (!node) {
      node = document.createElement('div');
      node.__arkuiComp = 'NavDestination';
      node.setAttribute('data-arkui-comp', 'NavDestination');   // mountNode 会打，这里绕过了它
      node.__navDestCbs = {};
      node.__arkuiNavNew = true;      // navBuildDest 靠这个标记认领"本次新建的目的地"
      // NavDestination 自己的标题栏 / 工具栏（R12 收口）。它没有 titleMode（.d.ts 里不存在），
      // 标题栏恒为紧凑高度 56vp（= Mini 高度）。**这一条是推断** —— .d.ts 没写 NavDestination
      // 标题栏的高度，取 Mini 的依据是"目标页用紧凑标题栏"这一可见事实，已写进 docs 已知限制。
      node.__navDest = {
        titleSpec: null, menus: null, toolbar: null,
        hideBackButton: false, hideTitleBar: false, hideToolBar: false,
        backButtonIcon: null, titleDrawn: null, barEl: null, toolbarEl: null,
      };
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.overflow = 'auto';
      node.style.display = 'none';
      node.style.position = 'relative';
      const dbar = document.createElement('div');
      dbar.setAttribute('data-arkui-dest-titlebar', '');
      dbar.style.position = 'absolute';
      dbar.style.left = '0';
      dbar.style.right = '0';
      dbar.style.top = '0';
      dbar.style.height = `${NAV_TITLE_H.mini}px`;
      dbar.style.zIndex = '2';
      dbar.style.padding = '0 8px';
      dbar.style.boxSizing = 'border-box';
      dbar.style.fontSize = '16px';
      dbar.style.background = '#fff';
      node.appendChild(dbar);
      const dtb = document.createElement('div');
      dtb.setAttribute('data-arkui-dest-toolbar', '');
      dtb.style.position = 'absolute';
      dtb.style.left = '0';
      dtb.style.right = '0';
      dtb.style.bottom = '0';
      dtb.style.height = '56px';
      dtb.style.zIndex = '2';
      dtb.style.display = 'none';
      dtb.style.background = '#fff';
      node.appendChild(dtb);
      node.__navDest.barEl = dbar;
      node.__navDest.toolbarEl = dtb;
      const parent = parentOfTop();
      // "在目标区内"要向上找祖先，不能只看直接父节点 —— builder 的 if/else 会插一层 `If` 包装，
      // 目的地的直接父节点就是那个包装层，不是目标区本身。
      let inArea = false;
      for (let p = parent; p; p = p.parentElement) {
        if (p.hasAttribute && p.hasAttribute('data-arkui-nav-destinations')) { inArea = true; break; }
      }
      if (!inArea) {
        layoutWarnings.push('NavDestination 不在 Navigation 的目标区内'
          + '（本组件只能由 Navigation 的 navDestination builder 创建）');
      }
      if (rec) { rec.node = node; rec.parentNode = parent; }
      parent.appendChild(node);
      if (typeof deepFn === 'function' && !deepRendering.has(elmtId)) {
        deepRendering.add(elmtId);
        const saved = ViewStackProcessor.snapshot();
        const savedElmt = currentNodeElmtId;
        ViewStackProcessor.push(node);
        currentNodeElmtId = elmtId;
        deepFn(elmtId, true);
        ViewStackProcessor.restore(saved);
        currentNodeElmtId = savedElmt;
        deepRendering.delete(elmtId);
      }
    }
    return node;
  }

  // Navigation 的语义属性
  const NAV_ATTRS = {
    navDestination: (st, v) => {
      const b = v && typeof v === 'object' ? v.builder : v;
      if (typeof b !== 'function') {
        layoutWarnings.push('Navigation.navDestination 的参数里没有 builder 函数');
        return;
      }
      st.builder = b;
    },
    // mode：Stack / Split / Auto 都实现了；Auto 的判定在 navEffectiveMode（要用真实宽度）
    mode: (st, v) => { st.mode = String(v); },
    title: (st, v, opts) => {
      st.titleSpec = navParseTitle(v);
      st.titleOptions = opts && typeof opts === 'object' ? opts : null;
    },
    titleMode: (st, v) => { st.titleMode = Number(v); },
    // R25：Free 滚动联动的事件（.d.ts：titleMode=Free 且内容滚动导致标题栏模式变化时触发）。
    // ⚠️ 属性分发必须在通用 on* 规则之前把它拦下 —— 否则 fn 会被当成 DOM 事件监听挂到
    // 'titlemodechange' 上，永远没人派发（R25 测量时撞上的分发陷阱）。
    onTitleModeChange: (st, v) => { st.tmc = typeof v === 'function' ? v : null; },
    hideTitleBar: (st, v) => { st.hideTitleBar = !!v; },
    hideBackButton: (st, v) => { st.hideBackButton = !!v; },
    backButtonIcon: (st, v) => { st.backButtonIcon = resolveResource(v); },
    menus: (st, v) => {
      if (typeof v === 'function') {
        layoutWarnings.push('Navigation.menus 的自定义 builder 形态未实现（数组形态已支持）');
        return;
      }
      st.menus = Array.isArray(v) ? v : null;
    },
    navBarWidth: (st, v) => { st.navBarWidth = v; },
    navBarPosition: (st, v) => { st.navBarPosition = Number(v); },
    minContentWidth: (st, v) => { st.minContentWidth = v; },
  };

  // NavDestination 的标题栏 / 工具栏属性
  const NAVDEST_ATTRS = {
    title: (node, v, opts) => {
      node.__navDest.titleSpec = navParseTitle(v);
      node.__navDest.titleOptions = opts && typeof opts === 'object' ? opts : null;
    },
    hideTitleBar: (node, v) => { node.__navDest.hideTitleBar = !!v; },
    hideBackButton: (node, v) => { node.__navDest.hideBackButton = !!v; },
    backButtonIcon: (node, v) => { node.__navDest.backButtonIcon = resolveResource(v); },
    menus: (node, v) => {
      if (typeof v === 'function') {
        layoutWarnings.push('NavDestination.menus 的自定义 builder 形态未实现（数组形态已支持）');
        return;
      }
      node.__navDest.menus = Array.isArray(v) ? v : null;
    },
    toolbarConfiguration: (node, v) => {
      if (typeof v === 'function') {
        layoutWarnings.push('NavDestination.toolbarConfiguration 的自定义 builder 形态未实现'
          + '（Array<ToolbarItem> 形态已支持）');
        return;
      }
      node.__navDest.toolbar = Array.isArray(v) ? v : null;
    },
    hideToolBar: (node, v) => { node.__navDest.hideToolBar = !!v; },
  };

  // ────────────────── 纯绘制类：Progress / Gauge / DataPanel / Rating（R13）──────────────────
  //
  // 产物形式（实测 fixtures/pages/DrawDemo.ts）：四个都是【create 选项】传数据 + 属性设样式。
  //   Progress.create({ value, total, style: ProgressStyle.Linear });  Progress.width/height/id
  //   Gauge.create({ value, min, max });  Gauge.startAngle/endAngle/strokeWidth/colors
  //   DataPanel.create({ values, max, type: DataPanelType.Circle })
  //   Rating.create({ rating, indicator });  Rating.stars/stepSize/starStyle/onChange
  // 注意：Gauge/DataPanel 的产物里有 pop() 配对，Progress/Rating 没有（不影响实现）。
  const ProgressStyle = { Linear: 'linear', Ring: 'ring', Eclipse: 'eclipse', ScaleRing: 'scaleRing', Capsule: 'capsule' };
  const ProgressType = ProgressStyle;                       // type 是老写法，语义同 style
  // 枚举顺序照 data_panel.d.ts（Line=0, Circle=1），所以也接受数字
  const DataPanelType = { Line: 'line', Circle: 'circle' };
  const isCirclePanel = (v) => v === 'circle' || v === 1;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, String(attrs[k]));
    return el;
  };
  const colorOf = (c) => {
    if (typeof c === 'number') return '#' + (c >>> 0).toString(16).padStart(8, '0').slice(2);
    if (typeof c === 'string') return c;
    return '#007dff';                                       // 拿不到资源引用时退化为默认蓝
  };
  // 弧长归一化：pathLength=100 → dasharray 直接是百分比，跨实现可断言
  const PATH_LEN = 100;
  const r2 = (n) => Math.round(n * 100) / 100;

  // 圆环坐标：0 点 = 0 度、顺时针为正（Gauge 的 .d.ts JSDoc 原话）
  // a=0 → 顶部中央；a=90 → 右侧；a=180 → 底部中央
  const polar = (cx, cy, r, deg) => ({
    x: cx + r * Math.sin((deg * Math.PI) / 180),
    y: cy - r * Math.cos((deg * Math.PI) / 180),
  });
  function arcPath(cx, cy, r, a0, a1) {
    const sweep = a1 - a0;
    if (sweep <= 0) return '';
    if (sweep >= 360) {
      // 整圆：一条 arc 的起终点重合、SVG 会渲染成空，必须拆成两个半圆
      const p0 = polar(cx, cy, r, a0), pm = polar(cx, cy, r, a0 + 180), p1 = polar(cx, cy, r, a0 + 360);
      return `M ${r2(p0.x)} ${r2(p0.y)} A ${r} ${r} 0 0 1 ${r2(pm.x)} ${r2(pm.y)}`
        + ` A ${r} ${r} 0 0 1 ${r2(p1.x)} ${r2(p1.y)}`;
    }
    const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    return `M ${r2(p0.x)} ${r2(p0.y)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${r2(p1.x)} ${r2(p1.y)}`;
  }
  const arcDash = (el, pct, offset) => {
    el.setAttribute('pathLength', String(PATH_LEN));
    el.setAttribute('stroke-dasharray', `${r2(pct)} ${PATH_LEN}`);
    el.setAttribute('stroke-dashoffset', String(r2(offset)));
  };

  // ── Progress ──
  function buildProgressNode(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const style = String(o.style !== undefined ? o.style : (o.type !== undefined ? o.type : 'linear'));
    const node = document.createElement('div');
    node.__arkuiComp = 'Progress';
    node.__drawKind = 'Progress';
    node.__drawOpts = o;
    node.setAttribute('data-arkui-progress', style);
    node.setAttribute('role', 'progressbar');
    node.style.display = 'block';
    const total = Number(o.total) || 100;
    node.setAttribute('aria-valuemin', '0');
    node.setAttribute('aria-valuemax', String(total));
    const ring = style === 'ring' || style === 'eclipse' || style === 'scaleRing';
    if (ring) {
      node.__svg = svgEl('svg', {});
      node.__svg.style.width = '100%';
      node.__svg.style.height = '100%';
      node.appendChild(node.__svg);
      if (style === 'scaleRing') warnOnce('Progress(style=ScaleRing) 的刻度未实现（只画环）');
      node.__stroke = 4;
    } else {
      if (style !== 'linear' && style !== 'capsule') {
        warnOnce(`Progress(style=${style}) 未实现，已退化为线性`);
      }
      node.style.overflow = 'hidden';
      if (style === 'capsule') node.style.borderRadius = '999px';
      const fill = document.createElement('div');
      fill.setAttribute('data-arkui-progress-fill', '');
      fill.style.height = '100%';
      fill.style.background = '#007dff';
      if (style === 'capsule') fill.style.borderRadius = '999px';
      node.appendChild(fill);
      node.__fill = fill;
    }
    applyProgressValue(node, o.value, total);
    return node;
  }

  function applyProgressValue(node, value, totalArg) {
    const total = Number(totalArg) || Number(node.getAttribute('aria-valuemax')) || 100;
    const v = Number(value) || 0;
    const pct = Math.max(0, Math.min(1, total ? v / total : 0)) * 100;
    node.__ratio = pct / 100;
    node.style.setProperty('--progress', r2(pct) + '%');
    node.setAttribute('aria-valuenow', String(v));
    if (node.__fill) node.__fill.style.width = r2(pct) + '%';
    else if (node.__svg) drawProgressRing(node, pct / 100);
  }

  function drawProgressRing(node, ratio) {
    const w = node.offsetWidth || 80, h = node.offsetHeight || 80;
    const stroke = node.__stroke || 4;
    const r = Math.max(1, Math.min(w, h) / 2 - stroke / 2);
    const svg = node.__svg;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.textContent = '';
    const track = svgEl('circle', { cx: w / 2, cy: h / 2, r, fill: 'none', stroke: '#e5e5e5', 'stroke-width': stroke });
    track.setAttribute('data-arkui-progress-track', '');
    const arc = svgEl('circle', {
      cx: w / 2, cy: h / 2, r, fill: 'none', stroke: '#007dff', 'stroke-width': stroke,
      transform: `rotate(-90 ${w / 2} ${h / 2})`,              // 从 12 点钟开始，与 Gauge 的 0 度一致
      'stroke-linecap': 'round',
    });
    arc.setAttribute('data-arkui-progress-arc', '');
    arcDash(arc, ratio * PATH_LEN, 0);
    svg.appendChild(track);
    svg.appendChild(arc);
  }

  // ── Gauge ──
  function buildGaugeNode(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const node = document.createElement('div');
    node.__arkuiComp = 'Gauge';
    node.__drawKind = 'Gauge';
    node.__drawOpts = o;
    node.__min = o.min === undefined ? 0 : Number(o.min);
    node.__max = o.max === undefined ? 100 : Number(o.max);
    node.__startAngle = 0;                      // .d.ts：默认 0
    node.__endAngle = 360;                      // .d.ts：默认 360
    node.__strokeW = 4;
    node.__colors = null;
    node.__svg = svgEl('svg', {});
    node.__svg.style.width = '100%';
    node.__svg.style.height = '100%';
    node.appendChild(node.__svg);
    return node;
  }

  function gaugeSegments(node) {
    const c = node.__colors;
    if (c === null || c === undefined) return [{ color: null, weight: 1 }];
    const list = Array.isArray(c) ? c : [{ color: c, weight: 1 }];
    const segs = [];
    for (const item of list) {
      if (Array.isArray(item)) segs.push({ color: item[0], weight: Number(item[1]) || 0 });
      else segs.push({ color: item, weight: 1 });
    }
    // JSDoc：权重为 0 的色段不显示；全 0 则整环不显示
    return segs.filter((s) => s.weight > 0);
  }

  function redrawGauge(node) {
    const w = node.offsetWidth || 120, h = node.offsetHeight || 120;
    const stroke = node.__strokeW;
    const r = Math.max(1, Math.min(w, h) / 2 - stroke / 2);
    const cx = w / 2, cy = h / 2;
    const svg = node.__svg;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.textContent = '';
    const d = arcPath(cx, cy, r, node.__startAngle, node.__endAngle);
    if (!d) {
      warnOnce(`Gauge: endAngle(${node.__endAngle}) <= startAngle(${node.__startAngle})，只顺时针绘制，已按空环处理`);
      return;
    }
    const segs = gaugeSegments(node);
    const sum = segs.reduce((s, x) => s + x.weight, 0);
    if (sum <= 0) {
      warnOnce('Gauge 的 colors 权重全为 0 → 按规范整环不显示');
      return;
    }
    let cursor = 0;
    segs.forEach((s, i) => {
      const pct = (s.weight / sum) * PATH_LEN;
      const p = svgEl('path', {
        d, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'butt',
        stroke: s.color === null ? '#007dff' : colorOf(s.color),
      });
      p.setAttribute('data-arkui-gauge-seg', String(i));
      arcDash(p, pct, -cursor);
      cursor += pct;
      svg.appendChild(p);
    });
    // 未填充部分：用一条压在上面的"轨道"覆盖 [ratio, 1]
    // —— 这样多色段的环仍按段着色，而不是被一条单色值弧盖掉
    const span = node.__max - node.__min;
    const ratio = Math.max(0, Math.min(1, span ? (Number(node.__drawOpts.value) - node.__min) / span : 0));
    const track = svgEl('path', {
      d, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'butt', stroke: '#e5e5e5',
    });
    track.setAttribute('data-arkui-gauge-track', '');
    arcDash(track, (1 - ratio) * PATH_LEN, -ratio * PATH_LEN);
    svg.appendChild(track);
  }

  // ── DataPanel ──
  const PANEL_PALETTE = ['#007dff', '#00c48c', '#ffb400', '#ff5c5c', '#9b59b6', '#00b3c7'];
  function buildDataPanelNode(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const node = document.createElement('div');
    node.__arkuiComp = 'DataPanel';
    node.__drawKind = 'DataPanel';
    node.__drawOpts = o;
    node.__values = Array.isArray(o.values) ? o.values.map(Number) : [];
    node.__panelMax = Number(o.max) || 100;
    node.__panelType = isCirclePanel(o.type) ? 'circle' : 'line';
    node.__panelColors = null;
    node.style.display = 'block';
    redrawDataPanel(node);
    return node;
  }

  function panelGeometry(node) {
    const max = node.__panelMax || 100;
    const segs = node.__values.map((v) => Math.max(0, v) / max);
    const stops = [];
    let acc = 0;
    for (const s of segs) { acc += s; stops.push(Math.min(1, acc)); }
    return { segs, stops };
  }

  function redrawDataPanel(node) {
    const { segs } = panelGeometry(node);
    const colors = node.__panelColors || PANEL_PALETTE;
    if (node.__panelType === 'circle') {
      const parts = [];
      let from = 0;
      segs.forEach((s, i) => {
        if (s <= 0) return;
        const to = Math.min(1, from + s);
        parts.push(`${colors[i % colors.length]} ${r2(from * 100)}% ${r2(to * 100)}%`);
        from = to;
      });
      if (from < 1) parts.push(`#e5e5e5 ${r2(from * 100)}% 100%`);   // 余量走轨道色
      node.style.borderRadius = '50%';
      node.style.backgroundImage = `conic-gradient(${parts.join(', ')})`;
    } else {
      node.style.display = 'flex';
      node.style.flexDirection = 'row';
      node.style.overflow = 'hidden';
      node.textContent = '';
      let used = 0;
      segs.forEach((s, i) => {
        if (s <= 0) return;
        const seg = document.createElement('div');
        seg.setAttribute('data-arkui-datapanel-seg', String(i));
        seg.style.width = r2(s * 100) + '%';
        seg.style.height = '100%';
        seg.style.flex = 'none';
        seg.style.background = colors[i % colors.length];
        node.appendChild(seg);
        used += s;
      });
      if (used < 1) {
        const rest = document.createElement('div');
        rest.setAttribute('data-arkui-datapanel-track', '');
        rest.style.flex = '1 1 auto';
        rest.style.height = '100%';
        rest.style.background = '#e5e5e5';
        node.appendChild(rest);
      }
    }
  }

  // ── Rating ──
  const STAR_PATH = 'M 12 2 L 15.09 8.26 L 22 9.27 L 17 14.14 L 18.18 21.02 L 12 17.77'
    + ' L 5.82 21.02 L 7 14.14 L 2 9.27 L 8.91 8.26 Z';
  function buildRatingNode(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const node = document.createElement('div');
    node.__arkuiComp = 'Rating';
    node.__drawKind = 'Rating';
    node.__rating = Number(o.rating) || 0;
    node.__interactive = o.indicator !== true;
    node.__starCount = 5;                                     // ArkUI 默认 5
    node.__step = 0.5;                                        // ArkUI 默认 0.5
    node.__onChange = [];
    node.style.display = 'flex';
    node.style.flexDirection = 'row';
    node.style.alignItems = 'center';
    node.style.gap = '2px';
    redrawRating(node);
    return node;
  }

  function ratingLit(node) {
    const snap = node.__step > 0 ? Math.round(node.__rating / node.__step) * node.__step : node.__rating;
    const lit = Math.max(0, Math.min(node.__starCount, snap));
    const full = Math.floor(lit + 1e-6);
    const half = lit - full >= 0.5 - 1e-6;
    return { lit, full, half };
  }

  function starSvg(filled) {
    const svg = svgEl('svg', { viewBox: '0 0 24 24' });
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.appendChild(svgEl('path', { d: STAR_PATH, fill: filled ? '#ffb400' : '#d8d8d8', stroke: 'none' }));
    return svg;
  }

  function redrawRating(node) {
    const { full, half } = ratingLit(node);
    node.textContent = '';
    for (let i = 0; i < node.__starCount; i++) {
      const box = document.createElement('span');
      box.setAttribute('data-arkui-star', String(i));
      // 半星不计入 lit（它是"半个"），只标 data-arkui-star-half
      box.setAttribute('data-arkui-star-lit', i < full ? 'true' : 'false');
      box.style.position = 'relative';
      box.style.flex = '1 1 0';
      box.style.height = '100%';
      box.style.display = 'block';
      box.appendChild(starSvg(i < full));
      if (i === full && half) {
        box.setAttribute('data-arkui-star-half', '');
        const over = document.createElement('span');
        over.setAttribute('data-arkui-star-fill', '');
        over.style.position = 'absolute';
        over.style.left = '0';
        over.style.top = '0';
        over.style.width = '50%';
        over.style.height = '100%';
        over.style.overflow = 'hidden';
        const inner = starSvg(true);
        inner.style.width = '200%';                           // 被裁的半个星仍保持整星比例
        over.appendChild(inner);
        box.appendChild(over);
      }
      if (node.__interactive) {
        box.style.cursor = 'pointer';
        box.addEventListener('click', () => {
          const raw = i + 1;
          const snapped = node.__step > 0 ? Math.round(raw / node.__step) * node.__step : raw;
          node.__rating = Math.max(0, Math.min(node.__starCount, snapped));
          redrawRating(node);
          for (const cb of node.__onChange) {
            try { cb(node.__rating); } catch (e) { layoutWarnings.push(`Rating.onChange 抛错：${e && e.message}`); }
          }
        });
      }
      node.appendChild(box);
    }
  }

  // 渲染后重绘：弧的半径要用容器的真实尺寸（create 时 .width/.height 还没生效，offsetWidth 是 0）。
  // 与 syncAlignRules 同一时机（首渲染后 + 每次重渲染后）。
  function syncDrawings(rootEl) {
    const r = rootEl || rootNode;
    if (!r || !r.querySelectorAll) return;
    for (const el of r.querySelectorAll('*')) {
      if (el.__drawKind === 'Gauge') redrawGauge(el);
      else if (el.__drawKind === 'Progress' && el.__svg) drawProgressRing(el, el.__ratio || 0);
      else if (el.__arkuiQrPending) redrawQr(el);          // QRCode 同思想：等真实尺寸画
    }
  }

  // 绘制类组件的属性：值要进 state / 重绘，而不是落 data-*
  const DRAW_ATTRS = {
    Progress: {
      value: (node, v) => applyProgressValue(node, v, node.__drawOpts.total),
      color: (node, v) => {
        if (node.__fill) node.__fill.style.background = colorOf(v);
        else node.__strokeColor = v;
      },
      style: (node, v) => {
        node.style.setProperty('--progress-style', String(v));
        warnOnce('Progress.style 在 create 之后设置不会改变形状（本实现的形状在 create 时确定）');
      },
    },
    Gauge: {
      value: (node, v) => { node.__drawOpts.value = Number(v) || 0; redrawGauge(node); },
      startAngle: (node, v) => { node.__startAngle = Number(v) || 0; redrawGauge(node); },
      endAngle: (node, v) => { node.__endAngle = Number(v) || 0; redrawGauge(node); },
      strokeWidth: (node, v) => { node.__strokeW = Number(resolveResource(v)) || 4; redrawGauge(node); },
      colors: (node, v) => { node.__colors = v; redrawGauge(node); },
      trackShadow: () => warnOnce('Gauge.trackShadow 未实现（轨道阴影）'),
      indicator: () => warnOnce('Gauge.indicator 未实现（指针/刻度）'),
      description: () => warnOnce('Gauge.description 未实现（自定义说明 builder）'),
    },
    DataPanel: {
      valueColors: (node, v) => {
        const list = Array.isArray(v) ? v : [v];
        node.__panelColors = list.map(colorOf);
        redrawDataPanel(node);
      },
      trackBackgroundColor: (node, v) => {
        node.style.setProperty('--datapanel-track', colorOf(v));
        warnOnce('DataPanel.trackBackgroundColor 只记录了值，未接入绘制（本实现的轨道色是固定灰）');
      },
      strokeWidth: () => warnOnce('DataPanel.strokeWidth 未实现（环的描边宽度）'),
      trackShadow: () => warnOnce('DataPanel.trackShadow 未实现（轨道阴影）'),
      closeEffect: () => warnOnce('DataPanel.closeEffect 未实现（关闭动效）'),
    },
    Rating: {
      stars: (node, v) => { node.__starCount = Number(v) || 5; redrawRating(node); },
      stepSize: (node, v) => { node.__step = Number(v) || 0.5; redrawRating(node); },
      starStyle: (node) => {
        // 图片 URI 在本运行时加载不了（没有资源管线）→ 退化为内置星形，但必须出声
        warnOnce('Rating.starStyle 的图片 URI 未加载（本运行时没有资源管线），已退化为内置星形')
      },
      onChange: (node, v) => { node.__onChange.push(v); },
    },
  };

  // ────────────── R17：onAreaChange（真实面积） + 自定义布局协议 ──────────────
  //
  // 权威来源（common.d.ts）：
  //   onAreaChange(event: (oldValue: Area, newValue: Area) => void)
  //     JSDoc：newValue 是"变化后"的宽高 + 相对父元素的坐标 + 相对页面左上角的坐标
  //   onMeasureSize?(selfLayoutInfo: GeometryInfo, children: Array<Measurable>, constraint: ConstraintSizeOptions): SizeResult
  //   onPlaceChildren?(selfLayoutInfo: GeometryInfo, children: Array<Layoutable>, constraint: ConstraintSizeOptions): void
  //     ⚠️ 这两条【不是链式属性】，而是【组件结构体上的方法】= 自定义布局协议：
  //        必须成对实现；返回值 SizeResult 的优先级【高于】组件自身声明的 width/height；
  //        Measurable.measure(constraint) 要回【真实测量】的尺寸，Layoutable.layout(position) 负责摆放。
  //     实测：@Entry 的 build 只能有一个【容器】根节点，所以"多子项 builder 模式"只适用于
  //     【非 @Entry 的嵌套 @Component】；带链式属性的自定义组件会被编译器包一层 `__Common__`。
  const areaMeta = new WeakMap();     // 元素 → 上次派发的面积（用于 old/new 与"只在变化时触发"）

  const edgesOf = (el, kind) => {
    const cs = getComputedStyle(el);
    const pick = (side) => parseFloat(cs[kind + side]) || 0;
    return { top: pick('Top'), right: pick('Right'), bottom: pick('Bottom'), left: pick('Left') };
  };
  const areaOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      position: { x: el.offsetLeft, y: el.offsetTop },                 // 相对父元素
      globalPosition: { x: r.left + (global.scrollX || 0), y: r.top + (global.scrollY || 0) },
    };
  };
  // 渲染后按【真实几何】派发 onAreaChange：只在面积真的变了（或首次）时触发
  function syncAreas(rootEl) {
    const r = rootEl || rootNode;
    if (!r || !r.querySelectorAll) return;
    for (const el of r.querySelectorAll('*')) {
      if (!el.__areaCbs || !el.__areaCbs.length) continue;
      const now = areaOf(el);
      const prev = areaMeta.get(el);
      const changed = !prev
        || Math.abs(prev.width - now.width) > 0.01 || Math.abs(prev.height - now.height) > 0.01
        || Math.abs((prev.position.x || 0) - now.position.x) > 0.01
        || Math.abs((prev.position.y || 0) - now.position.y) > 0.01;
      if (!changed) continue;
      // 首次布局也派发一次（oldValue 全 0）—— 这是实践中依赖的行为（拿初值），
      // 但真机 JSDoc 只说"面积变化时触发"，此点未在真机核对
      const old0 = prev || { width: 0, height: 0, position: { x: 0, y: 0 }, globalPosition: { x: 0, y: 0 } };
      areaMeta.set(el, now);
      for (const cb of el.__areaCbs) {
        try { cb(old0, now); } catch (e) { layoutWarnings.push(`onAreaChange 回调抛错：${e && e.message}`); }
      }
    }
  }

  const customLayoutMeta = new WeakMap();
  function measureChild(el, con, log) {
    const c = con || {};
    const set = (prop, v) => {
      el.style[prop] = (v === undefined || v === null) ? '' : (typeof v === 'number' ? v + 'px' : String(v));
    };
    set('minWidth', c.minWidth); set('maxWidth', c.maxWidth);
    set('minHeight', c.minHeight); set('maxHeight', c.maxHeight);
    const r = el.getBoundingClientRect();            // ← 真实测量，不做任何估算
    const out = { width: r.width, height: r.height };
    el.__lastMeasure = out;
    log.measures.push({ width: out.width, height: out.height });
    return out;
  }
  // 自定义布局：组件的"子节点" = 该组件 builder 直接产出的元素（在 container 里）。
  // 返回的尺寸施加在 host（= 带 .id() 的那一层，可能是编译器合成的 __Common__ 包装器）上，
  // 因为 ArkUI 里 onMeasureSize 回的就是"组件自身"的尺寸，二者必须是同一个盒子。
  function runCustomLayout(view, container, host) {
    const kids = [...container.children];
    const hostEl = host || container;
    if (!kids.length) { layoutWarnings.push('自定义布局：组件没有子节点，无法测量/摆放'); return; }
    const parentEl = hostEl.parentElement || hostEl;
    const pcs = getComputedStyle(parentEl);
    const pw = parentEl.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    const ph = parentEl.clientHeight - (parseFloat(pcs.paddingTop) || 0) - (parseFloat(pcs.paddingBottom) || 0);
    const constraint = { minWidth: 0, maxWidth: Math.max(0, pw), minHeight: 0, maxHeight: Math.max(0, ph) };
    const log = { measures: [], layoutCalls: 0, passes: 0 };
    const measurables = kids.map((el, i) => ({
      uniqueId: i,
      measure: (c) => measureChild(el, c, log),
      getMargin: () => edgesOf(el, 'margin'),
      getPadding: () => edgesOf(el, 'padding'),
      getBorderWidth: () => edgesOf(el, 'borderWidth'),
    }));
    const before = hostEl.getBoundingClientRect();
    const selfSize = {
      width: before.width, height: before.height,
      borderWidth: edgesOf(hostEl, 'borderWidth'),
      margin: edgesOf(hostEl, 'margin'), padding: edgesOf(hostEl, 'padding'),
    };
    let returned = null;
    for (let p = 0; p < 3; p++) {
      log.passes = p + 1;
      returned = view.onMeasureSize(selfSize, measurables, constraint) || {};
      const w = returned.width === undefined ? before.width : parseFloat(String(returned.width));
      const h = returned.height === undefined ? before.height : parseFloat(String(returned.height));
      if (!Number.isFinite(w) || !Number.isFinite(h)) break;
      if (Math.abs(hostEl.offsetWidth - w) < 0.5 && Math.abs(hostEl.offsetHeight - h) < 0.5) break;
      // 返回值优先于声明尺寸（JSDoc 明确）
      if (getComputedStyle(hostEl).display === 'contents') hostEl.style.display = 'block';
      if (getComputedStyle(hostEl).position === 'static') hostEl.style.position = 'relative';
      hostEl.style.width = w + 'px';
      hostEl.style.height = h + 'px';
    }
    if (typeof view.onPlaceChildren === 'function') {
      const layoutables = kids.map((el, i) => ({
        uniqueId: i,
        measureResult: el.__lastMeasure || { width: el.offsetWidth, height: el.offsetHeight },
        layout: (position) => {
          const x = Number((position && position.x) || 0);
          const y = Number((position && position.y) || 0);
          el.style.position = 'absolute';
          el.style.left = x + 'px';
          el.style.top = y + 'px';
          log.layoutCalls++;
        },
        getMargin: () => edgesOf(el, 'margin'),
        getPadding: () => edgesOf(el, 'padding'),
        getBorderWidth: () => edgesOf(el, 'borderWidth'),
      }));
      try {
        view.onPlaceChildren(selfSize, layoutables, constraint);
      } catch (e) {
        layoutWarnings.push(`onPlaceChildren 抛错：${e && e.message}`);
      }
    } else {
      layoutWarnings.push('实现了 onMeasureSize 但没有 onPlaceChildren：按 ArkUI 要求二者必须同时实现（未摆放子项）');
    }
    customLayoutMeta.set(hostEl, {
      measured: true, children: kids.length,
      selfSize: { width: selfSize.width, height: selfSize.height },
      constraint,
      returned: { width: returned && returned.width, height: returned && returned.height },
      measures: log.measures, layoutCalls: log.layoutCalls, passes: log.passes,
    });
  }

  function applyAttr(node, prop, value, extra) {
    if (!node) return;
    // R22 收口：`.transition(options|effect[, onFinish])` 也是**属性**（产物走 builder 栈），
    // 第二个参数（onFinish 回调）由生成的属性方法透传进来 —— 只取第一个参数会静默丢掉回调
    if (prop === 'transition') { registerTransition(node, value, extra); return; }
    // onAreaChange 由运行时在渲染后按真实几何派发（不是 DOM 事件，见不变量 14）
    if (prop === 'onAreaChange') {
      (node.__areaCbs = node.__areaCbs || []).push(value);
      return;
    }
    const drawAttrs = node.__drawKind && DRAW_ATTRS[node.__drawKind];
    // onChange / 语义属性必须抢在通用事件分支之前（见不变量 14）
    if (drawAttrs && Object.prototype.hasOwnProperty.call(drawAttrs, prop)) {
      drawAttrs[prop](node, value);
      return;
    }
    // SVG 形状族（R26）：fill/stroke/points/commands/… 必须抢在通用 data-* 落点之前变成
    // SVG 表现属性 —— data-* 不是形状语义，CSS 属性又会让 Shape 容器的继承语义走样
    if (node.__shapeEl && SHAPE_ATTRS[prop]) {
      SHAPE_ATTRS[prop](node, value);
      return;
    }
    // 输入类（R27）：select/checked/selectedColor 等语义抢在通用 data-* 落点之前；
    // Slider 的 onChange 是 (value, mode) 双参 —— 必须抢在通用 on* 规则【之前】拦下，
    // 否则只挂 change、丢掉拖动中的 Moving 派发与双参形态（'input'→Moving(1)，'change'→End(2)）
    if (node.__arkuiInput) {
      if (INPUT_ATTRS[prop]) {
        INPUT_ATTRS[prop](node, value);
        return;
      }
      // ArkUI 的 onChange(isOn/isChecked: boolean)：包掉 DOM Event —— 通用规则会原样透传
      // Event 对象（inputdemo 首跑实测 log='CK[object Event];'）。覆盖语义同上（__arkuiEv）。
      if (node.__arkuiInput === 'input' && prop === 'onChange') {
        // ⚠️ 包装器带【target 校验】：实测（inputdemo 排查）rd 的包装器会被错误地挂到
        // 其他 input 节点上（tg1/sl1 的 change 也会带起 rd 回调）—— 根因在组件栈复用，
        // 先用"事件目标必须是自己"兜住错投：change 目标不是这个节点就不算它的选中态变化。
        const wrapper = (e) => {
          if (e.target !== node) return;
          try { value(!!node.checked); }
          catch (err) { layoutWarnings.push(`输入类 onChange 派发抛错：${err && err.message}`); }
          // 组内互斥的另一半：Chrome 只给新选中者发 change，被取消成员的 onChange(false)
          // 由这里按登记的组补发（radio.d.ts JSDoc：false = "changes from selected to unselected"）
          if (node.type === 'radio' && node.checked && typeof radioGroups !== 'undefined') {
            const members = radioGroups.get(node.name);
            if (members) {
              members.forEach((m) => {
                if (m !== node && m.__arkuiRadioOn && m.__arkuiEv && m.__arkuiEv.change) {
                  m.__arkuiRadioOn = false;
                  m.__arkuiEv.change({ target: m, type: 'change' });
                }
              });
            }
          }
          node.__arkuiRadioOn = node.checked;
        };
        if (!node.__arkuiEv) node.__arkuiEv = {};
        if (node.__arkuiEv.change) node.removeEventListener('change', node.__arkuiEv.change);
        node.__arkuiEv.change = wrapper;
        node.addEventListener('change', wrapper);
        layoutWarnings.push('DBG-REG onChange id=' + node.id); // TODO 调试后删
        return;
      }
      if (node.__arkuiInput === 'slider' && prop === 'onChange') {
        // 覆盖语义同上：input→Moving(1)，change→End(2)；target 校验同上（防错投）
        const onInput = (e) => {
          if (e.target !== node) return;
          try { value(Number(node.value), 1); }
          catch (err) { layoutWarnings.push(`Slider.onChange 派发抛错：${err && err.message}`); }
        };
        const onChangeEv = (e) => {
          if (e.target !== node) return;
          try { value(Number(node.value), 2); }
          catch (err) { layoutWarnings.push(`Slider.onChange 派发抛错：${err && err.message}`); }
        };
        if (!node.__arkuiEv) node.__arkuiEv = {};
        if (node.__arkuiEv.input) node.removeEventListener('input', node.__arkuiEv.input);
        if (node.__arkuiEv.change) node.removeEventListener('change', node.__arkuiEv.change);
        node.__arkuiEv.input = onInput;
        node.__arkuiEv.change = onChangeEv;
        node.addEventListener('input', onInput);
        node.addEventListener('change', onChangeEv);
        return;
      }
    }
    // 信息展示类（R28）：Counter 的 onInc/onDec 是函数值（必须拦在通用 on* 规则之前，否则
    // 会变成 'inc'/'dec' DOM 监听）；Divider/Marquee 的语义属性抢在通用 data-* 落点之前
    if (node.__arkuiShow && SHOW_ATTRS[prop]) {
      SHOW_ATTRS[prop](node, value);
      return;
    }
    // 弹出类（R29）：selected 按身份分派；Select.onSelect 双参拦在通用 on* 规则之前；
    // MenuItem.onChange 只登记（点击切换在工厂里派发）
    if (node.__arkuiQrValue !== undefined && QR_ATTRS[prop]) {
      QR_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiPopup) {
      if (POPUP_ATTRS[prop]) {
        POPUP_ATTRS[prop](node, value);
        return;
      }
      if (node.__arkuiPopup === 'Select' && prop === 'onSelect') {
        popupBindSelect(node, value);
        return;
      }
    }
    // 表层类（R31/R32）：Canvas 的 onReady、XComponent 的 onLoad 都是函数值且原生元素
    // 不会自发派发——必须拦在通用 on* 规则之前（坑 86 同族）
    if (node.__arkuiCanvasFlag && CANVAS_ATTRS[prop]) {
      CANVAS_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiXComponentFlag && XC_ATTRS[prop]) {
      XC_ATTRS[prop](node, value);
      return;
    }
    // Tabs/Swiper 的 onChange 要由它们自己收集并在切换时派发，不能落成 DOM 事件 ——
    // 必须拦在通用事件分支【之前】，否则会变成永不触发的 'change' 监听器（静默失效）。
    if (prop === 'onChange' && (node.__tabsState || node.__swiperState)) {
      (node.__tabsState || node.__swiperState).onChange.push(value);
      return;
    }
    // NavDestination 的生命周期回调同理：由栈操作派发，不能变成 'willappear' 监听器
    if (node.__navDestCbs && NAVDEST_LIFECYCLE[prop]) {
      const kind = NAVDEST_LIFECYCLE[prop];
      if (kind === 'backPressed') {
        node.__navDestCbs[kind] = value;
        layoutWarnings.push('NavDestination.onBackPressed 已登记，但本运行时没有系统返回键触发源'
          + '（浏览器/Electron 不会产生它）—— 请用 NavPathStack.pop() 走真实路径');
        return;
      }
      node.__navDestCbs[kind] = value;
      return;
    }
    // Navigation 的事件类属性必须在下面的通用 on* 规则之前拦下：否则 onTitleModeChange(fn)
    // 会变成 addEventListener('titlemodechange')，永远没人派发（R25 实测的分发陷阱，坑 86）
    if (node.__navState && prop === 'onTitleModeChange') {
      NAV_ATTRS.onTitleModeChange(node.__navState, value, extra);
      return;
    }
    if (typeof value === 'function') {          // 事件类（onClick/onChange…）
      const ev = prop.replace(/^on/, '').toLowerCase() || 'click';
      // 覆盖语义（R27 实测教训）：同一个属性重复注册【替换】上一个，而不是追加 ——
      // @State 变化会触发重渲染、重渲染会把 `.onChange(cb)` 再应用一遍（isInitialRender=false
      // 的路径），追加语义下监听器每轮翻倍（inputdemo 首跑当场抓住：一次点击回调发两次）
      if (!node.__arkuiEv) node.__arkuiEv = {};
      if (node.__arkuiEv[ev]) node.removeEventListener(ev, node.__arkuiEv[ev]);
      node.__arkuiEv[ev] = value;
      node.addEventListener(ev, value);
      return;
    }
    if (prop === 'id') { node.id = String(resolveResource(value)); return; }
    if (prop === 'tabBar') { applyTabBar(node, value); return; }
    if (node.__swiperState && SWIPER_ATTRS[prop]) { SWIPER_ATTRS[prop](node.__swiperState, value); return; }
    if (node.__navState && NAV_ATTRS[prop]) { NAV_ATTRS[prop](node.__navState, value, extra); return; }
    if (node.__navDest && NAVDEST_ATTRS[prop]) { NAVDEST_ATTRS[prop](node, value, extra); return; }
    // Grid 轨道模板要过单位归一化，所以不能走 cssPropEnum 的原样透传
    if (GRID_TRACK_PROPS[prop]) {
      node.style[GRID_TRACK_PROPS[prop]] = normalizeTrackList(resolveResource(value));
      return;
    }
    // 未实现的 Grid/Tabs/Swiper/Navigation 语义项：不 return，继续落 data-*，但同时留下诊断
    if (node.__arkuiComp === 'Grid' && GRID_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Grid.${prop} 未实现（无模板时的轨道划分）：版式会与设备不一致`);
    }
    if (node.__swiperState && SWIPER_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Swiper.${prop} 未实现，已忽略`);
    }
    if (node.__tabsState && TABS_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Tabs.${prop} 未实现，已忽略`);
    }
    // Navigation/NavDestination：标题栏/工具栏/分栏等是【可见差异】，不能静默
    if (node.__navState && NAV_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Navigation.${prop} 未实现（本实现只有 Stack 栈语义，不绘制标题栏/工具栏）`);
    }
    if (node.__navDestCbs && NAV_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`NavDestination.${prop} 未实现（不绘制标题栏/工具栏）`);
    }
    // 注意：这些必须在 cssPropEnum 之前拦掉 —— 例如 ArkUI 的 alignContent 语义
    // 是"叠放子项的对齐"，与 CSS 的 align-content（内容分布）不是一回事。
    // alignRules 只登记，不立刻解析：此刻锚点（兄弟/guideline）可能还没建出来 ——
    // 逆序声明的锚链必然如此。立刻解析既会出错（单趟读到旧位置），又会留下假警告
    // "找不到锚点 'x'"。真正的解析在每轮 syncAlignRules（首渲染后 + 每次重渲染后），
    // 它迭代到不动点，那时锚点才齐。
    if (prop === 'alignRules') { node.__alignRules = value; return; }
    // guideLine 是【容器级】属性（挂在 RelativeContainer 上），位置要等容器有尺寸才能算 ——
    // 这里只登记，真正的计算在每轮 syncAlignRules 里（容器尺寸那时才可信）。
    if (prop === 'guideLine') {
      if (!Array.isArray(value)) {
        layoutWarnings.push('guideLine 需要数组（如 [{id, direction, position:{start}}]），已忽略');
        return;
      }
      node.__guideLines = value;
      applyGuideLines(node);
      return;
    }
    if (prop === 'maxLines') { node.__maxLines = Number(resolveResource(value)); applyTextClamp(node, node.__maxLines, node.__textOverflow); return; }
    if (prop === 'textOverflow') { node.__textOverflow = (value && value.overflow) || value; applyTextClamp(node, node.__maxLines, node.__textOverflow); return; }
    if (prop === 'alignContent') { applyAlignment(node, value); return; }
    if (cssPropSize[prop]) { node.style[cssPropSize[prop]] = toCssSize(value); return; }
    if (cssPropRaw[prop]) { node.style[cssPropRaw[prop]] = String(resolveResource(value)); return; }
    if (cssPropEnum[prop]) { node.style[cssPropEnum[prop]] = String(resolveResource(value)); return; }
    try { node.dataset[prop] = JSON.stringify(value); }
    catch { node.dataset[prop] = String(value); }
  }

  // ────────────────────── 组件注册表 ──────────────────────
  const components = {};

  const defaultDom = (tag, style) => () => {
    const el = document.createElement(tag);
    Object.assign(el.style, style || {});
    return el;
  };

  // 组件声明的已知工厂方法（官方工厂名不统一，先显式登记，其余以 /^create/ 兜底）
  const FACTORIES = {
    Button: ['create', 'createWithLabel', 'createWithIcon', 'createWithChild'],
  };

  function ensureComponent(name, domFactory, contentUpdater) {
    if (components[name]) return components[name];
    const C = function () {};
    C.componentName = name;
    const declared = FACTORIES[name] || ['create'];
    const methods = {};

    const isFactory = (key) => declared.includes(key) || /^create/.test(key) || key === 'pop';

    C.create = function (...args) {
      const rec = elmtRecords.get(currentNodeElmtId);
      let node;
      if (rec && rec.node && rec.node.__arkuiComp === name) {
        node = rec.node;
        if (contentUpdater) contentUpdater(node, args);
      } else if (rec && rec.node) {
        node = rec.node;                        // 复用（如 If/ForEach 的容器）
        if (contentUpdater) contentUpdater(node, args);
      } else {
        node = domFactory(args);
        node.__arkuiComp = name;
        applyCreateArgs(node, args);
        // 绑定 scroller 选项：List/Grid/Scroll({scroller}) → Scroller 实例拿到容器元素
        const opt = args && args[0];
        if (opt && opt.scroller && typeof opt.scroller._bind === 'function') opt.scroller._bind(node);
        mountNode(node, rec);
      }
      ViewStackProcessor.push(node);
      return node;
    };
    C.pop = function () { ViewStackProcessor.pop(); };

    // deepRender：ListItem.create(deepFn, true) 首次渲染要展开子树，但不能递归再进入
    if (name === 'ListItem' || name === 'GridItem') {
      C.create = function (deepFn, isDeep) {
        const elmtId = currentNodeElmtId;
        const rec = elmtRecords.get(elmtId);
        let node;
        if (rec && rec.node) {
          node = rec.node;
        } else {
          node = domFactory([]);
          node.__arkuiComp = name;
          mountNode(node, rec);
          if (typeof deepFn === 'function' && !deepRendering.has(elmtId)) {
            deepRendering.add(elmtId);
            const saved = ViewStackProcessor.snapshot();
            const savedElmt = currentNodeElmtId;
            ViewStackProcessor.push(node);
            currentNodeElmtId = elmtId;
            deepFn(elmtId, true);
            ViewStackProcessor.restore(saved);
            currentNodeElmtId = savedElmt;
            deepRendering.delete(elmtId);
          }
        }
        ViewStackProcessor.push(node);
        return node;
      };
    }

    // Tabs：DOM 结构见 createTabsState。栈顶是【包装元素】，所以 Tabs.width/height/onChange
    // 全部作用在整体上；TabContent 由 mountTabContent 认领内容区。
    if (name === 'Tabs') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        let node;
        if (rec && rec.node && rec.node.__arkuiComp === 'Tabs') {
          node = rec.node;
          node.__tabsState.contents = [];        // 重渲染：子项会重新登记，bar 在 pop 时重建
          applyTabsOptions(node.__tabsState, args && args[0]);
        } else {
          node = document.createElement('div');
          node.__arkuiComp = 'Tabs';
          createTabsState(node, args && args[0]);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
      // 只有到 pop 才知道有几个 TabContent、各叫什么标签
      C.pop = function () {
        const top = ViewStackProcessor.top();
        ViewStackProcessor.pop();
        const st = top && top.__tabsState;
        if (st) finalizeTabs(st);
      };
    }

    // TabContent：子构建器是【构造参数】，首次构建时立即展开（同 ListItem 的深渲染，防递归再入）
    if (name === 'TabContent') {
      C.create = function (deepFn) {
        const elmtId = currentNodeElmtId;
        const rec = elmtRecords.get(elmtId);
        const node = mountTabContent(rec);
        if (!node.__tabContentRendered) {
          if (typeof deepFn === 'function' && !deepRendering.has(elmtId)) {
            deepRendering.add(elmtId);
            const saved = ViewStackProcessor.snapshot();
            const savedElmt = currentNodeElmtId;
            ViewStackProcessor.push(node);
            currentNodeElmtId = elmtId;
            deepFn(elmtId, true);
            ViewStackProcessor.restore(saved);
            currentNodeElmtId = savedElmt;
            deepRendering.delete(elmtId);
          }
          node.__tabContentRendered = true;
        }
        ViewStackProcessor.push(node);
        return node;
      };
    }

    // Swiper：create 的参数是【控制器实例】；子项直接挂进 Swiper 元素（栈顶即它），
    // 所以 Swiper.width/height/onChange 都作用在整体上，指示点在 pop 时作为覆盖层追加。
    if (name === 'Swiper') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        let node;
        if (rec && rec.node && rec.node.__arkuiComp === 'Swiper') {
          node = rec.node;
          node.__swiperState.entries = [];        // 重渲染：页会在 pop 时重新收集
          bindSwiperController(node.__swiperState, args && args[0]);
        } else {
          node = document.createElement('div');
          node.__arkuiComp = 'Swiper';
          createSwiperState(node, args);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
      // 只有到 pop 才知道有几页、每页是谁
      C.pop = function () {
        const top = ViewStackProcessor.top();
        ViewStackProcessor.pop();
        const st = top && top.__swiperState;
        if (st) finalizeSwiper(st);
      };
    }

    // Navigation：栈顶是【Navigation 元素本身】（所以 width/height/mode/navDestination 都作用于整体），
    // 根内容子组件直接挂进来；目标区在 pop 时作为覆盖层创建，push 时由 navBuildDest 往里面建树。
    if (name === 'Navigation') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        let node;
        if (rec && rec.node && rec.node.__arkuiComp === 'Navigation') {
          node = rec.node;
          updateNavStack(node.__navState, args && args[0]);
        } else {
          node = document.createElement('div');
          node.__arkuiComp = 'Navigation';
          createNavState(node, args && args[0]);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
      C.pop = function () {
        const top = ViewStackProcessor.top();
        ViewStackProcessor.pop();
        const st = top && top.__navState;
        if (st) ensureNavArea(st);        // 空栈时也该有目标区（内容为空且隐藏），方便外部查询
      };
    }

    // NavDestination：由 NavPathStack 的压栈操作驱动创建（builder 里），不在页面 initialRender 中。
    // 子构建器同样是【构造参数】（同 TabContent），首次构建时立即展开。
    if (name === 'NavDestination') {
      C.create = function (deepFn) {
        const elmtId = currentNodeElmtId;
        const rec = elmtRecords.get(elmtId);
        const node = mountNavDestination(rec, deepFn, elmtId);
        ViewStackProcessor.push(node);
        return node;
      };
    }

    // 绘制类四件套：形状/数据来自 create 选项，尺寸来自 .width/.height ——
    // 所以弧的真正绘制要等渲染后（见 syncDrawings），create 时只是先建出骨架。
    if (name === 'Progress') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        let node;
        if (rec && rec.node && rec.node.__drawKind === 'Progress') {
          node = rec.node;
          node.__drawOpts = o || {};
          applyProgressValue(node, node.__drawOpts.value, node.__drawOpts.total);
        } else {
          node = buildProgressNode(o);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
    }

    if (name === 'Gauge') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        let node;
        if (rec && rec.node && rec.node.__drawKind === 'Gauge') {
          node = rec.node;
          node.__drawOpts = o || {};
          node.__min = node.__drawOpts.min === undefined ? 0 : Number(node.__drawOpts.min);
          node.__max = node.__drawOpts.max === undefined ? 100 : Number(node.__drawOpts.max);
        } else {
          node = buildGaugeNode(o);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
    }

    if (name === 'DataPanel') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        let node;
        if (rec && rec.node && rec.node.__drawKind === 'DataPanel') {
          node = rec.node;
          node.__drawOpts = o || {};
          node.__values = Array.isArray(node.__drawOpts.values) ? node.__drawOpts.values.map(Number) : [];
          node.__panelMax = Number(node.__drawOpts.max) || 100;
          node.__panelType = isCirclePanel(node.__drawOpts.type) ? 'circle' : 'line';
          redrawDataPanel(node);
        } else {
          node = buildDataPanelNode(o);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
    }

    if (name === 'Rating') {
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        let node;
        if (rec && rec.node && rec.node.__drawKind === 'Rating') {
          node = rec.node;
          node.__rating = Number(o && o.rating) || 0;
          node.__interactive = !o || o.indicator !== true;
          redrawRating(node);
        } else {
          node = buildRatingNode(o);
          mountNode(node, rec);
        }
        ViewStackProcessor.push(node);
        return node;
      };
    }

    components[name] = new Proxy(C, {
      get(target, key) {
        if (key in target) return target[key];
        if (typeof key === 'symbol') return undefined;
        if (isFactory(key)) {
          if (!methods[key]) {
            methods[key] = function (...args) {
              const rec = elmtRecords.get(currentNodeElmtId);
              let node;
              if (rec && rec.node) { node = rec.node; if (contentUpdater) contentUpdater(node, args); }
              else {
                node = domFactory(args);
                node.__arkuiComp = name;
                applyCreateArgs(node, args);
                const opt = args && args[0];
                if (opt && opt.scroller && typeof opt.scroller._bind === 'function') opt.scroller._bind(node);
                mountNode(node, rec);
              }
              ViewStackProcessor.push(node);
              return node;
            };
          }
          return methods[key];
        }
        if (!methods[key]) {
          // 属性方法要把**所有**实参透传：`transition(effect, onFinish)` 是两参重载，
          // 只传第一个会把 onFinish 静默丢掉（实测产物确实这么调）
          methods[key] = function (...args) { applyAttr(ViewStackProcessor.top(), key, args[0], args[1]); };
        }
        return methods[key];
      },
    });
    return components[name];
  }

  // ────────────────────── 具体组件 ──────────────────────
  const textLike = (node, args) => {
    if (args && args[0] !== undefined) node.textContent = String(resolveResource(args[0]));
  };

  const Text = ensureComponent('Text', (args) => {
    const el = document.createElement('div');
    el.style.display = 'inline-block';
    textLike(el, args);
    return el;
  }, textLike);

  const Button = ensureComponent('Button', (args) => {
    const el = document.createElement('button');
    textLike(el, args);
    return el;
  }, textLike);

  const RelativeContainer = ensureComponent('RelativeContainer',
    defaultDom('div', { position: 'relative', display: 'block' }));
  const Column = ensureComponent('Column', defaultDom('div', { display: 'flex', flexDirection: 'column' }));
  const Row = ensureComponent('Row', defaultDom('div', { display: 'flex', flexDirection: 'row' }));
  // Stack：叠放语义用 grid 同格实现 —— 所有子项 grid-area:1/1，靠 justify/align-items 对齐
  // （默认 Center，与 ArkUI 一致；alignContent 由 applyAttr 的 applyAlignment 改）
  const Stack = ensureComponent('Stack', () => {
    const el = document.createElement('div');
    el.style.display = 'grid';
    el.style.justifyItems = 'center';
    el.style.alignItems = 'center';
    return el;
  });
  const List = ensureComponent('List',
    defaultDom('div', { display: 'flex', flexDirection: 'column', overflow: 'auto', position: 'relative' }));
  const ListItem = ensureComponent('ListItem', defaultDom('div', { display: 'block' }));

  // Tabs/TabContent 必须手写：生成的骨架只会建一个 <div>，既没有切换语义也没有 TabsController。
  // 它们各自的 create/pop 在 ensureComponent 里按组件名分派（见 name === 'Tabs' / 'TabContent'）。
  const Tabs = ensureComponent('Tabs', () => document.createElement('div'));
  const TabContent = ensureComponent('TabContent', () => document.createElement('div'));
  // Swiper 同理：生成的骨架没有轮播语义，也没有 SwiperController
  const Swiper = ensureComponent('Swiper', () => document.createElement('div'));
  // Navigation/NavDestination 同理：生成的骨架没有栈语义（栈由 NavPathStack + 运行时共同驱动）
  const Navigation = ensureComponent('Navigation', () => document.createElement('div'));
  const NavDestination = ensureComponent('NavDestination', () => document.createElement('div'));
  // 绘制类四件套：生成的骨架给 Progress 用 <progress>、其余是空 div，都没有绘制语义
  const Progress = ensureComponent('Progress', () => document.createElement('div'));
  const Gauge = ensureComponent('Gauge', () => document.createElement('div'));
  const DataPanel = ensureComponent('DataPanel', () => document.createElement('div'));
  const Rating = ensureComponent('Rating', () => document.createElement('div'));
  // `__Common__`：编译器【合成】的名字 —— 给"带链式属性的自定义组件"套的包装层
  // （`KidLayout().id('x')` → `__Common__.create(true); …; __Common__.pop();`）。
  // 它不是 149 注册表里的组件，不实现就会 ReferenceError（实测踩过）。
  const _CommonWrapper = ensureComponent('__Common__', defaultDom('div', { display: 'block' }));

  // 容器类（If / ForEach）：display:contents 让它们不参与布局
  const If = ensureComponent('If',
    () => { const el = document.createElement('div'); el.style.display = 'contents'; return el; });
  const ForEach = ensureComponent('ForEach',
    () => { const el = document.createElement('div'); el.style.display = 'contents'; return el; });

  // ────────── LazyForEach：虚拟滚动 ──────────
  // 产物形式（与 ForEach 不同，view/dataSource 直接传进 create）：
  //   LazyForEach.create("1", this, this.source, itemGen, keyGen); LazyForEach.pop();
  // 只渲染视口内的项 + overscan，用上下 spacer 撑出总高度；滚动/数据变更时重算窗口。
  function nearestScrollable(startEl) {
    let p = startEl.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.clientHeight > 0) return p;
      p = p.parentElement;
    }
    return startEl.parentElement;
  }

  function createLazyForEach(id, view, source, itemGen, keyGen) {
    const holder = document.createElement('div');
    holder.setAttribute('data-arkui-lazyforeach', String(id));
    const parent = parentOfTop();
    const pcs = parent ? getComputedStyle(parent) : null;
    // 用【块级 + 每项 margin-bottom】表达容器 space，而不是 flex gap：
    // flex gap 会把 topSpacer 也算作一个子项 → 每个窗口都多算一个 gap，
    // 于是"偏移模型"与真实 DOM 永远差一个 gap（实测 item0 的 DOM offsetTop=2 而模型=0）。
    // 块级 + margin 下 offset(i) 恰好等于累计 advance，spacer 也不会引入额外间距。
    holder.style.display = 'block';
    const parentGap = (pcs && (parseFloat(pcs.rowGap) || parseFloat(pcs.gap))) || 0;
    mountNode(holder, elmtRecords.get(currentNodeElmtId));
    ViewStackProcessor.push(holder);              // create 入栈，pop 出栈（与 ForEach 一致）

    const state = {
      total: typeof source.totalCount === 'function' ? source.totalCount() : 0,
      estItemH: 26,                                  // 未实测项的【估计高度】（不含 gap）
      heights: new Map(),                            // index → 实测高度（不含 gap）
      gap: parentGap,
      prefix: null,                                  // 累计偏移（长度 total+1），懒算
      prefixDirty: true,
      window: [-1, -1], scrollEl: null, tid: 0, passes: 0,
    };
    lazyMeta.set(holder, state);

    // advance 取整：布局最终落在整像素上（spacer 的 px 高度会被浏览器取整），
    // 模型若保留小数，累积到几千像素后会与真实 DOM 差出零点几到一像素。
    // 估计值本身保留小数（均值更准），只在"一步前进多少"这一步取整。
    const advanceOf = (i) => Math.round((state.heights.has(i) ? state.heights.get(i) : state.estItemH) + state.gap);
    function rebuildPrefix() {
      const p = new Float64Array(state.total + 1);
      for (let i = 0; i < state.total; i++) p[i + 1] = p[i] + advanceOf(i);
      state.prefix = p;
      state.prefixDirty = false;
    }
    const offsetOf = (i) => {
      if (state.prefixDirty || !state.prefix || state.prefix.length !== state.total + 1) rebuildPrefix();
      const k = Math.max(0, Math.min(state.total, i | 0));
      return state.prefix[k];
    };
    // 总高：最后一项后面没有 gap
    const totalHOf = () => offsetOf(state.total) - (state.total ? state.gap : 0);
    // 二分：最大的 i 使 offset(i) <= y
    function indexAt(y) {
      if (state.prefixDirty || !state.prefix) rebuildPrefix();
      const p = state.prefix;
      let lo = 0, hi = state.total;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (p[mid] <= y) lo = mid; else hi = mid - 1;
      }
      return lo;
    }
    state.offsetOf = offsetOf;
    state.totalHOf = totalHOf;
    state.indexAt = indexAt;

    function renderWindow(depth) {
      const d = depth || 0;
      if (!state.scrollEl) state.scrollEl = nearestScrollable(holder);
      const se = state.scrollEl;
      const viewport = se ? se.clientHeight : 120;
      const overscan = 3;
      if (state.prefixDirty) rebuildPrefix();
      const scrollTop = se ? se.scrollTop : 0;
      // 起点按【累计偏移】二分，而不是 scrollTop / 某个统一行高
      const start = Math.max(0, indexAt(scrollTop) - overscan);
      // 终点：按真实/估计的 advance 累加到盖住视口，再补 overscan
      let end = start, acc = 0;
      while (end < state.total && acc < viewport) { acc += advanceOf(end); end++; }
      end = Math.min(state.total, end + overscan);
      const sameWindow = state.window[0] === start && state.window[1] === end;

      if (!sameWindow) {
        state.window = [start, end];
        holder.textContent = '';                     // 清旧窗口（含 spacer）
        purgeDetachedRecords();
        const topSpacer = document.createElement('div');
        topSpacer.style.height = offsetOf(start) + 'px';
        topSpacer.style.flex = 'none';
        holder.appendChild(topSpacer);

        const savedStack = ViewStackProcessor.snapshot();
        const savedElmt = currentNodeElmtId;
        ViewStackProcessor.restore([]);
        ViewStackProcessor.push(holder);
        for (let i = start; i < end; i++) itemGen(source.getData(i), i);
        ViewStackProcessor.restore(savedStack);
        currentNodeElmtId = savedElmt;

        // 项间距用 margin-bottom 表达（最后一项不加，否则总高会多一个 gap）
        const freshItems = [...holder.querySelectorAll('[data-arkui-comp="ListItem"]')];
        freshItems.forEach((node, k) => {
          const idx = start + k;
          node.style.marginBottom = (state.gap > 0 && idx < state.total - 1) ? state.gap + 'px' : '0';
        });

        const bottomSpacer = document.createElement('div');
        bottomSpacer.style.flex = 'none';
        holder.appendChild(bottomSpacer);
        state.topSpacer = topSpacer;
        state.bottomSpacer = bottomSpacer;
      }

      // spacer 高度【每次都按当前偏移重设】，而不是只在窗口变化时设一次：
      // 窗口没变、但实测回填改动了前缀时，若不重设就会留下"旧 spacer + 新模型"的错配
      // （实测：DOM 的项偏移比模型大 166px，一整个窗口都错）。
      if (state.topSpacer) state.topSpacer.style.height = offsetOf(start) + 'px';
      if (state.bottomSpacer) state.bottomSpacer.style.height = Math.max(0, totalHOf() - offsetOf(end)) + 'px';

      // ── 实测回填：把浏览器算出来的真实高度写回模型 ──
      // 锚点取"视口顶部那一项"：它的偏移只由【它上面】的项决定，所以只要在改前缀前
      // 记下旧偏移、改完再补差值到 scrollTop，用户看到的内容就不会跳。
      const anchor = indexAt(scrollTop);
      const anchorOld = offsetOf(anchor);
      let changed = false;
      const rendered = [...holder.querySelectorAll('[data-arkui-comp="ListItem"]')];
      rendered.forEach((node, k) => {
        const idx = start + k;
        const h = node.offsetHeight;
        if (h > 0 && state.heights.get(idx) !== h) { state.heights.set(idx, h); changed = true; }
      });
      // 估计值：用【已实测项的均值】逐步收敛，而不是"取第一项"（变高列表里取第一项会错一半，
      // 且随窗口滑动来回翻，导致每次滚动都重算整条前缀）。实测项够多后就不再多算。
      if (state.heights.size <= 24) {
        let sum = 0;
        for (const h of state.heights.values()) sum += h;
        const avg = sum / state.heights.size;
        if (Math.abs(state.estItemH - avg) > 0.5) { state.estItemH = avg; changed = true; }
      }
      if (!changed) return;
      // ⚠️ 顺序要紧：必须等【实测高度 + 估计值】**全都写完之后**再取 anchorNew。
      // 我第一版先取 anchorNew 再改估计值 → 补偿量少算了估计值那部分，目标会偏出十几像素。
      state.prefixDirty = true;
      const anchorNew = offsetOf(anchor);
      const delta = anchorNew - anchorOld;
      if (delta && se && d < 3) {
        se.scrollTop += delta;                       // 锚定：视口顶部那一项保持不动
        state.passes++;
      }
      if (d < 3) renderWindow(d + 1);                 // 高度变了 → spacer/窗口要按新偏移重排
    }

    const refresh = () => {
      state.total = typeof source.totalCount === 'function' ? source.totalCount() : state.total;
      state.window = [-1, -1];
      renderWindow();
    };
    if (typeof source.registerDataChangeListener === 'function') {
      state.listener = {
        onDataReloaded: refresh, onDataAdd: refresh, onDataMove: refresh, onDataDelete: refresh,
        onDataChange: refresh, onDatasetChange: refresh, onDataAdded: refresh,
        onDataDeleted: refresh, onDataChanged: refresh,
      };
      try { source.registerDataChangeListener(state.listener); } catch (_) { /* 数据源可不实现 */ }
    }

    state.flush = () => renderWindow(0);          // 供 Scroller 等同步刷新（不等节流）
    renderWindow(0);
    if (state.scrollEl) {
      // 用 setTimeout(0) 合并滚动事件，而【不是】requestAnimationFrame：
      // rAF 在 headless + --virtual-time-budget 下触发时机不稳（实测单独跑过、在 all 里失败）。
      state.onScroll = () => {
        if (state.tid) return;
        state.tid = setTimeout(() => { state.tid = 0; renderWindow(); }, 0);
      };
      state.scrollEl.addEventListener('scroll', state.onScroll);
    }
    // 注意：logs 由 ohos-shims.js 创建，未加载时不能假设它存在
    if (global.__arkui_dom_logs) {
      global.__arkui_dom_logs.push({ t: 'lazyForEach.mounted', id: String(id), total: state.total, estItemH: state.estItemH });
    }
    return holder;
  }

  const LazyForEach = {
    componentName: 'LazyForEach',
    create: createLazyForEach,
    pop() { ViewStackProcessor.pop(); },
  };

  // ────────────────── SVG 形状族（R26）──────────────────
  //
  // 产物形态（实测 fixtures/pages/ShapeDemo.ts）：
  //   Circle.create({width, height});  Circle.fill(Color.Red);  Circle.stroke(...);  Circle.strokeWidth(3);
  //   Rect.create({width, height, radiusWidth, radiusHeight});
  //   Ellipse.create({width, height});
  //   Line.create({width, height});    Line.startPoint([x,y]);  Line.endPoint([x,y]);
  //     ⚠️ LineOptions 里【没有】startPoint/endPoint（第一版编译就红了）—— 它们是属性方法（line.d.ts:
  //        `startPoint(value: Array<any>): LineAttribute`）
  //   Path.create({width, height, commands});
  //   Polygon/Polyline.create({width, height});  .points([[x,y],…]);
  //   Shape.create();  Shape.viewPort({x,y,width,height});  容器自身的 fill/stroke 会"罩住"子形状。
  //
  // 语义锚点（shape 族 .d.ts 的 JSDoc 原文）：
  //   fill 默认 **Color.Black**；stroke 默认 **Color.Transparent**（"the default stroke opacity is 0，
  //   meaning no stroke is displayed"）；CircleOptions 的 width/height 默认 0。
  //
  // DOM 映射（实现选择）：组件根 = `<svg>`（吃通用 .width()/.height() 与 create 尺寸，vp→px 1:1），
  // 真正的形状元素挂在 node.__shapeEl；fill/stroke/… 落成 SVG 表现属性。默认值不写属性——
  // SVG 原生默认就是"黑填充、无描边"，与 .d.ts 的默认值恰好一致，而且这样 Shape 容器的
  // fill 表现属性能通过 CSS 继承进【没显式 fill】的子形状（子形状自己的属性永远赢过继承）。
  // 生成的骨架只有裸 `<circle>` 之类（零属性语义），本节在生成注册之前手写登记，手写优先。
  // SVG_NS 复用 draw.js 里的同名常量（同一 IIFE，draw 分片在本节之前）
  const shapeDim = (v) => {
    const n = dimOf(v, 0);
    return Number.isFinite(n) && n > 0 ? n : 0;   // .d.ts：无效值（undefined/null/NaN/Infinity）按默认 0
  };

  function shapeRoot(tag, w, h) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const el = document.createElementNS(SVG_NS, tag);
    svg.__shapeEl = el;
    svg.style.display = 'block';
    svg.appendChild(el);
    if (w > 0) svg.style.width = w + 'px';
    if (h > 0) svg.style.height = h + 'px';
    if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    return svg;
  }

  const pointsAttr = (v) => (Array.isArray(v) ? v : [])
    .map((p) => `${Number(resolveResource(p[0]))},${Number(resolveResource(p[1]))}`)
    .join(' ');

  // 属性分派表：applyAttr 里 `node.__shapeEl && SHAPE_ATTRS[prop]` 一分支全收
  const SHAPE_ATTRS = {
    fill: (n, v) => n.__shapeEl.setAttribute('fill', colorOf(v)),
    fillOpacity: (n, v) => n.__shapeEl.setAttribute('fill-opacity', String(v)),
    stroke: (n, v) => n.__shapeEl.setAttribute('stroke', colorOf(v)),
    strokeOpacity: (n, v) => n.__shapeEl.setAttribute('stroke-opacity', String(v)),
    strokeWidth: (n, v) => n.__shapeEl.setAttribute('stroke-width', String(dimOf(v, 0))),
    strokeLineCap: (n, v) => n.__shapeEl.setAttribute('stroke-linecap', String(resolveResource(v))),
    strokeLineJoin: (n, v) => n.__shapeEl.setAttribute('stroke-linejoin', String(resolveResource(v))),
    strokeDashArray: (n, v) => n.__shapeEl.setAttribute('stroke-dasharray',
      Array.isArray(v) ? v.map((d) => String(dimOf(d, 0))).join(' ') : String(dimOf(v, 0))),
    strokeDashOffset: (n, v) => n.__shapeEl.setAttribute('stroke-dashoffset', String(dimOf(v, 0))),
    antialias: (n, v) => n.__shapeEl.setAttribute('shape-rendering', v === false ? 'crispEdges' : 'auto'),
    // 形状特有
    points: (n, v) => n.__shapeEl.setAttribute('points', pointsAttr(v)),
    startPoint: (n, v) => {
      n.__shapeEl.setAttribute('x1', String(Number(resolveResource(v[0]))));
      n.__shapeEl.setAttribute('y1', String(Number(resolveResource(v[1]))));
    },
    endPoint: (n, v) => {
      n.__shapeEl.setAttribute('x2', String(Number(resolveResource(v[0]))));
      n.__shapeEl.setAttribute('y2', String(Number(resolveResource(v[1]))));
    },
    commands: (n, v) => n.__shapeEl.setAttribute('d', String(resolveResource(v))),
    viewPort: (n, v) => {
      const vp = v && typeof v === 'object' ? v : {};
      n.setAttribute('viewBox',
        `${dimOf(vp.x, 0)} ${dimOf(vp.y, 0)} ${dimOf(vp.width, 0)} ${dimOf(vp.height, 0)}`);
    },
  };

  // 形状组件工厂：create 参数里做几何（后续 .width()/.height() 只改 svg 的视口，不再反推几何 —— 已知限制）
  function shapeComponent(name, build) {
    return ensureComponent(name, (args) => {
      const o = args && typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
      const w = shapeDim(o.width);
      const h = shapeDim(o.height);
      const svg = shapeRoot(build.tag, w, h);
      build.geometry(svg.__shapeEl, o, w, h);
      return svg;
    });
  }

  const Circle = shapeComponent('Circle', {
    tag: 'circle',
    geometry(el, o, w, h) {
      el.setAttribute('cx', String(w / 2));
      el.setAttribute('cy', String(h / 2));
      el.setAttribute('r', String(Math.min(w, h) / 2));   // 内切：r = min(w,h)/2（实现选择，非 .d.ts 数字）
    },
  });
  const Ellipse = shapeComponent('Ellipse', {
    tag: 'ellipse',
    geometry(el, o, w, h) {
      el.setAttribute('cx', String(w / 2));
      el.setAttribute('cy', String(h / 2));
      el.setAttribute('rx', String(w / 2));
      el.setAttribute('ry', String(h / 2));
    },
  });
  const Rect = shapeComponent('Rect', {
    tag: 'rect',
    geometry(el, o, w, h) {
      el.setAttribute('x', '0');
      el.setAttribute('y', '0');
      // 没给尺寸 → 100%（Shape 容器里 `Rect().width('100%').height('100%')` 是官方示例写法）
      el.setAttribute('width', w > 0 ? String(w) : '100%');
      el.setAttribute('height', h > 0 ? String(h) : '100%');
      const rw = shapeDim(o.radiusWidth);
      const rh = shapeDim(o.radiusHeight);
      if (rw > 0) el.setAttribute('rx', String(rw));
      if (rh > 0) el.setAttribute('ry', String(rh));
    },
  });
  const Line = shapeComponent('Line', {
    tag: 'line',
    geometry(el) {
      el.setAttribute('x1', '0');
      el.setAttribute('y1', '0');
      el.setAttribute('x2', '0');
      el.setAttribute('y2', '0');
    },
  });
  const Path = shapeComponent('Path', {
    tag: 'path',
    geometry(el, o) {
      if (o.commands !== undefined && o.commands !== null) {
        el.setAttribute('d', String(resolveResource(o.commands)));
      }
    },
  });
  const Polygon = shapeComponent('Polygon', { tag: 'polygon', geometry() {} });
  const Polyline = shapeComponent('Polyline', { tag: 'polyline', geometry() {} });

  // Shape 容器：自己就是 <svg>；fill/stroke 落在容器上靠 SVG 继承罩住没显式设置的子形状
  const Shape = ensureComponent('Shape', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.__shapeEl = svg;                    // 容器自身也吃 SHAPE_ATTRS（fill/stroke/viewPort/…）
    svg.style.display = 'block';
    return svg;
  });

  // ────────────────── 输入类：Checkbox / Radio / Toggle / Slider（R27）──────────────────
  //
  // 产物形态（实测 fixtures/pages/InputDemo.ts）：
  //   Checkbox.create({name});  Checkbox.select(bool);  Checkbox.selectedColor(...);  Checkbox.onChange((on)=>…)
  //   Radio.create({value, group});
  //     ⚠️ RadioOptions = {value, group}，【没有 name】（放进 create 编译就红，编译期实测）
  //   Radio.checked(bool);  Radio.onChange((isChecked)=>…)
  //   Toggle.create({type: ToggleType.Switch, isOn: true});
  //     ⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn（编译期实测）
  //   Slider.create({value, min, max, step});  blockColor/trackColor/selectedColor/showTips;
  //     Slider.onChange((value, mode: SliderChangeMode)=>…)
  //
  // 语义锚点（.d.ts）：SliderChangeMode = { Begin=0, Moving=1, End=2, Click=3 }
  //（声明顺序；Begin=触摸滑块、Moving=拖动中、End=拖动结束）
  //
  // DOM 映射（沿用生成骨架的原生控件基座，手写优先接管）：
  //   Checkbox/Toggle → <input type=checkbox>；Radio → <input type=radio> 且 **name = group**
  //   （原生单选互斥就是同名 name）；Slider → <input type=range>，min/max/step/value 直落控件。
  //   select/checked 落 checked；selectedColor → accent-color（原生控件唯一可映射的选中色）；
  //   原生控件没有对应属性的（unselectedColor/mark/shape/radioStyle/switchPointColor/…）
  //   照实记 data-*，不静默。select/checked 只改状态【不派发】change —— DOM 语义里
  //   change 是用户交互事件，编程改态是否触发 onChange .d.ts 没写死，取"不派发"并已写进 docs。
  const ToggleType = { Switch: 'switch', Checkbox: 'checkbox', Button: 'button' };
  const SliderChangeMode = { Begin: 0, Moving: 1, End: 2, Click: 3 };

  function inputComponent(name, type, setup) {
    return ensureComponent(name, (args) => {
      layoutWarnings.push('DBG-FACTORY ' + name); // TODO 调试后删
      const el = document.createElement('input');
      el.style.display = 'inline-block';
      el.__arkuiInput = name === 'Slider' ? 'slider' : 'input';
      if (type) el.type = type;
      const o = args && typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
      setup(el, o);
      return el;
    });
  }

  const Checkbox = inputComponent('Checkbox', 'checkbox', (el, o) => {
    if (o.name !== undefined && o.name !== null) el.name = String(o.name);
  });
  // Radio 的组登记：互斥时被取消成员的 onChange(false) 要【补发】—— Chrome 只给新选中者发
  // change（radio.d.ts JSDoc："false means that the radio button changes from selected to
  // unselected"，被取消的那次状态变化也是"选中态变化"，真机会发）
  const radioGroups = new Map();
  const Radio = inputComponent('Radio', 'radio', (el, o) => {
    if (o.group !== undefined && o.group !== null) {
      el.name = String(o.group);   // 互斥 = 同名 name
      if (!radioGroups.has(el.name)) radioGroups.set(el.name, new Set());
      radioGroups.get(el.name).add(el);
    }
    if (o.value !== undefined && o.value !== null) el.value = String(o.value);
  });
  const Toggle = inputComponent('Toggle', 'checkbox', (el, o) => {
    el.dataset.toggleType = o.type === undefined ? ToggleType.Checkbox : String(o.type);
    if (o.type === ToggleType.Switch) el.classList.add('arkui-toggle-switch');
    if (o.isOn !== undefined) el.checked = !!o.isOn;
  });
  const Slider = inputComponent('Slider', 'range', (el, o) => {
    const num = (v, d) => { const n = Number(resolveResource(v)); return Number.isFinite(n) ? n : d; };
    el.min = String(num(o.min, 0));                       // .d.ts 默认：min 0、max 100
    el.max = String(num(o.max, 100));
    el.step = String(num(o.step, 1));
    el.value = String(num(o.value, num(o.min, 0)));
  });

  // 输入类的语义属性：select/checked 落状态（**按上次应用的值做幂等 diff**——源码里是静态
  // 字面量，重渲染再应用同值必须是无操作；否则用户交互后的每次重渲染都会把状态拉回去，
  // 还连带触发组内互斥的 change —— inputdemo 首跑当场抓住）；selectedColor 落 accent-color；
  // 原生控件没有对应物的照实记 data-*（不静默）
  const INPUT_ATTRS = {
    select: (n, v) => {
      const want = !!v;
      if (n.__arkuiCheckedApplied !== want) { n.checked = want; n.__arkuiCheckedApplied = want; n.__arkuiRadioOn = want; }
    },
    checked: (n, v) => {
      const want = !!v;
      if (n.__arkuiCheckedApplied !== want) { n.checked = want; n.__arkuiCheckedApplied = want; n.__arkuiRadioOn = want; }
    },
    selectedColor: (n, v) => { n.style.accentColor = colorOf(v); },
    unselectedColor: (n, v) => { n.dataset.unselectedColor = String(colorOf(v)); },
    mark: (n, v) => { n.dataset.mark = String(resolveResource(v)); },
    shape: (n, v) => { n.dataset.shape = String(resolveResource(v)); },
    radioStyle: (n, v) => { n.dataset.radioStyle = String(resolveResource(v)); },
    switchPointColor: (n, v) => { n.dataset.switchPointColor = String(colorOf(v)); },
    switchStyle: (n, v) => { n.dataset.switchStyle = String(resolveResource(v)); },
    blockColor: (n, v) => { n.dataset.blockColor = String(colorOf(v)); },
    trackColor: (n, v) => { n.dataset.trackColor = String(colorOf(v)); },
    showTips: (n, v) => { n.dataset.showTips = String(v); },
    showSteps: (n, v) => { n.dataset.showSteps = String(v); },
  };

  // ────────────────── 信息展示类：Badge / Counter / Divider / Marquee（R28）──────────────────
  //
  // 产物形态（实测 fixtures/pages/ShowDemo.ts）：
  //   Badge.create({count: 9, position: BadgePosition.RightTop, style: {...}})
  //      | Badge.create({value: '99', ...})
  //     ⚠️ 数字重载用【count】、字符串重载用【value】（编译期实测：value: 9 编译就红）；
  //     ⚠️ style 在 create 参数里（BadgeParam.style 必填；BadgeAttribute 没有 .style() 方法）
  //   Counter.create();  Counter.onInc(cb);  Counter.onDec(cb);  Counter.enableInc/enableDec(bool)
  //   Divider.create();  Divider.vertical(bool);  Divider.color;  Divider.strokeWidth;  Divider.lineCap
  //   Marquee.create({src, start, loop});  Marquee.fontColor;  Marquee.fontSize;  onStart/onFinish
  //
  // 语义锚点（.d.ts JSDoc 原文）：
  //   BadgeStyle 默认：badgeColor Color.Red、color Color.White、fontSize 10vp、badgeSize 16vp、
  //     borderWidth 1vp；BadgePosition = { RightTop, Right, Left }（声明顺序，JSDoc 有名无数字 ——
  //     数值是本实现的枚举化，产物里只引用名字）
  //   Divider 默认：vertical false、color '#33182431'、strokeWidth 1px、lineCap LineCapStyle.Butt
  //   Marquee 默认：step 6、loop -1、fromStart true；MarqueeOptions 的 start 是必填（编译期实测）
  const BadgePosition = { RightTop: 0, Right: 1, Left: 2 };

  // Badge：容器（子内容照常挂进来）+ 绝对定位的角标。位置映射是 DOM 化选择（.d.ts 只有名字没数字）
  const Badge = ensureComponent('Badge', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const style = (o.style && typeof o.style === 'object' && o.style) || {};
    const root = document.createElement('div');
    root.__arkuiShow = 'Badge';
    root.style.display = 'inline-block';
    root.style.position = 'relative';
    const mark = document.createElement('div');
    mark.setAttribute('data-arkui-badge-mark', '');
    mark.style.position = 'absolute';
    mark.style.zIndex = '1';
    mark.style.display = 'inline-flex';
    mark.style.alignItems = 'center';
    mark.style.justifyContent = 'center';
    mark.style.borderRadius = '8px';
    mark.style.padding = '0 4px';
    mark.style.background = colorOf(style.badgeColor !== undefined ? style.badgeColor : 'red');
    mark.style.color = colorOf(style.color !== undefined ? style.color : '#ffffff');
    mark.style.fontSize = `${style.fontSize !== undefined ? dimOf(style.fontSize, 10) : 10}px`;
    const size = style.badgeSize !== undefined ? dimOf(style.badgeSize, 16) : 16;
    mark.style.minWidth = `${size}px`;
    mark.style.minHeight = `${size}px`;
    mark.style.boxSizing = 'border-box';
    if (style.borderWidth !== undefined) mark.style.borderWidth = `${dimOf(style.borderWidth, 1)}px`;
    if (style.borderColor !== undefined) mark.style.borderColor = colorOf(style.borderColor);
    mark.style.borderStyle = 'solid';
    if (style.fontWeight !== undefined) mark.style.fontWeight = String(resolveResource(style.fontWeight));
    // 位置：RightTop(0)/Right(1)/Left(2)，映射是 DOM 化选择
    const pos = o.position === undefined ? BadgePosition.RightTop : Number(o.position);
    root.dataset.badgePosition = pos === BadgePosition.Right ? 'Right' : pos === BadgePosition.Left ? 'Left' : 'RightTop';
    if (pos === BadgePosition.Right) {
      mark.style.right = '0';
      mark.style.top = '50%';
      mark.style.transform = 'translateY(-50%)';
    } else if (pos === BadgePosition.Left) {
      mark.style.left = '0';
      mark.style.top = '50%';
      mark.style.transform = 'translateY(-50%)';
    } else {
      mark.style.right = '0';
      mark.style.top = '0';
    }
    // 数字重载 count（超 maxCount 折叠成 "N+"）/ 字符串重载 value
    let text = '';
    if (o.count !== undefined && o.count !== null) {
      const max = o.maxCount !== undefined ? Number(o.maxCount) : 99;
      const n = Number(o.count);
      text = Number.isFinite(n) && o.maxCount !== undefined && n > o.maxCount ? `${o.maxCount}+` : String(o.count);
    } else {
      text = String(resolveResource(o.value === undefined ? '' : o.value));
    }
    mark.textContent = text;
    root.appendChild(mark);
    return root;
  });

  // Counter：inline-flex 容器，内置 +/- 两个可点元素（DOM 顺序在内容前后无所谓 ——
  // 用 flex order 摆成 [−, 内容, +]，create 时内容还没挂进来）
  const Counter = ensureComponent('Counter', () => {
    const root = document.createElement('div');
    root.__arkuiShow = 'Counter';
    root.style.display = 'inline-flex';
    root.style.alignItems = 'center';
    root.dataset.counter = '';
    const dec = document.createElement('div');
    dec.setAttribute('data-arkui-counter-dec', '');
    dec.textContent = '-';
    dec.style.cursor = 'pointer';
    dec.style.padding = '0 6px';
    dec.style.order = '-1';
    const inc = document.createElement('div');
    inc.setAttribute('data-arkui-counter-inc', '');
    inc.textContent = '+';
    inc.style.cursor = 'pointer';
    inc.style.padding = '0 6px';
    inc.style.order = '1';
    inc.addEventListener('click', () => {
      if (root.__counterCbs && typeof root.__counterCbs.inc === 'function') {
        try { root.__counterCbs.inc(); }
        catch (e) { layoutWarnings.push(`Counter.onInc 抛错：${e && e.message}`); }
      }
    });
    dec.addEventListener('click', () => {
      if (root.__counterCbs && typeof root.__counterCbs.dec === 'function') {
        try { root.__counterCbs.dec(); }
        catch (e) { layoutWarnings.push(`Counter.onDec 抛错：${e && e.message}`); }
      }
    });
    root.appendChild(dec);
    root.appendChild(inc);
    return root;
  });

  // Divider：div + 背景色画线（hr 的样式可控性差）。横向默认高 = strokeWidth；纵向宽 = strokeWidth
  const Divider = ensureComponent('Divider', () => {
    const el = document.createElement('div');
    el.__arkuiShow = 'Divider';
    el.dataset.divider = '';
    el.style.background = '#33182431';        // .d.ts JSDoc 默认色原文
    el.style.height = '1px';                  // 默认横向、粗细 1px（JSDoc）
    return el;
  });

  // Marquee：overflow 容器 + 内层文本跑 CSS 动画。时长按 step（默认 6vp/帧）× 16ms/帧算 ——
  // "逐帧步进"到 CSS 动画是本实现的 DOM 化映射（推断，已写进 docs）。事件走 animation
  // 生命周期：animationstart → onStart、animationend → onFinish（loop 次数 = 迭代次数）。
  // fromStart 默认 true（JSDoc）：从头开始。
  if (!document.getElementById('arkui-marquee-keyframes')) {
    const kf = document.createElement('style');
    kf.id = 'arkui-marquee-keyframes';
    kf.textContent = '@keyframes arkuiMarquee{from{transform:translateX(200%)}to{transform:translateX(-100%)}}';
    document.head.appendChild(kf);
  }
  const Marquee = ensureComponent('Marquee', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const root = document.createElement('div');
    root.__arkuiShow = 'Marquee';
    root.dataset.marquee = '';
    root.style.display = 'inline-block';
    root.style.overflow = 'hidden';
    root.style.whiteSpace = 'nowrap';
    const inner = document.createElement('span');
    inner.setAttribute('data-arkui-marquee-text', '');
    inner.style.display = 'inline-block';
    inner.style.whiteSpace = 'nowrap';
    inner.textContent = String(resolveResource(o.src === undefined ? '' : o.src));
    root.appendChild(inner);
    root.dataset.loop = String(o.loop === undefined ? -1 : o.loop);      // JSDoc：默认 -1（无限）
    root.dataset.start = String(o.start === undefined ? true : !!o.start);
    root.dataset.fromStart = String(o.fromStart === undefined ? true : !!o.fromStart);
    root.dataset.step = String(o.step === undefined ? 6 : o.step);       // JSDoc：step 默认 6
    if (root.dataset.start === 'true') {
      // step=6vp/帧 × 16ms/帧（60fps）→ 时长 ms = 文本字数 × 默认字号16 / step × 16
      //（"逐帧步进"→ CSS 动画是 DOM 化映射，时长公式是实现选择，非 .d.ts 数字）
      const ms = Math.max(1000, Math.ceil(inner.textContent.length * 16 / 6) * 16);
      const loops = root.dataset.loop === '-1' ? Infinity : Number(root.dataset.loop);
      root.style.animation = `arkuiMarquee ${ms}ms linear ${loops === Infinity ? 'infinite' : loops}`;
      // 收口与 animation.js 同约定（坑 ⑧）：headless 里 CSS 动画事件不可靠（不可见页面被节流，
      // animationend 实测会丢）—— MS 用短定时器兜底、MF 用"时长×圈数"定时器兜底，
      // 动画事件只当见证，once 守卫保证只发一次
      let startFired = false;
      const fireStart = () => {
        if (startFired) return;
        startFired = true;
        if (root.__marqueeCbs && typeof root.__marqueeCbs.start === 'function') {
          try { root.__marqueeCbs.start(); }
          catch (e) { layoutWarnings.push(`Marquee.onStart 抛错：${e && e.message}`); }
        }
      };
      root.addEventListener('animationstart', fireStart, { once: true });
      setTimeout(fireStart, 60);
      if (loops !== Infinity) {
        let finishFired = false;
        const fireFinish = () => {
          if (finishFired) return;
          finishFired = true;
          if (root.__marqueeCbs && typeof root.__marqueeCbs.finish === 'function') {
            try { root.__marqueeCbs.finish(); }
            catch (e) { layoutWarnings.push(`Marquee.onFinish 抛错：${e && e.message}`); }
          }
        };
        root.addEventListener('animationend', fireFinish, { once: true });
        setTimeout(fireFinish, ms * loops + 80);
      }
    }
    return root;
  });

  // 语义属性分派（applyAttr 里抢在通用落点之前）：Divider 三件 + Marquee 字体 +
  // Counter 的 onInc/onDec/enable（函数值，必须拦在通用 on* 规则之前）
  const SHOW_ATTRS = {
    onInc: (n, v) => { (n.__counterCbs = n.__counterCbs || {}).inc = v; },
    onDec: (n, v) => { (n.__counterCbs = n.__counterCbs || {}).dec = v; },
    enableInc: (n, v) => {
      const b = n.querySelector('[data-arkui-counter-inc]');
      if (b) { b.style.opacity = v === false ? '0.4' : ''; b.style.pointerEvents = v === false ? 'none' : ''; }
    },
    enableDec: (n, v) => {
      const b = n.querySelector('[data-arkui-counter-dec]');
      if (b) { b.style.cursor = v === false ? 'default' : 'pointer'; b.style.opacity = v === false ? '0.4' : ''; }
    },
    vertical: (n, v) => {
      const on = !!v;
      n.dataset.vertical = String(on);
      n.dataset.direction = on ? 'v' : 'h';
    },
    color: (n, v) => {
      if (n.__arkuiShow === 'Divider') n.style.background = colorOf(v);
      else n.style.color = colorOf(v);            // Marquee.fontColor
    },
    fontColor: (n, v) => { n.querySelector('[data-arkui-marquee-text]').style.color = colorOf(v); },
    fontSize: (n, v) => { n.querySelector('[data-arkui-marquee-text]').style.fontSize = `${dimOf(v, 16)}px`; },
    strokeWidth: (n, v) => {
      if (n.dataset.direction === 'v') n.style.width = `${dimOf(v, 1)}px`;
      else n.style.height = `${dimOf(v, 1)}px`;
    },
    lineCap: (n, v) => { n.dataset.lineCap = String(resolveResource(v)); },
    allowScale: (n, v) => { n.dataset.allowScale = String(v); },
    marqueeUpdateStrategy: (n, v) => { n.dataset.updateStrategy = String(resolveResource(v)); },
    onStart: (n, v) => { (n.__marqueeCbs = n.__marqueeCbs || {}).start = v; },
    onBounce: (n, v) => { (n.__marqueeCbs = n.__marqueeCbs || {}).bounce = v; },
    onFinish: (n, v) => { (n.__marqueeCbs = n.__marqueeCbs || {}).finish = v; },
  };

  // ────────────────── 信息展示收官：QRCode（R33）──────────────────
  //
  // 产物形态（实测 fixtures/pages/QrDemo.ts）：
  //   QRCode.create('…');        ← create 单参（最多 512 字符，超出取前 512，JSDoc 原文）
  //   QRCode.color(...); QRCode.backgroundColor(...); QRCode.contentOpacity(...)
  //
  // 语义锚点（qrcode.d.ts JSDoc 原文）：color 默认 '#ff000000'、backgroundColor 默认
  // '#ffffffff'（API 11+）、contentOpacity 默认 1 范围 [0,1]；空串 → 无效 QR。
  //
  // 编码器是**移植的第三方库**（global.ArkuiVendorQrcode = node-qrcode@1.5.4 的浏览器 bundle，
  // 见 THIRD-PARTY-NOTICES §3b，库代码零修改）——不自己实现。未加载 vendor 时记警告并降级
  // 为占位（不静默、不假画）。
  // 渲染走渲染后同步阶段（redrawQr，由 syncDrawings 调用——绘制要等尺寸生效，不变量 18）：
  // canvas 内容尺寸 = 组件尺寸（1:1），模块边长 = floor(尺寸/总模块数)，quiet zone 4 模块
  // （node-qrcode 默认）计入矩阵。颜色变化 → 整幅重画。
  // ArkUI 的 8 位颜色字面量是【ARGB】（'#ff000000' = 不透明黑，JSDoc 原文默认），CSS 是 RRGGBBAA
  // ——位数歧义必须归一，否则默认前景画成全透明（首跑当场抓住：解码 null）。
  const qrColor = (c) => {
    const s = colorOf(c);
    return s[0] === '#' && s.length === 9 ? '#' + s.slice(3) + s.slice(1, 3) : s;
  };
  function redrawQr(el) {
    if (!global.ArkuiVendorQrcode) {
      delete el.__arkuiQrPending; // BROKEN-1：应记警告（不静默降级）
      return;
    }
    el.__arkuiQrPending = false;
    try {
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      if (w > 0) el.width = w;
      if (h > 0) el.height = h;
      const value = el.__arkuiQrValue.slice(0, 512);           // JSDoc：取前 512
      if (!value) return;                                     // 空串 → 无效 QR（JSDoc 原文）
      const native = el.getContext('2d');
      const matrix = global.ArkuiVendorQrcode.create(value).modules;
      const quiet = 4;                                        // quiet zone 4 模块（node-qrcode 默认）
      const total = matrix.size + quiet * 2;
      const cell = Math.max(1, Math.floor(Math.min(w, h) / total));
      const offX = Math.floor((w - cell * total) / 2);
      const offY = Math.floor((h - cell * total) / 2);
      native.fillStyle = qrColor(el.__arkuiQrBg);
      native.fillRect(0, 0, w, h);
      native.globalAlpha = el.__arkuiQrOpacity;
      native.fillStyle = qrColor(el.__arkuiQrFg);
      for (let y = 0; y < matrix.size; y++) {
        for (let x = 0; x < matrix.size; x++) {
          if (matrix.data[y * matrix.size + x]) {
            native.fillRect(offX + (x + quiet) * cell, offY + (y + quiet) * cell, cell, cell);
          }
        }
      }
      native.globalAlpha = 1;
      el.dataset.qrRendered = String(total);
    } catch (e) {
      layoutWarnings.push(`QRCode 渲染抛错：${e && e.message}`);
    }
  }
  const QRCode = ensureComponent('QRCode', (args) => {
    const el = document.createElement('canvas');
    el.__arkuiQrValue = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    el.__arkuiQrFg = '#ff000000';              // JSDoc 默认
    el.__arkuiQrBg = '#ffffffff';              // JSDoc 默认（API 11+）
    el.__arkuiQrOpacity = 1;
    el.__arkuiQrPending = true;                // 等渲染后同步阶段画（不变量 18）
    return el;
  });
  const QR_ATTRS = {
    color: (n, v) => { n.__arkuiQrFg = colorOf(v); redrawQr(n); },
    backgroundColor: (n, v) => { n.__arkuiQrBg = colorOf(v); redrawQr(n); },
    contentOpacity: (n, v) => {
      const o = Number(resolveResource(v));
      n.__arkuiQrOpacity = Number.isFinite(o) && o >= 0 && o <= 1 ? o : 1;   // JSDoc：出界取默认 1
      redrawQr(n);
    },
  };

  // ────────────────── 弹出类：Select / Menu + MenuItem（R29）──────────────────
  //
  // 产物形态（实测 fixtures/pages/PopDemo.ts）：
  //   Select.create([{value: 'A'}, …]);   ← create 单参数（SelectOption = {value, icon?…}）
  //     Select.selected(i); Select.value(str); Select.fontColor(...);
  //     Select.onSelect((index: number, value: string) => …)
  //   Menu.create(); MenuItem.create({content}); MenuItem.selected(bool); MenuItem.onChange((on)=>…)
  //
  // 语义锚点（.d.ts）：Select.create 只收选项数组（"selected" 是属性方法，selected(value:
  // number | Resource)）；onSelect 的签名是双参 (index, value)（index = 选中序号、value =
  // 选中项文本）；MenuItem.onChange 是**多选语义**（每项独立 selected + onChange，非互斥）。
  //
  // DOM 映射：Select 沿用原生 <select> 基座（options → <option>，selectedIndex 直落）；
  // Menu/MenuItem 是行式面板：MenuItem 点击切换自身 selected（带 ✓ 标记）并派发 onChange。
  // Select.value(str)（"设置当前显示文本"）：原生 <select> 的显示文本不可覆盖 → 照实记
  // data-value-text（不静默，取舍已写进 docs）。
  const Select = ensureComponent('Select', (args) => {
    const el = document.createElement('select');
    el.style.display = 'inline-block';
    el.__arkuiPopup = 'Select';
    (Array.isArray(args && args[0]) ? args[0] : []).forEach((opt) => {
      const o = document.createElement('option');
      const text = String(resolveResource(opt && opt.value === undefined ? '' : opt.value));
      o.value = text;
      o.textContent = text;
      el.appendChild(o);
    });
    return el;
  });
  const Menu = ensureComponent('Menu', () => {
    const el = document.createElement('div');
    el.__arkuiPopup = 'Menu';
    el.dataset.menu = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    return el;
  });
  const MenuItem = ensureComponent('MenuItem', (args) => {
    const el = document.createElement('div');
    el.__arkuiPopup = 'MenuItem';
    el.dataset.menuItem = '';
    el.style.cursor = 'pointer';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const mark = document.createElement('span');
    mark.setAttribute('data-arkui-select-icon', '');
    el.appendChild(mark);
    const text = document.createElement('span');
    text.textContent = String(resolveResource(o.content === undefined ? '' : o.content));
    el.appendChild(text);
    // 点击切换选中（多选语义：每项独立 selected，非互斥），派发 onChange(新状态)
    el.addEventListener('click', () => {
      const now = el.dataset.selected !== 'true';
      el.dataset.selected = String(now);
      mark.textContent = now ? '✓' : '';
      if (el.__popupCbs && typeof el.__popupCbs.onChange === 'function') {
        try { el.__popupCbs.onChange(now); }
        catch (e) { layoutWarnings.push(`MenuItem.onChange 派发抛错：${e && e.message}`); }
      }
    });
    return el;
  });

  // 弹出类语义属性分派（applyAttr 里抢在通用落点之前）：函数值的 onSelect/onChange 必须拦在
  // 通用 on* 规则之前（坑 86 同族），selected 按组件身份分派（Select 落 selectedIndex、
  // MenuItem 落 data-selected）
  const POPUP_ATTRS = {
    selected: (n, v) => {
      if (n.__arkuiPopup === 'Select') {
        n.selectedIndex = Number(resolveResource(v));       // 直接改 <select> 的选中序号
        return;
      }
      // MenuItem
      n.dataset.selected = String(!!v);
      const mark = n.querySelector('[data-arkui-select-icon]');
      if (mark) mark.textContent = v ? '✓' : '';
    },
    selectIcon: (n, v) => { n.dataset.selectIcon = String(resolveResource(v)); },
    value: (n, v) => { n.dataset.valueText = String(resolveResource(v)); },   // Select.value：显示文本覆盖（记录取舍）
    fontColor: (n, v) => { n.style.color = colorOf(v); },
    showPosition: (n, v) => { n.dataset.showPosition = String(resolveResource(v)); },
    onChange: (n, v) => { (n.__popupCbs = n.__popupCbs || {}).onChange = v; },   // MenuItem 的回调（点击切换见工厂）
  };

  // Select.onSelect 的双参派发（特殊签名，拦在通用 on* 规则之前）：change 事件 → (index, value)。
  // 编程改 selectedIndex 不派发（DOM 语义取舍已记录）；测试用 dispatchEvent('change') 驱动。
  function popupBindSelect(node, cb) {
    node.addEventListener('change', () => {
      const i = node.selectedIndex;
      const opt = node.options && node.options[i];
      try { cb(i, opt ? opt.textContent : ''); }
      catch (e) { layoutWarnings.push(`Select.onSelect 派发抛错：${e && e.message}`); }
    });
  }

  // ────────────────── 表层类：Canvas（R31）──────────────────
  //
  // 产物形态（实测 fixtures/pages/CanvasDemo.ts）：
  //   Canvas.create(this.context);           ← create 参数是 CanvasRenderingContext2D 对象
  //   Canvas.width/height; Canvas.onReady(cb);   ← 绘制必须等 onReady（JSDoc："perform any
  //     drawing after this event is triggered, not the onAttach event"）
  //   const ctx = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  //   ctx.fillStyle/fillRect/getImageData/toDataURL —— CanvasRenderer 通用 2D 面（fillRect/
  //     fillText/strokeRect/clearRect/arc… 全是标准 Canvas 2D 方法，.d.ts 原文同 Web）
  //
  // DOM 映射：手写 Canvas → 原生 <canvas>；ctx 对象**转发**到原生 2D context——
  // fillRect/像素/toDataURL 都是浏览器真画，getImageData 像素断言天然有牙齿。
  // ctx 先于 Canvas 创建（用户字段初始化），Canvas.create 时"交接"原生 context；
  // onReady 的派发时机：create → .width/.height 应用完 → setTimeout(0)（坑 ⑧：不用 rAF），
  // 因为 onReady 同步派发时画布还没有尺寸。
  const CanvasRenderingContext2D = class {
    constructor(settings) {
      this.__arkuiSettings = settings;       // antialias/alpha 在浏览器 2D 里无对应开关（取舍已记录）
      this.__arkuiCanvas = null;
      this.__arkuiNative = null;
    }
    // Canvas 组件绑定时调用：把原生 2D context 借给它
    __arkuiAttach(canvasEl) {
      this.__arkuiCanvas = canvasEl;
      this.__arkuiNative = canvasEl.getContext('2d');
      return this.__arkuiNative;
    }
    get fillStyle() { return this.__arkuiNative ? this.__arkuiNative.fillStyle : undefined; }
    set fillStyle(v) { if (this.__arkuiNative) this.__arkuiNative.fillStyle = String(v); }
    get strokeStyle() { return this.__arkuiNative ? this.__arkuiNative.strokeStyle : undefined; }
    set strokeStyle(v) { if (this.__arkuiNative) this.__arkuiNative.strokeStyle = String(v); }
    get font() { return this.__arkuiNative ? this.__arkuiNative.font : undefined; }
    set font(v) { if (this.__arkuiNative) this.__arkuiNative.font = String(v); }
    get lineWidth() { return this.__arkuiNative ? this.__arkuiNative.lineWidth : undefined; }
    set lineWidth(v) { if (this.__arkuiNative) this.__arkuiNative.lineWidth = Number(v); }
    get globalAlpha() { return this.__arkuiNative ? this.__arkuiNative.globalAlpha : undefined; }
    set globalAlpha(v) { if (this.__arkuiNative) this.__arkuiNative.globalAlpha = Number(v); }
    fillRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.fillRect(x, y, w, h); }
    strokeRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.strokeRect(x, y, w, h); }
    clearRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.clearRect(x, y, w, h); }
    fillText(t, x, y, w) { if (this.__arkuiNative) this.__arkuiNative.fillText(String(t), x, y, w); }
    strokeText(t, x, y, w) { if (this.__arkuiNative) this.__arkuiNative.strokeText(String(t), x, y, w); }
    beginPath() { if (this.__arkuiNative) this.__arkuiNative.beginPath(); }
    closePath() { if (this.__arkuiNative) this.__arkuiNative.closePath(); }
    moveTo(x, y) { if (this.__arkuiNative) this.__arkuiNative.moveTo(x, y); }
    lineTo(x, y) { if (this.__arkuiNative) this.__arkuiNative.lineTo(x, y); }
    arc(x, y, r, a0, a1) { if (this.__arkuiNative) this.__arkuiNative.arc(x, y, r, a0, a1); }
    fill() { if (this.__arkuiNative) this.__arkuiNative.fill(); }
    stroke() { if (this.__arkuiNative) this.__arkuiNative.stroke(); }
    getImageData(sx, sy, sw, sh) { return this.__arkuiNative ? this.__arkuiNative.getImageData(sx, sy, sw, sh) : null; }
    putImageData(img, x, y) { if (this.__arkuiNative) this.__arkuiNative.putImageData(img, x, y); }
    toDataURL(type, quality) {
      return this.__arkuiCanvas ? this.__arkuiCanvas.toDataURL(type, quality) : '';
    }
  };
  const RenderingContextSettings = class RenderingContextSettings {
    constructor(antialias, alpha) {
      this.antialias = !!antialias;
      this.alpha = alpha === undefined ? true : !!alpha;   // .d.ts 默认 true
    }
  };

  // Canvas：create 时拿 ctx 对象绑定；尺寸由通用 .width/.height 应用后，同步到 canvas 的
  // 内容尺寸（width/height 属性 = CSS 尺寸 1:1，vp→px 本项目一贯近似）；onReady 在
  // 属性应用完之后派发（setTimeout(0)）——绘制必须等它（.d.ts 原文）
  const Canvas = ensureComponent('Canvas', (args) => {
    const el = document.createElement('canvas');
    el.__arkuiCanvasFlag = true;
    el.__arkuiCanvasCtx = args && args[0] && args[0].__arkuiAttach ? args[0] : null;
    el.__arkuiOnReadyCbs = [];
    if (el.__arkuiCanvasCtx) el.__arkuiCanvasCtx.__arkuiAttach(el);   // 原生 2D context 在此交接
    return el;
  });
  // Canvas 的属性分派：onReady 是函数值（拦在通用 on* 规则之前，否则变成 'ready' DOM 监听——
  // 原生 canvas 不会自发派发 ready），create-args 无需处理
  const CANVAS_ATTRS = {
    onReady: (n, v) => {
      n.__arkuiCanvasOnReady = v;
      if (n.__arkuiReadyScheduled) return;   // 覆盖语义：cb 替换，调度只排一次
      n.__arkuiReadyScheduled = true;
      // 派发时机：.width/.height 应用完之后（setTimeout(0)，坑 ⑧）——同步派发时画布还没有尺寸；
      // 尺寸同步（CSS 尺寸 → canvas 内容尺寸，1:1）必须在绘制开始前完成
      setTimeout(() => {
        const w = n.offsetWidth;
        const h = n.offsetHeight;
        if (w > 0) n.width = w;
        if (h > 0) n.height = h;
        if (typeof n.__arkuiCanvasOnReady === 'function') {
          try { n.__arkuiCanvasOnReady(); }
          catch (e) { layoutWarnings.push(`Canvas.onReady 抛错：${e && e.message}`); }
        }
      }, 0);
    },
    enableAnalyzer: (n, v) => { n.dataset.enableAnalyzer = String(v); },
  };

  // ────────────────── 表层类：XComponent（R32）──────────────────
  //
  // 产物形态（实测 fixtures/pages/XCompDemo.ts）：
  //   XComponent.create({id, type, controller}, "bundle/module");   ← create 有第二参（bundle 串，记录）
  //   XComponent.width/height; XComponent.onLoad(cb); XComponent.onDestroy(cb);
  //   controller.getXComponentSurfaceId() / setXComponentSurfaceRect(rect) / getXComponentSurfaceRect()
  //
  // 语义锚点（.d.ts）：XComponentOptions = {type, controller}（id 也在 create 参数里）；
  //   XComponentType = { SURFACE = 0, COMPONENT, NODE }（enums.d.ts 声明顺序）；onLoad 在
  //   surface 创建后触发；getXComponentSurfaceRect —— JSDoc 原文："不调用 set 则返回
  //   组件实际尺寸"。
  // DOM 映射：真机的 surface 由原生图形栈持有，DOM 里**如实降级为占位容器**——surfaceId 是
  // 生成的字符串（`XComponent-<id>`，DOM 化选择），rect 默认取组件实际尺寸（JSDoc 原文语义），
  // set 只记录（真机会改 surface 缓冲尺寸，DOM 无对应物）。
  const XComponentType = { SURFACE: 0, COMPONENT: 1, NODE: 2 };
  const XComponentController = class {
    constructor() {
      this.__arkuiXcEl = null;
      this.__arkuiXcRect = null;
    }
    __arkuiBindXComponent(el) { this.__arkuiXcEl = el; }
    getXComponentSurfaceId() {
      return 'XComponent-' + (this.__arkuiXcEl ? this.__arkuiXcEl.__arkuiXcId : '');
    }
    getXComponentContext() { return { surfaceId: this.getXComponentSurfaceId() }; }
    setXComponentSurfaceRect(rect) { this.__arkuiXcRect = rect; }
    getXComponentSurfaceRect() {
      if (this.__arkuiXcRect) return Object.assign({}, this.__arkuiXcRect);
      // JSDoc 原文：不调用 set 时返回组件实际尺寸
      return {
        offsetX: 0,
        offsetY: 0,
        surfaceWidth: this.__arkuiXcEl ? this.__arkuiXcEl.offsetWidth : 0,
        surfaceHeight: this.__arkuiXcEl ? this.__arkuiXcEl.offsetHeight : 0,
      };
    }
  };
  const XComponent = ensureComponent('XComponent', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const el = document.createElement('div');
    el.__arkuiXComponentFlag = true;
    el.dataset.xcomponent = '';
    el.dataset.xcType = String(o.type === undefined ? 0 : o.type);
    el.__arkuiXcId = o.id === undefined ? '' : String(o.id);
    const ctl = o.controller;
    if (ctl && typeof ctl.__arkuiBindXComponent === 'function') ctl.__arkuiBindXComponent(el);
    return el;
  });
  const XC_ATTRS = {
    onLoad: (n, v) => {
      n.__arkuiXcOnLoad = v;
      if (n.__arkuiXcScheduled) return;      // 覆盖语义：cb 替换，调度只排一次
      n.__arkuiXcScheduled = true;
      // onLoad 在 surface 就绪后触发（setTimeout(0)，坑 ⑧——此时尺寸属性已应用）
      setTimeout(() => {
        if (typeof n.__arkuiXcOnLoad === 'function') {
          try { n.__arkuiXcOnLoad(); }
          catch (e) { layoutWarnings.push(`XComponent.onLoad 抛错：${e && e.message}`); }
        }
      }, 0);
    },
    onDestroy: (n, v) => {
      n.__arkuiXcOnDestroy = v;
      // DOM 里的销毁时机：元素被摘除时（运行时挂卸钩子成本高）——只登记，触发时机已写进 docs
    },
  };

  // ── 由 tools/gen-components.mjs 生成的 149 个组件骨架 ──
  // 手写实现（上面那些，已被测试覆盖）优先；生成的只补缺口。
  // 骨架保证"能建出正确的 DOM 标签 + 基础样式"，精细化布局语义按需手补（见 docs）。
  let generatedRegistered = false;
  function registerGeneratedComponents() {
    const reg = global.__ARKUI_COMPONENTS;
    if (!reg || generatedRegistered) return 0;
    let n = 0;
    const overwritten = [];
    for (const name of Object.keys(reg)) {
      if (components[name]) continue;                  // 手写优先
      const meta = reg[name];
      const comp = ensureComponent(name, (args) => {
        const el = document.createElement(meta.tag || 'div');
        if (meta.baseStyle) Object.assign(el.style, meta.baseStyle);
        if (meta.inputType) el.type = meta.inputType;   // input/textarea 的原生 type
        applyCreateArgs(el, args);                      // {space} → gap
        applyNativeArgs(el, args, meta);                // 原生控件参数
        if (meta.tag === 'img' && args && args[0] !== undefined) {
          el.src = String(resolveResource(args[0]));
        }
        return el;
      });
      // 必须装成全局：产物里是 `Scroll.create(...)` 这类【自由变量】引用，不走 import。
      // 代价是可能覆盖同名浏览器全局（Image/Range/Text 之类）——记录下来以便排查。
      if (Object.prototype.hasOwnProperty.call(global, name)) overwritten.push(name);
      global[name] = comp;
      n++;
    }
    generatedRegistered = true;
    if (overwritten.length) {
      global.__arkui_dom_overwrittenGlobals = overwritten;
      if (global.console && console.debug) {
        console.debug('[arkui-dom] 组件骨架覆盖了同名浏览器全局:', overwritten.join(', '));
      }
    }
    return n;
  }

  // ────────────────── 状态管理 v2（@ComponentV2 等）──────────────────
  //
  // V1 与 V2 的机制【根本不同】，这点必须先说清：
  //   V1: 产物把状态包成对象 —— this.__theme = new ObservedPropertySimplePU(...)
  //       → 观测能力由【状态类】提供，值藏在包装对象里。
  //   V2: 产物保留装饰器，编译成
  //         __decorate([Local], V2.prototype, "count", void 0)
  //       状态存【裸字段】，观测能力由【装饰器函数】提供（在原型上装访问器）。
  //
  // 所以 V2 不是"再加几个状态类"，而是要【实现装饰器层】。TS 4.9 的 __decorate 助手
  // 决定了各装饰器的调用形态（已实测，见 docs/ARCHITECTURE.md §3.4）：
  //   属性   __decorate([Param],  Proto, "label", void 0) → Param(Proto, "label", undefined)
  //   方法   __decorate([Monitor('inner')], Proto, "cb", null)
  //          → desc=null 时助手会取真实描述符 → Monitor('inner')(Proto, "cb", methodDesc)
  //   访问器 __decorate([Computed], Proto, "doubled", null) → 拿到 {get,...}，可返回改写后的
  //   类     __decorate([ObservedV2], Cls) → 只有 1 个实参 → ObservedV2(Cls)，必须【返回类】
  //
  // 为什么装饰器不挂 global：`Event` 既是装饰器名也是浏览器全局，而 runtime 自己
  // （Scroller 里 `new Event('scroll')`）与 test/lazy.html 都在用 new Event(...)。
  // 挂 global 会直接把滚动事件打断。改为导出装饰器表 __arkui_dom_decorators，
  // 由 tools/extract.mjs 在产物里生成【作用域内】的绑定前奏（只绑实际用到的名字）。

  const v2InstCells = new WeakMap();   // 任意对象 -> Map<字段名, 依赖单元>（复用 propDeps 机制）
  const v2ProtoMeta = new WeakMap();   // 原型 -> {observed, consumers, providers, monitors, computed}

  // 依赖单元的粒度是【实例 × 字段】。若按原型共享，同类多实例会互相触发多余重渲染。
  function v2Cell(inst, key) {
    let m = v2InstCells.get(inst);
    if (!m) v2InstCells.set(inst, (m = new Map()));
    let c = m.get(key);
    if (!c) m.set(key, (c = { __v2: true, __name: key }));
    return c;
  }

  function v2Info(proto) {
    let i = v2ProtoMeta.get(proto);
    if (!i) {
      v2ProtoMeta.set(proto, (i = {
        observed: new Set(), consumers: new Map(), providers: new Map(),
        monitors: new Map(), computed: new Set(),
      }));
    }
    return i;
  }

  // 沿原型链汇总（子类能继承装饰器信息，与 ArkUI 一致）
  function v2Collect(inst, pick, out = []) {
    for (let p = Object.getPrototypeOf(inst); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      const info = v2ProtoMeta.get(p);
      if (info) pick(info, out);
    }
    return out;
  }

  // 字段存储的隐藏槽。名字带前缀避免与产物的其它字段撞车。
  const v2Slot = (key) => '__v2slot_' + key;

  function installV2Accessor(proto, key, kind) {
    const existing = Object.getOwnPropertyDescriptor(proto, key);
    if (existing && existing.get && existing.get.__v2) return;    // 已装过（重复装饰）
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: true,
      get() {
        // @Consumer：读提供者的字段。依赖由【提供者的访问器】记录，所以祖先改值
        // 会直接使后代读到它的 elmtId 变脏——不需要额外转发。
        const bind = this.__v2consumerBind && this.__v2consumerBind.get(key);
        if (bind) return bind.inst[bind.key];
        if (kind !== 'event') recordDep(v2Cell(this, key));
        return this[v2Slot(key)];
      },
      set(v) {
        const bind = this.__v2consumerBind && this.__v2consumerBind.get(key);
        if (bind) {
          // ArkUI 的 @Consumer 是单向下行数据；写它不应悄悄改掉祖先。
          layoutWarnings.push(`@Consumer 字段 '${key}' 被写入（应为只读），已忽略`);
          return;
        }
        const before = this[v2Slot(key)];
        this[v2Slot(key)] = v;
        if (kind === 'event') return;                 // @Event 只是回调槽，不参与观测
        markDependentsDirty(v2Cell(this, key));
        if (!Object.is(before, v)) fireV2Monitors(this, key, v, before);
      },
    });
    const d = Object.getOwnPropertyDescriptor(proto, key);
    d.get.__v2 = true;
    d.set.__v2 = true;
    // observed 的语义是"参与观测的字段"。@Event 只是回调槽（不记依赖、不发通知），
    // 装访问器只是为了让赋值统一走 setter —— 故不计入，否则自省会给出误导性的结论。
    if (kind !== 'event') v2Info(proto).observed.add(key);
  }

  // @Monitor 回调入参：形状取自 SDK 的权威声明
  //   <CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/common.d.ts
  //     declare interface IMonitor { dirty: Array<string>; value<T>(path?: string): IMonitorValue<T> | undefined }
  //     declare interface IMonitorValue<T> { before: T; now: T; path: string }
  // 曾经按 {dirty:[{path,value,before,kind}]} 实现，被 ArkTS 编译器当场判错
  // （"Property 'value' does not exist on type 'string'"）——所以这里以 .d.ts 为准。
  // 已知简化：一次赋值只产生一条 dirty（ArkUI 会把同一批变更合并），且 path 是
  // 字段名而不是 `items.0.name` 这样的点分路径。
  function fireV2Monitors(inst, key, value, before) {
    const methods = v2Collect(inst, (info, out) => {
      const s = info.monitors.get(key);
      if (s) for (const m of s) out.push(m);
    });
    if (!methods.length) return;
    const entries = [{ path: key, now: value, before }];
    const monitor = {
      dirty: entries.map((e) => e.path),
      value(path) {
        const want = path === undefined ? entries[0].path : path;
        const e = entries.find((x) => x.path === want);
        return e ? { before: e.before, now: e.now, path: e.path } : undefined;
      },
    };
    for (const m of methods) {
      const fn = inst[m];
      if (typeof fn !== 'function') { layoutWarnings.push(`@Monitor 找不到方法 '${m}'`); continue; }
      try {
        fn.call(inst, monitor);
      } catch (e) {
        // 回调抛错不该让整页渲染挂掉（与 @Watch 一致的容错策略）
        layoutWarnings.push(`@Monitor('${key}') → ${m} 抛错：${e && e.message}`);
      }
    }
  }

  const v2Field = (kind) => function (target, key) {
    if (typeof key === 'string') installV2Accessor(target, key, kind);
    return undefined;                                  // 属性装饰器的返回值被 __decorate 忽略
  };

  const Param = v2Field('param');
  const Local = v2Field('local');
  const Once = v2Field('once');
  const Event = v2Field('event');
  const Trace = v2Field('trace');

  const Provider = (name) => function (target, key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).providers.set(key, name || key);
    return undefined;
  };

  const Consumer = (name) => function (target, key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).consumers.set(key, name || key);
    return undefined;
  };

  const Monitor = (...keys) => function (target, key, desc) {
    const info = v2Info(target);
    for (const k of keys) {
      const s = info.monitors.get(k) || new Set();
      s.add(key);
      info.monitors.set(k, s);
    }
    return desc;                                       // 方法描述符原样传回
  };

  // @Computed：【不缓存】实现。getter 体在求值时就处在目标 elmtId 的渲染上下文里，
  // 它读到的每个字段都会直接把依赖记到该 elmtId 上——所以"传递依赖"天然成立，
  // 也就不需要缓存与失效逻辑。代价是每次重渲染都重算，换了正确性，值这个价。
  function Computed(target, key, desc) {
    if (typeof key === 'string') {
      if (desc && typeof desc.get === 'function') v2Info(target).computed.add(key);
      else installV2Accessor(target, key, 'local');     // 容错：@Computed 用在字段上
    }
    return desc;
  }

  // @ObservedV2 是【类装饰器】：__decorate([ObservedV2], Cls) 只有 1 个实参，
  // 助手会当成"整体替换"处理，所以必须返回这个类本身。
  function ObservedV2(target) {
    v2Info(target.prototype);
    return target;
  }

  class ViewV2 extends ViewPU {
    // 注意产物调用的是 super(parent, elmtId, extraInfo) —— 比 ViewPU 少一个
    // __localStorage。这里补上 undefined 以复用 ViewPU 的全部机制。
    constructor(parent, elmtId, extraInfo) {
      super(parent, undefined, elmtId, extraInfo);
      this.__v2consumerBind = null;
    }

    // ── 产物契约：initParam / updateParam / resetParam ──
    initParam(name, value) { this[name] = value; }
    updateParam(name, value) { this[name] = value; }
    resetParam(name, value) { this[name] = value; }

    resetConsumer(fieldKey, fallback) {
      const provName = v2Collect(this, (info, out) => {
        const n = info.consumers.get(fieldKey);
        if (n) out.push(n);
      })[0] || fieldKey;
      // 直接写槽，绕过 setter（此刻尚未绑定，走 setter 会平白触发一次通知）
      if (fallback !== undefined && this[v2Slot(fieldKey)] === undefined) {
        this[v2Slot(fieldKey)] = fallback;
      }
      if (!this.__v2consumerBind) this.__v2consumerBind = new Map();
      this.bindConsumer(fieldKey, provName, true);
    }

    // 无缓存实现 → 无需失效；保留方法只为对齐产物契约
    resetComputed(_name) {}
    resetMonitorsOnReuse() {}
    resetStateVarsOnReuse(_params) {}

    bindConsumer(fieldKey, provName, quiet) {
      const found = this._findProvided(provName);
      if (found && found.inst) {
        if (!this.__v2consumerBind) this.__v2consumerBind = new Map();
        this.__v2consumerBind.set(fieldKey, { inst: found.inst, key: found.key });
      } else if (!quiet) {
        layoutWarnings.push(`@Consumer('${provName}') 未找到祖先 @Provider，退化为本地字段`);
      }
    }

    // 产物在子类构造函数末尾调用它。用它来登记 @Provider / 绑定 @Consumer：
    // 这个时机两边都齐了（祖先实例已存在，本实例的字段也已赋值）。
    finalizeConstruction() {
      const provs = v2Collect(this, (info, out) => { for (const [k, n] of info.providers) out.push([k, n]); });
      for (const [key, name] of provs) {
        if (!this.__providedVars) this.__providedVars = new Map();
        const inst = this;
        // 同时提供 get/set：这样 V1 的 @Consume（initializeConsume 期望拿到 prop 对象）
        // 也能消费 V2 的 @Provider，反之亦然。
        this.__providedVars.set(name, {
          __v2provider: true, inst, key,
          get() { return inst[key]; },
          set(v) { inst[key] = v; },
          purgeDependencyOnElmtId() {},
          aboutToBeDeleted() {},
        });
      }
      const cons = v2Collect(this, (info, out) => { for (const [k, n] of info.consumers) out.push([k, n]); });
      for (const [key, name] of cons) this.bindConsumer(key, name);
    }
  }

  // 装饰器表：不给 global 加裸名（`Event`/`Local` 之类会撞浏览器全局），
  // 由抽取工具在产物里做作用域内绑定。
  // `Observed` 是 V1 的类装饰器（与 V2 的 `ObservedV2` 对应），走同一张表同一套机制。
  const decorators = {
    ViewV2, Param, Local, Once, Event, Monitor, Computed, Provider, Consumer, ObservedV2, Trace,
    Observed,
  };

  // ────────────────────── @ohos:* 模块别名层（④） ──────────────────────
  // 产物里的 `import X from "@ohos:xxx"` 经 CommonJS 转译后是 require("@ohos:xxx").default
  const ohosModules = new Map();
  function defineOhosModule(name, impl) {
    // 同时接受 @ohos:x 与 x 两种写法；require 返回 {default, ...impl} 以兼容 TS 的 default interop
    const ns = Object.assign({}, impl);
    ns.default = impl;
    ns.__esModule = true;
    ohosModules.set('@ohos:' + name, ns);
    ohosModules.set(name, ns);
  }
  function ohosRequire(spec) {
    if (ohosModules.has(spec)) return ohosModules.get(spec);
    const known = [...ohosModules.keys()].filter((k) => !k.startsWith('@ohos:')).sort();
    throw new Error(
      `[arkui-dom] 未实现的平台模块: ${spec}\n` +
      `  已实现: ${known.join(', ') || '(无)'}\n` +
      `  → 在 runtime/ohos-shims.js 里按需补充`
    );
  }

  // 已注册的 CommonJS 模块（由 tools/extract.mjs --register 生成的文件调用 define）
  const cjsModules = new Map();
  const cjsCache = new Map();
  function defineCommonJS(id, factory) { cjsModules.set(id, factory); }
  function requireModule(id) {
    if (cjsCache.has(id)) return cjsCache.get(id);
    const factory = cjsModules.get(id);
    if (!factory) {
      throw new Error(
        `[arkui-dom] 未注册的模块: ${id}\n  已注册: ${[...cjsModules.keys()].join(', ') || '(无)'}`
      );
    }
    const module = { exports: {} };
    factory(ohosRequire, module.exports, module);
    cjsCache.set(id, module.exports);
    return module.exports;
  }

  // ────────────────────── ability 栈（R20） ──────────────────────
  // 一个 ability = 一份生命周期 + 一个窗口。根 ability 由 __arkui_dom_startAbility 起；
  // 子 ability 由 context.startAbility / startAbilityForResult 起；terminateSelf* 结束自己。
  //
  // ⚠️ 实测更正：API 26 SDK 里【没有】onAbilityResult（全 SDK grep 0 命中），
  // stage 模型的结果只走 startAbilityForResult 的 Promise / AsyncCallback —— 见 docs/ROADMAP R20。
  const abilityStack = [];
  const abilityWindowStats = { created: 0, closed: 0, history: [] };
  let abilityClassForChildren = null;     // 同一进程内再起实例时用的类（不按 abilityName 路由）

  function abilityLog(rec) {
    (global.__arkui_dom_logs = global.__arkui_dom_logs || []).push(rec);
  }
  function bizError(code, message) { return Object.assign(new Error(message), { code }); }
  const okRes = () => ({ code: 0, message: '' });

  function makeAbilityWindow(entry) {
    const el = document.createElement('div');
    el.setAttribute('data-arkui-ability-window', entry.name);
    // 真机上被启动的 ability 在【新窗口】里：DOM 里用一个盖满全屏的独立容器表示，
    // 结束（terminateSelf*）时移除 —— 这样"起了第二个 ability"是可被看见、可被断言的
    el.setAttribute('style',
      'position:fixed;left:0;top:0;right:0;bottom:0;background:#fff;z-index:20;overflow:auto');
    document.body.appendChild(el);
    abilityWindowStats.created++;
    abilityLog({ t: 'abilityWindow', op: 'create', ability: entry.name });
    return el;
  }

  function closeAbilityWindow(entry) {
    const el = entry.windowEl;
    if (!el) return;
    // 关窗前把窗口里的文本抓下来：这是"这个窗口真的渲染过页面"的证据（不只一行日志）
    abilityWindowStats.history.push({
      ability: entry.name, page: entry.pagePath, text: String(el.textContent || ''),
    });
    abilityWindowStats.closed++;
    abilityLog({ t: 'abilityWindow', op: 'close', ability: entry.name, page: entry.pagePath });
    el.remove();
    purgeDetachedRecords();
    entry.windowEl = null;
  }

  // loadRoute 用的是单例 rootNode/pageStack：起子 ability 时切成它的窗口，跑完切回来。
  // 已知限制：子 ability 的【异步】重渲染不在支持范围（它必须在自己生命周期内完成渲染）——
  // 见 docs/ARCHITECTURE §4.14。
  function withAbilityWindow(entry, fn) {
    const savedRoot = rootNode;
    const savedStack = pageStack.slice();
    rootNode = entry.windowEl;
    pageStack.length = 0;
    try {
      return fn();
    } finally {
      rootNode = savedRoot;
      pageStack.length = 0;
      for (const p of savedStack) pageStack.push(p);
    }
  }

  function makeWindowStage(entry) {
    return {
      loadContent(page, cb) {
        abilityLog({ t: 'loadContent', page, ability: entry.name });
        let err = null;
        try {
          entry.pagePath = page;
          if (entry.windowEl) withAbilityWindow(entry, () => loadRoute(page, entry.windowEl));
          else loadRoute(page, entry.rootEl);
        } catch (e) {
          err = { code: 1, message: e.message };
          abilityLog({ t: 'loadContentError', message: e.message });
        }
        // 注意：生成代码是 `if (err.code) …`，【没有 null 检查】——说明官方 API 成功时
        // 也必须传一个 BusinessError 形状的对象（code=0）。传 null 会直接 TypeError。
        if (typeof cb === 'function') cb(err || { code: 0, message: '' });
        return err ? undefined : true;
      },
    };
  }

  // AsyncCallback：一律【异步】回调（同步回调会让"回调晚于后续同步代码"的假设悄悄不成立）
  function withCallback(promise, cb) {
    if (typeof cb !== 'function') return promise;
    promise.then(
      (v) => Promise.resolve().then(() => cb(okRes(), v)),
      (e) => Promise.resolve().then(() => cb(bizError(e.code || 1, e.message), undefined)),
    );
    return undefined;
  }

  function spawnChildAbility(want, parent, onResult) {
    if (!want || typeof want !== 'object') {
      throw bizError(401, 'startAbilityForResult: 缺少必填参数 want（BusinessError 401）');
    }
    const AbilityClass = abilityClassForChildren;
    if (typeof AbilityClass !== 'function') {
      throw bizError(16000001, '没有可启动的 ability：本运行时只会启动 '
        + '__arkui_dom_startAbility 注册的那个类（不按 want.abilityName 路由，见 docs 已知限制）');
    }
    const entry = {
      name: (want.abilityName !== undefined && want.abilityName !== null) ? String(want.abilityName) : AbilityClass.name,
      role: 'child', parent, rootEl: null, windowEl: null, pagePath: null,
      ability: null, context: null, terminated: false,
      pending: onResult ? [onResult] : [],   // 先登记结果接收者：子 ability 可能在自己的
    };                                       // 生命周期里【同步】就 terminateSelfWithResult
    entry.windowEl = makeAbilityWindow(entry);
    abilityStack.push(entry);
    entry.context = makeAbilityContext(entry);
    const ability = new AbilityClass(entry.context);
    entry.ability = ability;
    abilityLog({ t: 'ability', name: entry.name, child: true });
    ability.onCreate(want, { launchReason: 1 });
    ability.onWindowStageCreate(makeWindowStage(entry));
    if (!entry.terminated) ability.onForeground();
    return entry;
  }

  // parameter 为空 = terminateSelf()：.d.ts 没规定"不带结果结束"时结果是什么 →
  // 本实现取 resultCode 0（见 docs 已知限制），并保证调用方【不会挂住】
  function terminateEntry(entry, parameter) {
    if (entry.terminated) return undefined;      // 幂等：重复 terminateSelf 不重复交结果
    entry.terminated = true;
    const result = (parameter && typeof parameter === 'object')
      ? { resultCode: Number(parameter.resultCode), want: parameter.want }
      : { resultCode: 0 };
    const ability = entry.ability;
    if (ability) {
      try {
        ability.onWindowStageDestroy();
      } finally {
        ability.onDestroy();
      }
    }
    closeAbilityWindow(entry);
    const i = abilityStack.indexOf(entry);
    if (i >= 0) abilityStack.splice(i, 1);
    for (const w of entry.pending.splice(0)) w.resolve(result);
    return undefined;
  }

  function makeAbilityContext(entry) {
    const appContext = {
      setColorMode(mode) { abilityLog({ t: 'setColorMode', mode }); },
      getApplicationContext() { return appContext; },
    };
    return {
      getApplicationContext: () => appContext,
      resourceManager: {
        getStringSync: (k) => k,
        getStringByNameSync: (k) => k,
      },
      startAbility(want, optionsOrCb, cbMaybe) {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : cbMaybe;
        return withCallback(Promise.resolve().then(() => { spawnChildAbility(want, entry, null); }), cb);
      },
      // Promise 形态与 AsyncCallback 形态（want, cb）/（want, options, cb）
      startAbilityForResult(want, optionsOrCb, cbMaybe) {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : cbMaybe;
        const started = new Promise((resolve, reject) => {
          spawnChildAbility(want, entry, { resolve, reject });
        });
        return withCallback(started, cb);
      },
      terminateSelf(cb) {
        return withCallback(Promise.resolve().then(() => terminateEntry(entry, null)), cb);
      },
      terminateSelfWithResult(parameter, cb) {
        return withCallback(Promise.resolve().then(() => terminateEntry(entry, parameter)), cb);
      },
    };
  }

  // 扮演"框架"启动 ability：onCreate → onWindowStageCreate(loadContent 真的渲染页面) → onForeground
  function startAbility(AbilityClass, opts) {
    const { rootEl, want = {} } = opts || {};
    const logs = (global.__arkui_dom_logs = global.__arkui_dom_logs || []);
    abilityClassForChildren = AbilityClass;

    const entry = {
      name: AbilityClass.name, role: 'root', parent: null, rootEl, windowEl: null,
      pagePath: null, ability: null, context: null, terminated: false, pending: [],
    };
    abilityStack.push(entry);
    const context = makeAbilityContext(entry);
    entry.context = context;

    const ability = new AbilityClass(context);
    entry.ability = ability;
    logs.push({ t: 'ability', name: AbilityClass.name });

    ability.onCreate(want, { launchReason: 1 });
    ability.onWindowStageCreate(makeWindowStage(entry));
    if (!entry.terminated) ability.onForeground();
    return { ability, logs, context, entry };
  }

  // ────────────────────── 枚举 / 订阅 / 路由 ──────────────────────
  // 取值刻意直接对齐 CSS 关键字，这样 applyAttr 里的"枚举类属性"可以原样透传
  const FontWeight = { Lighter: 100, Normal: 400, Regular: 400, Medium: 500, Bold: 700, Bolder: 900 };
  const VerticalAlign = { Top: 'top', Center: 'center', Bottom: 'bottom' };
  const HorizontalAlign = { Start: 'start', Center: 'center', End: 'end' };
  const FlexAlign = {
    Start: 'flex-start', Center: 'center', End: 'flex-end',
    SpaceBetween: 'space-between', SpaceAround: 'space-around', SpaceEvenly: 'space-evenly',
  };
  const TextAlign = { Start: 'start', Center: 'center', End: 'end', JUSTIFY: 'justify' };
  const ItemAlign = { Start: 'flex-start', Center: 'center', End: 'flex-end', Stretch: 'stretch', Baseline: 'baseline' };
  const Color = {
    White: 'white', Black: 'black', Red: 'red', Green: 'green', Blue: 'blue',
    Yellow: 'yellow', Gray: 'gray', Grey: 'gray', Orange: 'orange', Pink: 'pink',
    Brown: 'brown', Purple: 'purple', Transparent: 'transparent',
  };

  class SubscriberManager {
    constructor() { this._subs = new Map(); }
    static Get() {
      if (!global.__arkui_dom_sm) global.__arkui_dom_sm = new SubscriberManager();
      return global.__arkui_dom_sm;
    }
    delete(id) { this._subs.delete(id); }
  }

  const routes = new Map();
  function registerNamedRoute(factory, _name, info) {
    if (info && info.pagePath) routes.set(info.pagePath, factory);
  }

  // 页面栈：[{path, view}] —— ArkUI 的 router 会【保留页面实例】，back 回去时 @State 不丢
  //（这也是 onPageShow 与 aboutToAppear 存在的区别：前者每次显示都调，后者只首次）
  const pageStack = [];
  function currentRoot() { return rootNode; }

  function createPage(pagePath) {
    const factory = routes.get(pagePath);
    if (!factory) throw new Error('[arkui-dom] 未注册的路由: ' + pagePath);
    return factory();
  }

  function clearRoot() {
    const root = currentRoot();
    if (root) {
      root.textContent = '';
      purgeDetachedRecords();
      ViewStackProcessor.restore([]);
    }
  }

  function renderView(view) {
    ViewStackProcessor.restore([]);
    if (typeof view.aboutToAppear === 'function' && !view.__aboutToAppearDone) {
      view.__aboutToAppearDone = true;
      view.aboutToAppear();            // 首次出现前：产物里常在这里读 preferences 等
    } else if (typeof view.onPageShow === 'function') {
      view.onPageShow();               // 返回已存在页面：按 ArkUI 语义走 onPageShow
    }
    view.initialRender();
    syncAlignRules(rootNode);          // 兄弟锚点需要几何信息 → 首渲染后统一同步一遍
    syncDrawings(rootNode);            // 同理由：弧要等 .width/.height 生效才能按真实尺寸画
    syncAreas(rootNode);               // onAreaChange 同上：首渲染后派发一次
    syncNavChrome(rootNode);           // 标题栏/工具栏/分栏同理：首渲染后摆一次
    return view;
  }

  function loadRoute(pagePath, rootEl) {
    if (rootEl) rootNode = rootEl;
    const view = createPage(pagePath);
    pageStack.push({ path: pagePath, view });
    return renderView(view);
  }

  function navigateTo(pagePath) {
    clearRoot();
    return loadRoute(pagePath, currentRoot());
  }

  function navigateBack() {
    pageStack.pop();                                 // 当前页：实例丢弃
    const prev = pageStack[pageStack.length - 1];    // 上一页：复用【同一个实例】
    if (!prev) return null;
    clearRoot();
    return renderView(prev.view);                    // 状态因此保留
  }

  function pushRoute(pagePath) { return loadRoute(pagePath, currentRoot()); }

  // ────────────────────── 安装全局 ──────────────────────
  Object.assign(global, {
    ViewPU,
    ObservedPropertySimplePU, ObservedPropertyObjectPU,
    SynchedPropertySimpleOneWayPU, SynchedPropertySimpleTwoWayPU,
    // @ObjectLink 的状态类。产物里是 `new SynchedPropertyNesedObjectPU(...)` ——
    // 【自由变量】引用（不走 import），所以必须挂在 global 上。
    // 名字里的 `Nesed` 是官方拼写错误，不能改。
    SynchedPropertyNesedObjectPU,
    SubscriberManager, registerNamedRoute, ViewStackProcessor,
    Text, Button, Column, Row, Stack, List, ListItem, If, ForEach, LazyForEach, RelativeContainer,
    Tabs, TabContent, TabsController, BarPosition, BarMode,
    Swiper, SwiperController,
    Navigation, NavDestination, NavPathStack, NavigationMode,
    // R12 收口：标题栏/工具栏/分栏用到的枚举在产物里都是自由变量，必须挂 global
    NavigationTitleMode, NavBarPosition, TitleHeight,
    Progress, Gauge, DataPanel, Rating, ProgressStyle, ProgressType, DataPanelType,
    // R26：SVG 形状族。产物里 `Circle.create(...)` 这类同样是自由变量引用，必须挂 global
    Circle, Ellipse, Rect, Line, Path, Polygon, Polyline, Shape,
    // R27：输入类。ToggleType/SliderChangeMode 也是产物里的自由变量枚举
    Checkbox, Radio, Toggle, Slider, ToggleType, SliderChangeMode,
    // R28：信息展示类。BadgePosition 同为产物里的自由变量枚举
    Badge, Counter, Divider, Marquee, BadgePosition,
    // R29：弹出类
    Select, Menu, MenuItem,
    // R31：表层类。ctx 的两个类在产物里是 `new CanvasRenderingContext2D(...)` 自由变量引用
    Canvas, CanvasRenderingContext2D, RenderingContextSettings,
    // R32：表层类另一半。XComponentType 同为产物里的自由变量枚举
    XComponent, XComponentController, XComponentType,
    // R33：信息展示收官（QRCode 组件；其编码器由 runtime/vendor/qrcode-1.5.4.js 提供）
    QRCode,
    __Common__: _CommonWrapper,
    FontWeight, VerticalAlign, HorizontalAlign, FlexAlign, TextAlign, ItemAlign, Color,
    TextOverflow, Alignment, Scroller, Axis,
    // R22：显式动画。产物里是 `Context.animateTo(...)`（自由变量）→ 必须挂 Context 这个名字
    Context, Curve, PlayMode,
    // R22 收口：出现/消失过渡。产物里 `TransitionEffect.OPACITY`、`TransitionType.Insert` 都是
    // 自由变量（`TransitionEdge` 同理，供 `TransitionEffect.move(TransitionEdge.Left)` 用）
    TransitionType, TransitionEffect, TransitionEdge,
    // 过渡自省：登记了什么、每次出现/消失实际用了多久/哪个来源（effect / animateTo / default）
    __arkui_dom_transitions: transitionsDescribe,
    // R25：Nav 转场自省（push/pop 各一条运行记录 + 当前挂着的数目），测试轮询"滑完没有"用
    __arkui_dom_navTrans: navTransDescribe,
    // R23：手势。产物里是 `globalThis.Gesture.create(...)` + `PanGesture.create(...)` 这类
    // 自由变量引用（两层栈），所以这些名字都必须挂在 global 上。
    // R23 收口：`Gesture.create` 是【两参】的（第二参 mask），且优先级名字来自 ets-loader 的
    // 约定（Low/High/Parallel）—— 见 fixtures/pages/GestureGroupDemo.ts。
    Gesture, GestureGroup, GestureMode, GestureMask, PanDirection, SwipeDirection, GesturePriority,
    TapGesture: gestureBuilders.TapGesture, LongPressGesture: gestureBuilders.LongPressGesture,
    PanGesture: gestureBuilders.PanGesture, SwipeGesture: gestureBuilders.SwipeGesture,
    PinchGesture: gestureBuilders.PinchGesture, RotationGesture: gestureBuilders.RotationGesture,
    // 手势自省：证明手势真的挂到了哪个元素上（而不是只登记了一堆回调）＋ 分组登记 ＋ 仲裁结论
    __arkui_dom_gestures: (el) => {
      const st = el && el.__arkuiGestureState;
      return {
        types: gestureTypes(el),
        attachCount: gestureAttachCount,
        dragState: st ? st.gestures.length : 0,
        groups: gestureGroups(el),
        priority: st ? [...new Set(st.gestures.map((r) => (r.__priority === GesturePriority.High ? 'high'
          : (r.__priority === GesturePriority.Parallel ? 'parallel' : 'low'))))] : [],
        masks: st ? [...new Set(st.gestures.map((r) => GESTURE_MASK_NAME[r.__mask] || String(r.__mask)))] : [],
        arbClass: st ? st.arbClass : 'idle',
        arb: st ? gestureArbState(st) : 'idle',
      };
    },
    // 动画自省：证明"过渡真的挂在被重渲染的节点上、到点真的清掉了"，而不是只看某次 style 非空
    __arkui_dom_animations: () => ({
      active: animWindow ? { seq: animWindow.seq, duration: animWindow.duration, els: animWindow.els.length } : null,
      history: animHistory.map((h) => Object.assign({}, h)),
      onFinishCount,
    }),
    // DataPanel 自省：证明"段占比真按 values/max 算出来了"，而不只看某个背景串。
    __arkui_dom_dataPanel: (el) => {
      if (!el || el.__drawKind !== 'DataPanel') return null;
      const g = panelGeometry(el);
      return { type: el.__panelType, segments: g.segs, stops: g.stops, max: el.__panelMax };
    },
    // Rating 自省：区分"满星/半星"（渲染上只是个位数，机制上要能证明）
    __arkui_dom_rating: (el) => {
      if (!el || el.__drawKind !== 'Rating') return null;
      const { lit, full, half } = ratingLit(el);
      return {
        rating: el.__rating, stars: el.__starCount, stepSize: el.__step,
        indicator: !el.__interactive, lit, full, half,
      };
    },
    // 虚拟列表自省：证明"偏移是真的按实测高度算出来的"，而不只看某个 scrollTop 数字
    __arkui_dom_lazyInfo: (el) => {
      const st = el && lazyMeta.get(el);
      if (!st) return null;
      return {
        total: st.total,
        measured: st.heights.size,
        estItemH: st.estItemH,
        estAdvance: st.estItemH + st.gap,
        gap: st.gap,
        totalH: st.totalHOf ? st.totalHOf() : 0,
        window: st.window.slice(),
        passes: st.passes,
        offsetOf: (i) => (st.offsetOf ? st.offsetOf(i) : 0),
      };
    },
    // 自定义布局自省：证明"measure() 真的量了、layout() 真的摆了"，而不只看最终矩形
    __arkui_dom_customLayout: (el) => {
      const m = el && customLayoutMeta.get(el);
      return m ? JSON.parse(JSON.stringify(m)) : null;
    },
    __arkui_dom_syncAlignRules: syncAlignRules,
    __arkui_dom_layout_warnings: layoutWarnings,
    __arkui_dom_loadRoute: loadRoute,
    __arkui_dom_elmtRecords: elmtRecords,
    // 页面导航（router 垫片用）
    __arkui_dom_navigate: navigateTo,
    __arkui_dom_back: navigateBack,
    __arkui_dom_pushRoute: pushRoute,
    __arkui_dom_root: currentRoot,
    // ④ 平台别名层 / CommonJS 装载 / ability 启动
    __arkui_dom_defineOhosModule: defineOhosModule,
    __arkui_dom_require: ohosRequire,
    __arkui_dom_defineCommonJS: defineCommonJS,
    __arkui_dom_requireModule: requireModule,
    __arkui_dom_startAbility: startAbility,
    // R20：ability 栈自省。history 只存【已关闭】窗口的快照（含关窗前的 textContent）——
    // 那是"这个窗口真的渲染过页面"的证据，不是一句日志。
    __arkui_dom_abilityWindows: () => ({
      created: abilityWindowStats.created,
      closed: abilityWindowStats.closed,
      open: abilityStack.filter((e) => e.windowEl).length,
      depth: abilityStack.length,
      history: abilityWindowStats.history.map((h) => ({ ability: h.ability, page: h.page, text: h.text })),
    }),
    // 组件骨架（生成）
    __arkui_dom_registerGenerated: registerGeneratedComponents,
    __arkui_dom_componentNames: () => Object.keys(components).sort(),
    // 状态管理 v2 的装饰器表。刻意【不】把裸名挂 global：`Event` 与浏览器全局同名，
    // 挂上去会打断 `new Event(...)`（Scroller 与 test/lazy.html 都在用）。
    // 由 tools/extract.mjs 在产物里生成作用域内绑定，只绑实际用到的名字。
    __arkui_dom_decorators: decorators,
    // V1 深度观测自省：断言"@Observed 确实产出了可观测代理"，而不只看渲染结果。
    // （Meta 这类非 @Observed 的嵌套对象必须返回 false —— 这是负向断言的依据。）
    __arkui_dom_isObserved: (v) => !!observedCells.get(v),
    // Tabs 自省：证明"控制器真绑上了、标签真来自 tabBar、活动索引真的变了"，
    // 而不是只看"某个 div 的 display 恰好是 none"。
    __arkui_dom_tabsState: (el) => {
      const st = el && el.__tabsState;
      if (!st) return null;
      return {
        index: st.index,
        count: st.contents.length,
        labels: st.contents.map((c) => c.label),
        barPosition: st.barPosition,
        hasController: !!st.controller,
        controller: st.controller,
      };
    },
    // Swiper 自省：证明"控制器真绑上了、loop/autoPlay 真生效"，而不只看某个 div 的 display。
    __arkui_dom_swiperState: (el) => {
      const st = el && el.__swiperState;
      if (!st) return null;
      return {
        index: st.index,
        count: st.entries.length,
        loop: st.loop,
        autoPlay: st.autoPlay,
        interval: st.interval,
        hasController: !!st.controller,
        controller: st.controller,
      };
    },
    // Navigation 自省：证明"builder 真登记了、栈真在走动"，而不只看某个 div 的 display。
    __arkui_dom_navState: (el) => {
      const st = el && el.__navState;
      if (!st) return null;
      return {
        size: st.paths.length,
        names: st.paths.map((p) => p.name),
        params: st.paths.map((p) => p.param),
        hasBuilder: typeof st.builder === 'function',
        mode: st.mode,
        stack: st.stack,
      };
    },
    // R12 收口自省：标题栏 / 工具栏 / 分栏的【实际形态】（断言读这个，而不是读 style 字符串猜）
    __arkui_dom_navChrome: (el) => {
      if (!el) return null;
      const nav = el.__navState;
      if (nav) {
        const t = nav.titleEl;
        const txt = t ? t.querySelector('[data-arkui-nav-title-text]') : null;
        return {
          kind: 'Navigation',
          declaredMode: nav.mode,
          effectiveMode: nav.effectiveMode,
          titleKind: nav.titleSpec ? nav.titleSpec.kind : null,
          titleText: txt ? txt.textContent : null,
          main: t && t.querySelector('[data-arkui-nav-title-main]')
            ? t.querySelector('[data-arkui-nav-title-main]').textContent : null,
          sub: t && t.querySelector('[data-arkui-nav-title-sub]')
            ? t.querySelector('[data-arkui-nav-title-sub]').textContent : null,
          barHeight: nav.barHeight,
          barWidth: nav.effectiveMode === 'split' ? nav.barEl.offsetWidth : nav.barEl.offsetWidth,
          navBarWidth: nav.navBarWidthPx,
          navBarPosition: nav.navBarPosition === NavBarPosition.End ? 'End' : 'Start',
          titleBarDisplay: t ? t.style.display : null,
          hasBack: !!(t && t.querySelector('[data-arkui-nav-back]')),
          divider: nav.dividerEl ? nav.dividerEl.style.display !== 'none' : false,
          menus: t ? Array.from(t.querySelectorAll('[data-arkui-nav-menu]')).map((m) => m.textContent) : [],
        };
      }
      const d = el.__navDest;
      if (d) {
        const t = d.barEl;
        const tb = d.toolbarEl;
        return {
          kind: 'NavDestination',
          titleKind: d.titleSpec ? d.titleSpec.kind : null,
          titleText: t && t.querySelector('[data-arkui-nav-title-text]')
            ? t.querySelector('[data-arkui-nav-title-text]').textContent : null,
          barHeight: t ? t.offsetHeight : 0,
          titleBarDisplay: t ? t.style.display : null,
          hasBack: !!(t && t.querySelector('[data-arkui-nav-back]')),
          backIcon: t && t.querySelector('[data-arkui-nav-back]')
            ? t.querySelector('[data-arkui-nav-back]').getAttribute('data-arkui-nav-back-icon') : null,
          menus: t ? Array.from(t.querySelectorAll('[data-arkui-nav-menu]')).map((m) => m.textContent) : [],
          toolbar: tb ? Array.from(tb.querySelectorAll('[data-arkui-nav-toolbar-item]'))
            .map((m) => m.textContent) : [],
          toolbarDisplay: tb ? tb.style.display : null,
        };
      }
      return null;
    },
    // Guideline 自省：证明"参考线真的按 start/end 与轴向算出了位置"，而不只看子项恰好落在那儿。
    __arkui_dom_guideLines: (el) => {
      const m = el && el.__guideLineBoxes;
      if (!m) return null;
      const out = {};
      for (const k of Object.keys(m)) out[k] = { x: m[k].x, y: m[k].y, axis: m[k].axis };
      return out;
    },
    // 只读自省：供测试断言"装饰器确实在原型上装了访问器"，而不是只看渲染结果。
    // 注意 v2ProtoMeta 是 WeakMap（不可枚举，没有 keys()），所以只按类查询。
    __arkui_dom_v2Introspect: () => ({
      observedOf: (cls) => v2Collect({ __proto__: cls.prototype }, (info, out) => {
        for (const k of info.observed) out.push(k);
      }),
      monitorsOf: (cls) => v2Collect({ __proto__: cls.prototype }, (info, out) => {
        for (const [k, s] of info.monitors) out.push(`${k}→${[...s].join('|')}`);
      }),
      computedOf: (cls) => v2Collect({ __proto__: cls.prototype }, (info, out) => {
        for (const k of info.computed) out.push(k);
      }),
    }),
  });

  // 若 generated-components.js 已在前面加载，这里就把 149 个骨架装上
  registerGeneratedComponents();

  // 页面栈对外只暴露路径数组（内部存 {path, view} 是为了保留页面实例）
  Object.defineProperty(global, '__arkui_dom_pageStack', {
    get: () => pageStack.map((e) => e.path),
    configurable: true,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
