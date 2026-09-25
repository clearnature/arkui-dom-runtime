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
  /** @type {any} */ let currentNodeElmtId = null;    // 正在执行哪个 elmtId 的渲染（依赖追踪 + If/ForEach 归属）
  /** @type {any} */ let rootNode = null;
  /** @type {number} */ let viewSeq = 0;

  // 组件栈：官方命名，产物里的 ViewStackProcessor.StartGetAccessRecordingFor/Stop… 由它承载
  //（stack 不写 @type 会被推成 never[]，push 全红）
  const ViewStackProcessor = {
    /** @type {any[]} */ stack: [],
    /** @param {any} n */
    push(n) { this.stack.push(n); return n; },
    pop() { return this.stack.pop(); },
    top() { return this.stack.length ? this.stack[this.stack.length - 1] : null; },
    snapshot() { return this.stack.slice(); },
    /** @param {any[]} snap */
    restore(snap) { this.stack.length = 0; for (const n of snap) this.stack.push(n); },
    /** @param {number} elmtId */
    StartGetAccessRecordingFor(elmtId) { (/** @type {any} */ (this))._recording = elmtId; currentNodeElmtId = elmtId; },
    StopGetAccessRecording() { (/** @type {any} */ (this))._recording = null; },
  };

  const parentOfTop = () => {
    // 叶组件（编译产物缺 .pop()，坑 97）挂载后自动弹出，避免后续兄弟挂进叶内
    let top = ViewStackProcessor.top();
    while (top && top.__arkuiLeaf) { ViewStackProcessor.pop(); top = ViewStackProcessor.top(); }
    return top || rootNode;
  };

  /** @param {any} prop */
  function recordDep(prop) {
    if (currentNodeElmtId == null) return;
    /** @type {any} */ let s = propDeps.get(prop);
    if (!s) propDeps.set(prop, (s = new Set()));
    s.add(currentNodeElmtId);
  }

  /** @param {number} elmtId */
  function dropPropDeps(elmtId) {
    for (const [prop, s] of propDeps) s.delete(elmtId);
  }

  // ─────────────────── 状态管理（4 个类） ───────────────────
  // 共同协议：get / set / reset(可选) / resetSource(可选) / purgeDependencyOnElmtId / aboutToBeDeleted
  class ObservedPropertySimplePU {
    /** @param {any} value @param {any} owner @param {string} name */
    constructor(value, owner, name) {
      /** @type {any} */ this._value = value; /** @type {any} */ this._owner = owner;
      this._name = name; this._watches = /** @type {any[]} */ ([]);
    }
    get() { recordDep(this); return this._value; }
    /** @param {any} v */
    set(v) {
      if (Object.is(this._value, v)) return;
      this._value = v;
      markDependentsDirty(this);
      this._fireWatches();                       // @Watch：值变了才回调（同一属性名作为入参）
    }
    /** @param {any} v */
    reset(v) { this.set(v); }
    /** @param {any} cb */
    watch(cb) { this._watches.push(cb); }        // declareWatch 挂载点
    _fireWatches() { for (const cb of this._watches) cb(this._name); }
    /** @param {number} elmtId */
    purgeDependencyOnElmtId(elmtId) { const s = propDeps.get(this); if (s) s.delete(elmtId); }
    aboutToBeDeleted() { propDeps.delete(this); }
  }

  // @State 用于对象/数组类型
  class ObservedPropertyObjectPU {
    /** @param {any} value @param {any} owner @param {string} name */
    constructor(value, owner, name) {
      /** @type {any} */ this._value = value; /** @type {any} */ this._owner = owner;
      this._name = name; this._watches = /** @type {any[]} */ ([]);
    }
    get() { recordDep(this); return this._value; }
    /** @param {any} v */
    set(v) {
      if (Object.is(this._value, v)) return;
      this._value = v;
      markDependentsDirty(this);
      this._fireWatches();
    }
    /** @param {any} v */
    reset(v) { this.set(v); }
    /** @param {any} cb */
    watch(cb) { this._watches.push(cb); }
    _fireWatches() { for (const cb of this._watches) cb(this._name); }
    /** @param {number} elmtId */
    purgeDependencyOnElmtId(elmtId) { const s = propDeps.get(this); if (s) s.delete(elmtId); }
    aboutToBeDeleted() { propDeps.delete(this); }
  }

  // @Prop：单向。父通过 updateStateVarsOfChildByElmtId → reset(新值)
  class SynchedPropertySimpleOneWayPU {
    /** @param {any} value @param {any} owner @param {string} name */
    constructor(value, owner, name) {
      /** @type {any} */ this._value = value; /** @type {any} */ this._owner = owner;
      this._name = name; /** @type {Set<number>} */ this._deps = new Set();
    }
    get() {
      if (currentNodeElmtId != null) this._deps.add(currentNodeElmtId);
      return this._value;
    }
    /** @param {any} v */
    set(v) { this.reset(v); }
    /** @param {any} v */
    reset(v) {
      if (Object.is(this._value, v)) return;
      this._value = v;
      for (const id of [...this._deps]) markDirty(id);
    }
    /** @param {number} elmtId */
    purgeDependencyOnElmtId(elmtId) { this._deps.delete(elmtId); }
    aboutToBeDeleted() { this._deps.clear(); }
  }

  // @Link：双向。父把自己的状态实例传进来，双方共享同一数据源
  class SynchedPropertySimpleTwoWayPU {
    /** @param {any} source @param {any} owner @param {string} name */
    constructor(source, owner, name) {
      /** @type {any} */ this._source = source; /** @type {any} */ this._owner = owner;
      this._name = name;
    }
    get() { return this._source.get(); }        // 依赖记在 source 上（父 set 能触发子的 elmtId）
    /** @param {any} v */
    set(v) { this._source.set(v); }             // 写回 source（双向）
    /** @param {any} source */
    resetSource(source) { this._source = source; }
    /** @param {number} elmtId */
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

  /** @param {any} target */
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
  /** @param {any} Base */
  function Observed(Base) {
    /** @type {any} */ const ObservedClass = class extends Base {
      /** @param {...any} args */
      constructor(...args) {
        super(...args);
        return makeObservedProxy(this);
      }
    };
    // 保持 name 与静态成员可读（排查时 `Item.name` 不该变成 ''）
    try { Object.defineProperty(ObservedClass, 'name', { value: Base.name, configurable: true }); } catch (_) {}
    return ObservedClass;
  }

  /** @param {any} obj */
  function observedCellOf(obj) {
    if (obj === null || typeof obj !== 'object') return null;
    return observedCells.get(obj) || null;
  }

  // @ObjectLink：子组件持有父侧 @Observed 实例的【引用】，只订阅、不复制值。
  class SynchedPropertyNesedObjectPU {
    /** @param {any} source @param {any} owner @param {string} name */
    constructor(source, owner, name) {
      /** @type {any} */ this._owner = owner; this._name = name; /** @type {any} */ this._source = undefined;
      /** @type {any} */ this._cell = null;
      this.set(source);
    }
    get() {
      if (this._cell) recordDep(this._cell);   // 读对象 = 依赖它的字段变更
      return this._source;
    }
    /** @param {any} source */
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
    /** @param {number} elmtId */
    purgeDependencyOnElmtId(elmtId) {
      if (this._cell) { const s = propDeps.get(this._cell); if (s) s.delete(elmtId); }
    }
    aboutToBeDeleted() { this._source = undefined; this._cell = null; }
  }

  // ─────────────────── 脏标记 / 批量重渲染 ───────────────────
  const dirty = new Set();
  let flushScheduled = false;

  /** @param {any} prop */
  function markDependentsDirty(prop) {
    const s = propDeps.get(prop);
    if (s) for (const id of [...s]) markDirty(id);
  }
  /** @param {number} elmtId */
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

  /** @param {number} elmtId */
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
  /** @type {Record<string, number>} */
  const Curve = {};
  CURVE_NAMES.forEach((n, i) => { Curve[n] = i; });
  // ArkUI 的曲线名 → CSS 等价物（名字对得上的直接透传）
  /** @type {Record<string, string>} */
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
    /** @param {string} kind @param {any} value */
    constructor(kind, value) {
      /** @type {string} */ this.kind = kind; /** @type {any} */ this.value = value;
      /** @type {any} */ this.anim = undefined;
      /** @type {any} */ this.next = null;
    }
    static get IDENTITY() { return new TransitionEffect('identity', undefined); }
    static get OPACITY() { return new TransitionEffect('opacity', 0); }
    static get SLIDE() { return new TransitionEffect('slide', undefined); }
    static get SLIDE_SWITCH() { return new TransitionEffect('slideSwitch', undefined); }
    /** @param {any} o */
    static translate(o) { return new TransitionEffect('translate', o); }
    /** @param {any} o */
    static rotate(o) { return new TransitionEffect('rotate', o); }
    /** @param {any} o */
    static scale(o) { return new TransitionEffect('scale', o); }
    /** @param {any} a */
    static opacity(a) { return new TransitionEffect('opacity', a); }
    /** @param {any} e */
    static move(e) { return new TransitionEffect('move', e); }
    /** @param {any} appear @param {any} disappear */
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
    /** @param {any} p */
    animation(p) { const c = this._deepCopy(); c.anim = p; return c; }
    /** @param {any} e */
    combine(e) {
      const head = this._deepCopy();
      let tail = head;
      while (tail.next) tail = tail.next;
      for (const n of _effectChain(e)) { tail.next = n._deepCopy(); tail = tail.next; }
      return head;
    }
  }
  /** @param {any} e @returns {any[]} */
  function _effectChain(e) { const out = []; for (let t = e; t; t = t.next) out.push(t); return out; }
  /** @param {any} e */
  function _effectAnim(e) { for (const n of _effectChain(e)) if (n.anim) return n.anim; return undefined; }
  /** @param {any} e */
  function _effectSummary(e) { return _effectChain(e).map((n) => n.kind).join('+'); }

  /** @type {any[]} */
  const transitionRegistered = [];         // 登记过的 transition（自省用）
  /** @type {any[]} */
  const transitionRuns = [];               // 每次真的跑过的出现/消失（自省用）
  let transitionSeq = 0;
  let transitionRunSeq = 0;

  // 偏离态 → CSS（ArkUI 的裸数字 = vp，这里 1vp=1px，与项目其它地方一致）
  /** @param {any} effectOrOptions @param {boolean} isEffect */
  function _offStyleOf(effectOrOptions, isEffect) {
    // @type 档位：opacity 是 number|undefined（初值 undefined 是"未提及"语义，后面会赋数字）、
    // 两个数组不写 @type 会被推成 never[]，push 全红
    const out = /** @type {{opacity: number|undefined, transforms: string[], warnings: string[]}} */
      ({ opacity: undefined, transforms: [], warnings: [] });
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
      if (kind === 'slide') { out.transforms.push('translate(-100%, 0)'); continue; }        // 推断：从左滑入
      if (kind === 'slideSwitch') {
        // R43 照真机参数（rosen_transition_effect.cpp：SLIDE_SWITCH_SCALE=0.85；真机自带动效
        // curve(0.24,0,0.5,1)/600ms 是渲染层参数，DOM 侧透明度仍取 0、时长走外层窗口）
        out.transforms.push('scale(0.85)');
        if (out.opacity === undefined) out.opacity = 0;
        out.warnings.push('TransitionEffect.SLIDE_SWITCH 参数照真机近似：scale(0.85)+opacity 0'
          + '（rosen_transition_effect.cpp SLIDE_SWITCH_SCALE=0.85；.d.ts 未给参数）');
        continue;
      }
      out.warnings.push(`TransitionEffect 的 ${kind} 未实现（本次不动这一项）`);
    }
    return out;
  }
  const TransitionEdge = { Top: 0, Bottom: 1, Left: 2, Right: 3 };
  // 自省用的"偏离态"文本（断言据此核对 translate/scale/opacity 真的被算进去了）
  /** @param {any} off */
  function _offText(off) {
    /** @type {string[]} */
    const parts = [];
    if (off.opacity !== undefined) parts.push('opacity=' + off.opacity);
    if (off.transforms.length) parts.push('transform=' + off.transforms.join(' '));
    return parts.join(' ');
  }

  // 把一次 transition 解析成"某方向要不要动、怎么动、多久"
  /** @param {any} el @param {string} dir */
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
  /** @param {HTMLElement} el @param {any} run */
  function _transitionWitness(el, run) {         // 与 animateTo 一样：transitionend 只当"见证"，不当收口依据
    const fn = () => { run.sawTransitionEnd = true; };
    el.addEventListener('transitionend', fn, { once: true });
    return () => el.removeEventListener('transitionend', fn);
  }
  /** @param {any} el @param {any} run @param {any} plan @param {() => void} cleanup */
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
  /** @param {any} el @param {any} plan */
  function runEnterTransition(el, plan) {
    // @type 档位：endedBy 初值 null 终值 string；不写会推成 null 型，赋 'timer'/'transitionend' 全红
    const run = /** @type {{seq: number, dir: string, id: any, target: string, duration: number,
          delay: number, curve: string, curveCss: string, source: string, offText: string,
          endedBy: string|null, sawTransitionEnd: boolean}} */ ({
      seq: ++transitionRunSeq, dir: 'enter', id: plan.identifier, target: 'identity',
      duration: plan.duration, delay: plan.delay, curve: plan.curveName, curveCss: plan.curveCss, source: plan.source,
      offText: _offText(plan.off), endedBy: null, sawTransitionEnd: false,
    });
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
  /** @param {any} el @param {any} plan */
  function runExitTransition(el, plan) {
    // @type 同 runEnterTransition 的 run（endedBy 初值 null 终值 string）
    const run = /** @type {{seq: number, dir: string, id: any, target: string, duration: number,
          delay: number, curve: string, curveCss: string, source: string, offText: string,
          endedBy: string|null, sawTransitionEnd: boolean}} */ ({
      seq: ++transitionRunSeq, dir: 'exit', id: plan.identifier, target: 'off',
      duration: plan.duration, delay: plan.delay, curve: plan.curveName, curveCss: plan.curveCss, source: plan.source,
      offText: _offText(plan.off), endedBy: null, sawTransitionEnd: false,
    });
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
  /** @param {HTMLElement} container */
  function detachChildren(container) {
    if (!container) return;
    for (const child of [...container.children]) {
      const plan = transitionPlanFor(child, 'exit');
      if (plan && !plan.skip) runExitTransition(child, plan);
      else child.remove();
    }
  }

  // 登记：属性管线把 `.transition(...)` 的实参原样交过来
  /** @param {any} node @param {any} value @param {any} onFinish */
  function registerTransition(node, value, onFinish) {
    if (!node) return;
    // @type 档位：spec 的字段在两个分支里形状不同，且 onFinish/seq 是后挂的动态字段
    /** @type {{isEffect: boolean, payload: any, type: any, summary: string, onFinish?: any, seq?: number} | undefined} */
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

  /** @type {any} */ let animWindow = null;              // 当前开着的动画窗口（rerenderElmt 会往里收集节点）
  /** @type {any[]} */
  const animHistory = [];
  let animSeq = 0;
  let onFinishCount = 0;

  /** @param {any} curve */
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
  /** @param {any} curve */
  function animCurveName(curve) {
    if (typeof curve === 'number' && CURVE_NAMES[curve] !== undefined) return CURVE_NAMES[curve];
    if (typeof curve === 'string' && curve) return curve;
    if (curve && typeof curve === 'object') return 'ICurve';
    return 'EaseInOut(默认)';
  }

  /** @param {any} win */
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

  /** @param {any} win @param {string} how */
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

  /** @param {any} param @param {any} fn @param {string} api */
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

    // @type 档位：endedBy 初值 null、终值 string（'duration-0'/'timer'/…），不写会推成 null 型
    const rec = /** @type {{seq: number, api: string, duration: number, delay: number,
          curve: string, curveCss: string, els: number, endedBy: string|null,
          sawTransitionEnd: boolean}} */
      ({
      seq: ++animSeq, api, duration, delay,
      curve: animCurveName(p.curve), curveCss: animCurveCss(p.curve),
      els: 0, endedBy: null, sawTransitionEnd: false,
    });
    animHistory.push(rec);

    if (!(duration > 0)) {
      fn();                                    // duration:0 → 不进动画
      flush();
      rec.endedBy = 'duration-0';
      animFireFinish({ onFinish: p.onFinish });
      return undefined;
    }

    // @type 档位：els/listeners 不写会被推成 never[]；onFinish/timer 是后挂字段
    const win = /** @type {{seq: number, api: string, duration: number, delay: number,
          onFinish: any, rec: any, els: any[], listeners: any[],
          sawTransitionEnd: boolean, done: boolean, timer?: any}} */
      ({ seq: rec.seq, api, duration, delay, onFinish: p.onFinish, rec,
      els: [], listeners: [], sawTransitionEnd: false, done: false,
    });
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
      const onEnd = (/** @type {Event} */ ev) => {
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
    animateTo: (/** @type {any} */ param, /** @type {any} */ fn) => runExplicitAnimation(param, fn, 'animateTo'),
    // animateToImmediately 与 animateTo 在 DOM 里等价：CSS transition 本来就是"下一帧开始"。
    // 真机差异（不等 vsync 立即投递）在 CSS 里没有对应物，见 docs 已知限制。
    animateToImmediately: (/** @type {any} */ param, /** @type {any} */ fn) => runExplicitAnimation(param, fn, 'animateToImmediately'),
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

  /** @type {any[]} */                   // Gesture.create/pop 的作用域栈
  const gestureScopes = [];
  /** @type {any[]} */                   // 正在构建的手势记录栈（各手势 + 手势组的 create/pop）
  const gestureBuild = [];
  const TAP_SLOP_PX = 10;                // 超过这个位移就不算 tap（ArkUI 内部也有类似的容差）
  const TAP_WINDOW_MS = 300;             // 连续点击的归组窗口

  /** @param {any} [extra] */
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

  /** @param {any[]} records */
  function gestureArbClass(records) {
    let high = false, par = false, block = false;
    for (const r of records) {
      if (r.__mask === GestureMask.IgnoreInternal) block = true;
      if (r.__priority === GesturePriority.High) high = true;
      if (r.__priority === GesturePriority.Parallel) par = true;
    }
    return block ? ARB_BLOCK : (high ? ARB_HIGH : (par ? ARB_PARALLEL : ARB_LOW));
  }

  /** @param {HTMLElement} el @param {any} st @param {PointerEvent} ev */
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
  /** @param {any} st */
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
  /** @param {any} st @param {PointerEvent} ev */
  function isSessionTail(st, ev) {
    const s = gestureSessions.get(ev.pointerId);
    return !s || s.chain[s.chain.length - 1] === st.el;
  }

  // "识别完成"对应的回调名（Exclusive 靠它判先后、Sequence 靠它推进阶段）
  /** @type {Record<string, string>} */
  const GESTURE_RECOG_KIND = {
    tap: 'onAction', longPress: 'onAction', pan: 'onActionStart',
    pinch: 'onActionStart', rotation: 'onActionStart', swipe: 'onAction',
  };
  const GESTURE_MODE_NAME = ['Sequence', 'Parallel', 'Exclusive'];
  const GESTURE_MASK_NAME = ['Normal', 'IgnoreInternal'];

  /** @param {any[]} records @param {any[]=} [out] @returns {any[]} */
  function flattenGestures(records, out) {
    const acc = out || [];
    for (const r of records) {
      if (r && r.__isGroup) flattenGestures(r.gestures, acc);
      else if (r) acc.push(r);
    }
    return acc;
  }

  /** @param {any} g */
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
  /** @param {any} st @param {boolean} cancelled */
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
  /** @param {any} st @param {any} rec @param {string} kind @param {PointerEvent|ReturnType<typeof gestureEvent>} ev */
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

  /** @param {any} rec @param {number} dx @param {number} dy */
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
  /** @param {any} rec @param {number} dx @param {number} dy */
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
  /** @param {{x: number, y: number}} p @param {{x: number, y: number}} q */
  const lineDeg = (p, q) => Math.atan2(q.y - p.y, q.x - p.x) * RAD2DEG;
  /** @param {number} a */
  const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  /** @param {any} startLine @param {{x: number, y: number}} p0 @param {{x: number, y: number}} p1 */
  function rotationDeltaDeg(startLine, p0, p1) {
    if (!startLine) return 0;
    return norm180(lineDeg(p0, p1) - lineDeg({ x: startLine.x1, y: startLine.y1 },
      { x: startLine.x2, y: startLine.y2 }));
  }

  /** @param {any} el */
  function detachGestures(el) {
    const st = el && el.__arkuiGestureState;
    if (!st) return;
    for (const [k, fn] of st.listeners) el.removeEventListener(k, fn);
    for (const rs of st.longPress) if (rs.timer) clearTimeout(rs.timer);
    if (st.tapTimer) clearTimeout(st.tapTimer);
    el.__arkuiGestureState = null;
  }
  /** @param {any} el @returns {any[]} */
  function gestureTypes(el) {
    const st = el && el.__arkuiGestureState;
    return st ? st.gestures.map((/** @type {any} */ g) => (g.__isGroup ? 'group' : g.type)) : [];
  }
  /** @param {any} el @returns {any[]} */
  function gestureGroups(el) {
    const st = el && el.__arkuiGestureState;
    if (!st) return [];
    return st.gestures.filter((/** @type {any} */ g) => g.__isGroup).map((/** @type {any} */ g) => ({
      mode: GESTURE_MODE_NAME[g.mode] || String(g.mode),
      members: flattenGestures(g.gestures).map((/** @type {any} */ x) => x.type),
    }));
  }

  /** @param {HTMLElement} el @param {any[]} gestures @returns {any} */
  function attachGestures(el, gestures) {
    detachGestures(el);
    // @type 档位：listeners/longPress 不写会推成 never[]，push 全红；tapTimer null↔number 摆动；
    // arbClass 等字段是挂上后才有的 → 整袋 any（识别器状态的形状本来就是动态的）
    const st = /** @type {any} */ ({
      el,
      gestures: gestures.slice(), listeners: [], longPress: [],
      ptrs: new Map(), recState: new Map(), tapCount: 0, tapTimer: null,
    });
    st.arbClass = gestureArbClass(st.gestures);
    // 识别循环一律跑【摊平后】的手势表：组只是登记层，识别与回调仍在元素这一层做
    const flat = flattenGestures(st.gestures);
    el.__arkuiGestureState = st;
    /** @param {string} k @param {(ev: PointerEvent) => void} fn */
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

    /** @param {PointerEvent} ev */
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
          const rs = /** @type {any} */ ({ rec, timer: null, fired: 0, dur });
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
            const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
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
            const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
            startLine = { x1: arr[0].x, y1: arr[0].y, x2: arr[1].x, y2: arr[1].y };
          }
          st.recState.set(rec, { started: false, startLine });
        }
      }
    };

    /** @param {PointerEvent} ev */
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
          const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
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
          const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
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

    /** @param {PointerEvent} ev */
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

    /** @param {PointerEvent} ev */
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
  /** @type {Record<string, string>} */
  const GESTURE_TYPES = {
    TapGesture: 'tap', LongPressGesture: 'longPress', PanGesture: 'pan',
    SwipeGesture: 'swipe', PinchGesture: 'pinch', RotationGesture: 'rotation',
  };
  // 收一个手势/手势组：归入【最近一层容器】——有手势组就进组，否则进当前手势作用域。
  // 产物里组是嵌套的（组内 `XxxGesture.pop()` 之后才 `GestureGroup.pop()`），
  // 所以要从栈顶往下找最近的组，而不是只看栈顶。
  /** @param {any} rec */
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

  /** @param {string} name */
  function makeGestureBuilder(name) {
    const type = GESTURE_TYPES[name];
    const impl = {
      /** @param {any} params */
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
      get(/** @type {any} */ target, key) {
        if (key in target) return target[key];
        if (typeof key === 'symbol') return undefined;
        let fn = target['__' + String(key)];
        if (!fn) {
          /** @param {any} cb */
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
    /** @param {any} mode */
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
    get(/** @type {any} */ target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      let fn = target['__' + String(key)];
      if (!fn) {
        /** @param {any} cb */
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
  /** @type {Record<string, any>} */
  const gestureBuilders = {};
  for (const name of Object.keys(GESTURE_TYPES)) gestureBuilders[name] = makeGestureBuilder(name);

  const Gesture = {
    // 产物是两参形式：Gesture.create(GesturePriority.Low|High|Parallel[, GestureMask.Xxx])
    /** @param {any} [priority] @param {any=} [mask] */
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
        layoutWarnings.push(`Gesture.pop() 时组件栈是空的 —— 手势（${scope.list.map((/** @type {any} */ g) => g.type).join(',')}）无处可挂`);
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
  /** @param {any} el @param {any[]} records */
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
    /** @param {any} parent @param {any} localStorage @param {any} elmtId @param {any=} [extraInfo] */
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

    /** @param {any} updateFunc @param {any} componentClassOrName */
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
    /** @param {number} elmtId @param {any} params */
    updateStateVarsOfChildByElmtId(elmtId, params) {
      const rec = elmtRecords.get(elmtId);
      if (rec && rec.childView && typeof rec.childView.updateStateVars === 'function') {
        rec.childView.updateStateVars(params);
      }
    }

    // ── @Provide / @Consume（按名字沿视图链解析） ──
    /** @param {string} name @param {any} prop @param {any} allowOverride */
    addProvidedVar(name, prop, allowOverride) {
      if (!this.__providedVars) this.__providedVars = new Map();
      if (this.__providedVars.has(name) && !allowOverride) {
        layoutWarnings.push(`@Provide('${name}') 重复声明且 allowOverride=false`);
      }
      this.__providedVars.set(name, prop);
    }
    /** @param {string} name */
    _findProvided(name) {
      let v = this.__parent;                 // 从父视图向上找（@Consume 必须位于后代）
      while (v) {
        if (v.__providedVars && v.__providedVars.has(name)) return v.__providedVars.get(name);
        v = v.__parent;
      }
      return null;
    }
    /** @param {string} name @param {string} propName */
    initializeConsume(name, propName) {
      const found = this._findProvided(name);
      if (found) return found;               // 关键：返回的【就是提供者的属性实例】→ 依赖追踪天然生效
      layoutWarnings.push(`@Consume('${name}') 未找到祖先 @Provide，退化为本地占位属性`);
      const fallback = new ObservedPropertySimplePU(undefined, this, propName);
      (/** @type {any} */ (this))['__' + propName] = fallback;
      return fallback;
    }
    /** @param {string} name @param {string} propName */
    reInitializeConsume__Internal(name, propName) {
      const found = this._findProvided(name);
      if (found) (/** @type {any} */ (this))['__' + propName] = found;
      else layoutWarnings.push(`@Consume('${name}') 重绑定时未找到祖先 @Provide`);
    }

    // ── @Watch（把回调挂到属性实例上，set 时触发） ──
    /** @param {string} propName @param {any} cb */
    declareWatch(propName, cb) {
      const prop = (/** @type {any} */ (this))['__' + propName];
      if (prop && typeof prop.watch === 'function') prop.watch(cb.bind(this));
      else layoutWarnings.push(`@Watch('${propName}') 未找到属性实例，回调未挂载`);
    }

    // if/else：同一 elmtId 下按 branchId 换子树，切换时销毁旧分支
    /** @param {number} branchId @param {() => void} branchFunc */
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
    /** @param {number} elmtId @param {any[]} arr @param {any} itemGenFunc @param {any} keyGenFunc */
    forEachUpdateFunction(elmtId, arr, itemGenFunc, keyGenFunc) {
      const rec = elmtRecords.get(elmtId);
      if (!rec || !rec.node) return;
      const snap = (arr || []).slice();
      const changed = !rec.forEachSnapshot
        || rec.forEachSnapshot.length !== snap.length
        || rec.forEachSnapshot.some((/** @type {any} */ v, /** @type {number} */ i) => !Object.is(v, snap[i]));
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
    /** @param {any} childView */
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
  /** @param {any} v */
  const resolveResource = (v) => {
    if (v && typeof v === 'object' && 'id' in v && 'type' in v) {
      const table = (/** @type {any} */ (global)).__arkui_dom_resources || {};
      return table[v.id] !== undefined ? table[v.id] : DEFAULT_RESOURCES[v.type];
    }
    return v;
  };
  /** @type {Record<string, any>} */ const DEFAULT_RESOURCES = { 10002: 16, 10003: '' };
  /** @param {any} v */
  const toCssSize = (v) => {
    const r = resolveResource(v);
    return typeof r === 'number' ? r + 'px' : String(r);
  };

  /** @type {Record<string, string>} */
  const cssPropSize = {
    fontSize: 'fontSize', fontColor: 'color', backgroundColor: 'backgroundColor',
    width: 'width', height: 'height', borderWidth: 'borderWidth',
    borderRadius: 'borderRadius', padding: 'padding', margin: 'margin',
    letterSpacing: 'letterSpacing', lineHeight: 'lineHeight',
    // Grid 的双向间距（Length → px）。缺这两个时它们只会落进 data-*，版式静默错。
    columnsGap: 'columnGap', rowsGap: 'rowGap',
  };
  /** @type {Record<string, string>} */
  const cssPropRaw = {
    fontWeight: 'fontWeight', opacity: 'opacity', zIndex: 'zIndex',
    flexGrow: 'flexGrow', flexShrink: 'flexShrink', aspectRatio: 'aspectRatio',
  };
  // 枚举类属性：取值为枚举（FlexAlign/TextAlign/HorizontalAlign…），枚举值本身就是 CSS 值，原样透传
  /** @type {Record<string, string>} */
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
  /** @param {any} v */
  const normalizeTrackList = (v) => String(v === undefined || v === null ? '' : v)
    .replace(/(\d+(?:\.\d+)?)(vp|fp|lpx)\b/g, '$1px')
    .replace(/(?<![\w.%-])(\d+(?:\.\d+)?)(?![\w.%-])/g, '$1px');
  const GRID_TRACK_PROPS = { columnsTemplate: 'gridTemplateColumns', rowsTemplate: 'gridTemplateRows' };
  // Grid 的"无模板"布局参数：cellLength/maxCount/minCount/layoutDirection 决定轨道如何划分，
  // 本实现不做 —— 静默忽略会让页面版式错得看不出原因，所以显式记诊断（值仍落 data-*）。
  const GRID_UNSUPPORTED = new Set(['cellLength', 'maxCount', 'minCount', 'layoutDirection']);

  // 切多面板：只显示 active 那一项（Tabs 与后续 Swiper 共用）
  /** @param {any} entries @param {number} active */
  const onlyOneVisible = (entries, active) => {
    entries.forEach((/** @type {any} */ e, /** @type {number} */ k) => { e.el.style.display = k === active ? 'block' : 'none'; });
  };


  // create({ space: n }) —— ArkUI 容器的 space 语义映射为 flex gap
  /** @param {any} node @param {any} args */
  function applyCreateArgs(node, args) {
    const a = args && args[0];
    if (!a || typeof a !== 'object') return;
    if (typeof a.space === 'number') node.style.gap = a.space + 'px';
    // Stack({alignContent}) 是【create 选项】而非属性 setter —— 这条路径容易漏（踩过）
    if (a.alignContent !== undefined) applyAlignment(node, a.alignContent);
    // Flex({direction/wrap/justifyContent/alignItems}) 是【create 选项】（R36 实测）——
    // 与 CSS 同名对齐（取值层已对齐 CSS 关键字，透传即可）
    if (node.__arkuiComp === 'Flex') {
      if (a.direction !== undefined) node.style.flexDirection = String(resolveResource(a.direction));
      if (a.wrap !== undefined) node.style.flexWrap = String(resolveResource(a.wrap));
      if (a.justifyContent !== undefined) node.style.justifyContent = String(resolveResource(a.justifyContent));
      if (a.alignItems !== undefined) node.style.alignItems = String(resolveResource(a.alignItems));
    }
  }

  // 生成组件的"原生控件参数"映射：把 create({...}) 的常用键落到真实控件属性上
  /** @param {any} el @param {any} args @param {any} meta */
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
  /** @type {any[]} */
  const layoutWarnings = ((/** @type {any} */ (global)).__arkui_dom_layout_warnings = []);
  // 锚点解析会在不动点迭代里跑多趟，同一问题只该留一条痕（否则一条缺失锚点会变成 12 条）
  /** @param {string} msg */
  const warnOnce = (msg) => { if (!layoutWarnings.includes(msg)) layoutWarnings.push(msg); };

  // Guideline 的方向（轴）。两者极易记反，以 .d.ts 的 JSDoc 为准：
  //   Axis.Vertical   → 【竖线】→ 只能锚子组件的【水平】位置（position.start 是距【左】边的距离）
  //   Axis.Horizontal → 【横线】→ 只能锚子组件的【垂直】位置（position.start 是距【上】边的距离）
  //   错轴使用 → 值恒为 0（JSDoc："the value is 0 when it is used as the anchor in the …"）
  // enums.d.ts 里枚举顺序是 Vertical=0 / Horizontal=1，所以也接受数字。
  const Axis = { Vertical: 'vertical', Horizontal: 'horizontal' };
  /** @param {any} v */
  const isHorizontalAxis = (v) => v === 'horizontal' || v === 1;

  // 注意：ArkUI 有两套对齐词汇 —— 水平是 start/end 或 left/right，垂直是 top/bottom。
  // 两者都映射到 0/0.5/1 的分数，同时 dx/dy 的判定也要认这两种写法（踩过的坑）。
  /** @type {Record<string, number>} */
  const ALIGN_FRAC = { start: 0, top: 0, center: 0.5, end: 1, bottom: 1 };
  /** @param {any} a */
  const isStart = (a) => a === 'start' || a === 'top';
  /** @param {any} a */
  const isEnd = (a) => a === 'end' || a === 'bottom';
  /** @param {number} base @param {number} size @param {any} align */
  const edgeAt = (base, size, align) => base + size * (ALIGN_FRAC[align] !== undefined ? ALIGN_FRAC[align] : 0);
  // 键 → 轴。LocalizedAlignRuleOptions 用 start/end/middle（水平）+ top/bottom/center（垂直）；
  // 老版 AlignRuleOption 用 left/right/middle + top/bottom/center。两套都认（否则 start/end 会漏支持）。
  const H_KEYS = new Set(['left', 'start', 'middle', 'right', 'end']);

  // Dimension → px：number 是 vp，字符串可带 %（'30%' 按容器对应尺寸换算）
  /** @param {any} v @param {number} total */
  function dimOf(v, total) {
    if (v === undefined || v === null) return 0;
    const s = String(resolveResource(v));
    if (s.endsWith('%')) return (parseFloat(s) / 100) * total;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  // 容器里所有 Guideline 的位置（相对容器）。只依赖容器尺寸，所以每轮 sync 重算一次即可。
  // ⚠️ 本 SDK 的 GuideLinePosition 只有 start/end（没有旧版的 percent）。
  /** @param {any} container */
  function applyGuideLines(container) {
    const specs = container.__guideLines;
    if (!specs) return;
    const pw = container.offsetWidth, ph = container.offsetHeight;
    /** @type {Record<string, any>} */
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
  /** @param {HTMLElement} parent @param {any} anchor @param {string} key @param {number} pw @param {number} ph */
  function alignBoxOf(parent, anchor, key, pw, ph) {
    if (!anchor || anchor === '__container__') return { x: 0, y: 0, w: pw, h: ph };
    const g = /** @type {any} */ (parent.__guideLineBoxes && parent.__guideLineBoxes[anchor]);
    if (g) {
      const needAxis = H_KEYS.has(key) ? 'v' : 'h';   // 要定水平位置 → 需要【竖线】
      if (g.axis !== needAxis) return { x: 0, y: 0, w: 0, h: 0 };   // 错轴：值恒为 0
      return g;
    }
    const sel = (global.CSS && CSS.escape) ? CSS.escape(anchor) : anchor;
    const sib = /** @type {HTMLElement|null} */ (parent.querySelector('#' + sel));
    if (!sib) return null;
    return { x: sib.offsetLeft, y: sib.offsetTop, w: sib.offsetWidth, h: sib.offsetHeight };
  }

  /** @param {HTMLElement} el */
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
  /** @param {HTMLElement} el @param {any} bias @param {number} pw @param {number} ph
   *  @param {number|null} leftVal @param {number|null} rightVal @param {number|null} topVal @param {number|null} bottomVal */
  function applyBias(el, bias, pw, ph, leftVal, rightVal, topVal, bottomVal) {
    const bt = bias && typeof bias === 'object' ? bias : {};
    const ratio = (/** @type {any} */ v) => (v === undefined ? 0.5 : Math.max(0, Number(v) || 0));
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
  /** @param {any=} [rootEl] */
  function syncAlignRules(rootEl) {
    const r = rootEl || rootNode;
    if (!r || !r.querySelectorAll) return;
    const all = [...r.querySelectorAll('*')];
    for (const c of all) if (c.__guideLines) applyGuideLines(c);
    const targets = /** @type {any[]} */ (all.filter((/** @type {any} */ el) => el.__alignRules));
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

  /** @type {Record<string, string>} */
  const TEXT_OVERFLOW_CSS = { none: 'clip', clip: 'clip', ellipsis: 'ellipsis', marquee: 'clip' };

  /** @param {HTMLElement} node @param {number} maxLines @param {any} overflow */
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

  /** @param {HTMLElement} node @param {any} v */
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
    constructor() {
      /** @type {number} */
      this._id = ++scrollerSeq;
      /** @type {HTMLElement|null} */
      this._el = null;
    }
    /** @param {HTMLElement} el */
    _bind(el) { this._el = el; }
    /** @param {number} i @param {boolean=} [smooth] */
    scrollToIndex(i, smooth) {
      const el = this._el;
      if (!el) { layoutWarnings.push(`Scroller.scrollToIndex(${i}): 未绑定容器`); return; }
      // ForEach/If 的包裹层是 display:contents，ListItem 是【孙子】而非直接子节点；
      // 所以优先按组件标记查，再退回直接子节点。容器已设 position:relative → offsetTop 以它为基准。
      // R53：WaterFlow 的 FlowItem 同为合法目标（此前只查 ListItem → WaterFlow 下必走
      // '目标不存在' 警告分支）
      const items = el.querySelectorAll('[data-arkui-comp="ListItem"], [data-arkui-comp="FlowItem"]');
      // 虚拟列表的 `items` 是【当前窗口】的渲染项，不是全量列表：
      // 窗口内第 k 个渲染项对应的索引是 window[0]+k。第一版直接取 items[i]，
      // 于是 scrollToIndex(0) 会滚到"当前窗口第一个渲染项"（实测跳到了 100 段）。
      const holder = el.querySelector('[data-arkui-lazyforeach]');
      const meta = holder && lazyMeta.get(holder);
      const win = meta && meta.window;
      const k = win ? i - win[0] : i;
      const target = (k >= 0 && k < items.length) ? /** @type {HTMLElement} */ (items[k]) : null;
      if (target) {
        el.scrollTop = target.offsetTop;
        el.dispatchEvent(new Event('scroll'));   // R53：与 scrollBy/scrollEdge 同款同步派发（确定性）；
      } else if (meta) {                         // 真机 scrollToIndex 同样发滚动事件
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
    /** @param {any} opt */
    scrollTo(opt) {
      if (!this._el || !opt) return;
      // R46：Scroll 的官方形参是 {xOffset, yOffset, animation?}（scroll.d.ts）；List 侧的
      // opt.x/opt.y 旧路径保留兼容。animation 是真机弹簧滚动（DOM 用 smooth 近似，标注）
      const x = opt.xOffset !== undefined ? opt.xOffset : opt.x;
      const y = opt.yOffset !== undefined ? opt.yOffset : opt.y;
      const smooth = opt.animation === true;
      if (x !== undefined) this._el.scrollLeft = Number(resolveResource(x));
      if (y !== undefined) {
        if (smooth) this._el.scrollTo({ top: Number(resolveResource(y)), behavior: 'smooth' });
        else this._el.scrollTop = Number(resolveResource(y));
      }
    }
    // R46：Scroll 族补面（scroll.d.ts Scroller）。滚动事件由基座 'scroll' 派发（见 scroll.js）
    /** @param {any} dx @param {any} dy */
    scrollBy(dx, dy) {
      const el = this._el;
      if (!el) { layoutWarnings.push('Scroller.scrollBy: 未绑定容器'); return; }
      el.scrollLeft += Number(resolveResource(dx)) || 0;
      el.scrollTop += Number(resolveResource(dy)) || 0;
      el.dispatchEvent(new Event('scroll'));   // 同步派发（确定性；scrollTo 同理依赖它）
    }
    /** @param {any} edge */
    scrollEdge(edge) {
      const el = this._el;
      if (!el) { layoutWarnings.push('Scroller.scrollEdge: 未绑定容器'); return; }
      // Edge: Top=0 Center=1 Bottom=2 Baseline=3 Start=4 Middle=5 End=6
      /** @type {Record<string, string>} */
      const E = { 0: 'top', 2: 'bottom', 4: 'left', 6: 'right' };
      const side = typeof edge === 'number' ? E[edge] : edge;
      if (side === 'top') el.scrollTop = 0;
      else if (side === 'bottom') el.scrollTop = el.scrollHeight;
      else if (side === 'left') el.scrollLeft = 0;
      else if (side === 'right') el.scrollLeft = el.scrollWidth;
      else layoutWarnings.push(`Scroller.scrollEdge(${String(edge)}): 该档位未实现（记警告）`);
      el.dispatchEvent(new Event('scroll'));
    }
    /** @param {any=} [opt] */
    scrollPage(opt) {
      const el = this._el;
      if (!el) { layoutWarnings.push('Scroller.scrollPage: 未绑定容器'); return; }
      const next = opt ? opt.next !== false : true;     // 默认下一页（.d.ts："Default value: true"）
      el.scrollTop += (next ? 1 : -1) * el.clientHeight;
      el.dispatchEvent(new Event('scroll'));
    }
    isAtEnd() {
      const el = this._el;
      if (!el) return false;
      return Math.ceil(el.scrollTop) >= el.scrollHeight - el.clientHeight;
    }
    currentOffset() {
      // OffsetResult 官方形参是 {xOffset, yOffset}（scroll.d.ts）；x/y 键保留兼容旧用例
      return this._el
        ? { xOffset: this._el.scrollLeft, yOffset: this._el.scrollTop, x: this._el.scrollLeft, y: this._el.scrollTop }
        : { xOffset: 0, yOffset: 0, x: 0, y: 0 };
    }
  }

  // 统一的挂载点：记录 elmtId→节点，处理 Stack 叠放，并给节点打上可查询的组件标记
  /** @param {any} node @param {any=} [rec] */
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
      animateTo: (/** @type {any} */ param, /** @type {any} */ fn) => runExplicitAnimation(param, fn, 'animateTo'),
      // 与 Context.animateToImmediately 同理：DOM 里两者等价（CSS transition 本来就"下一帧开始"）
      animateToImmediately: (/** @type {any} */ param, /** @type {any} */ fn) => runExplicitAnimation(param, fn, 'animateToImmediately'),
      getRouter: () => ohosRequire('@ohos:router'),
      getPromptAction: () => ohosRequire('@ohos:promptAction'),
      runScopedTask: (/** @type {any} */ cb) => {
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
    constructor() { this._id = ++tabsSeq; this._state = /** @type {any} */ (null); }
    /** @param {number} i */
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

  /** @param {HTMLElement} node @param {any} opt */
  function createTabsState(node, opt) {
    // @type 档位：contents/onChange 不写会推成 never[]；barEl/contentEl null↔Element 摆动
    const st = /** @type {any} */ ({
      node, index: 0, barPosition: 'start', controller: null,
      contents: [], onChange: [], barEl: null, contentEl: null,
    });
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

  /** @param {any} st @param {any} opt */
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

  /** @param {any} st @param {number} i @param {boolean} fire */
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
  /** @param {any} st */
  function finalizeTabs(st) {
    const n = st.node;
    if (st.barPosition === 'end') {
      if (n.lastElementChild !== st.barEl) n.appendChild(st.barEl);
    } else if (n.firstElementChild !== st.barEl) {
      n.insertBefore(st.barEl, st.contentEl);
    }
    st.barEl.textContent = '';                       // 重建（重渲染时不会残留旧项）
    st.contents.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
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

  /** @param {any} node @param {any} value */
  function applyTabBar(node, value) {
    const st = node.__tabContentOf;
    if (!st) { layoutWarnings.push('TabContent.tabBar: 未找到所属 Tabs'); return; }
    const entry = st.contents.find((/** @type {any} */ c) => c.el === node);
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
  /** @param {any} rec */
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
    if (st && !st.contents.some((/** @type {any} */ c) => c.el === node)) {
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
    constructor() {
      /** @type {number} */ this._id = ++swiperSeq;
      /** @type {any} */ this._state = null;
    }
    showNext() { return stepSwiper(this._state, +1); }
    showPrevious() { return stepSwiper(this._state, -1); }
    /** @param {number} i @param {boolean=} [useAnimation] */
    changeIndex(i, useAnimation) {
      if (useAnimation === true) layoutWarnings.push('SwiperController.changeIndex(useAnimation=true)：无动画实现，已忽略动画');
      return this._state ? setActiveSwiper(this._state, Number(i), true) : false;
    }
    /** @param {any=} [cb] */
    finishAnimation(cb) { if (typeof cb === 'function') cb(); }   // 无动画 → 立即完成
    preloadItems() { return Promise.resolve(); }                  // 所有页都是即时构建的，语义等价
  }

  /** @param {any} st @param {any} ctl */
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

  /** @param {HTMLElement} node @param {any=} [args] */
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

  /** @param {any} st @param {number} i @param {boolean} fire */
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
    st.dots.forEach((/** @type {any} */ d, /** @type {number} */ k) => d.setAttribute('data-arkui-swiper-dot-active', k === idx ? 'true' : 'false'));
    if (fire) {
      for (const cb of st.onChange) {
        try { cb(idx); } catch (e) { layoutWarnings.push(`Swiper.onChange 抛错：${e && e.message}`); }
      }
    }
    return true;
  }

  // showNext / showPrevious：loop=false 且在边界时【停住】（这是合法语义，所以不记 warning）
  /** @param {any} st @param {number} delta */
  function stepSwiper(st, delta) {
    if (!st) { layoutWarnings.push('SwiperController 尚未绑定到任何 Swiper'); return false; }
    const n = st.entries.length;
    if (!n) { layoutWarnings.push('Swiper 内没有任何子组件'); return false; }
    const next = st.index + delta;
    if (!st.loop && (next < 0 || next >= n)) return false;
    return setActiveSwiper(st, next, true);
  }

  /** @param {any} st */
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
  /** @param {any} st */
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

  /** @param {any} st */
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
    st.dots = st.entries.map((/** @type {any} */ _e, /** @type {number} */ k) => {
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
  /** @type {Record<string, (st: any, v: any, opts?: any) => void>} */
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
  /** @type {Record<number, number>} */
  const TITLE_HEIGHT_VALUE = { 0: NAV_TITLE_H.main, 1: NAV_TITLE_H.mainSub };
  const NAV_DIVIDER_PX = 1;               // 分栏时的分割线宽度
  const NAV_DEFAULT_BAR_W = 240;          // navBarWidth 默认 240vp（.d.ts JSDoc 原文）
  // push/pop 的系统转场（R25，R40 照真机源码纠偏）。权威出处：ace_engine
  // navigation_group_node.cpp——push/pop 动画 = InterpolatingSpring(0,1,342,37)、
  // 时长上界 DEFAULT_ANIMATION_DURATION=450ms；入页起点 +50%（navdestination_node_base.cpp
  // CalcTranslateForTransitionPushStart: width×HALF）；被盖页视差滑到 -20%
  //（CONTENT_OFFSET_PERCENT=0.2，其标题栏再 -2%：TITLE_OFFSET_PERCENT）；pop 弹出页滑到
  // +50%、露出页从 -20% 回 0。CSS transition 没有弹簧曲线——cubic-bezier(0.2,0,0,1) 是
  // 该弹簧（damping 37 ≈ 临界阻尼，无过冲）的近似，时长取 450ms 上界。
  const NAV_TRANS_MS = 450;
  const NAV_TRANS_CURVE = 'cubic-bezier(0.2, 0.0, 0.0, 1.0)';
  const NAV_PUSH_FROM = 50;             // 入页起点%（width×HALF）
  const NAV_POP_TO = 50;                // 弹出页终点%（width×HALF）
  const NAV_PARALLAX = 20;              // 被盖/露出页的视差%（CONTENT_OFFSET_PERCENT×100）
  // 转场运行记录（测试轮询"挂着的转场"用，与 animation.js 的 transitionRuns 同思想）
  /** @type {any[]} */
  const navTransRuns = [];
  let navTransRunSeq = 0;
  function navTransDescribe() {
    let pending = 0;
    navTransRuns.forEach((r) => { if (!r.done) pending++; });
    return { runs: navTransRuns.map((r) => ({ ...r })), pending };
  }
  /** @param {HTMLElement} el @param {any} run */
  function navWitness(el, run) {          // transitionend 只当"见证"，不当收口依据（坑 ⑧ 同源）
    const fn = () => { run.sawTransitionEnd = true; };
    el.addEventListener('transitionend', fn, { once: true });
    return () => el.removeEventListener('transitionend', fn);
  }
  /** @param {HTMLElement} el */
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

  /** @param {any} v */
  const animOf = (v) => (typeof v === 'boolean' ? v : !!(v && typeof v === 'object' && v.animated));

  class NavPathStack {
    constructor() {
      /** @type {any} */ this._nav = null;
      /** @type {any[]} */ this._paths = [];
      /** @type {boolean} */ this._noAnim = false;
    }

    // ── 查询 ──
    size() { return this._paths.length; }
    getAllPathName() { return this._paths.map((p) => p.name); }
    /** @param {number} i */
    getParamByIndex(i) { const p = this._paths[i]; return p ? p.param : undefined; }
    /** @param {string} name */
    getParamByName(name) { return this._paths.filter((p) => p.name === name).map((p) => p.param); }
    /** @param {string} name */
    getIndexByName(name) {
      /** @type {number[]} */
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
    /** @param {any=} [paths] */
    setPathStack(paths) {
      navClearAll(this);
      (paths || []).forEach((/** @type {any} */ p) => navPushRec(this, { name: p.name, param: p.param, onPop: p.onPop }, false));
      navSyncVisibility(this._nav);
    }

    // ── 压栈 ──（animated 一律透传原值，默认 true 的解释在 navWantAnim）
    /** @param {any} info @param {any=} [options] */
    pushPath(info, options) {
      navPushRec(this, info || {}, options && typeof options === 'object' ? options.animated : options);
    }
    /** @param {string} name @param {any} param @param {any=} [a3] @param {any=} [a4] */
    pushPathByName(name, param, a3, a4) {
      // .d.ts 重载：(name, param, animated?) / (name, param, onPop, animated?)。
      // a3 是函数 → a4 才是 animated；a3 是布尔 → a3 就是 animated（三参形态）；
      // a3=undefined（如 (name, param, undefined, false)）→ 看 a4。
      const onPop = typeof a3 === 'function' ? a3 : undefined;
      const animated = typeof a3 === 'function' ? a4 : (typeof a3 === 'boolean' ? a3 : a4);
      navPushRec(this, { name, param, onPop }, animated);
    }
    /** @param {any} info */
    pushDestination(info) {
      navPushRec(this, info || {}, info && typeof info === 'object' ? info.animated : undefined);
      return Promise.resolve();
    }
    /** @param {string} name @param {any} param */
    pushDestinationByName(name, param) {
      navPushRec(this, { name, param }, arguments[2]);
      return Promise.resolve();
    }

    // ── 弹栈 ──
    // .d.ts 重载：pop(animated?) / pop(result, animated?)；popToName/Index(name, result?, animated?)
    // 都有 "Whether to enable the transition animation ... Default value: true"
    /** @param {any=} [a1] @param {any=} [a2] */
    pop(a1, a2) {
      if (!this._paths.length) return undefined;
      const result = a1 !== undefined && typeof a1 !== 'boolean' ? a1 : undefined;
      const animated = typeof a1 === 'boolean' ? a1 : a2;
      const rec = this._paths[this._paths.length - 1];
      navPopRange(this, this._paths.length - 1, 1, result, animated);
      return { name: rec.name, param: rec.param };
    }
    /** @param {string} name @param {any=} [a2] @param {any=} [a3] */
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
    /** @param {number} index @param {any=} [a2] @param {any=} [a3] */
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
    /** @param {any} info @param {any=} [options] */
    replacePath(info, options) { navReplaceTop(this, info || {}, animOf(options)); }
    /** @param {string} name @param {any} param */
    replacePathByName(name, param) { navReplaceTop(this, { name, param }, animOf(arguments[2])); }
    /** @param {any} info */
    replaceDestination(info) { navReplaceTop(this, info || {}, animOf(arguments[1])); return Promise.resolve(); }
    /** @param {string} name */
    removeByName(name) {
      /** @type {number[]} */
      const idx = [];
      this._paths.forEach((p, i) => { if (p.name === name) idx.push(i); });
      if (!idx.length) return 0;
      idx.slice().reverse().forEach((i) => navPopRange(this, i, 1, undefined));
      return idx.length;
    }
    /** @param {any=} [indexes] */
    removeByIndexes(indexes) {
      const valid = (indexes || []).filter((/** @type {number} */ i) => Number.isInteger(i) && i >= 0 && i < this._paths.length);
      valid.slice().sort((/** @type {number} */ a, /** @type {number} */ b) => b - a).forEach((/** @type {number} */ i) => navPopRange(this, i, 1, undefined));
      return valid.length;
    }
    removeByNavDestinationId() {
      layoutWarnings.push('NavPathStack.removeByNavDestinationId 未实现（本实现没有 NavDestination id 概念）');
      return 0;
    }
    /** @param {string} name */
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
    /** @param {number} index */
    moveIndexToTop(index) {
      const rec = this._paths[index];
      if (!rec) { layoutWarnings.push(`NavPathStack.moveIndexToTop(${index})：越界`); return; }
      this.moveToTop(rec.name);
    }
    clear() { navClearAll(this); navSyncVisibility(this._nav); }
    /** @param {any} value */
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

  /** @param {any} v */
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
  /** @param {any} spec @param {any} titleMode */
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
  /** @param {any} st */
  function navCollapseAllowed(st) {
    return st.titleMode === NavigationTitleMode.Free && !st.hideTitleBar
      && !(st.titleSpec && st.titleSpec.height !== undefined && st.titleSpec.height !== null);
  }

  // 内容滚动 → 标题栏收缩（capture 监听挂在 Navigation 上，见 createNavState）。
  // 进度 p∈[0,1]：0 = 全高（Free 非滚动态等同 Full），1 = 收到 Mini；
  // 滚动距离与收缩进度线性，滚满 (Full−Mini) px 收到底 —— 该换算是本实现的选择
  //（.d.ts 只说 "the main title shrinks as the content scrolls down ... and restores
  // as the content scrolls up to the top"，没给阈值）。
  /** @param {any} st @param {Event} e */
  function navOnContentScroll(st, e) {
    const t = /** @type {any} */ (e.target);
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
  /** @param {HTMLElement} host @param {any} builder @param {string} what */
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

  /** @param {any=} [items] */
  function navMenuBar(items) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-arkui-nav-menus', '');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    (items || []).forEach((/** @type {any} */ m, /** @type {number} */ i) => {
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

  /** @param {any} onBack @param {any=} icon */
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
  /** @param {HTMLElement} host @param {any} spec @param {any} opts */
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
  /** @param {HTMLElement} host @param {any} items */
  function drawToolbar(host, items) {
    host.textContent = '';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    host.style.boxSizing = 'border-box';
    host.style.gap = '16px';
    (items || []).forEach((/** @type {any} */ it, /** @type {number} */ i) => {
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

  /** @param {HTMLElement} node @param {any} stack */
  function createNavState(node, stack) {
    // @type 档位：整袋 any —— barEl/titleEl/dividerEl/tmc 等十来个字段都是 null↔对象 摆动，
    // 后渲染才赋值；属性级 @type 只能管到紧随其后的一个属性，这里必须整袋收
    const st = /** @type {any} */ ({
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
    });
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
  /** @param {any} st */
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
  const builderIdOf = (/** @type {any} */ fn) => {
    if (!builderIds.has(fn)) builderIds.set(fn, ++builderIdSeq);
    return builderIds.get(fn);
  };

  /** @param {HTMLElement} node */
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
    // R43 照真机公式（title_bar_pattern.cpp GetSubtitleOpacity/GetFontSize + 
    // navigation_bar_theme.cpp 字号默认 title_primary=30fp / title_secondary=26fp）：
    // · 副标题透明度 = (H − 56) / (max − 56)，随收缩从 1 线性到 0
    // · 主标题 = 字号插值（L=30fp ↔ M=26fp），映射经 Curves::SHARP（cubic-bezier(0.4,0,0.6,1)，
    //   GetMappedOffset）；DOM 侧等价实现为 transform scale = (26 + SHARP(p)×4) / 30
    const sharp = (/** @type {number} */ p) => {                       // Curves::SHARP = cubic-bezier(0.4, 0, 0.6, 1)
      let lo = 0, hi = 1, t = p;
      for (let i = 0; i < 24; i++) {             // 解 x(t)=p 的 t（x(t) 单调），再取 y(t)
        const x = 3 * (1 - t) * (1 - t) * t * 0.4 + 3 * (1 - t) * t * t * 0.6 + t * t * t;
        if (x < p) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return 3 * (1 - t) * t * t + t * t * t;    // y(t)：P1y=0、P2y=1
    };
    const p = col;
    const shrinkEl = st.titleEl.querySelector('[data-arkui-nav-title-main],[data-arkui-nav-title-text]');
    if (shrinkEl) {
      const k = H0 > 0 ? (26 + sharp(p) * (30 - 26)) / 30 : 1;   // 字号比（真机 L=30fp / M=26fp）
      shrinkEl.style.transformOrigin = 'left center';
      shrinkEl.style.transform = col > 0 && k < 1 ? `scale(${k})` : '';
    }
    const subEl = st.titleEl.querySelector('[data-arkui-nav-title-sub]');
    if (subEl) subEl.style.opacity = col > 0 ? String(1 - col) : '';
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
  /** @param {HTMLElement} node */
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
    const tbSig = `${items.length}|${items.map((/** @type {any} */ i) => String(i.value)).join(',')}|${d.hideToolBar}`;
    if (d.toolbarDrawn !== tbSig) {
      d.toolbarDrawn = tbSig;
      drawToolbar(d.toolbarEl, items);
    }
    node.setAttribute('data-arkui-dest-title', d.titleSpec && d.titleSpec.text ? d.titleSpec.text : '');
  }

  // 目的地所属的 Navigation 状态（目标区 → Navigation 元素）
  /** @param {HTMLElement} node */
  function navStateOfDest(node) {
    let p = node.parentElement;
    while (p) {
      if (p.__navState) return p.__navState;
      p = p.parentElement;
    }
    return null;
  }

  /** @param {any=} [rootEl] */
  function syncNavChrome(rootEl) {
    const scope = rootEl || document;
    if (scope.__navState) syncOneNav(scope);
    if (scope.__navDest) syncOneDest(scope);
    if (scope.querySelectorAll) {
      scope.querySelectorAll('[data-arkui-comp="Navigation"]').forEach(syncOneNav);
      scope.querySelectorAll('[data-arkui-comp="NavDestination"]').forEach(syncOneDest);
    }
  }


  /** @param {any} st @param {any} stack */
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
  /** @param {any} st */
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

  /** @param {any} st */
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
  /** @param {any} stack @param {any} animated */
  function navWantAnim(stack, animated) {
    if (stack._noAnim) return false;                       // disableAnimation(true)
    if (animated === undefined || animated === null) return true;
    return animOf(animated);
  }

  // push 转场（R25）：新栈顶从右滑入、盖在上一个栈顶上；上一个栈顶在滑入期间保持可见，
  // 结束才藏。样式收口与 animation.js 同一约定：先提交起始值（强制重排，坑 ⑧），
  // transitionend 只当见证，真正收口靠定时器。
  /** @param {any} st @param {any} rec @param {any} prev */
  function navSlidePush(st, rec, prev) {
    const el = rec.el;
    if (!el) return;
    const showPrev = !!(prev && prev.el && prev !== rec);
    if (showPrev) prev.el.style.display = 'block';         // navSyncVisibility 刚把它藏掉
    // @type 档位：endedBy null↔string 摆动
    const run = /** @type {any} */ ({ seq: ++navTransRunSeq, kind: 'push', name: rec.name, done: false, sawTransitionEnd: false, endedBy: null });
    navTransRuns.push(run);
    if (navTransRuns.length > 50) navTransRuns.shift();
    el.dataset.arkuiNavTrans = 'push';
    // 入页 +50% → 0；被盖页同一段弹簧里视差 0 → -20%（真机 push 编舞）
    el.style.transform = `translateX(${NAV_PUSH_FROM}%)`;
    if (showPrev) {
      prev.el.style.transform = 'translateX(0%)';
      void prev.el.offsetHeight;
      prev.el.style.transitionProperty = 'transform';
      prev.el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
      prev.el.style.transitionTimingFunction = NAV_TRANS_CURVE;
      prev.el.style.transform = `translateX(-${NAV_PARALLAX}%)`;
    }
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
      // 被盖页收口：清视差 transform 后藏掉（期间若有新栈操作，可见性已由那次的 sync 接管：
      // 只藏"现在仍然不是栈顶"的前任）
      if (showPrev) {
        navEndTransStyle(prev.el);
        prev.el.style.transform = '';
        if (prev !== st.visible) prev.el.style.display = 'none';
      }
    }, NAV_TRANS_MS + 30);
  }

  /** @param {any} stack @param {any} info @param {any} animated */
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

  /** @param {any} st @param {any} rec */
  function navBuildDest(st, rec) {
    const area = ensureNavArea(st);
    const savedStack = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    // 目的地未必是目标区的【直接子节点】：builder 里的 if/else 会生成 `If` 包装层
    // （display:contents），目的地是"孙子辈"。所以不能只看 lastElementChild ——
    // 旧实现就这么写的，遇到带 if 分支的 PageMap 会误判成"没建出来"并把栈项弹掉
    // （R12 收口的新页面正是这种 builder，断言当场抓住）。改成按"本次新建的节点"认领。
    area.querySelectorAll('[data-arkui-comp="NavDestination"]')
      .forEach((/** @type {any} */ n) => { n.__arkuiNavNew = false; });
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

  /** @param {any} rec */
  function navDestroyDest(rec) {
    if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    rec.el = null;
  }

  /** @param {any} rec @param {string} kind */
  function navFire(rec, kind) {
    const cb = rec.cbs && rec.cbs[kind];
    if (typeof cb !== 'function') return;
    try { cb(); } catch (e) { layoutWarnings.push(`NavDestination.${kind} 回调抛错：${e && e.message}`); }
  }

  // 隐藏：willHide → hidden（JSDoc：前者"即将隐藏"，后者"已隐藏"）
  /** @param {any} rec */
  function navHideDest(rec) {
    if (!rec || !rec.el) return;
    navFire(rec, 'willHide');
    rec.el.style.display = 'none';
    navFire(rec, 'hidden');
  }

  // 显示：首次挂载 willAppear → willShow → shown → ready；再次显示只走 willShow → shown
  /** @param {any} rec */
  function navShowDest(rec) {
    if (!rec || !rec.el) return;
    if (!rec.everShown) { navFire(rec, 'willAppear'); rec.everShown = true; }
    navFire(rec, 'willShow');
    rec.el.style.display = 'block';
    navFire(rec, 'shown');
    if (rec.cbs.ready && !rec.readyFired) { rec.readyFired = true; navFire(rec, 'ready'); }
  }

  // 把可见性与生命周期对齐到"只有栈顶可见"
  /** @param {any} st */
  function navSyncVisibility(st) {
    if (!st) return;
    const top = st.paths.length ? st.paths[st.paths.length - 1] : null;
    if (st.visible && st.visible !== top) navHideDest(st.visible);
    st.paths.forEach((/** @type {any} */ p) => { if (p.el && p !== top) p.el.style.display = 'none'; });
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
  /** @param {any} stack @param {any} rec @param {any} result */
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
    const run = /** @type {any} */ ({ seq: ++navTransRunSeq, kind: 'pop', name: rec.name, done: false, sawTransitionEnd: false, endedBy: null });
    navTransRuns.push(run);
    if (navTransRuns.length > 50) navTransRuns.shift();
    el.dataset.arkuiNavTrans = 'pop';
    el.style.display = 'block';
    el.style.zIndex = '3';                 // DOM 顺序上新栈顶在后面（盖住它），滑出期间要反超
    // 露出页从视差位 -20% 回 0（真机 pop 编舞：PopStart(true) = -20% → PopEnd(true) = 0）
    const shown = st.paths.length ? st.paths[st.paths.length - 1] : null;
    const shownEl = (shown && shown.el) ? shown.el : null;
    if (shownEl) {
      shownEl.style.transform = `translateX(-${NAV_PARALLAX}%)`;
      void shownEl.offsetHeight;
      shownEl.style.transitionProperty = 'transform';
      shownEl.style.transitionDuration = `${NAV_TRANS_MS}ms`;
      shownEl.style.transitionTimingFunction = NAV_TRANS_CURVE;
      shownEl.style.transform = '';
    }
    el.style.transform = '';
    void el.offsetHeight;
    const stopWitness = navWitness(el, run);
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
    el.style.transitionTimingFunction = NAV_TRANS_CURVE;
    el.style.transform = `translateX(${NAV_POP_TO}%)`;
    const timer = setTimeout(() => {
      run.endedBy = 'timer';
      navEndTransStyle(el);
      stopWitness();
      run.done = true;
      el.style.zIndex = '';
      el.style.transform = '';
      if (shownEl) {
        navEndTransStyle(shownEl);
        shownEl.style.transform = '';
      }
      navDestroyDest(rec);
      purgeDetachedRecords();
      // 目标区的显隐以【当下】的栈为准（滑出期间可能有新 push）
      if (st.areaEl && !st.paths.length) st.areaEl.style.display = 'none';
    }, NAV_TRANS_MS + 30);
  }

  // 弹出 [from, from+count)：从【栈顶向下】处理，保证生命周期顺序
  /** @param {any} stack @param {number} from @param {number} count @param {any} result @param {any=} [animated] */
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

  /** @param {any} stack */
  function navClearAll(stack) {
    const st = stack._nav;
    if (!st) { stack._paths.length = 0; return; }
    navPopRange(stack, 0, st.paths.length, undefined);
  }

  /** @param {any} stack @param {any} info @param {any} _animated */
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

  /** @param {any} st @param {any} v */
  function updateNavStack(st, v) { bindNavStack(st, v); }

  // NavDestination 挂载：认领目标区（先按 none 挂上，可见性交给 navSyncVisibility）
  /** @param {any} rec @param {any} deepFn @param {any} elmtId */
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
      // @type 档位：barEl/toolbarEl null↔HTMLElement 摆动 → 整袋 any
      node.__navDest = /** @type {any} */ ({
        titleSpec: null, menus: null, toolbar: null,
        hideBackButton: false, hideTitleBar: false, hideToolBar: false,
        backButtonIcon: null, titleDrawn: null, barEl: null, toolbarEl: null,
      });
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
  /** @type {Record<string, (st: any, v: any, opts?: any) => void>} */
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
    onTitleModeChange: (st, v, extra) => { st.tmc = typeof v === 'function' ? v : null; },
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
  /** @type {Record<string, (node: any, v: any, opts?: any) => void>} */
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
  /** @param {string|number} v */
  const isCirclePanel = (v) => v === 'circle' || v === 1;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** @param {string} tag @param {any=} [attrs] */
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, String(attrs[k]));
    return el;
  };
  /** @param {any} c */
  const colorOf = (c) => {
    if (typeof c === 'number') return '#' + (c >>> 0).toString(16).padStart(8, '0').slice(2);
    if (typeof c === 'string') return c;
    return '#007dff';                                       // 拿不到资源引用时退化为默认蓝
  };
  // 弧长归一化：pathLength=100 → dasharray 直接是百分比，跨实现可断言
  const PATH_LEN = 100;
  /** @param {number} n */
  const r2 = (n) => Math.round(n * 100) / 100;

  // 圆环坐标：0 点 = 0 度、顺时针为正（Gauge 的 .d.ts JSDoc 原话）
  // a=0 → 顶部中央；a=90 → 右侧；a=180 → 底部中央
  /** @param {number} cx @param {number} cy @param {number} r @param {number} deg */
  const polar = (cx, cy, r, deg) => ({
    x: cx + r * Math.sin((deg * Math.PI) / 180),
    y: cy - r * Math.cos((deg * Math.PI) / 180),
  });
  /** @param {number} cx @param {number} cy @param {number} r @param {number} a0 @param {number} a1 */
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
  /** @param {SVGElement} el @param {number} pct @param {number} offset */
  const arcDash = (el, pct, offset) => {
    el.setAttribute('pathLength', String(PATH_LEN));
    el.setAttribute('stroke-dasharray', `${r2(pct)} ${PATH_LEN}`);
    el.setAttribute('stroke-dashoffset', String(r2(offset)));
  };

  // ── Progress ──
  /** @param {any} opts */
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
      (/** @type {SVGElement} */ (node.__svg)).style.width = '100%';
      (/** @type {SVGElement} */ (node.__svg)).style.height = '100%';
      node.appendChild(/** @type {SVGElement} */ (node.__svg));
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

  /** @param {any} node @param {any} value @param {any} totalArg */
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

  /** @param {any} node @param {number} ratio */
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
  /** @param {any} opts */
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
    (/** @type {SVGElement} */ (node.__svg)).style.width = '100%';
    (/** @type {SVGElement} */ (node.__svg)).style.height = '100%';
    node.appendChild(/** @type {SVGElement} */ (node.__svg));
    return node;
  }

  /** @param {any} node */
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

  /** @param {any} node */
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
  /** @param {any} opts */
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

  /** @param {any} node */
  function panelGeometry(node) {
    const max = node.__panelMax || 100;
    const segs = node.__values.map((/** @type {any} */ v) => Math.max(0, v) / max);
    const stops = [];
    let acc = 0;
    for (const s of segs) { acc += s; stops.push(Math.min(1, acc)); }
    return { segs, stops };
  }

  /** @param {any} node */
  function redrawDataPanel(node) {
    const { segs } = panelGeometry(node);
    const colors = node.__panelColors || PANEL_PALETTE;
    if (node.__panelType === 'circle') {
      const parts = [];
      let from = 0;
      segs.forEach((/** @type {any} */ s, /** @type {any} */ i) => {
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
      segs.forEach((/** @type {any} */ s, /** @type {any} */ i) => {
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
  /** @param {any} opts */
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

  /** @param {any} node */
  function ratingLit(node) {
    const snap = node.__step > 0 ? Math.round(node.__rating / node.__step) * node.__step : node.__rating;
    const lit = Math.max(0, Math.min(node.__starCount, snap));
    const full = Math.floor(lit + 1e-6);
    const half = lit - full >= 0.5 - 1e-6;
    return { lit, full, half };
  }

  /** @param {boolean} filled */
  function starSvg(filled) {
    const svg = svgEl('svg', { viewBox: '0 0 24 24' });
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.appendChild(svgEl('path', { d: STAR_PATH, fill: filled ? '#ffb400' : '#d8d8d8', stroke: 'none' }));
    return svg;
  }

  /** @param {any} node */
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
  /** @param {any=} [rootEl] */
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
  /** @type {Record<string, Record<string, (n: any, v: any, opts?: any) => void>>} */
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

  /** @param {HTMLElement} el @param {string} kind */
  const edgesOf = (el, kind) => {
    const cs = getComputedStyle(el);
    const pick = (/** @type {string} */ side) => parseFloat((/** @type {any} */ (cs))[kind + side]) || 0;
    return { top: pick('Top'), right: pick('Right'), bottom: pick('Bottom'), left: pick('Left') };
  };
  /** @param {HTMLElement} el */
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
  /** @param {any} rootEl */
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
  /** @param {any} el @param {any} con @param {any} log */
  function measureChild(el, con, log) {
    const c = con || {};
    /** @param {string} prop @param {any} v */
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
  /** @param {any} view @param {any} container @param {any} host */
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
    const measurables = kids.map((/** @type {any} */ el, /** @type {number} */ i) => ({
      uniqueId: i,
      measure: (/** @type {any} */ c) => measureChild(el, c, log),
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
      const layoutables = kids.map((/** @type {any} */ el, /** @type {number} */ i) => ({
        uniqueId: i,
        measureResult: el.__lastMeasure || { width: el.offsetWidth, height: el.offsetHeight },
        layout: (/** @type {any} */ position) => {
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

  /** @param {any} node @param {any} prop @param {any} value @param {any} extra */
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
      // ⚠️ 只对 checkbox/radio（选中语义）；文本输入的 onChange(value: string) 见下。
      if (node.__arkuiInput === 'input' && prop === 'onChange'
        && (node.type === 'checkbox' || node.type === 'radio')) {
        // ⚠️ 包装器带【target 校验】：实测（inputdemo 排查）rd 的包装器会被错误地挂到
        // 其他 input 节点上（tg1/sl1 的 change 也会带起 rd 回调）—— 根因在组件栈复用，
        // 先用"事件目标必须是自己"兜住错投：change 目标不是这个节点就不算它的选中态变化。
        const wrapper = (/** @type {Event} */ e) => {
          if (e.target !== node) return;
          try { value(!!node.checked); }
          catch (err) { layoutWarnings.push(`输入类 onChange 派发抛错：${err && err.message}`); }
          // 组内互斥的另一半：Chrome 只给新选中者发 change，被取消成员的 onChange(false)
          // 由这里按登记的组补发（radio.d.ts JSDoc：false = "changes from selected to unselected"）
          if (node.type === 'radio' && node.checked && typeof radioGroups !== 'undefined') {
            const members = radioGroups.get(node.name);
            if (members) {
              members.forEach((/** @type {any} */ m) => {
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
        return;
      }
      // 文本输入（R34）：TextInput/TextArea/Search 的 onChange 签名是 (value: string)——
      // 监听 input 事件（每次键入）并传字符串值（text_common.d.ts：value 双参首参）。
      if (node.__arkuiInput === 'input' && prop === 'onChange'
        && (node.type === 'text' || node.type === 'search' || node.tagName === 'TEXTAREA')) {
        const textWrapper = () => {
          try { value(node.value); }
          catch (e) { layoutWarnings.push(`文本输入 onChange 派发抛错：${e && e.message}`); }
        };
        if (!node.__arkuiEv) node.__arkuiEv = {};
        if (node.__arkuiEv.input) node.removeEventListener('input', node.__arkuiEv.input);
        if (node.__arkuiEv.change) node.removeEventListener('change', node.__arkuiEv.change);
        node.__arkuiEv.input = textWrapper;
        node.__arkuiEv.change = textWrapper;      // change 与 input 同参（值字符串）
        node.addEventListener('input', textWrapper);
        node.addEventListener('change', textWrapper);
        return;
      }
      if (node.__arkuiInput === 'slider' && prop === 'onChange') {
        // 覆盖语义同上：input→Moving(1)，change→End(2)；target 校验同上（防错投）
        const onInput = (/** @type {Event} */ e) => {
          if (e.target !== node) return;
          try { value(Number(node.value), 1); }
          catch (err) { layoutWarnings.push(`Slider.onChange 派发抛错：${err && err.message}`); }
        };
        const onChangeEv = (/** @type {Event} */ e) => {
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
    // 分步器（R37）：Stepper 的五事件 + StepperItem 的 label/status（函数值与语义属性
    // 都必须拦在通用 on* / data-* 落点之前，与 Counter 同理）
    if (node.__arkuiStepper && STEP_ATTRS[prop]) {
      STEP_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiStepperItem && XC_ITEM_ATTRS[prop]) {
      XC_ITEM_ATTRS[prop](node, value);
      return;
    }
    // Image（R45）：objectFit/alt/事件是语义属性，抢在通用落点之前（同 Counter 道理）
    if (node.__arkuiImage && IMAGE_ATTRS[prop]) {
      IMAGE_ATTRS[prop](node, value);
      return;
    }
    // Scroll（R46）：scrollable/scrollBar/edgeEffect/事件是语义属性，抢在通用落点之前
    if (node.__arkuiScroll && SCROLL_ATTRS[prop]) {
      SCROLL_ATTRS[prop](node, value);
      return;
    }
    // WaterFlow（R53）：columnsTemplate/gap/layoutDirection/事件是语义属性（函数值抢在通用
    // on* 前，坑 86；分支必须与兄弟条件块平级——嵌进去就是静默死分支，坑 91）
    if (node.__arkuiWaterFlow && WATERFLOW_ATTRS[prop]) {
      WATERFLOW_ATTRS[prop](node, value);
      return;
    }
    // CalendarPicker（R54）：edgeAlign/markToday/textStyle/onChange 是语义属性；onChange
    // 与 DOM 原生 change 事件同名，必须拦在通用 on* 规则之前（坑 86）
    if (node.__arkuiCalPick && (/** @type {Record<string, any>} */ (CALPICK_ATTRS))[prop]) {
      (/** @type {Record<string, any>} */ (CALPICK_ATTRS))[prop](node, value);
      return;
    }
    // ImageAnimator（R47）：images/state/事件是语义属性，抢在通用落点之前
    if (node.__arkuiAnimator && ANIMATOR_ATTRS[prop]) {
      ANIMATOR_ATTRS[prop](node, value);
      return;
    }
    // DatePicker（R51）：lunar/canLoop/事件是语义属性（函数值抢在通用 on* 前，坑 86）
    if (node.__arkuiDatePicker && DATEPICKER_ATTRS[prop]) {
      DATEPICKER_ATTRS[prop](node, value);
      return;
    }
    // TimePicker（R52）：useMilitaryTime/onChange 是语义属性
    if (node.__arkuiTimePicker && TIMEPICKER_ATTRS[prop]) {
      TIMEPICKER_ATTRS[prop](node, value);
      return;
    }
    // TextPicker（R56）：selectedIndex/defaultPickerItemHeight/onChange 是语义属性
    if (node.__arkuiTextPick && TEXTPICKER_ATTRS[prop]) {
      TEXTPICKER_ATTRS[prop](node, value);
      return;
    }
    // TextClock/TextTimer（R59）：format/onClockChange/onTimer 是语义属性
    if (node.__arkuiTextClock && TEXTCLOCK_ATTRS[prop]) {
      TEXTCLOCK_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiTextTimer && TEXTTIMER_ATTRS[prop]) {
      TEXTTIMER_ATTRS[prop](node, value);
      return;
    }
    // AlphabetIndexer（R60）：selected/itemSize/配色/onSelect 是语义属性
    if (node.__arkuiAlphabetIndexer && AIX_ATTRS[prop]) {
      AIX_ATTRS[prop](node, value);
      return;
    }
    // RichEditor（R65）：placeholder/onReady/onSelect 是语义属性
    if (node.__arkuiRichEditor && RICHEDITOR_ATTRS[prop]) {
      RICHEDITOR_ATTRS[prop](node, value);
      return;
    }
    // Video（R65）：controls/autoPlay/muted/loop/生命周期回调是语义属性
    if (node.__arkuiVideo && VIDEO_ATTRS[prop]) {
      VIDEO_ATTRS[prop](node, value);
      return;
    }
    // ── 批量分片收官（R66/R67）：以下分支全部抢在通用 on*/data-* 落点之前（坑 86：
    //    函数值语义属性若落成 DOM 监听器就是永不触发的死代码）──

    // batch-media：ContainerSpan/ImageSpan/RichText/SymbolGlyph/SymbolSpan/Web
    if (node.__arkuiContainerSpan && CONTAINERSPAN_ATTRS[prop]) {
      CONTAINERSPAN_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiImageSpan && IMAGESPAN_ATTRS[prop]) {
      IMAGESPAN_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiRichText && RICHTEXT_ATTRS[prop]) {
      RICHTEXT_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiSymbolGlyph && SYMBOLGLYPH_ATTRS[prop]) {
      SYMBOLGLYPH_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiSymbolSpan && SYMBOLSPAN_ATTRS[prop]) {
      SYMBOLSPAN_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiWeb && WEB_ATTRS[prop]) {
      WEB_ATTRS[prop](node, value);
      return;
    }

    // batch-nav：NavRouter/Navigator/PageTransition(Enter|Exit 共用一张表，元素上标记为
    // 'enter'|'exit')/UIPickerComponent（onChange 必须拦在通用 on* 前）。ToolBarItem 无分支：
    // toolbar.d.ts:112 ToolBarItemAttribute 是空类、不支持通用属性，无 ATTRS 表
    if (node.__arkuiNavRouter && NAVROUTER_ATTRS[prop]) {
      NAVROUTER_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiNavigator && NAVIGATOR_ATTRS[prop]) {
      NAVIGATOR_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiPageTransition && PAGE_TRANSITION_ATTRS[prop]) {
      PAGE_TRANSITION_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiPicker && UIPICKER_ATTRS[prop]) {
      UIPICKER_ATTRS[prop](node, value);
      return;
    }

    // batch-layout：FolderStack/GridContainer/UnionEffectContainer/XComponentNode。
    // Sheet/Section 无自有属性（ets-loader JSON attrs=[]），不需分支；FolderStack.alignContent
    // 刻意不在表内 —— 落到下方通用 `prop === 'alignContent'` → applyAlignment 分支
    if (node.__arkuiFolderStack && FOLDERSTACK_ATTRS[prop]) {
      FOLDERSTACK_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiGridContainer && GRIDCONTAINER_ATTRS[prop]) {
      GRIDCONTAINER_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiUnionEffect && UNIONEFFECT_ATTRS[prop]) {
      UNIONEFFECT_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiXComponentNodeFlag && XCNODE_ATTRS[prop]) {
      XCNODE_ATTRS[prop](node, value);
      return;
    }

    // batch-input（R66）：六组件的函数值回调/语义属性抢在通用 on*/data-* 之前（坑 86 同族）；
    // 表内每个条目按 __arkuiComp/__batchPicker.kind/__selContainer 身份守卫。Option 的字体四件
    // （fontColor/fontSize/fontWeight/fontFamily）刻意不在表内，落通用 cssPropSize/cssPropRaw
    if (node.__arkuiBatchIn && BATCHINPUT_ATTRS[prop]) {
      BATCHINPUT_ATTRS[prop](node, value);
      return;
    }

    // batch-motion：Animator 动画组件 + ScrollBar。FrictionMotion/ScrollMotion/SpringMotion/
    // SpringProp/GeometryView 的 ets-loader json attrs 为空，无需分派（未实现语义走通用
    // data-* 落点）
    if (node.__arkuiAnimComp && ANIM_COMP_ATTRS[prop]) {
      ANIM_COMP_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiScrollBar && SCROLLBAR_ATTRS[prop]) {
      SCROLLBAR_ATTRS[prop](node, value);
      return;
    }

    // batch-func（R66）：Repeat/Calendar/ContainerReader/IndicatorComponent 的构建器/配置/
    // 事件是函数值或语义属性（Repeat.each 不分派就不渲染、Calendar.onSelectChange 失效）；
    // MenuItemGroup/WithTheme 无属性方法，不需要分派
    if (node.__arkuiRepeat && REPEAT_ATTRS[prop]) {
      REPEAT_ATTRS[prop](node, value, extra);
      return;
    }
    if (node.__arkuiCalendar && CALGRID_ATTRS[prop]) {
      CALGRID_ATTRS[prop](node, value, extra);
      return;
    }
    if (node.__arkuiCReader && CREADER_ATTRS[prop]) {
      CREADER_ATTRS[prop](node, value, extra);
      return;
    }
    if (node.__arkuiIndicator && INDIC_ATTRS[prop]) {
      INDIC_ATTRS[prop](node, value, extra);
      return;
    }
    // SideBarContainer（R61）：showSideBar/sideBarWidth/controlButton/onChange 是语义属性
    if (node.__arkuiSideBar && SIDEBAR_ATTRS[prop]) {
      SIDEBAR_ATTRS[prop](node, value);
      return;
    }
    // GridRow/GridCol（R64）：columns/gutter/span/offset 是语义属性
    if (node.__arkuiGridRow && GRIDROW_ATTRS[prop]) {
      GRIDROW_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiGridCol && GRIDCOL_ATTRS[prop]) {
      GRIDCOL_ATTRS[prop](node, value);
      return;
    }
    // Grid（R57）/ GridItem（R57）：columnsTemplate/事件族与跨行跨列是语义属性
    if (node.__arkuiGrid && GRID_ATTRS[prop]) {
      GRID_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiGridItem && GRIDITEM_ATTRS[prop]) {
      GRIDITEM_ATTRS[prop](node, value);
      return;
    }
    // Refresh（R50）：refreshing/refreshOffset/事件是语义属性（函数值抢在通用 on* 前，坑 86）
    if (node.__arkuiRefresh && REFRESH_ATTRS[prop]) {
      REFRESH_ATTRS[prop](node, value);
      return;
    }
    // List.sticky（R49）：StickyStyle（None=0/Header=1/Footer=2/BOTH=3）—— ListItemGroup
    // 的头/尾吸顶由该 List 级属性驱动（样式规则见 main.js arkui-list-style）
    if (node.__arkuiComp === 'List' && prop === 'sticky') {
      node.dataset.sticky = String(Number(resolveResource(value)));
      return;
    }
    // ListItemGroup（R49）：divider/childrenMainSize 两个属性方法（其余是 create 选项）
    if (node.__arkuiLig && prop === 'divider') {
      node.__lig.divider = value && typeof value === 'object' ? value : null;
      return;
    }
    if (node.__arkuiLig && prop === 'childrenMainSize') {
      node.dataset.childrenMainSize = 'recorded';
      layoutWarnings.push('ListItemGroup.childrenMainSize 只记 data-*（服务于真机懒加载估算，DOM 布局无需）');
      return;
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
    // 小件收官（R36）：Span 的字体属性落在自身元素（Text 内联子段语义）；
    // LoadingProgress.color → currentColor（spinner 边框色）；Blank.color → 空白背景色；
    // Flex 的 create 参数在 ensureComponent.create 时由 applyFlexOptions 处理（CSS 同名透传）
    if (node.__arkuiSpan && SPAN_ATTRS[prop]) {
      SPAN_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiLoading && prop === 'color') {
      node.style.color = colorOf(value);
      return;
    }
    if (node.__arkuiBlank && prop === 'color') {
      node.style.backgroundColor = colorOf(value);
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
    if (node.__navDestCbs && (/** @type {Record<string, any>} */ (NAVDEST_LIFECYCLE))[prop]) {
      const kind = (/** @type {Record<string, any>} */ (NAVDEST_LIFECYCLE))[prop];
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
    if ((/** @type {Record<string, any>} */ (GRID_TRACK_PROPS))[prop]) {
      node.style[(/** @type {Record<string, any>} */ (GRID_TRACK_PROPS))[prop]] = normalizeTrackList(resolveResource(value));
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
  /** @type {Record<string, any>} */ const components = {};

  /** @param {string} tag @param {Record<string, string>} style */
  const defaultDom = (tag, style) => () => {
    const el = document.createElement(tag);
    Object.assign(el.style, style || {});
    return el;
  };

  // 组件声明的已知工厂方法（官方工厂名不统一，先显式登记，其余以 /^create/ 兜底）
  /** @type {Record<string, string[]>} */
  const FACTORIES = {
    Button: ['create', 'createWithLabel', 'createWithIcon', 'createWithChild'],
  };

  /** @param {string} name @param {(args: any[]) => Element} domFactory @param {any=} [contentUpdater] */
  function ensureComponent(name, domFactory, contentUpdater) {
    if (components[name]) return components[name];
    const C = function () {};
    C.componentName = name;
    const declared = FACTORIES[name] || ['create'];
    /** @type {Record<string, any>} */ const methods = {};

    /** @param {any} key */
    const isFactory = (key) => declared.includes(key) || /^create/.test(key) || key === 'pop';

    /** @param {...any} args */
    C.create = function (...args) {
      const rec = elmtRecords.get(currentNodeElmtId);
      /** @type {any} */ let node;
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
      /** @param {any} deepFn @param {any} isDeep */
      C.create = function (deepFn, isDeep) {
        const elmtId = currentNodeElmtId;
        const rec = elmtRecords.get(elmtId);
        /** @type {any} */ let node;
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        /** @type {any} */ let node;
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

    // ListItemGroup（R49）：create 选项含 header/footer 两个 CustomBuilder——header 在
    // create 时展开进头槽；footer 推迟到 pop（真机 AdjustMountTreeSequence 保证
    // header→items→footer 序，list_item_group_pattern.cpp:1134）。space 不走通用 gap
    // （gap 会连 header/首项也拉开，违反 d.ts"not spacing between the header and list
    // items"）——间距/divider 在 pop 时按 item 间 margin+::before 落。
    if (name === 'ListItemGroup') {
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        /** @type {any} */ let node;
        if (rec && rec.node && rec.node.__arkuiComp === 'ListItemGroup') {
          node = rec.node;
        } else {
          node = document.createElement('div');
          node.__arkuiComp = 'ListItemGroup';
          node.__arkuiLig = true;
          node.dataset.lig = '';
          node.style.display = 'flex';
          node.style.flexDirection = 'column';
          node.style.alignItems = 'stretch';
          const headerWrap = document.createElement('div');
          headerWrap.setAttribute('data-arkui-lig-header', '');
          node.appendChild(headerWrap);
          node.__lig = { space: 0, spaceWidth: null, divider: null, headerB: null, footerB: null };
          mountNode(node, rec);
        }
        const st = node.__lig;
        const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
        if (typeof o.header === 'function') st.headerB = o.header;
        if (typeof o.footer === 'function') st.footerB = o.footer;
        if (o.space !== undefined) st.space = Number(o.space) || 0;
        if (o.spaceWidth !== undefined) {
          st.spaceWidth = Number(o.spaceWidth);
          node.dataset.spaceWidth = String(st.spaceWidth);
        }
        if (o.style !== undefined) {
          node.dataset.style = String(Number(resolveResource(o.style)));
          if (Number(resolveResource(o.style)) === 1) node.style.borderRadius = '12px';   // CARD 视觉近似
        }
        const headerWrap = node.querySelector('[data-arkui-lig-header]');
        if (st.headerB && headerWrap && !headerWrap.hasChildNodes()) {
          runBuilderInto(headerWrap, st.headerB, 'ListItemGroup.header');
        }
        ViewStackProcessor.push(node);
        return node;
      };
      // 到 pop 才渲染 footer（保证 header→items→footer 序），并落 item 间距/divider
      C.pop = function () {
        const top = ViewStackProcessor.top();
        ViewStackProcessor.pop();
        if (!top || !top.__arkuiLig) return;
        const st = top.__lig;
        if (st.footerB) {
          const footerWrap = document.createElement('div');
          footerWrap.setAttribute('data-arkui-lig-footer', '');
          top.appendChild(footerWrap);
          runBuilderInto(footerWrap, st.footerB, 'ListItemGroup.footer');
        }
        // 间距 = spaceWidth ?? max(space, divider.strokeWidth)（真机 algorithm:106-119 口径）；
        // divider 画在 item 顶缘外 1px 槽（::before 绝对定位，不占 item 高度）
        const items = top.querySelectorAll('[data-arkui-comp="ListItem"]');
        const bw = st.divider ? Math.max(0, Number(st.divider.strokeWidth) || 0) : 0;
        const gap = st.spaceWidth != null ? Math.max(0, Number(st.spaceWidth) || 0)
          : Math.max(st.space, bw);
        items.forEach((/** @type {any} */ item, /** @type {number} */ k) => {
          if (k > 0) item.style.marginTop = `${gap}px`;
          if (st.divider && k > 0) {
            item.setAttribute('data-arkui-lig-div', '');
            item.style.setProperty('--dw', `-${bw}px`);   // 线画在 item 顶缘之外的间距槽里
            item.style.setProperty('--dh', `${bw}px`);
            item.style.setProperty('--dc', colorOf(st.divider.color == null ? '#08000000' : st.divider.color));
            item.style.setProperty('--dml', `${Number(st.divider.startMargin) || 0}px`);
            item.style.setProperty('--dmr', `${Number(st.divider.endMargin) || 0}px`);
          }
        });
      };
    }

    // TabContent：子构建器是【构造参数】，首次构建时立即展开（同 ListItem 的深渲染，防递归再入）
    if (name === 'TabContent') {
      /** @param {any} deepFn */
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        /** @type {any} */ let node;
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        /** @type {any} */ let node;
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
      /** @param {any} deepFn */
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        /** @type {any} */ let node;
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        /** @type {any} */ let node;
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        /** @type {any} */ let node;
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
      /** @param {...any} args */
      C.create = function (...args) {
        const rec = elmtRecords.get(currentNodeElmtId);
        const o = args && args[0];
        /** @type {any} */ let node;
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
      /** @param {any} target @param {any} key */
      get(target, key) {
        if (key in target) return target[key];
        if (typeof key === 'symbol') return undefined;
        if (isFactory(key)) {
          if (!methods[key]) {
            /** @param {...any} args */
            methods[key] = function (...args) {
              const rec = elmtRecords.get(currentNodeElmtId);
              /** @type {any} */ let node;
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
          /** @param {...any} args */
          methods[key] = function (...args) { applyAttr(ViewStackProcessor.top(), key, args[0], args[1]); };
        }
        return methods[key];
      },
    });
    return components[name];
  }

  // ────────────────────── 具体组件 ──────────────────────
  /** @param {any} node @param {any} args */
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

  // ListItemGroup（R49）：List 分组容器——header/items/footer 三段 + item 间距 + divider。
  // 三个不做通用映射的点（.d.ts 原文）：space 只作用于 item 间（header/footer 不参与）；
  // spaceWidth 压过 space；divider 实际间距 = max(space, strokeWidth)。sticky 见下条样式。
  if (!document.getElementById('arkui-list-style')) {
    const lst = document.createElement('style');
    lst.id = 'arkui-list-style';
    lst.textContent = ''
      + '[data-arkui-comp="List"][data-sticky="1"] [data-arkui-lig-header]{position:sticky;top:0;z-index:1;background:inherit;}'
      + '[data-arkui-comp="List"][data-sticky="2"] [data-arkui-lig-footer]{position:sticky;bottom:0;z-index:1;background:inherit;}'
      + '[data-arkui-comp="List"][data-sticky="3"] [data-arkui-lig-header]{position:sticky;top:0;z-index:1;background:inherit;}'
      + '[data-arkui-comp="List"][data-sticky="3"] [data-arkui-lig-footer]{position:sticky;bottom:0;z-index:1;background:inherit;}'
      + '[data-arkui-lig-div]{position:relative;}'
      + '[data-arkui-lig-div]::before{content:"";position:absolute;top:var(--dw,0);left:var(--dml,0);right:var(--dmr,0);height:var(--dh,0);background:var(--dc,transparent);}';
    document.head.appendChild(lst);
  }
  const ListItemGroup = ensureComponent('ListItemGroup',
    defaultDom('div', { display: 'flex', flexDirection: 'column', alignItems: 'stretch' }));

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
  /** @param {HTMLElement} startEl */
  function nearestScrollable(startEl) {
    let p = startEl.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.clientHeight > 0) return p;
      p = p.parentElement;
    }
    return startEl.parentElement;
  }

  /** @param {any} id @param {any} view @param {any} source @param {any} itemGen @param {any} keyGen */
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

    // @type 档位：scrollEl/window/prefix 都是 null↔对象 摆动，onScroll 等后挂 → 整袋 any
    const state = /** @type {any} */ ({
      total: typeof source.totalCount === 'function' ? source.totalCount() : 0,
      estItemH: 26,                                  // 未实测项的【估计高度】（不含 gap）
      heights: new Map(),                            // index → 实测高度（不含 gap）
      gap: parentGap,
      /** @type {any} */ prefix: null,               // 累计偏移（长度 total+1），懒算
      prefixDirty: true,
      window: [-1, -1], scrollEl: null, tid: 0, passes: 0,
    });
    lazyMeta.set(holder, state);

    // advance 取整：布局最终落在整像素上（spacer 的 px 高度会被浏览器取整），
    // 模型若保留小数，累积到几千像素后会与真实 DOM 差出零点几到一像素。
    // 估计值本身保留小数（均值更准），只在"一步前进多少"这一步取整。
    /** @param {number} i */
    const advanceOf = (i) => Math.round((state.heights.has(i) ? state.heights.get(i) : state.estItemH) + state.gap);
    function rebuildPrefix() {
      const p = new Float64Array(state.total + 1);
      for (let i = 0; i < state.total; i++) p[i + 1] = p[i] + advanceOf(i);
      state.prefix = p;
      state.prefixDirty = false;
    }
    /** @param {number} i */
    const offsetOf = (i) => {
      if (state.prefixDirty || !state.prefix || state.prefix.length !== state.total + 1) rebuildPrefix();
      const k = Math.max(0, Math.min(state.total, i | 0));
      return state.prefix[k];
    };
    // 总高：最后一项后面没有 gap
    const totalHOf = () => offsetOf(state.total) - (state.total ? state.gap : 0);
    // 二分：最大的 i 使 offset(i) <= y
    /** @param {number} y */
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

    /** @param {number=} [depth] */
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
        const freshItems = /** @type {HTMLElement[]} */ ([...holder.querySelectorAll('[data-arkui-comp="ListItem"]')]);
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
      const rendered = /** @type {HTMLElement[]} */ ([...holder.querySelectorAll('[data-arkui-comp="ListItem"]')]);
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
    if ((/** @type {any} */ (global)).__arkui_dom_logs) {
      (/** @type {any} */ (global)).__arkui_dom_logs.push({ t: 'lazyForEach.mounted', id: String(id), total: state.total, estItemH: state.estItemH });
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
  /** @param {any} v */
  const shapeDim = (v) => {
    const n = dimOf(v, 0);
    return Number.isFinite(n) && n > 0 ? n : 0;   // .d.ts：无效值（undefined/null/NaN/Infinity）按默认 0
  };

  /** @param {string} tag @param {number} w @param {number} h */
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

  /** @param {any} v */
  const pointsAttr = (v) => (Array.isArray(v) ? v : [])
    .map((p) => `${Number(resolveResource(p[0]))},${Number(resolveResource(p[1]))}`)
    .join(' ');

  // 属性分派表：applyAttr 里 `node.__shapeEl && SHAPE_ATTRS[prop]` 一分支全收
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
  /** @param {string} name @param {{tag: string, geometry: (el: any, o: any, w: number, h: number) => void, [k: string]: any}} build */
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

  /** @param {string} name @param {string} type @param {(el: any, o: any) => void} setup */
  function inputComponent(name, type, setup) {
    return ensureComponent(name, (args) => {
      const el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      el.style.display = 'inline-block';
      el.__arkuiInput = name === 'Slider' ? 'slider' : 'input';
      if (type && type !== 'textarea') (/** @type {any} */ (el)).type = type;
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
  /** @type {Map<string, any>} */
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
    /** @param {any} v @param {number} d */
    const num = (v, d) => { const n = Number(resolveResource(v)); return Number.isFinite(n) ? n : d; };
    el.min = String(num(o.min, 0));                       // .d.ts 默认：min 0、max 100
    el.max = String(num(o.max, 100));
    el.step = String(num(o.step, 1));
    el.value = String(num(o.value, num(o.min, 0)));
  });

  // ── 输入收官（R34）：TextInput / TextArea / Search ──
  // 产物形态（实测 fixtures/pages/TextDemo.ts）：
  //   TextInput.create({placeholder, text, controller})；TextArea.create({placeholder})；
  //   Search.create({value})；.maxLength(n)；.caretColor；onChange 双参（value + previewText?，
  //   text_common.d.ts："EditableTextOnChangeCallback = (value, previewText?, options?)"）；
  //   onSubmit((enterKey, event) => …)（SubmitEvent 可按住软键盘收起等，DOM 无对应）；
  //   TextInputController（caretPosition 等，按需补面）
  // DOM 映射：沿用原生 input/textarea 基座；maxLength/caretColor/placeholder 直落原生属性；
  // onChange 沿用通用 input 事件（单参 value）——DOM 无 previewText 对应（取舍已记录）；
  // onSubmit 在通用 on* 规则前拦截：keydown Enter 时派发 (EnterKeyType, SubmitEvent)。
  // TextInputController：caretPosition/caretAnimationTime 等按需补面（本轮只挂基座 + 绑定）
  const TextInputControllerBase = class {
    constructor() { this.__arkuiEditable = null; }
    /** @param {any} el */
    __arkuiBindEditable(el) { this.__arkuiEditable = el; }
    /** @param {number} pos */
    caretPosition(pos) {
      if (this.__arkuiEditable) this.__arkuiEditable.setSelectionRange(pos, pos);
    }
  };
  const TextInputController = class extends TextInputControllerBase {};
  // EnterKeyType 的数值来自 .d.ts 原文（Go=2…NEW_LINE=8；0/1 未声明——产物没引用就不挂）
  const EnterKeyType = { Go: 2, Search: 3, Send: 4, Next: 5, Done: 6, PREVIOUS: 7, NEW_LINE: 8 };
  const TextInput = inputComponent('TextInput', 'text', (el, o) => {
    if (o.placeholder !== undefined) el.dataset.placeholder = String(resolveResource(o.placeholder));
    if (o.text !== undefined) el.value = String(resolveResource(o.text));
    if (o.controller && typeof o.controller.__arkuiBindEditable === 'function') {
      o.controller.__arkuiBindEditable(el);
    }
  });
  const TextArea = inputComponent('TextArea', 'textarea', (el, o) => {
    if (o.placeholder !== undefined) el.dataset.placeholder = String(resolveResource(o.placeholder));
  });
  const Search = inputComponent('Search', 'search', (el, o) => {
    if (o.value !== undefined) el.value = String(resolveResource(o.value));
    if (o.placeholder !== undefined) el.dataset.placeholder = String(resolveResource(o.placeholder));
  });
  const Hyperlink = ensureComponent('Hyperlink', (args) => {
    const el = document.createElement('a');
    el.__arkuiLink = true;
    el.__arkuiHref = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    el.href = el.__arkuiHref;                              // <a> 语义：href 直落
    el.target = '_blank';                                  // 外链新开（实现选择）
    const text = args && args[1] !== undefined ? String(resolveResource(args[1])) : '';
    if (text) el.textContent = text;                       // 无子组件时显示 content（JSDoc 原文）
    return el;
  });

  // 输入类的语义属性：select/checked 落状态（**按上次应用的值做幂等 diff**——源码里是静态
  // 字面量，重渲染再应用同值必须是无操作；否则用户交互后的每次重渲染都会把状态拉回去，
  // 还连带触发组内互斥的 change —— inputdemo 首跑当场抓住）；selectedColor 落 accent-color；
  // 原生控件没有对应物的照实记 data-*（不静默）
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
    // 文本输入收官（R34）
    maxLength: (n, v) => { n.maxLength = Number(resolveResource(v)); },          // 原生截断
    caretColor: (n, v) => { n.style.caretColor = colorOf(v); },
    // enterKeyType 落 data-enter-key，onSubmit 的 wrapper 按它取回调整数（.d.ts：Go=2…NEW_LINE=8）
    enterKeyType: (n, v) => { n.setAttribute('data-enter-key', String(Number(resolveResource(v)))); },
    onSubmit: (n, v) => {
      // ArkUI 签名：(enterKey, event: SubmitEvent)。DOM 在 keydown Enter 时派发
      // （原生 input 无 submit 事件——必须拦在通用 on* 规则之前，坑 86 同族）。
      // enterKey 未设时取 Done(6)（.d.ts 默认值原文："Default value: EnterKeyType.Done"）。
      // （R38 修复：此前的 wrapper 里写的是 `value(...)`——未定义标识符，Enter 一按就
      // ReferenceError 且被本 try/catch 吞掉，表现为"派发未打通"之谜；tsc --checkJs 抓出。）
      const wrapper = (/** @type {KeyboardEvent} */ e) => {
        if (e.target !== n) return;
        const key = n.getAttribute('data-enter-key');
        const enterKey = key !== null ? Number(key) : EnterKeyType.Done;
        try { v(enterKey, { keepEditable: true }); }
        catch (err) { layoutWarnings.push(`onSubmit 派发抛错：${err && err.message}`); }
      };
      if (!n.__arkuiEv) n.__arkuiEv = {};
      if (n.__arkuiEv.keydown) n.removeEventListener('keydown', n.__arkuiEv.keydown);
      n.__arkuiEv.keydown = wrapper;
      n.addEventListener('keydown', wrapper);
    },
    color: (n, v) => { if (n.__arkuiLink) n.style.color = colorOf(v); },     // Hyperlink.color
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

  // Marquee：overflow 容器 + 内层文本跑 CSS 动画。时长照真机公式（R40，marquee_pattern.cpp
  // PlayMarqueeAnimation）：duration = |end−start| × 85 / step（DEFAULT_MARQUEE_SCROLL_DELAY
  // = 85.0ms，LINEAR；step 默认 6vp（.d.ts @default 6），step > 文本宽时按 6 兜底，step≤0
  // 不除）。LEFT 方向的距离 = 容器宽 + 文本宽（右缘外进场 → 完全滚出）——用 CSS 变量把
  // 每例的真实起止像素喂给 keyframes。真机在布局后才算时长，所以动画在 setTimeout(0)
  // 启动（不变量 18）。事件走 animation 生命周期：animationstart → onStart、
  // animationend → onFinish（loop 次数 = 迭代次数）；fromStart 默认 true（JSDoc）。
  if (!document.getElementById('arkui-marquee-keyframes')) {
    const kf = document.createElement('style');
    kf.id = 'arkui-marquee-keyframes';
    kf.textContent = '@keyframes arkuiMarquee{from{transform:translateX(var(--mq-from,200%))}'
      + 'to{transform:translateX(var(--mq-to,-100%))}}';
    document.head.appendChild(kf);
  }
  const Marquee = ensureComponent('Marquee', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const root = document.createElement('div');
    root.__arkuiShow = 'Marquee';
    root.dataset.marquee = '';
    root.style.display = 'block';            // 真机占满行宽（marqueeSize.Width() = 容器宽，R40）
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
      // 真机在布局后用真实宽高算时长 → 这里也等挂载后（同步阶段，不变量 18）再启动
      setTimeout(() => {
        const textW = Math.max(1, inner.offsetWidth);
        const rootW = Math.max(0, root.clientWidth);
        const dist = rootW + textW;
        // R44 照真机分支（marquee_pattern.cpp）：step>文本宽 → 按默认 6 兜底；
        // step≤0 → 【不除】（duration = 距离×85，一圈会非常慢——真机如此，不替它"修正"）
        let stepPx = Number(root.dataset.step);
        const divide = Number.isFinite(stepPx) && stepPx > 0;
        if (divide && stepPx > textW) stepPx = 6;
        const ms = Math.max(1, divide ? Math.round(dist * 85 / stepPx) : Math.round(dist * 85));
        inner.style.setProperty('--mq-from', `${rootW}px`);   // 起点右缘外
        inner.style.setProperty('--mq-to', `${-textW}px`);    // 终点完全滚出
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
      }, 0);
    }
    return root;
  });

  // 语义属性分派（applyAttr 里抢在通用落点之前）：Divider 三件 + Marquee 字体 +
  // Counter 的 onInc/onDec/enable（函数值，必须拦在通用 on* 规则之前）
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SHOW_ATTRS = {
    onInc: (n, v) => { (/** @type {any} */ (n.__counterCbs = n.__counterCbs || {})).inc = v; },
    onDec: (n, v) => { (/** @type {any} */ (n.__counterCbs = n.__counterCbs || {})).dec = v; },
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
    onStart: (n, v) => { (/** @type {any} */ (n.__marqueeCbs = n.__marqueeCbs || {})).start = v; },
    onBounce: (n, v) => { (/** @type {any} */ (n.__marqueeCbs = n.__marqueeCbs || {})).bounce = v; },
    onFinish: (n, v) => { (/** @type {any} */ (n.__marqueeCbs = n.__marqueeCbs || {})).finish = v; },
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
  // 编码器是**真机源码直接复用**（R41：global.ArkuiQrcodegen = OHOS arkui_qrcodegen 的
  // C++ 源码 → WASM 单文件加载器，src/ 逐字复制零修改 + securec 兼容 glue，见
  // THIRD-PARTY-NOTICES §3b 与 vendor 内 build.sh）。ECC 照真机组件硬编码 MEDIUM
  //（qrcode_modifier.cpp:44，枚举仅 MEDIUM=0/HIGH=1）。未加载 vendor 时记警告并降级
  // 为不渲染（不静默、不假画）。
  // 渲染走渲染后同步阶段（redrawQr，由 syncDrawings 调用——绘制要等尺寸生效，不变量 18）：
  // canvas 内容尺寸 = 组件尺寸（1:1），模块边长 = floor(尺寸/总模块数)。quiet zone 保留
  // 4 模块（QR 规范 + jsQR 解码依赖）——已知渲染差异：真机组件 API12+ 满幅绘制无 quiet。
  // 颜色变化 → 整幅重画。
  // ArkUI 的 8 位颜色字面量是【ARGB】（'#ff000000' = 不透明黑，JSDoc 原文默认），CSS 是 RRGGBBAA
  // ——位数歧义必须归一，否则默认前景画成全透明（首跑当场抓住：解码 null）。
  /** @param {any} c */
  const qrColor = (c) => {
    const s = colorOf(c);
    return s[0] === '#' && s.length === 9 ? '#' + s.slice(3) + s.slice(1, 3) : s;
  };
  /** @param {any} el */
  function redrawQr(el) {
    if (!(/** @type {any} */ (global)).ArkuiQrcodegen || typeof (/** @type {any} */ (global)).ArkuiQrcodegen.encode !== 'function') {
      layoutWarnings.push('QRCode 编码器 vendor 未加载（runtime/vendor/arkui-qrcodegen.js）——降级为不渲染');
      delete el.__arkuiQrPending;
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
      // 真机编码器：arkui_qrcodegen 的 QrcodeImageEncodeString，ECC 恒 MEDIUM(0)
      //（qrcode_modifier.cpp:44 硬编码）。返回 {version,width,data}，data[i]&1 = 暗格。
      const matrix = (/** @type {any} */ (global)).ArkuiQrcodegen.encode(value, 0);
      if (!matrix) return;                                    // 编码失败（内容非法）
      // R44 照真机守卫（qrcode_modifier.cpp:55）：组件尺寸小于矩阵模块数 → 拒绝绘制
      //（真机：LessNotEqual(qrCodeSize, qrWidth) 即记错误返回；我们含 quiet zone，
      // 需要的空间 = 矩阵宽 + 8，故按 total 比较——真机无 quiet，其 total 即 qrWidth）
      const quiet = 4;                                        // quiet zone 4 模块（渲染差异已记录）
      const total = matrix.size + quiet * 2;
      if (Math.min(w, h) < total) {
        layoutWarnings.push(`QRCode 组件尺寸 ${Math.min(w, h)}px 小于矩阵所需 ${total}px`
          + `（矩阵 ${matrix.size}+quiet 8）——照真机拒绝绘制`);
        delete el.__arkuiQrPending;   // 只尝试一次（与成功路径一致；颜色变化会显式重画）
        return;
      }
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
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
    (Array.isArray(args && args[0]) ? args[0] : []).forEach(/** @param {any} opt */ (opt) => {
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
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
    onChange: (n, v) => { (/** @type {any} */ (n.__popupCbs = n.__popupCbs || {})).onChange = v; },   // MenuItem 的回调（点击切换见工厂）
  };

  // Select.onSelect 的双参派发（特殊签名，拦在通用 on* 规则之前）：change 事件 → (index, value)。
  // 编程改 selectedIndex 不派发（DOM 语义取舍已记录）；测试用 dispatchEvent('change') 驱动。
  /** @param {any} node @param {any} cb */
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
    /** @param {any} settings */
    constructor(settings) {
      /** @type {any} */ this.__arkuiSettings = settings;   // antialias/alpha 在浏览器 2D 里无对应开关（取舍已记录）
      /** @type {any} */ this.__arkuiCanvas = null;
      /** @type {any} */ this.__arkuiNative = null;
    }
    // Canvas 组件绑定时调用：把原生 2D context 借给它
    /** @param {any} canvasEl */
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
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    fillRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.fillRect(x, y, w, h); }
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    strokeRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.strokeRect(x, y, w, h); }
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    clearRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.clearRect(x, y, w, h); }
    /** @param {any} t @param {number} x @param {number} y @param {number=} [w] */
    fillText(t, x, y, w) { if (this.__arkuiNative) this.__arkuiNative.fillText(String(t), x, y, w); }
    /** @param {any} t @param {number} x @param {number} y @param {number=} [w] */
    strokeText(t, x, y, w) { if (this.__arkuiNative) this.__arkuiNative.strokeText(String(t), x, y, w); }
    beginPath() { if (this.__arkuiNative) this.__arkuiNative.beginPath(); }
    closePath() { if (this.__arkuiNative) this.__arkuiNative.closePath(); }
    /** @param {number} x @param {number} y */
    moveTo(x, y) { if (this.__arkuiNative) this.__arkuiNative.moveTo(x, y); }
    /** @param {number} x @param {number} y */
    lineTo(x, y) { if (this.__arkuiNative) this.__arkuiNative.lineTo(x, y); }
    /** @param {number} x @param {number} y @param {number} r @param {number} a0 @param {number} a1 */
    arc(x, y, r, a0, a1) { if (this.__arkuiNative) this.__arkuiNative.arc(x, y, r, a0, a1); }
    fill() { if (this.__arkuiNative) this.__arkuiNative.fill(); }
    stroke() { if (this.__arkuiNative) this.__arkuiNative.stroke(); }
    /** @param {number} sx @param {number} sy @param {number} sw @param {number} sh */
    getImageData(sx, sy, sw, sh) { return this.__arkuiNative ? this.__arkuiNative.getImageData(sx, sy, sw, sh) : null; }
    /** @param {any} img @param {number} x @param {number} y */
    putImageData(img, x, y) { if (this.__arkuiNative) this.__arkuiNative.putImageData(img, x, y); }
    /** @param {string=} [type] @param {number=} [quality] */
    toDataURL(type, quality) {
      return this.__arkuiCanvas ? this.__arkuiCanvas.toDataURL(type, quality) : '';
    }
  };
  const RenderingContextSettings = class RenderingContextSettings {
    /** @param {boolean=} [antialias] @param {boolean=} [alpha] */
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
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
    /** @param {any} el */
    __arkuiBindXComponent(el) { this.__arkuiXcEl = el; }
    getXComponentSurfaceId() {
      return 'XComponent-' + (this.__arkuiXcEl ? this.__arkuiXcEl.__arkuiXcId : '');
    }
    getXComponentContext() { return { surfaceId: this.getXComponentSurfaceId() }; }
    /** @param {any} rect */
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
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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

  // ────────────────── Image 组件（R45）：真实 <img> 基座 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/ImageDemo.ts）：
  //   Image.create('test-assets/known-7x3.png');   ← create 单参（ResourceStr）
  //   Image.objectFit(ImageFit.Contain);           ← ImageFit 是自由变量（数值 0..5/7..16）
  //   Image.alt('…'); Image.onError(cb); Image.onComplete(cb); Image.syncLoad(true);
  //
  // DOM 映射：根 = div（position:relative），内含主 <img> + alt 占位 <img>（绝对定位垫底，
  // 主图加载成功前/失败时可见——真机 alt 语义："placeholder image displayed during loading"）。
  // objectFit → CSS object-fit（Contain→contain / Cover→cover / Fill→fill / ScaleDown→
  // scale-down / None→none——枚举语义与 CSS 关键字一一同名对齐；Auto 记 data-* 不映射；
  // 对齐族 7..16 → object-position；MATRIX 记警告）。事件：load → onComplete（载荷含真实
  // 解码尺寸）→ onLoad、error → onError。syncLoad 只记 data-*（浏览器默认即主线程解码）。
  // 回调经 __imgCbs 闭包间接引用（覆盖语义，坑 88 同族）；图已缓存完成时补派发（定时器
  // 收口，坑 ⑧ 同思想）。
  /** @type {Record<string, string>} */
  const IMAGE_FIT_CSS = { 0: 'contain', 1: 'cover', 3: 'fill', 4: 'scale-down', 5: 'none' };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const IMAGE_ATTRS = {
    objectFit: (n, v) => {
      const fit = Number(resolveResource(v));
      n.dataset.objectFit = String(fit);
      const css = IMAGE_FIT_CSS[fit];
      const main = n.querySelector('[data-arkui-img-main]');
      const altImg = n.querySelector('[data-arkui-img-alt]');
      if (css) {
        if (main) main.style.objectFit = css;
        if (altImg) altImg.style.objectFit = css;
      } else if (fit >= 7 && fit <= 15) {
        layoutWarnings.push(`Image.objectFit 的对齐档位 ${fit} 未实现（需 object-position 组合，记 data-*）`);
      } else if (fit === 16) {
        layoutWarnings.push('Image.objectFit MATRIX 未实现（记 data-*）');
      }
      // Auto(2)：真机"自适应"，取基座默认 stretch——如实不映射
    },
    alt: (n, v) => {
      const altImg = n.__arkuiImgEnsureAlt();
      altImg.src = String(resolveResource(v));
      n.dataset.alt = String(resolveResource(v));
      n.__arkuiImgTryAlt();
    },
    syncLoad: (n, v) => { n.dataset.syncLoad = String(!!resolveResource(v)); },
    draggable: (n, v) => { n.dataset.draggable = String(!!resolveResource(v)); },
    interpolate: (n, v) => { n.dataset.interpolate = String(!!resolveResource(v)); },
    onLoad: (n, v) => { (/** @type {any} */ (n.__imgCbs = n.__imgCbs || {})).load = v; (/** @type {() => void} */ (n.__arkuiImgFireIfDone))(); },
    onComplete: (n, v) => { (/** @type {any} */ (n.__imgCbs = n.__imgCbs || {})).complete = v; (/** @type {() => void} */ (n.__arkuiImgFireIfDone))(); },
    onError: (n, v) => { (/** @type {any} */ (n.__imgCbs = n.__imgCbs || {})).error = v; (/** @type {() => void} */ (n.__arkuiImgFireIfDone))(); },
  };
  const Image = ensureComponent('Image', (args) => {
    const el = document.createElement('div');
    el.__arkuiImage = true;
    el.dataset.image = '';
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    const main = document.createElement('img');
    main.setAttribute('data-arkui-img-main', '');
    main.style.display = 'block';
    main.style.width = '100%';
    main.style.height = '100%';
    // alt 占位图**惰性创建**（R45 教训：预插的无 src <img> 会被页面的 querySelector('img')
    // 命中、getAttribute('src') 为 null——widgets 页的旧断言就是这么红的）
    /** @type {any} */ let altImg = null;
    const ensureAlt = () => {
      if (!altImg) {
        altImg = document.createElement('img');
        altImg.setAttribute('data-arkui-img-alt', '');
        altImg.style.display = 'none';
        altImg.style.position = 'absolute';
        altImg.style.inset = '0';
        altImg.style.width = '100%';
        altImg.style.height = '100%';
        el.insertBefore(altImg, main);
      }
      return altImg;
    };
    el.appendChild(main);
    const s0 = args && args[0] !== undefined && args[0] !== null ? resolveResource(args[0]) : null;
    if (s0 != null) {
      main.src = String(s0);
    } else if (args && args[0] !== undefined) {
      // Resource 形态解析不出 URL：如实记 data-src，不伪造 src='null'
      el.dataset.src = String(args[0]);
      layoutWarnings.push(`Image.create 的资源参数无法解析为 URL（${String(args[0])}），记 data-src`);
    }
    el.__arkuiImgEnsureAlt = ensureAlt;
    el.__arkuiImgTryAlt = () => {
      // alt 语义：主图还没成功加载（含加载失败）→ 占位图顶上
      if (altImg && altImg.src && !main.complete) {
        altImg.style.display = 'block';
      }
    };
    if (altImg) el.__arkuiImgTryAlt();
    // 事件收口（坑 ⑧ 同思想）：load/error 都可能晚于属性挂载到达——回调经 __imgCbs 间接
    // 引用（覆盖语义）；img.complete 已成立时用定时器补派发，动画事件只当见证
    main.addEventListener('load', () => {
      if (altImg) altImg.style.display = 'none';
      el.__arkuiImgLoaded = true;
      (/** @type {() => void} */ (el.__arkuiImgFireIfDone))();
    });
    main.addEventListener('error', () => {
      el.__arkuiImgFailed = true;
      if (altImg && altImg.src) altImg.style.display = 'block';
      (/** @type {() => void} */ (el.__arkuiImgFireIfDone))();
    });
    el.__arkuiImgFireIfDone = () => {
      const cbs = el.__imgCbs;
      if (!cbs) return;
      /** @param {any} name @param {any} arg */
      const fire = (name, arg) => {
        if (typeof cbs[name] !== 'function') return;
        const cb = cbs[name];
        cbs[name] = undefined;   // 同步认领：双事件（load+补派发）只会真正跑一次
        setTimeout(() => {
          try { cb(arg); }
          catch (e) { layoutWarnings.push(`Image.${name} 回调抛错：${e && e.message}`); }
        }, 0);
      };
      if (el.__arkuiImgLoaded) {
        fire('complete', {
          loadingStatus: 0,
          width: main.naturalWidth,
          height: main.naturalHeight,
          componentWidth: el.offsetWidth,
          componentHeight: el.offsetHeight,
          contentWidth: main.naturalWidth,
          contentHeight: main.naturalHeight,
        });
        fire('load', undefined);
        cbs.complete = undefined;   // 载荷回调只在加载完成时发一次（重渲染重挂安全）
        cbs.load = undefined;
      } else if (el.__arkuiImgFailed) {
        fire('error', undefined);
        cbs.error = undefined;
      }
    };
    (/** @type {() => void} */ (el.__arkuiImgFireIfDone))();
    return el;
  });

  // ────────────────── ImageAnimator 帧动画（R47）：真实 <img> 基座 + 逐帧定时器 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/AnimatorDemo.ts）：
  //   ImageAnimator.create();
  //   ImageAnimator.images([{src,…},…]);  ← ImageFrameInfo：src 必填，单帧可带 duration(ms)
  //   ImageAnimator.duration(200);        ← 每帧 ms（.d.ts Default 1000；单帧 duration 优先）
  //   ImageAnimator.iterations(2);        ← 迭代次数（Default 1；-1 无限）
  //   ImageAnimator.state(this.st);       ← AnimationStatus（Initial=0/Running=1/Paused=2/Stopped=3）
  //   ImageAnimator.onStart/onPause/onRepeat/onCancel/onFinish
  //   （本 SDK 的 d.ts **没有 onFrame 属性**——不要照旧文档实现）
  //
  // DOM 映射：根 = div + 主 <img>；引擎 = 逐帧 setTimeout（headless 虚拟时间下确定，坑 ⑧ 同族
  // 不会踩：不用 rAF）。Running→逐帧推进+迭代计数；Paused→停表保持当前帧；Stopped→停表回
  // 第一帧；播完 iterations → 状态落 Stopped、发 onFinish（保持末帧）。回调**延时派发**：
  // state 属性先于 onStart 应用，同步发会丢（实测）；重渲染重复应用 images/state 需深 diff/
  // 同值守卫（坑 88 同族）。reverse 反向播放未实现（记警告）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const ANIMATOR_ATTRS = {
    images: (n, v) => {
      const an = n.__an;
      const frames = Array.isArray(v) ? v : [];
      const key = frames.map((f) => String((f && f.src != null) ? resolveResource(f.src) : '')).join('|');
      if (an.framesKey === key) return;          // 重渲染同帧序列 → 无操作（防重置帧序）
      an.framesKey = key;
      an.frames = frames;
      an.idx = 0; an.cycle = 0;
      an.show(0);
      if (an.state === 1) an.schedule();         // images 晚于 state 应用时补启动
    },
    duration: (n, v) => {
      const d = Number(resolveResource(v));
      n.__an.duration = d > 0 ? d : 1000;        // 负值/0 用默认（.d.ts："negative → default"）
    },
    iterations: (n, v) => {
      const i = Number(resolveResource(v));
      n.__an.iterations = i === -1 ? Infinity : (i >= 1 ? i : 1);
    },
    state: (n, v) => { n.__anApplyState(v); },
    reverse: (n, v) => {
      n.dataset.reverse = String(!!resolveResource(v));
      if (resolveResource(v)) layoutWarnings.push('ImageAnimator.reverse 反向播放未实现（记 data-*）');
    },
    fixedSize: (n, v) => { n.dataset.fixedSize = String(!!resolveResource(v)); },
    onStart: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).start = v; },
    onPause: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).pause = v; },
    onRepeat: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).repeat = v; },
    onCancel: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).cancel = v; },
    onFinish: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).finish = v; },
  };
  const ImageAnimator = ensureComponent('ImageAnimator', (args) => {
    const el = document.createElement('div');
    el.__arkuiAnimator = true;
    el.dataset.animator = '';
    el.dataset.state = '0';
    el.dataset.frame = '0';
    el.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.setAttribute('data-arkui-animator-main', '');
    img.style.display = 'block';
    img.style.width = '100%';
    img.style.height = '100%';
    el.appendChild(img);
    el.__anCbs = {};
    el.__an = {
      frames: [], framesKey: '', duration: 1000, iterations: 1, reverse: false, fixedSize: true,
      state: 0, idx: 0, cycle: 0, timer: null, started: false,
      show: /** @param {number} i */ (i) => {
        el.__an.idx = i;
        const f = el.__an.frames[i];
        if (f && f.src != null) img.src = String(resolveResource(f.src));
        el.dataset.frame = String(i);
      },
    };
    const an = el.__an;
    /** @param {string} name */
    const fire = (name) => {
      // 延时派发：state 属性先于 onStart/onFinish 应用（产物顺序实测），同步发会丢
      setTimeout(() => {
        const cb = el.__anCbs && el.__anCbs[name];
        if (typeof cb === 'function') {
          try { cb(); }
          catch (e) { layoutWarnings.push(`ImageAnimator.${name} 回调抛错：${e && e.message}`); }
        }
      }, 0);
    };
    const stopTimer = () => { if (an.timer) { clearTimeout(an.timer); an.timer = null; } };
    const schedule = () => {
      stopTimer();
      if (an.state !== 1 || !an.frames.length) return;
      const f = an.frames[an.idx];
      const d = (f && f.duration) || an.duration;   // 单帧 duration 优先（.d.ts 原文）
      an.timer = setTimeout(() => {
        let ni = an.idx + 1;
        if (ni >= an.frames.length) {
          an.cycle += 1;
          if (an.cycle >= an.iterations) {
            an.state = 3;                              // 播完：状态落 Stopped（保持末帧）
            el.dataset.state = '3';
            fire('finish');
            return;
          }
          fire('repeat');
          ni = 0;
        }
        an.show(ni);
        schedule();
      }, d);
    };
    el.__anApplyState = (nv) => {
      nv = Number(nv);
      if (nv === an.state) return;                 // 重渲染重复应用同值 → 无操作
      const prev = an.state;
      an.state = nv;
      el.dataset.state = String(nv);
      if (nv === 1) {                              // → Running
        if (!an.started) { an.started = true; fire('start'); }
        schedule();
      } else if (nv === 2) {                       // → Paused：停表保持当前帧
        stopTimer();
        if (prev === 1) fire('pause');
      } else if (nv === 3) {                       // → Stopped：停表回第一帧
        stopTimer();
        an.idx = 0; an.cycle = 0; an.show(0);
        if (prev === 1) fire('cancel');
      } else {                                     // → Initial：复位（含 started，重启会再发 start）
        stopTimer(); an.idx = 0; an.cycle = 0; an.started = false; an.show(0);
      }
    };
    return el;
  });

  // ────────────────── Refresh 下拉刷新（R50）：pointer 驱动状态机 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/RefreshDemo.ts）：
  //   Refresh.create({ refreshing: bool });      ← refreshing 支持 $ 双向（真机回写）
  //   Refresh.onStateChange((s)=>…); Refresh.onRefreshing(…); Refresh.onOffsetChange((vp)=>…);
  //   Refresh.refreshOffset(50); .maxPullDownDistance(80); .pullDownRatio(1);
  //   .pullToRefresh(false);
  //
  // 状态机（refresh.d.ts:28-86，真机 refresh_constant.h 同序）：Inactive=0 → Drag=1
  // （下拉 < refreshOffset）→ OverDrag=2（≥ refreshOffset）→ 松手：OverDrag 且
  // pullToRefresh → Refresh=3（回弹到 refreshOffset 并保持）→ refreshing=false → Done=4
  // （回初始位，内部归 Idle 不再发 0）。事件顺序照真机（refresh_pattern.cpp:704-710）：
  // 回写 → onRefreshing → onStateChange；同值不重复发。
  //
  // DOM 映射：根 = div（overflow hidden），唯一子组件整体 translateY 跟手（Refresh 无
  // builder/refreshingContent 时真机也是"调整子组件 translate"，refresh.d.ts:90-113）；
  // Refresh 态回弹到 refreshOffset 并保持（内容下移让出指示区——默认指示器未绘制，
  // 见 CAPABILITY 限制）。指针只收 pointerType='touch'（真机 SetIsAllowMouse(false)，
  // refresh_pattern.cpp:215 / refresh.d.ts:248）。松手回弹/Done 复位用 setTimeout
  // （350ms，坑 ⑧：不用 rAF）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const REFRESH_ATTRS = {
    refreshing: (n, v) => { n.__rfApplyRefreshing(!!resolveResource(v)); },
    refreshOffset: (n, v) => {
      const d = Number(resolveResource(v));
      n.__rf.offset = d > 0 ? d : 64;          // 0/负 → 默认 64（.d.ts 原文）
      n.dataset.refreshOffset = String(n.__rf.offset);
    },
    pullToRefresh: (n, v) => {
      n.__rf.pullToRefresh = !!resolveResource(v);
      n.dataset.pullToRefresh = String(n.__rf.pullToRefresh);
    },
    pullDownRatio: (n, v) => {
      const r = Number(resolveResource(v));
      n.__rf.ratio = Math.min(1, Math.max(0, r));
      n.dataset.pullDownRatio = String(n.__rf.ratio);
    },
    maxPullDownDistance: (n, v) => {
      const d = Number(resolveResource(v));
      n.__rf.maxPull = d < 0 ? 0 : d;          // undefined/null 不设限（保持 null）
      n.dataset.maxPullDownDistance = String(n.__rf.maxPull);
    },
    onStateChange: (n, v) => { (/** @type {any} */ (n.__rfCbs = n.__rfCbs || {})).state = v; },
    onRefreshing: (n, v) => { (/** @type {any} */ (n.__rfCbs = n.__rfCbs || {})).refreshing = v; },
    onOffsetChange: (n, v) => { (/** @type {any} */ (n.__rfCbs = n.__rfCbs || {})).offset = v; },
  };
  const Refresh = ensureComponent('Refresh', (args) => {
    const el = document.createElement('div');
    el.__arkuiRefresh = true;
    el.dataset.refresh = '';
    el.dataset.refreshState = '0';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    el.__rf = {
      offset: 64,                                // .d.ts：promptText 未设默认 64
      ratio: null,                               // 未设 → 动态阻尼；实现取线性 1（近似，标注）
      maxPull: null, pullToRefresh: true,
      state: 0,                                  // 内部状态（与 dataset 的"最后派发值"分离）
      pulling: false, startY: 0, pull: 0,
      refreshing: false, lastOffset: -1,
    };
    const childOf = () => (/** @type {HTMLElement} */ (el.firstElementChild));
    /** @param {number} y */
    const setTranslate = (y) => {
      const c = childOf();
      if (c) c.style.transform = y ? `translateY(${y}px)` : '';
    };
    /** @param {string} kind @param {any=} [a] */
    const fire = (kind, a) => {
      const cb = el.__rfCbs && el.__rfCbs[kind];
      if (typeof cb !== 'function') return;
      try { cb(a); }
      catch (e) { layoutWarnings.push(`Refresh.on${kind[0].toUpperCase() + kind.slice(1)} 回调抛错：${e && e.message}`); }
    };
    /** @param {number} s */
    const setState = (s) => {
      if (el.__rf.state === s) return;           // 同值不重复发（真机 NearEqual 守卫同族）
      el.__rf.state = s;
      el.dataset.refreshState = String(s);
      fire('state', s);
    };
    el.__rfApplyRefreshing = (on) => {
      if (el.__rf.refreshing === on) return;     // 同值守卫（真机 UpdateRefreshStatus :694-696）
      el.__rf.refreshing = on;
      if (on) {
        (/** @type {() => void} */ (el.__rfEnterRefresh))();
      } else if (el.__rf.state === 3) {
        // 停止刷新：Done=4 → 回初始位 → 内部归 Idle（不再发 0）
        setState(4);
        setTranslate(0);
        el.__rf.state = 0;
        el.__rf.pulling = false;
      }
    };
    el.__rfEnterRefresh = () => {
      el.__rf.refreshing = true;
      fire('refreshing');                        // 真机顺序：onRefreshing 先于 onStateChange
      setState(3);
      // 回弹到 refreshOffset 并保持（真机"rebounds to the minimum length"）
      const c = childOf();
      if (c) {
        c.style.transition = 'transform 350ms ease-out';
        setTimeout(() => {
          setTranslate(el.__rf.offset);
          if (c) c.style.transition = '';
        }, 20);
      }
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;     // 真机禁鼠标拖拽（refresh.d.ts:248）
      if (el.__rf.refreshing) return;            // Refresh 态拖拽走 RECYCLE（不响应）
      el.__rf.pulling = true;
      el.__rf.startY = e.clientY;
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.__rf.pulling) return;
      let pull = Math.max(0, e.clientY - el.__rf.startY) * (el.__rf.ratio == null ? 1 : el.__rf.ratio);
      if (el.__rf.maxPull != null) pull = Math.min(pull, el.__rf.maxPull);
      el.__rf.pull = pull;
      setTranslate(pull);
      const vp = Math.round(pull);
      if (vp !== el.__rf.lastOffset) {
        el.__rf.lastOffset = vp;
        fire('offset', vp);                      // 单位 vp、值变化才发（真机 NearEqual 守卫）
      }
      setState(pull >= el.__rf.offset ? 2 : 1);  // OverDrag / Drag
    });
    const finishDrag = () => {
      if (!el.__rf.pulling) return;
      el.__rf.pulling = false;
      if (el.__rf.state === 2 && el.__rf.pullToRefresh) {
        (/** @type {() => void} */ (el.__rfEnterRefresh))();   // 回写（不实现，见下）→ onRefreshing → state 3
      } else {
        // 松手不足阈值 / pullToRefresh=false → 回弹归零，回 Inactive
        const c = childOf();
        if (c) {
          c.style.transition = 'transform 350ms ease-out';
          setTimeout(() => {
            setTranslate(0);
            if (c) c.style.transition = '';
          }, 20);
        }
        setState(0);
      }
    };
    el.addEventListener('pointerup', finishDrag);
    el.addEventListener('pointercancel', finishDrag);
    // refreshing 双向回写：DOM 侧无应用 @State 的写回通道（loader 产物不提供 setter），
    // "回写"一步如实不实现——onRefreshing/onStateChange 顺序照真机保留。应用侧经
    // this.rf1On = false 显式停止（与真机用法一致）。
    if (o.refreshing !== undefined) {
      el.__rfApplyRefreshing(!!resolveResource(o.refreshing));
    }
    return el;
  });
  // 重渲染时处理 refreshing 选项变化（应用设置 refreshing=false 是结束刷新的唯一通道）
  {
    const prevCreate = Refresh.create;
    /** @param {...any} args */
    Refresh.create = function (...args) {
      const node = prevCreate.apply(null, args);
      const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
      if (o.refreshing !== undefined && node.__rfApplyRefreshing) {
        (/** @type {(on: boolean) => void} */ (node.__rfApplyRefreshing))(!!resolveResource(o.refreshing));
      }
      return node;
    };
  }

  // ────────────────── DatePicker 三列滚轮选择器（R51）──────────────────
  //
  // 产物形态（实测 fixtures/pages/DatePickerDemo.ts）：
  //   DatePicker.create({start, end, selected, mode?});
  //   DatePicker.onChange((v: DatePickerResult) => …);   ← {year, month(0 基), day}
  //   DatePicker.onDateChange((d: Date) => …);            ← 年月日按选择、时分取当前、秒 0
  //   DatePicker.lunar(v); .canLoop(v); .digitalCrownSensitivity(v); .enableHapticFeedback(v);
  //
  // DOM 映射：根 = div（overflow hidden），三列（year/month/day）各 5 行可见、行高 40px。
  // 选中行 = 中行（index 2），±1 候选，±2 边缘渐隐。wheel deltaY<0 = 上一步（值+1）、
  // deltaY>0 = 下一步（值−1）（真机 AXIS+MOUSE 同步单步，picker_column_pattern.cpp:506-510）。
  // 跨列联动：month/day 变更 → 重算 day 列选项并夹取（真机 HandleSolarMonthChange）。
  // start/end 钳制：selected 夹入 [start, end]（真机 AdjustSolarDate）。设了 start/end 则
  // canLoop 强制 false（真机 OnModifyDone:486）。lunar 不实现（记警告，无农历换算）。
  const DP_ROW_H = 40;
  const DP_ROWS = 5;
  const DP_COLOR_DIS = 'rgb(24, 36, 49)';
  const DP_COLOR_SEL = 'rgb(0, 125, 255)';
  /** @param {number} y @param {number} m */
  const dpDaysInMonth = (y, m) => new Date(y, m, 0).getDate();   // m=1..12
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const DATEPICKER_ATTRS = {
    lunar: (n, v) => {
      n.dataset.dpLunar = String(!!resolveResource(v));
      if (resolveResource(v)) layoutWarnings.push('DatePicker.lunar 未实现（无农历换算，记 data-*）');
    },
    canLoop: (n, v) => { n.dataset.dpLoop = String(!!resolveResource(v)); },
    digitalCrownSensitivity: (n, v) => { n.dataset.dpCrown = String(Number(resolveResource(v))); },
    enableHapticFeedback: (n, v) => { n.dataset.dpHaptic = String(!!resolveResource(v)); },
    disappearTextStyle: (n, v) => { n.dataset.dpDisTextStyle = JSON.stringify(v); },
    textStyle: (n, v) => { n.dataset.dpTextStyle = JSON.stringify(v); },
    selectedTextStyle: (n, v) => { n.dataset.dpSelTextStyle = JSON.stringify(v); },
    onChange: (n, v) => { (/** @type {any} */ (n.__dpCbs = n.__dpCbs || {})).change = v; },
    onDateChange: (n, v) => { (/** @type {any} */ (n.__dpCbs = n.__dpCbs || {})).dateChange = v; },
  };
  const DatePicker = ensureComponent('DatePicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiDatePicker = true;
    el.dataset.dp = '';
    el.style.display = 'flex';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const now = new Date();
    const start = o.start instanceof Date ? o.start : new Date(1970, 0, 1);
    const end = o.end instanceof Date ? o.end : new Date(2100, 11, 31);
    let sel = o.selected instanceof Date ? o.selected : now;
    if (sel < start) sel = new Date(start);
    if (sel > end) sel = new Date(end);
    const mode = o.mode != null ? Number(o.mode) : 0;    // DATE=0
    el.__dp = {
      start, end, mode,
      year: sel.getFullYear(), month: sel.getMonth() + 1, day: sel.getDate(),
      canLoop: !((o.start !== undefined && o.start !== null) || (o.end !== undefined && o.end !== null)),
      cbs: {},
    };
    el.__dpCbs = el.__dp.cbs;
    // 列选项
    const getYears = () => { const a = []; for (let y = start.getFullYear(); y <= end.getFullYear(); y++) a.push(y); return a; };
    const getMonths = () => { const a = []; for (let m = 1; m <= 12; m++) a.push(m); return a; };
    /** @param {number} y @param {number} m */
    const getDays = (y, m) => { const n = dpDaysInMonth(y, m); const a = []; for (let d = 1; d <= n; d++) a.push(d); return a; };
    /** @type {Record<string, any>} */
    const cols = {};
    /** @param {string} label */
    const mk = (label) => {
      const wrap = document.createElement('div');
      wrap.dataset['dpCol'] = label;
      wrap.style.flex = '1';
      wrap.style.overflow = 'hidden';
      wrap.style.position = 'relative';
      wrap.style.height = `${DP_ROWS * DP_ROW_H}px`;
      const inner = document.createElement('div');
      inner.style.position = 'absolute';
      inner.style.left = '0'; inner.style.right = '0';
      inner.style.willChange = 'transform';
      for (let r = 0; r < DP_ROWS; r++) {
        const row = document.createElement('div');
        row.style.height = `${DP_ROW_H}px`;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'center';
        row.style.fontSize = '16px';
        row.style.color = DP_COLOR_DIS;
        if (r === 2) { row.style.color = DP_COLOR_SEL; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
        inner.appendChild(row);
      }
      wrap.appendChild(inner);
      el.appendChild(wrap);
      return { wrap, inner, rows: [...inner.children] };
    };
    cols.year = mk('year'); cols.month = mk('month'); cols.day = mk('day');
    if (mode === 1) cols.day.wrap.style.display = 'none';       // YEAR_AND_MONTH
    if (mode === 2) cols.year.wrap.style.display = 'none';      // MONTH_AND_DAY
    el.dataset.dpMode = String(mode);
    // 渲染一列：围绕 idx 显示 5 行（idx-2..idx+2）
    /** @param {string} col @param {any[]} options @param {number} idx @param {(v: any) => string} fmt */
    const renderCol = (col, options, idx, fmt) => {
      const c = cols[col];
      for (let r = 0; r < DP_ROWS; r++) {
        const oi = idx - 2 + r;
        c.rows[r].textContent = (oi >= 0 && oi < options.length) ? fmt(options[oi]) : '';
      }
      c.inner.style.transform = `translateY(${(2 - idx) * DP_ROW_H}px)`;
    };
    const dp = el.__dp;
    dp.renderAll = () => {
      const years = getYears();
      const months = getMonths();
      const days = getDays(dp.year, dp.month);
      dp.yearIdx = years.indexOf(dp.year);
      dp.monthIdx = months.indexOf(dp.month);
      dp.dayIdx = days.indexOf(dp.day);
      renderCol('year', years, dp.yearIdx, (v) => String(v));
      renderCol('month', months, dp.monthIdx, (v) => String(v));
      renderCol('day', days, dp.dayIdx, (v) => String(v));
      el.dataset.dpYearCount = String(years.length);
      el.dataset.dpMonthCount = String(months.length);
      el.dataset.dpDayCount = String(days.length);
    };
    dp.fireChange = () => {
      const cb = el.__dpCbs;
      if (typeof cb.change === 'function') {
        try { cb.change({ year: dp.year, month: dp.month - 1, day: dp.day }); }
        catch (e) { layoutWarnings.push(`DatePicker.onChange 抛错：${e && e.message}`); }
      }
      if (typeof cb.dateChange === 'function') {
        try { const now = new Date(); cb.dateChange(new Date(dp.year, dp.month - 1, dp.day, now.getHours(), now.getMinutes(), 0)); }
        catch (e) { layoutWarnings.push(`DatePicker.onDateChange 抛错：${e && e.message}`); }
      }
    };
    /** @param {string} col @param {number} dir */
    dp.step = (col, dir) => {
      // dir: +1 = 值+1（wheel deltaY<0），-1 = 值−1
      const opts = col === 'year' ? getYears() : col === 'month' ? getMonths() : getDays(dp.year, dp.month);
      const cur = col === 'year' ? dp.yearIdx : col === 'month' ? dp.monthIdx : dp.dayIdx;
      let ni = cur + dir;
      if (!dp.canLoop || (dp.start && dp.end)) {
        if (ni < 0 || ni >= opts.length) return;   // 非循环：越界不动
      } else {
        if (ni < 0) ni = opts.length - 1;
        if (ni >= opts.length) ni = 0;
      }
      ni = Math.max(0, Math.min(ni, opts.length - 1));
      if (col === 'year') dp.year = opts[ni];
      else if (col === 'month') dp.month = opts[ni];
      else dp.day = opts[ni];
      // 跨列联动：月/年变 → 重算当月天数 → day 夹取
      const maxD = dpDaysInMonth(dp.year, dp.month);
      if (dp.day > maxD) dp.day = maxD;
      // start/end 钳制
      const sel = new Date(dp.year, dp.month - 1, dp.day);
      if (sel < start) { dp.year = start.getFullYear(); dp.month = start.getMonth() + 1; dp.day = start.getDate(); }
      if (sel > end) { dp.year = end.getFullYear(); dp.month = end.getMonth() + 1; dp.day = end.getDate(); }
      dp.renderAll();
      dp.fireChange();
    };
    // wheel 步进（deltaY<0 = 上/值+1；deltaY>0 = 下/值−1）
    for (const col of ['year', 'month', 'day']) {
      cols[col].wrap.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
        e.preventDefault();
        dp.step(col, e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }
    dp.renderAll();
    return el;
  });

  // ────────────────── TimePicker 时间选择器（R52）──────────────────
  //
  // 产物形态（实测 fixtures/pages/TimePickerDemo.ts）：
  //   TimePicker.create({selected: Date, format?: TimePickerFormat});
  //   TimePicker.useMilitaryTime(bool); TimePicker.onChange((v)=>…);
  // 列：hour(0..23) + minute(0..59) + second(0..59，仅 HOUR_MINUTE_SECOND 格式)。
  // 状态机/事件/步进与 DatePicker 共用模式（wheel 同步单步）。
  const TimePickerFormat = { HOUR_MINUTE: 0, HOUR_MINUTE_SECOND: 1 };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TIMEPICKER_ATTRS = {
    useMilitaryTime: (n, v) => {
      n.__tp.military = !!resolveResource(v);
      n.dataset.military = String(n.__tp.military);
      n.__tpRender();
    },
    onChange: (n, v) => { (/** @type {any} */ (n.__tpCbs = n.__tpCbs || {})).change = v; },
  };
  const TimePicker = ensureComponent('TimePicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiTimePicker = true;
    el.dataset.tp = '';
    el.style.display = 'flex';
    el.style.overflow = 'hidden';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const sel = o.selected instanceof Date ? o.selected : new Date();
    const fmt = o.format != null ? Number(o.format) : 0;   // HOUR_MINUTE=0
    const hasSec = fmt === 1;
    el.__tp = {
      hour: sel.getHours(), minute: sel.getMinutes(), second: sel.getSeconds(),
      military: true, hasSec,
      cbs: {},
    };
    el.__tpCbs = el.__tp.cbs;
    const tp = el.__tp;
    /** @param {string} label */
    const mk = (label) => {
      const wrap = document.createElement('div');
      wrap.dataset['tpCol'] = label;
      wrap.style.flex = '1';
      wrap.style.overflow = 'hidden';
      wrap.style.position = 'relative';
      wrap.style.height = '200px';
      const inner = document.createElement('div');
      inner.style.position = 'absolute';
      inner.style.left = '0'; inner.style.right = '0';
      for (let r = 0; r < 5; r++) {
        const row = document.createElement('div');
        row.style.height = '40px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'center';
        row.style.fontSize = '16px';
        row.style.color = 'rgb(24, 36, 49)';
        if (r === 2) { row.style.color = 'rgb(0, 125, 255)'; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
        inner.appendChild(row);
      }
      wrap.appendChild(inner);
      el.appendChild(wrap);
      return { wrap, inner, rows: [...inner.children] };
    };
    /** @type {Record<string, any>} */
    const cols = { hour: mk('hour'), minute: mk('minute') };
    if (hasSec) cols.second = mk('second');
    /** @param {number} v */
    const pad2 = (v) => String(v).padStart(2, '0');
    /** @param {number} h */
    const fmtHour = (h) => (tp.military ? String(h) : h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
    /** @param {string} col @param {any[]} options @param {number} idx @param {(v: any) => string} fmtFn */
    const renderCol = (col, options, idx, fmtFn) => {
      const c = cols[col];
      for (let r = 0; r < 5; r++) {
        const oi = idx - 2 + r;
        c.rows[r].textContent = (oi >= 0 && oi < options.length) ? fmtFn(options[oi]) : '';
      }
      c.inner.style.transform = `translateY(${(2 - idx) * 40}px)`;
    };
    el.__tpRender = tp.tpRender = () => {
      const hours = []; for (let h = 0; h < 24; h++) hours.push(h);
      const mins = []; for (let m = 0; m < 60; m++) mins.push(m);
      renderCol('hour', hours, tp.hour, fmtHour);
      renderCol('minute', mins, tp.minute, pad2);
      if (hasSec) renderCol('second', mins, tp.second, pad2);
      el.dataset.tpHour = String(tp.hour);
      el.dataset.tpMinute = String(tp.minute);
      if (hasSec) el.dataset.tpSecond = String(tp.second);
    };
    el.__tpFireChange = tp.fireChange = () => {
      const cb = el.__tpCbs;
      if (typeof cb.change === 'function') {
        try { cb.change({ hour: tp.hour, minute: tp.minute, second: tp.second }); }
        catch (e) { layoutWarnings.push(`TimePicker.onChange 抛错：${e && e.message}`); }
      }
    };
    /** @param {string} col @param {number} dir */
    el.__tpStep = tp.step = (col, dir) => {
      const max = col === 'hour' ? 23 : 59;
      const cur = col === 'hour' ? tp.hour : col === 'minute' ? tp.minute : tp.second;
      let ni = cur + dir;
      if (ni < 0) ni = tp.military ? max : max;   // loop 默认 true → 回绕
      if (ni > max) ni = 0;
      if (col === 'hour') tp.hour = ni;
      else if (col === 'minute') tp.minute = ni;
      else tp.second = ni;
      tp.tpRender();
      tp.fireChange();
    };
    for (const col of ['hour', 'minute'].concat(hasSec ? ['second'] : [])) {
      cols[col].wrap.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
        e.preventDefault();
        tp.step(col, e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }
    tp.tpRender();
    return el;
  });

  // ────────────────── TextPicker 文本选择器（R56/R58）──────────────────
  //
  // 产物形态（实测 fixtures/pages/TextPickerDemo.ts）：
  //   TextPicker.create({ range, selected });   ← range: string[] / TextPickerRangeContent[]
  //                                              / string[][]（多列）/ 级联（children 联动）
  //   TextPicker.defaultPickerItemHeight(40); TextPicker.selectedIndex(2);
  //   TextPicker.onChange((value: string|string[], index: number|number[]) => …);
  //   TextPickerDialog.show({ range, selected, onAccept: (r: TextPickerResult)=>…, onCancel });
  //
  // 真机语义（text_picker.d.ts / textpicker_pattern.cpp）：滚轮选中变化即
  // FireChangeEvent(value, index)（:803-822）；selected 缺省 0；selectedIndex 属性是
  // create 之后的覆盖（.d.ts:842，重定位不发 onChange）；defaultPickerItemHeight 行高
  // （缺省 40vp→px 1:1）；级联父变 → 子列选项联动重置。wheel 同步单步（R51/R52 同族）。
  // DOM：N 列滚轮（视觉同 DatePicker：5 行、中行高亮、translateY 定位）；静态 Dialog 为
  //   fixed 居中面板 + OK/Cancel（DOM 无 OverlayManager 动画，标注）。
  const TPX_ROWS = 5;
  const TPX_ROW_H_DEFAULT = 40;
  const TPX_COLOR_SEL = 'rgb(0, 125, 255)';
  const TPX_COLOR_DIS = 'rgb(24, 36, 49)';
  const tpxTextOf = (/** @type {any} */ item) => (item && typeof item === 'object') ? String(item.text) : String(item);
  // range 归一化：{kind, cols}。single/multi 的 cols 是静态 string[][]；cascade 的 cols
  // 动态生成（沿 sel 链下钻，父变 → 子列重置为 0）
  /** @param {any} range */
  const tpxNormalize = (range) => {
    const arr = Array.isArray(range) ? range : [];
    if (!arr.length) return { kind: 'single', cols: [['']], cascade: null };
    if (Array.isArray(arr[0])) {
      return { kind: 'multi', cols: arr.map((/** @type {any[]} */ col) => col.map(tpxTextOf)), cascade: null };
    }
    if (arr[0] && typeof arr[0] === 'object' && Array.isArray(arr[0].children)) {
      return { kind: 'cascade', cols: [], cascade: arr };
    }
    return { kind: 'single', cols: [arr.map(tpxTextOf)], cascade: null };
  };
  /** @param {any} selected */
  const tpxNormSel = (selected) => Array.isArray(selected) ? selected.map((/** @type {any} */ n) => Number(n) || 0) : [Number(selected) || 0];
  // 级联第 c 列的选项与子树：沿 sel[0..c-1] 下钻
  /** @param {any[]} nodes @param {number[]} sel @param {number} c */
  const tpxCascadeLevel = (nodes, sel, c) => {
    let level = nodes;
    for (let i = 0; i < c; i++) {
      const node = level[sel[i]] || level[0];
      if (!node || !Array.isArray(node.children)) return null;
      level = node.children;
    }
    return level;
  };
  /**
   * 滚轮引擎：在 hostEl 里建 colCount 列，sel 每次变更后调 rebuild 重排（级联列数可变）。
   * @param {HTMLElement} hostEl
   * @param {{kind: string, cols: string[][], cascade: any[]}} norm
   * @param {number[]} sel0
   * @param {number} rowH
   * @param {(values: any, indexes: any) => void} fire
   */
  /** @param {any} hostEl @param {any} norm @param {number[]} sel0 @param {number} rowH @param {any} fire */
  const tpxEngine = (hostEl, norm, sel0, rowH, fire) => {
    const st = /** @type {any} */ ({
      kind: norm.kind, cascade: norm.cascade, cols: norm.cols, sel: sel0.slice(),
      rowH, colEls: [], cbs: {}, onChange: fire,
    });
    /** @returns {string[]} */
    /** @param {number} c */
    const optionsOf = (c) => {
      if (st.kind === 'cascade') {
        const level = tpxCascadeLevel(st.cascade, st.sel, c);
        return level ? level.map(tpxTextOf) : [];
      }
      return st.cols[c] || [];
    };
    /** @returns {number} */
    const colCount = () => {
      if (st.kind !== 'cascade') return st.cols.length;
      let c = 1;
      let level = st.cascade;
      while (true) {
        const node = level[st.sel[c - 1] || 0] || level[0];
        if (!node || !Array.isArray(node.children) || !node.children.length) return c;
        level = node.children;
        c += 1;
      }
    };
    const clamp = () => {
      for (let c = 0; c < colCount(); c++) {
        const n = optionsOf(c).length;
        st.sel[c] = Math.max(0, Math.min(n - 1, st.sel[c] || 0));
      }
    };
    /** @param {number} c @param {number} dir */
    const step = (c, dir) => {
      const opts = optionsOf(c);
      const next = Math.max(0, Math.min(opts.length - 1, (st.sel[c] || 0) + dir));
      if (next === (st.sel[c] || 0)) return;          // 边界：不动不发
      st.sel[c] = next;
      if (st.kind === 'cascade') {
        // 父变 → 子列选项联动重置（截断 sel 到当前深度，下游从 0 重新计）
        st.sel = st.sel.slice(0, c + 1);
        for (let d = c + 1; d < colCount(); d++) st.sel[d] = 0;
        build();
      } else {
        renderCol(c);
      }
      const values = st.sel.map((/** @type {number} */ s, /** @type {number} */ cc) => optionsOf(cc)[s] || '');
      const indexes = st.sel.slice();
      hostEl.dataset.selectedIndex = JSON.stringify(indexes);   // 步进后同步（断言/自省读这里）
      fire(st.kind === 'single' ? values[0] : values, st.kind === 'single' ? indexes[0] : indexes);
    };
    /** @param {number} c */
    const renderCol = (c) => {
      const ce = st.colEls[c];
      const opts = optionsOf(c);
      const idx = st.sel[c] || 0;
      for (let r = 0; r < TPX_ROWS; r++) {
        const oi = idx - 2 + r;
        ce.rows[r].textContent = (oi >= 0 && oi < opts.length) ? opts[oi] : '';
      }
      ce.inner.style.transform = `translateY(${(2 - idx) * st.rowH}px)`;
    };
    const build = () => {
      hostEl.textContent = '';
      st.colEls = [];
      for (let c = 0; c < colCount(); c++) {
        const wrap = document.createElement('div');
        wrap.setAttribute('data-tpx-col', String(c));
        wrap.style.flex = '1';
        wrap.style.overflow = 'hidden';
        wrap.style.position = 'relative';
        wrap.style.height = TPX_ROWS * st.rowH + 'px';
        const inner = document.createElement('div');
        inner.style.position = 'absolute';
        inner.style.left = '0';
        inner.style.right = '0';
        inner.style.willChange = 'transform';
        const rows = [];
        for (let r = 0; r < TPX_ROWS; r++) {
          const row = document.createElement('div');
          row.className = 'tpx-row';
          row.style.height = st.rowH + 'px';
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'center';
          row.style.fontSize = '16px';
          row.style.color = TPX_COLOR_DIS;
          if (r === 2) { row.style.color = TPX_COLOR_SEL; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
          inner.appendChild(row);
          rows.push(row);
        }
        wrap.appendChild(inner);
        hostEl.appendChild(wrap);
        wrap.addEventListener('wheel', (e) => {
          e.preventDefault();
          step(c, e.deltaY > 0 ? 1 : -1);
        }, { passive: false });
        st.colEls.push({ wrap, inner, rows });
        renderCol(c);
      }
    };
    clamp();
    build();
    /** @param {number} dir */
    const stepFirst = (dir) => { step(0, dir); };
    return {
      st,
      cbs: st.cbs,
      get colEls() { return st.colEls; },
      /** @param {number} h */
      relayout(h) {
        st.rowH = h;
        hostEl.style.height = TPX_ROWS * h + 'px';
        build();
      },
      /** @param {number[]} sel */
      setSel(sel) {
        st.sel = sel.slice();
        clamp();
        build();
        hostEl.dataset.selectedIndex = JSON.stringify(st.sel);
      },
      /** @param {number} c @param {number} dir */
      stepCol(c, dir) { step(c, dir); },
      stepFirst,
      /** @returns {string[]} */
      texts() { return st.sel.map((/** @type {number} */ _s, /** @type {number} */ c) => optionsOf(c)[st.sel[c]] || ''); },
      /** @returns {number[]} */
      indexes() { return st.sel.map((/** @type {number} */ s) => s || 0); },
    };
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTPICKER_ATTRS = {
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__txp;
      if (w) w.cbs.change = v;
    },
    selectedIndex: (n, v) => {
      const w = /** @type {any} */ (n).__txp;
      if (!w) return;
      const sel = Array.isArray(v)
        ? v.map((/** @type {any} */ x) => Number(resolveResource(x)) || 0)
        : [Number(resolveResource(v)) || 0];
      w.setSel(sel);                                  // 重定位不发 onChange（.d.ts:842 覆盖语义）
      n.dataset.selectedIndex = JSON.stringify(w.indexes());
    },
    defaultPickerItemHeight: (n, v) => {
      const h = Math.max(1, Number(resolveResource(v)) || TPX_ROW_H_DEFAULT);
      n.dataset.rowHeight = String(h);
      (/** @type {any} */ (n).__txp).relayout(h);
    },
    selectedTextStyle: (n, v) => {
      const o = v || {};
      n.dataset.selectedTextStyle = 'set';
      const w = /** @type {any} */ (n).__txp;
      if (!w) return;
      w.colEls.forEach((/** @type {any} */ ce) => {
        const sel = ce.rows[2];
        if (o.color !== undefined) sel.style.color = colorOf(o.color);
        if (o.font && o.font.size !== undefined) sel.style.fontSize = toCssSize(o.font.size);
        if (o.font && o.font.weight !== undefined) sel.style.fontWeight = String(resolveResource(o.font.weight));
      });
    },
  };
  /** @param {any[]} args */
  const TextPicker = ensureComponent('TextPicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiTextPick = true;
    el.dataset.txp = '';
    el.style.display = 'flex';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const norm = tpxNormalize(o.range);
    const sel0 = tpxNormSel(o.selected);
    while (sel0.length < (norm.kind === 'cascade' ? 1 : norm.cols.length)) sel0.push(0);
    const engine = tpxEngine(el, norm, sel0, TPX_ROW_H_DEFAULT, (/** @type {any} */ values, /** @type {any} */ indexes) => {
      const w = /** @type {any} */ (el).__txp;
      const cb = w.cbs.change;
      if (typeof cb !== 'function') return;
      try { cb(values, indexes); }                    // FireChangeEvent(value, index)（真机 :803-822）
      catch (e) { layoutWarnings.push(`TextPicker.onChange 回调抛错：${e && e.message}`); }
    });
    /** @type {any} */ (el).__txp = engine;
    el.style.height = TPX_ROWS * TPX_ROW_H_DEFAULT + 'px';
    el.dataset.txRange = JSON.stringify(
      norm.kind === 'multi' ? norm.cols : (norm.kind === 'cascade' ? (/** @type {any} */ (norm.cascade)).map(tpxTextOf) : norm.cols[0]));
    el.dataset.selectedIndex = JSON.stringify(engine.indexes());
    el.dataset.rowHeight = String(TPX_ROW_H_DEFAULT);
    el.__txpStep = (/** @param {number} dir */ dir) => engine.stepFirst(dir);   // R56 单列兼容
    el.__txpStepCol = (/** @param {number} c @param {number} dir */ c, dir) => engine.stepCol(c, dir);
    return el;
  });
  // TextPickerDialog.show（静态弹层）：OK/Cancel（onAccept/onCancel，.d.ts TextPickerDialogOptions）。
  // TextPickerResult = { value, index }（value/index 保持官方联合类型形态）。
  const TextPickerDialog = {
    /** @param {any=} [options] */
    show(options) {
      const o = options || {};
      const host = document.createElement('div');
      host.setAttribute('data-arkui-tpx-static', '');
      host.setAttribute('data-open', 'true');
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.top = '50%';
      host.style.transform = 'translate(-50%, -50%)';
      host.style.zIndex = '9999';
      host.style.background = '#fff';
      host.style.border = '1px solid #bbb';
      host.style.padding = '12px';
      let last = null;
      const norm = tpxNormalize(o.range);
      const sel0 = tpxNormSel(o.selected);
      while (sel0.length < (norm.kind === 'cascade' ? 1 : norm.cols.length)) sel0.push(0);
      const body = document.createElement('div');
      body.style.display = 'flex';
      host.appendChild(body);
      const eng = tpxEngine(body, norm, sel0, TPX_ROW_H_DEFAULT, (/** @type {any} */ values, /** @type {any} */ indexes) => {
        last = { value: values, index: indexes };
        if (typeof o.onChange === 'function') {
          try { o.onChange({ value: values, index: indexes }); }
          catch (e) { layoutWarnings.push(`TextPickerDialog.onChange 抛错：${e && e.message}`); }
        }
      });
      const ok = document.createElement('button');
      ok.setAttribute('data-tpx-ok', '');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        close();
        if (typeof o.onAccept === 'function') {
          const value = norm.kind === 'single' ? eng.texts()[0] : eng.texts();
          const index = norm.kind === 'single' ? eng.indexes()[0] : eng.indexes();
          try { o.onAccept({ value, index }); }
          catch (e) { layoutWarnings.push(`TextPickerDialog.onAccept 抛错：${e && e.message}`); }
        }
      });
      const cancel = document.createElement('button');
      cancel.setAttribute('data-tpx-cancel', '');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        close();
        if (typeof o.onCancel === 'function') {
          try { o.onCancel(); }
          catch (e) { layoutWarnings.push(`TextPickerDialog.onCancel 抛错：${e && e.message}`); }
        }
      });
      host.appendChild(ok);
      host.appendChild(cancel);
      const close = () => { if (host.parentNode) host.parentNode.removeChild(host); };
      document.body.appendChild(host);
    },
  };

  // ────────────────── TextClock / TextTimer（R59）：时间文本双件 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/TextTimeDemo.ts）：
  //   TextClock.create({ controller }); TextClock.format('HH:mm:ss');
  //   TextTimer.create({ controller, startTime: 5000, isCountDown: true });
  //   TextTimer.format('HH:mm:ss.SS'); TextTimer.onTimer((utc, elapsedTime) => …);
  //   timerCtrl.start() / pause() / reset();
  //
  // 真机语义（text_clock.d.ts / text_timer.d.ts）：TextClock 每秒随系统时间刷新，
  //   TextClockController start/pause/stop 控刷新；TextTimer 从 startTime 走表，
  //   isCountDown=true 倒数（到 endTime 缺省 0 停），format 含 .SS 时步进 10ms 否则
  //   按最小 token 粒度；onTimer(utc, elapsedTime) 每 tick 触发；controller
  //   start/pause/reset（reset 停表回 startTime）。
  // DOM：textContent + setInterval（虚拟时间 headless 下确定性最好，坑 ⑧）；
  //   TextClock 走真实系统时间（结构性断言，不锁墙钟值）；TextTimer 走 tick 累积。
  /** @param {number} n */
  const pad2t = (n) => String(n).padStart(2, '0');
  // format 令牌子集：HH/mm/ss（共同）+ SS（百分秒）。其余字符原样保留。
  /** @param {string} fmt @param {Record<string, number>} bag */
  const tmtApply = (fmt, bag) => String(fmt)
    .replace(/HH/g, pad2t(bag.HH)).replace(/mm/g, pad2t(bag.mm))
    .replace(/ss/g, pad2t(bag.ss)).replace(/SS/g, pad2t(bag.SS));
  /** @param {string} fmt */
  const tmtTickMs = (fmt) => (/SS/.test(String(fmt)) ? 10 : 100);
  class TextClockController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    start() { if (this._api) this._api.start(); }
    pause() { if (this._api) this._api.pause(); }
    stop() { if (this._api) this._api.pause(); }
  }
  class TextTimerController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    start() { if (this._api) this._api.start(); }
    pause() { if (this._api) this._api.pause(); }
    reset() { if (this._api) this._api.reset(); }
  }
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTCLOCK_ATTRS = {
    format: (n, v) => {
      const w = /** @type {any} */ (n).__tclock;
      if (!w) return;
      w.fmt = String(resolveResource(v));
      w.render();
    },
    onClockChange: (n, v) => {
      const w = /** @type {any} */ (n).__tclock;
      if (w) w.cbs.change = v;
    },
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTTIMER_ATTRS = {
    format: (n, v) => {
      const w = /** @type {any} */ (n).__ttimer;
      if (!w) return;
      w.fmt = String(resolveResource(v));
      w.relayout();                                     // 步进粒度随 format 变（.SS → 10ms）
      w.render();
    },
    onTimer: (n, v) => {
      const w = /** @type {any} */ (n).__ttimer;
      if (w) w.cbs.timer = v;
    },
  };
  /** @param {any[]} args */
  const TextClock = ensureComponent('TextClock', (args) => {
    const el = document.createElement('div');
    el.__arkuiTextClock = true;
    el.dataset.textClock = '';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    /** @type {any} */ const w = /** @type {any} */ (el).__tclock = { fmt: String(o.format || 'HH:mm:ss'), cbs: {}, timer: null, running: true };
    const render = () => {
      const d = new Date();
      el.textContent = tmtApply(w.fmt, {
        HH: d.getHours(), mm: d.getMinutes(), ss: d.getSeconds(), SS: Math.floor(d.getMilliseconds() / 10),
      });
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(el.textContent, 0); }
        catch (e) { layoutWarnings.push(`TextClock.onClockChange 回调抛错：${e && e.message}`); }
      }
    };
    w.render = render;
    w.api = {
      start() { if (!w.timer) { render(); w.timer = setInterval(render, 1000); } },
      pause() { if (w.timer) { clearInterval(w.timer); w.timer = null; } },
    };
    w.api.start();                                      // 缺省自动走时（真机同）
    if (o.controller && typeof o.controller._bind === 'function') o.controller._bind(w.api);
    render();
    return el;
  });
  /** @param {any[]} args */
  const TextTimer = ensureComponent('TextTimer', (args) => {
    const el = document.createElement('div');
    el.__arkuiTextTimer = true;
    el.dataset.textTimer = '';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const startTime = Number(o.startTime) || 0;
    const endTime = o.endTime === undefined ? 0 : Number(o.endTime);
    const countDown = o.isCountDown === true;
    /** @type {any} */ const w = /** @type {any} */ (el).__ttimer = {
      fmt: String(o.format || 'HH:mm:ss.SS'), cbs: {}, timer: null,
      elapsed: 0, running: false, startTime, endTime, countDown,
    };
    // 步进粒度：format 含 .SS → 10ms；否则按最小 token（秒级 format → 100ms 平滑）
    w.render = () => {
      const shown = w.countDown ? Math.max(w.endTime, w.startTime - w.elapsed) : Math.min(w.endTime || Infinity, w.startTime + w.elapsed);
      el.textContent = tmtApply(w.fmt, {
        HH: Math.floor(shown / 3600000),
        mm: Math.floor(shown / 60000) % 60,
        ss: Math.floor(shown / 1000) % 60,
        SS: Math.floor(shown / 10) % 100,
      });
    };
    w.relayout = () => {
      const wasRunning = w.running;
      if (w.timer) { clearInterval(w.timer); w.timer = null; }
      if (wasRunning) w.start();
    };
    const fireTimer = () => {
      const cb = w.cbs.timer;
      if (typeof cb !== 'function') return;
      try { cb(Date.now(), w.elapsed); }
      catch (e) { layoutWarnings.push(`TextTimer.onTimer 回调抛错：${e && e.message}`); }
    };
    w.start = () => {
      if (w.timer) return;                              // 重复 start 幂等（真机同）
      const done = () => (w.countDown ? w.elapsed >= w.startTime - w.endTime : w.endTime !== undefined && w.endTime !== null && w.elapsed >= w.endTime - w.startTime && w.endTime > 0);
      w.timer = setInterval(() => {
        w.elapsed += tmtTickMs(w.fmt);
        if (done()) {
          w.elapsed = w.countDown ? w.startTime - w.endTime : (w.endTime || 0) - w.startTime;
          w.render();
          fireTimer();
          if (w.timer) { clearInterval(w.timer); w.timer = null; }
          return;
        }
        w.render();
        fireTimer();
      }, tmtTickMs(w.fmt));
    };
    w.pause = () => { if (w.timer) { clearInterval(w.timer); w.timer = null; } };
    w.reset = () => {
      w.pause();
      w.elapsed = 0;
      w.render();
    };
    if (o.controller && typeof o.controller._bind === 'function') o.controller._bind(w);
    w.render();
    return el;
  });

  // ────────────────── RichEditor 富文本编辑器（R65）──────────────────
  //
  // 产物形态（实测 fixtures/pages/RichVideoDemo.ts）：
  //   RichEditor.create({controller}); RichEditor.placeholder('edit here');
  //   RichEditor.onReady(() => …);
  //
  // 真机语义（rich_editor.d.ts）：基于 contenteditable 的富文本编辑器；onReady 在组件
  //   通用部分构建完成后触发；placeholder 占位文本（无内容时显示）。
  // DOM：div[contenteditable=true] 原生编辑器。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const RICHEDITOR_ATTRS = {
    placeholder: (n, v) => {
      n.dataset.placeholder = String(resolveResource(v));
    },
    onReady: (n, v) => {
      const w = /** @type {any} */ (n).__rich;
      if (w) w.cbs.ready = v;
    },
    onSelect: (n, v) => {
      const w = /** @type {any} */ (n).__rich;
      if (w) w.cbs.select = v;
    },
  };
  /** @param {any[]} args */
  const RichEditor = ensureComponent('RichEditor', (args) => {
    const el = document.createElement('div');
    el.__arkuiRichEditor = true;
    el.dataset.richEditor = '';
    el.setAttribute('contenteditable', 'true');
    el.style.minHeight = '40px';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__rich = /** @type {any} */ ({ cbs: {} });
    // onReady 在下一帧触发（真机：通用部分构建完成后）
    setTimeout(() => {
      const cb = w.cbs.ready;
      if (typeof cb === 'function') {
        try { cb(); }
        catch (e) { layoutWarnings.push(`RichEditor.onReady 回调抛错：${e && e.message}`); }
      }
    }, 0);
    return el;
  });
  const RichEditorController = class {
    constructor() { this._el = null; }
    /** @param {any} el */
    _bind(el) { this._el = el; }
  };

  // ────────────────── Video 视频播放器（R65）：HTML <video> 原生垫片 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/RichVideoDemo.ts）：
  //   Video.create({src: 'video-test.mp4', controller});
  //   Video.controls(false); Video.autoPlay(false); Video.muted(true);
  //
  // 真机语义（video.d.ts）：src 视频源；controls 显示原生控制条（缺省 true）；
  //   autoPlay 自动播放（缺省 false）；muted 静音（缺省 false）；loop 循环（缺省 false）。
  //   onPrepared/onStart/onPause/onFinish/onUpdate 生命周期回调。
  //   VideoController start/pause/stop/requestFullscreen/exitFullscreen。
  // DOM：<video> 原生元素（controls/autoPlay/muted/loop CSS 属性直通）；src → src 属性。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const VIDEO_ATTRS = {
    controls: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.controls = v === true;
      n.dataset.controls = String(v === true);
    },
    muted: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.muted = v === true;
      n.dataset.muted = String(v === true);
    },
    autoPlay: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.autoplay = v === true;
      n.dataset.autoPlay = String(v === true);
    },
    loop: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.loop = v === true;
      n.dataset.loop = String(v === true);
    },
    onStart: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.start = v;
    },
    onPause: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.pause = v;
    },
    onFinish: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.finish = v;
    },
    onPrepared: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.prepared = v;
    },
    onUpdate: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.update = v;
    },
  };
  /** @param {any[]} args */
  const Video = ensureComponent('Video', (args) => {
    const el = document.createElement('div');
    el.__arkuiVideo = true;
    el.dataset.video = '';
    el.style.position = 'relative';
    // 原生 <video> 元素垫片
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const native = document.createElement('video');
    native.style.width = '100%';
    native.style.height = '100%';
    native.style.display = 'block';
    if (o.src) native.src = String(o.src);
    el.appendChild(native);
    const w = /** @type {any} */ (el).__video = /** @type {any} */ ({ native, cbs: {}, controller: null });
    // 生命周期桥接：原生 <video> 事件 → ArkUI 回调
    native.addEventListener('play', () => {
      const cb = w.cbs.start;
      if (typeof cb === 'function') { try { cb(); } catch (e) { /* 容错 */ } }
    });
    native.addEventListener('pause', () => {
      const cb = w.cbs.pause;
      if (typeof cb === 'function') { try { cb(); } catch (e) { /* 容错 */ } }
    });
    native.addEventListener('ended', () => {
      const cb = w.cbs.finish;
      if (typeof cb === 'function') { try { cb(); } catch (e) { /* 容错 */ } }
    });
    // VideoController 绑定
    if (o.controller && typeof o.controller._bind === 'function') {
      o.controller._bind({
        play() { try { native.play(); } catch (e) { /* 容错 */ } },
        pause() { try { native.pause(); } catch (e) { /* 容错 */ } },
        stop() { try { native.pause(); native.currentTime = 0; } catch (e) { /* 容错 */ } },
      });
    }
    return el;
  });
  class VideoController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    start() { if (this._api) this._api.play(); }
    pause() { if (this._api) this._api.pause(); }
    stop() { if (this._api) this._api.stop(); }
    requestFullscreen() { layoutWarnings.push('VideoController.requestFullscreen 未实现'); }
    exitFullscreen() { layoutWarnings.push('VideoController.exitFullscreen 未实现'); }
  }

  // ────────────────── AlphabetIndexer 字母索引条（R60）──────────────────
  //
  // 产物形态（实测 fixtures/pages/AlphabetIndexerDemo.ts）：
  //   AlphabetIndexer.create({ arrayValue: [...], selected: 0 });
  //   AlphabetIndexer.itemSize(24); AlphabetIndexer.selectedBackgroundColor('#0a59f7');
  //   AlphabetIndexer.selected(this.idx);          ← 属性式程序化选中（rerender 重放）
  //   AlphabetIndexer.onSelect((index) => …);      ← 点击项触发（真机 onIndexSelect 同族）
  //
  // 真机语义（alphabet_indexer.d.ts）：点击索引项 → onSelect(index)（:427）；
  //   selected(index) 属性 = 程序化选中（:473，重放不发 onSelect）；itemSize 方格边长
  //   （缺省 24vp→px 1:1）；selectedColor/selectedBackgroundColor 选中态配色。
  // DOM：纵向 flex 条，每项一格 button；选中项 data-selected + 配色；点击发 onSelect。
  const AIX_COLOR_SEL = 'rgb(0, 125, 255)';
  const AIX_BG_SEL = 'rgb(10, 89, 247)';
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const AIX_ATTRS = {
    selected: (n, v) => {
      const w = /** @type {any} */ (n).__aix;
      if (!w) return;
      const idx = Math.max(0, Math.min(w.items.length - 1, Number(resolveResource(v)) || 0));
      w.select(idx, false);                         // 属性重定位不发 onSelect（同真机 onSelect 走点击）
    },
    itemSize: (n, v) => {
      const w = /** @type {any} */ (n).__aix;
      const s = Number(resolveResource(v)) || 24;
      n.dataset.itemSize = String(s);
      if (!w) return;
      w.items.forEach((/** @type {HTMLElement} */ it) => {
        it.style.width = s + 'px';
        it.style.height = s + 'px';
      });
    },
    selectedColor: (n, v) => {
      n.dataset.selectedColor = colorOf(v);
      const w = /** @type {any} */ (n).__aix;
      if (w) w.selColor = colorOf(v);
      const w2 = /** @type {any} */ (n).__aix;
      if (w2 && w2.selected >= 0 && w2.items[w2.selected]) w2.items[w2.selected].style.color = colorOf(v);
    },
    selectedBackgroundColor: (n, v) => {
      n.dataset.selectedBackgroundColor = colorOf(v);
      const w = /** @type {any} */ (n).__aix;
      if (w) w.selBg = colorOf(v);
      const w2 = /** @type {any} */ (n).__aix;
      if (w2 && w2.selected >= 0 && w2.items[w2.selected]) w2.items[w2.selected].style.background = colorOf(v);
    },
    autoCollapse: (n, v) => { n.dataset.autoCollapse = String(v === true); },
    usingPopup: (n, v) => {
      n.dataset.usingPopup = String(v === true);
      layoutWarnings.push('AlphabetIndexer.usingPopup 弹出气泡未实现（记 data-*）');
    },
    onSelect: (n, v) => {
      const w = /** @type {any} */ (n).__aix;
      if (w) w.cbs.select = v;
    },
  };
  /** @param {any[]} args */
  const AlphabetIndexer = ensureComponent('AlphabetIndexer', (args) => {
    const el = document.createElement('div');
    el.__arkuiAlphabetIndexer = true;
    el.dataset.alphabetIndexer = '';
    el.__arkuiLeaf = true;                            // 编译产物无 .pop()：视作叶组件自动弹出（坑 97）
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.position = 'relative';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const texts = (Array.isArray(o.arrayValue) ? o.arrayValue : []).map(tpxTextOf);
    const w = /** @type {any} */ (el).__aix = /** @type {any} */ ({
      items: [], texts, selected: 0, selColor: AIX_COLOR_SEL, selBg: AIX_BG_SEL, cbs: {},
      /** @param {number} idx @param {boolean} fireEvent */
      select(idx, fireEvent) {
        w.selected = idx;
        w.items.forEach((/** @type {HTMLElement} */ it, /** @type {number} */ i) => {
          const on = i === idx;
          if (on) it.setAttribute('data-selected', 'true');
          else it.removeAttribute('data-selected');
          it.style.color = on ? w.selColor : '';
          it.style.background = on ? w.selBg : '';
        });
        if (fireEvent) {
          const cb = w.cbs.select;
          if (typeof cb === 'function') {
            try { cb(idx); }                        // onSelect(index)（真机 :427）
            catch (e) { layoutWarnings.push(`AlphabetIndexer.onSelect 回调抛错：${e && e.message}`); }
          }
        }
      },
    });
    const itemSize = 24;
    texts.forEach((/** @type {string} */ text, /** @type {number} */ i) => {
      const it = document.createElement('button');
      it.style.width = itemSize + 'px';
      it.style.height = itemSize + 'px';
      it.style.fontSize = '12px';
      it.style.display = 'flex';
      it.style.alignItems = 'center';
      it.style.justifyContent = 'center';
      it.style.color = TPX_COLOR_DIS;
      it.textContent = text;
      it.addEventListener('click', () => w.select(i, true));
      el.appendChild(it);
      w.items.push(it);
    });
    el.dataset.itemSize = String(itemSize);
    w.select(Math.max(0, Math.min(texts.length - 1, Number(o.selected) || 0)), false);
    return el;
  });

  // ────────────────── Panel 底部滑出面板（R63）──────────────────
  //
  // 产物形态（实测 fixtures/pages/PanelDemo.ts）：
  //   Panel.create(true);              ← 参数 show?: boolean（初始显示，缺省 true）
  //   Panel.mode(PanelMode.Half);      ← Mini=0 Half=1 Full=2（声明顺序）
  //   Panel.dragBar(true);
  //   Panel.onChange((mode: PanelMode) => …); onHeightChange((h: number) => …);
  //
  // 真机语义（panel.d.ts）：底部滑出面板；mode 控制面板高度档位（Mini/半屏/全屏）；
  //   dragBar 显示顶部拖拽条；onChange(mode) 面板模式切换；onHeightChange(height) 面板
  //   高度变化（px）。builder 子组件挂载在面板体内。
  // DOM：div 定位在父容器底部、width 100%；dragBar 顶部居中横条；mode 切换 CSS class。
  //   面板高度：mini=48px，half=50%，full=100%（.d.ts PanelHeight 枚举顺序，CSS 近似）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const PANEL_ATTRS = {
    mode: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (!w) return;
      const m = Number(resolveResource(v)) || 1;
      if (m === w.mode) return;                         // 同值不重复发
      w.mode = m;
      n.dataset.mode = String(m);
      n.classList.remove('panel-mode-mini', 'panel-mode-half', 'panel-mode-full');
      n.classList.add(`panel-mode-${{ 0: 'mini', 1: 'half', 2: 'full' }[m] || 'half'}`);
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(m); }                                  // onChange(mode: PanelMode)
        catch (e) { layoutWarnings.push(`Panel.onChange 回调抛错：${e && e.message}`); }
      }
    },
    dragBar: (n, v) => {
      const bar = n.querySelector('[data-panel-dragbar]');
      if (bar) bar.style.display = (v === true) ? '' : 'none';
      n.dataset.dragBar = String(v === true);
    },
    backgroundMask: (n, v) => {
      n.dataset.backgroundMask = colorOf(v);
      n.style.backgroundColor = colorOf(v);
    },
    customHeight: (n, v) => {
      const h = Number(resolveResource(v)) || 0;
      n.style.height = h + 'px';
      n.dataset.customHeight = String(h);
    },
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (w) w.cbs.change = v;
    },
    onHeightChange: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (w) w.cbs.heightChange = v;
    },
  };
  /** @param {any[]} args */
  const Panel = ensureComponent('Panel', (args) => {
    const el = document.createElement('div');
    el.__arkuiPanel = true;
    el.dataset.panel = '';
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.overflow = 'hidden';
    // dragBar：顶部居中横条
    const dragbar = document.createElement('div');
    dragbar.setAttribute('data-panel-dragbar', '');
    dragbar.style.width = '24px';
    dragbar.style.height = '4px';
    dragbar.style.borderRadius = '2px';
    dragbar.style.background = 'rgba(0,0,0,0.15)';
    dragbar.style.margin = '4px auto';
    el.appendChild(dragbar);
    const w = /** @type {any} */ (el).__panel = { mode: 1, cbs: {} };
    el.classList.add('panel-mode-half');                // 缺省 Half
    return el;
  });

  // ────────────────── SideBarContainer 侧边栏容器（R61）──────────────────
  //
  // 产物形态（实测 fixtures/pages/SideBarDemo.ts）：
  //   SideBarContainer.create(SideBarContainerType.Embed);
  //   SideBarContainer.showSideBar(this.show); sideBarWidth(200);
  //   SideBarContainer.controlButton({left, top, icons:{shown, hidden}});
  //   SideBarContainer.showControlButton(true); SideBarContainer.onChange((v: boolean) => …);
  //   { 侧栏子组件 } { 内容子组件 }            ← 前 1 个子组件 = 侧栏，其余 = 内容
  //
  // 真机语义（sidebar.d.ts）：Embed 类型侧栏与内容并排，显隐压缩/扩展内容区（容器总宽不变）；
  //   showSideBar(false) → 隐藏侧栏 + onChange(false)；showSideBar(true) → 显示 + onChange(true)；
  //   sideBarWidth 侧栏宽（缺省 240vp）；controlButton 的 icons.shown/hidden 切换图标；
  //   showControlButton 缺省 true（:419）。autoHide/minContentWidth 记 data-*。
  // DOM：display:flex 横排；侧栏 = 第 1 个子元素（width = sideBarWidth，隐藏时 width 0 +
  //   display none）；内容 = 其余子元素（flex 1 自动扩展）；控制按钮 absolute 定位（left/top）。
  const SBC_TYPE_NAME = { 0: 'Embed', 1: 'Overlay' };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SIDEBAR_ATTRS = {
    showSideBar: (n, v) => {
      const w = /** @type {any} */ (n).__sbc;
      if (!w) return;
      const show = v === true || v === 'true';
      if (show === w.shown) return;                   // 同值不重复发 onChange
      w.shown = show;
      n.dataset.showSideBar = String(show);
      w.apply();
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(show); }                             // onChange(value: boolean)
        catch (e) { layoutWarnings.push(`SideBarContainer.onChange 回调抛错：${e && e.message}`); }
      }
    },
    sideBarWidth: (n, v) => {
      const w = /** @type {any} */ (n).__sbc;
      if (!w) return;
      w.barWidth = Number(resolveResource(v)) || 240;
      n.dataset.sideBarWidth = String(w.barWidth);
      w.apply();
    },
    controlButton: (n, v) => {
      const btn = n.querySelector('[data-sbc-btn]');
      if (!btn || !v || typeof v !== 'object') return;
      if (v.left !== undefined) btn.style.left = Number(resolveResource(v.left)) + 'px';
      if (v.top !== undefined) btn.style.top = Number(resolveResource(v.top)) + 'px';
      if (v.icons && v.icons.shown !== undefined) btn.textContent = String(v.icons.shown);
    },
    showControlButton: (n, v) => {
      const btn = n.querySelector('[data-sbc-btn]');
      if (btn) btn.style.display = (v === true || v === undefined) ? '' : 'none';
      n.dataset.showControlButton = String(v !== false);
    },
    autoHide: (n, v) => { n.dataset.autoHide = String(Number(resolveResource(v)) || 0); },
    minContentWidth: (n, v) => { n.dataset.minContentWidth = String(Number(resolveResource(v)) || 0); },
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__sbc;
      if (w) w.cbs.change = v;
    },
  };
  /** @param {any[]} args */
  const SideBarContainer = ensureComponent('SideBarContainer', (args) => {
    const el = document.createElement('div');
    el.__arkuiSideBar = true;
    el.dataset.sideBarContainer = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const type = args && args[0] !== undefined ? Number(resolveResource(args[0])) : 0;
    el.dataset.type = String(type);                   // Embed=0 Overlay=1（声明顺序）
    const w = /** @type {any} */ (el).__sbc = /** @type {any} */ ({
      shown: true, barWidth: 240, cbs: {}, apply: null,
    });
    // 控制按钮：absolute 定位在容器左上（真机 controlButton 位置语义）
    const btn = document.createElement('button');
    btn.setAttribute('data-sbc-btn', '');
    btn.textContent = '←';
    btn.style.position = 'absolute';
    btn.style.zIndex = '10';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      SIDEBAR_ATTRS.showSideBar(el, !w.shown);
    });
    el.appendChild(btn);
    // apply：显隐副作用（侧栏 width/display + data-*），mount 后子组件已就位
    w.apply = () => {
      const sidebar = /** @type {HTMLElement} */ (el.children[1] || null);
      if (sidebar) {
        sidebar.style.display = w.shown ? '' : 'none';
        sidebar.style.width = w.shown ? w.barWidth + 'px' : '0px';
        sidebar.style.minWidth = w.shown ? w.barWidth + 'px' : '0px';
        sidebar.style.maxWidth = w.shown ? w.barWidth + 'px' : '0px';
      }
      const content = /** @type {HTMLElement} */ (el.children[2] || null);
      if (content) {
        content.style.flex = '1';
        content.style.overflow = 'hidden';
      }
    };
    el.__sbcApply = w.apply;
    setTimeout(() => w.apply(), 0);                   // 子组件挂载后应用显隐（同 next frame）
    return el;
  });

  // ────────────────── GridRow / GridCol 响应式网格（R64）──────────────────
  //
  // 产物形态（实测 fixtures/pages/GridRowDemo.ts）：
  //   GridRow.create({ columns: 12, gutter: 8 });
  //   GridCol.create({ span: 6 }); GridCol.create({ span: 12 });
  //
  // 语义（grid_row.d.ts / grid_col.d.ts）：12 列响应式网格；GridCol span 决定占几列；
  //   gutter 列间距。DOM 天然同构：display:grid + grid-template-columns:repeat(12,1fr)
  //   + gap:8px；GridCol span → grid-column: span N。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDROW_ATTRS = {
    columns: (n, v) => {
      const cols = Number(resolveResource(v)) || 12;
      n.dataset.columns = String(cols);
      n.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    },
    gutter: (n, v) => {
      const g = Number(resolveResource(v)) || 0;
      n.dataset.gutter = String(g);
      n.style.gap = g + 'px';
    },
    onBreakpointChange: (n, v) => {
      const w = /** @type {any} */ (n).__gridrow;
      if (w) w.cbs.breakpoint = v;
    },
  };
  /** @param {any[]} args */
  const GridRow = ensureComponent('GridRow', (args) => {
    const el = document.createElement('div');
    el.__arkuiGridRow = true;
    el.dataset.gridRow = '';
    el.style.display = 'grid';
    el.style.gridTemplateColumns = 'repeat(12, 1fr)'; // 缺省 12 列
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__gridrow = { cbs: {} };
    if (o.columns !== undefined) {
      const cols = Number(resolveResource(o.columns)) || 12;
      el.dataset.columns = String(cols);
      el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }
    if (o.gutter !== undefined) {
      const g = Number(resolveResource(o.gutter)) || 0;
      el.dataset.gutter = String(g);
      el.style.gap = g + 'px';
    }
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDCOL_ATTRS = {
    span: (n, v) => {
      const s = Number(resolveResource(v)) || 1;
      n.dataset.span = String(s);
      n.style.gridColumn = `span ${s}`;
    },
    offset: (n, v) => {
      const off = Number(resolveResource(v)) || 0;
      n.dataset.offset = String(off);
      if (off > 0) n.style.gridColumnStart = `${off + 1}`;
    },
    order: (n, v) => {
      n.dataset.order = String(Number(resolveResource(v)) || 0);
      n.style.order = String(Number(resolveResource(v)) || 0);
    },
  };
  /** @param {any[]} args */
  const GridCol = ensureComponent('GridCol', (args) => {
    const el = document.createElement('div');
    el.__arkuiGridCol = true;
    el.dataset.gridCol = '';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.span !== undefined) {
      GRIDCOL_ATTRS.span(el, o.span);
    }
    if (o.offset !== undefined) {
      GRIDCOL_ATTRS.offset(el, o.offset);
    }
    if (o.order !== undefined) {
      GRIDCOL_ATTRS.order(el, o.order);
    }
    return el;
  });

  // ────────────────── RowSplit / ColumnSplit 分隔容器（R62）──────────────────
  //
  // 产物形态（实测 fixtures/pages/SplitDemo.ts）：
  //   RowSplit.create(); RowSplit.width(240); RowSplit.height(60);
  //   ColumnSplit.create(); ColumnSplit.width(120); ColumnSplit.height(80);
  //
  // 语义（.d.ts）：RowSplit = 水平 flex 容器（子组件左右排列），ColumnSplit = 垂直 flex
  //   容器（子组件上下排列）；无自有属性（extends CommonMethod only）；真机有可拖拽分隔
  //   条（DOM 无拖拽分隔条实现，记标注）。
  // DOM：RowSplit → flex row；ColumnSplit → flex column；子组件由通用 width/height 控制。
  const RowSplit = ensureComponent('RowSplit', () => {
    const el = document.createElement('div');
    el.__arkuiRowSplit = true;
    el.dataset.rowSplit = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';                   // 子组件 offset 相对容器
    return el;
  });
  const ColumnSplit = ensureComponent('ColumnSplit', () => {
    const el = document.createElement('div');
    el.__arkuiColumnSplit = true;
    el.dataset.columnSplit = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    return el;
  });

  // ────────────────── Scroll 滚动容器（R46）：真实 overflow 基座 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/ScrollDemo.ts）：
  //   Scroll.create(scroller);        ← create 单参（Scroller 实例，main.js 的 _bind 已接）
  //   Scroll.scrollable(ScrollDirection.Vertical);   ← 枚举自由变量（Vertical=0..None=3）
  //   Scroll.scrollBar(BarState.Off); Scroll.edgeEffect(EdgeEffect.None);
  //   Scroll.onScroll((x,y)=>…); Scroll.onScrollEdge((side)=>…); Scroll.onScrollEnd(…);
  //
  // DOM 映射：根 = div，overflow 由 scrollable 决定（Vertical→overflow-y:auto）。子组件直接
  // 挂进根（builder 的单一子容器）。scrollBar(Off) → scrollbar-width:none + ::-webkit 规则；
  // scrollBarColor/Width → scrollbar-color/width（Chromium 121+）并记 data-*。edgeEffect 记
  // data-*（DOM 无 spring/fade 回弹，edgeEffect None 时禁 over-scroll）。
  // 事件：scroll → onScroll(xOffset,yOffset) + onScrollEdge（到顶/到底的【到达沿】触发一次，
  // 离开后再到才再发）；onScrollStart/onScrollEnd 是真机手势语义——DOM 化为"滚动静默 80ms
  // 收口"（近似，标注）；onScrollStop 与 onScrollEnd 同源（DOM 无 fling/停止之分）。
  // Scroller 侧（scrollBy/scrollEdge/scrollPage）改 scrollTop 后同步派发 'scroll'（确定性）。
  /** @type {Record<string, string>} */
  const SCROLLABLE_CSS = { 0: 'auto', 1: 'auto', 2: 'auto', 3: 'hidden' };  // Vertical/Horizontal/Free/None
  if (!document.getElementById('arkui-scroll-style')) {
    const st = document.createElement('style');
    st.id = 'arkui-scroll-style';
    st.textContent = '[data-scroll-bar="0"]{scrollbar-width:none;}'
      + '[data-scroll-bar="0"]::-webkit-scrollbar{display:none;}';
    document.head.appendChild(st);
  }
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SCROLL_ATTRS = {
    scrollable: (n, v) => {
      const d = Number(resolveResource(v));
      n.dataset.scrollable = String(d);
      // Horizontal → overflow-x:auto（overflow-y:hidden）；Free → 双向
      n.style.overflowX = d === 1 || d === 2 ? 'auto' : 'hidden';
      n.style.overflowY = d === 0 || d === 2 ? 'auto' : 'hidden';
      if (SCROLLABLE_CSS[d] === undefined) {
        layoutWarnings.push(`Scroll.scrollable(${d}): 未知档位，已忽略`);
      }
    },
    scrollBar: (n, v) => { n.dataset.scrollBar = String(Number(resolveResource(v))); },
    scrollBarColor: (n, v) => {
      const c = colorOf(v);
      n.dataset.scrollBarColor = c;
      n.style.scrollbarColor = `${c} transparent`;   // Chromium 121+；否则只记 data-*
    },
    scrollBarWidth: (n, v) => {
      const w = toCssSize(v);
      n.dataset.scrollBarWidth = String(w);
      n.style.scrollbarWidth = String(w);            // thin/数值口径有限——如实记录
    },
    edgeEffect: (n, v) => {
      const e = Number(resolveResource(v));
      n.dataset.edgeEffect = String(e);              // Spring=0 Fade=1 None=2
      n.style.overscrollBehavior = e === 2 ? 'none' : 'contain';
    },
    onScroll: (n, v) => {
      (/** @type {any} */ (n.__scrollCbs = n.__scrollCbs || {})).scroll = v;
    },
    onScrollEdge: (n, v) => {
      (/** @type {any} */ (n.__scrollCbs = n.__scrollCbs || {})).edge = v;
    },
    onScrollStart: (n, v) => {
      (/** @type {any} */ (n.__scrollCbs = n.__scrollCbs || {})).start = v;
    },
    onScrollEnd: (n, v) => {
      (/** @type {any} */ (n.__scrollCbs = n.__scrollCbs || {})).end = v;
    },
    onScrollStop: (n, v) => {
      (/** @type {any} */ (n.__scrollCbs = n.__scrollCbs || {})).stop = v;
    },
    fling: (n, v) => {
      n.dataset.fling = String(Number(resolveResource(v)));
      layoutWarnings.push('Scroll.fling 的真机惯性滚动无 DOM 对应（velocity 记 data-*，不模拟）');
    },
  };
  /** @param {any[]} args */
  const Scroll = ensureComponent('Scroll', (args) => {
    const el = document.createElement('div');
    el.__arkuiScroll = true;
    el.dataset.scroll = '';
    // 默认档：Vertical + scrollBar(Auto) + edgeEffect(Spring)（.d.ts 各自的 @default）
    el.style.overflowY = 'auto';
    el.__scrollCbs = {};
    let lastEdge = '';
    /** @type {any} */ let settleTimer = null;
    let scrolling = false;
    // create 单参：scroller 直接就是 Scroller 实例（.d.ts："(scroller?: Scroller)"——不是
    // {scroller} 选项对象）。手写接管骨架后不走 applyCreateArgs 的通用绑定，必须在工厂里
    // 自己 _bind——首跑 scrollBy 无效就是漏了这步（探针抓到 '未绑定容器'）
    const a0 = args && args[0];
    const scroller = a0 && typeof a0._bind === 'function' ? a0 : (a0 && a0.scroller) || null;
    if (scroller && typeof scroller._bind === 'function') scroller._bind(el);
    /** @param {string} name @param {any=} [a] @param {any=} [b] */
    const fire = (name, a, b) => {
      const cb = el.__scrollCbs && el.__scrollCbs[name];
      if (typeof cb !== 'function') return;
      try { cb(a, b); }
      catch (e) { layoutWarnings.push(`Scroll.onScroll* 回调抛错：${e && e.message}`); }
    };
    /** @param {boolean} top */
    const edgeOf = (top) => (top ? 'top' : 'bottom');
    el.addEventListener('scroll', () => {
      const atTop = el.scrollTop <= 0;
      const atBottom = Math.ceil(el.scrollTop) >= el.scrollHeight - el.clientHeight;
      const side = atTop ? (el.scrollLeft === 0 ? 'top' : 'top') : (atBottom ? 'bottom' : '');
      // 到达沿触发：离开边缘后再到才再发（lastEdge 记忆）
      if (side && side !== lastEdge) fire('edge', side);
      lastEdge = side;
      fire('scroll', el.scrollLeft, el.scrollTop);
      if (!scrolling) {
        scrolling = true;
        fire('start');
      }
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        scrolling = false;
        fire('end');
        fire('stop');
      }, 80);
    });
    // Scroller 侧主动滚动（scrollBy/scrollEdge/scrollPage 改 scrollTop）也走同一 'scroll'
    // 事件；scrollTo 走 el.scrollTo（同样派发）。真机 fling 动画无对应——不模拟（已标注）。
    return el;
  });

  // ────────────────── Grid 网格（R57）：display:grid 基座 + 滚动事件族 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/GridDemo.ts）：
  //   Grid.create(scroller);              ← create 单参（Scroller 实例，工厂里自己 _bind）
  //   Grid.columnsTemplate('1fr 1fr'); Grid.columnsGap(0); Grid.rowsGap(0);
  //   Grid.scrollBar(BarState.Off); Grid.edgeEffect(EdgeEffect.None);
  //   Grid.onScrollIndex((first,last)=>…); Grid.onReachEnd(…);
  //   GridItem.create(()=>{}, false); GridItem.height(60);
  //   GridItem.columnStart(1); GridItem.columnEnd(2);   ← 跨列（含两端，ArkUI 语义）
  //
  // DOM 映射：CSS grid 与 ArkUI 轨道模板天然同构 —— display:grid +
  //   grid-template-columns/rows（normalizeTrackList 归一化，main.js 既有函数）；
  //   GridItem 跨行跨列 → grid-column: start / (end+1)（ArkUI 的 end 是【含】端，CSS 是【排】线）。
  // 事件（真机 grid_pattern 滚动族，WaterFlow 同款收口）：onScrollIndex(first,last) 区间变才发、
  //   首帧补发；onReachEnd 过境判定（分居 scrollHeight-clientHeight 两侧才发）。
  //   cachedCount/GridLayoutOptions 记 data-*（DOM 全量渲染无窗口释放语义）。
  // 基座缺省：display:grid + overflowY:auto（竖向滚动的网格）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRID_ATTRS = {
    columnsTemplate: (n, v) => {
      n.dataset.columnsTemplate = String(v);
      n.style.gridTemplateColumns = normalizeTrackList(v);
    },
    rowsTemplate: (n, v) => {
      n.dataset.rowsTemplate = String(v);
      n.style.gridTemplateRows = normalizeTrackList(v);
    },
    columnsGap: (n, v) => {
      n.dataset.columnsGap = String(Number(resolveResource(v)));
      n.style.columnGap = Number(resolveResource(v)) + 'px';
    },
    rowsGap: (n, v) => {
      n.dataset.rowsGap = String(Number(resolveResource(v)));
      n.style.rowGap = Number(resolveResource(v)) + 'px';
    },
    cachedCount: (n, v) => {
      n.dataset.cachedCount = String(Number(resolveResource(v)));
      layoutWarnings.push('Grid.cachedCount 只记 data-*（DOM 全量渲染，无窗口释放语义）');
    },
    // 滚动观感四件套与 Scroll 同款落点（scrollBar 缺省 Auto、edgeEffect 缺省 Spring，.d.ts 基类）
    scrollBar: SCROLL_ATTRS.scrollBar,
    scrollBarColor: SCROLL_ATTRS.scrollBarColor,
    scrollBarWidth: SCROLL_ATTRS.scrollBarWidth,
    edgeEffect: SCROLL_ATTRS.edgeEffect,
    onScrollIndex: (n, v) => { (/** @type {any} */ (n).__gridCbs = n.__gridCbs || {}).scrollIndex = v; },
    onReachEnd: (n, v) => { (/** @type {any} */ (n).__gridCbs = n.__gridCbs || {}).reachEnd = v; },
    onReachStart: (n, v) => { (/** @type {any} */ (n).__gridCbs = n.__gridCbs || {}).reachStart = v; },
    onScrollStart: (n, v) => { (/** @type {any} */ (n).__gridCbs = n.__gridCbs || {}).start = v; },
    onScrollStop: (n, v) => { (/** @type {any} */ (n).__gridCbs = n.__gridCbs || {}).stop = v; },
  };
  /** @param {any[]} args */
  const Grid = ensureComponent('Grid', (args) => {
    const el = document.createElement('div');
    el.__arkuiGrid = true;
    el.dataset.grid = '';
    el.style.display = 'grid';
    el.style.position = 'relative';                   // 滚动容器一律 relative：offsetTop 以它为基准
    el.style.overflowY = 'auto';
    el.style.overflowX = 'hidden';
    el.style.alignContent = 'start';                  // 行不足视口时内容贴顶（CSS grid 默认 stretch 会摊高行）
    (/** @type {any} */ (el)).__gridCbs = {};
    const a0 = args && args[0];
    if (a0 && typeof a0._bind === 'function') a0._bind(el);   // Grid.create(scroller) 单参直传
    const w = /** @type {any} */ (el).__grid = /** @type {any} */ ({ lastTop: 0, prevTop: undefined, lastRange: null, edgeMem: '', scrolling: false, settleTimer: null });
    /**
     * @param {string} name
     * @param {any=} [a]
     * @param {any=} [b]
     */
    const fire = (name, a, b) => {
      const cb = /** @type {any} */ (el).__gridCbs[name];
      if (typeof cb !== 'function') return;
      try { cb(a, b); }
      catch (e) { layoutWarnings.push(`Grid.on* 回调抛错：${e && e.message}`); }
    };
    // 参与索引统计的 GridItem：嵌套 Grid 的不算（closest 归属守卫）
    /** @returns {HTMLElement[]} */
    const items = () => /** @type {HTMLElement[]} */ (Array.prototype.filter.call(
      el.querySelectorAll('[data-arkui-comp="GridItem"]'),
      (/** @type {any} */ c) => { const g = c.closest('[data-arkui-comp="Grid"]'); return !g || g === el; }));
    const visibleRange = () => {
      const list = items();
      if (!list.length) return null;
      const st = el.scrollTop;
      const end = st + el.clientHeight;
      let first = -1;
      let last = -1;
      list.forEach((it, i) => {
        if (it.offsetTop + it.offsetHeight > st && first < 0) first = i;
        if (it.offsetTop < end) last = i;
      });
      return first < 0 ? null : { first, last };
    };
    el.addEventListener('scroll', () => {
      const st = el.scrollTop;
      if (st === w.lastTop) return;                   // 原生异步 scroll 与手动派发去重（R53 坑 95）
      w.lastTop = st;
      fire('scroll', st - (w.prevTop === undefined ? st : w.prevTop), 1);
      w.prevTop = st;
      const r = visibleRange();
      if (r && (!w.lastRange || r.first !== w.lastRange.first || r.last !== w.lastRange.last)) {
        w.lastRange = r;
        fire('scrollIndex', r.first, r.last);
      }
      const atBottom = el.scrollHeight > el.clientHeight && st >= el.scrollHeight - el.clientHeight;
      if (atBottom && w.edgeMem !== 'bottom') fire('reachEnd');
      w.edgeMem = atBottom ? 'bottom' : '';
      if (!w.scrolling) { w.scrolling = true; fire('start'); }
      if (w.settleTimer) clearTimeout(w.settleTimer);
      w.settleTimer = setTimeout(() => { w.scrolling = false; fire('stop'); }, 80);
    });
    // 首帧：布局落定后补发 onScrollIndex（真机 itemRange 初始 {-1,-1} 首帧必发；同 WaterFlow R53）
    setTimeout(() => {
      const r = visibleRange();
      if (r) {
        /** @type {any} */ (el).__grid.lastRange = r;
        fire('scrollIndex', r.first, r.last);
      }
    }, 0);
    return el;
  });
  // GridItem 的跨行跨列：ArkUI 的 start/end 都是【含】端 → CSS 排线 end+1
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDITEM_ATTRS = {
    columnStart: (n, v) => { n.style.gridColumnStart = String(Number(resolveResource(v))); },
    columnEnd: (n, v) => { n.style.gridColumnEnd = String(Number(resolveResource(v)) + 1); },
    rowStart: (n, v) => { n.style.gridRowStart = String(Number(resolveResource(v))); },
    rowEnd: (n, v) => { n.style.gridRowEnd = String(Number(resolveResource(v)) + 1); },
  };
  /** @param {any[]} _args */
  const GridItem = ensureComponent('GridItem', (_args) => {
    const el = document.createElement('div');
    el.__arkuiGridItem = true;
    el.style.display = 'block';
    return el;
  });

  // ────────────────── WaterFlow 瀑布流（R53）：JS 绝对定位排布复刻真机换列算法 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/WaterFlowDemo.ts）：
  //   WaterFlow.create({ scroller });          ← 选项对象（scroller 由 ensureComponent 通用分支 _bind）
  //   WaterFlow.columnsTemplate('1fr 1fr'); WaterFlow.columnsGap(0); WaterFlow.rowsGap(0);
  //   WaterFlow.edgeEffect(EdgeEffect.None);
  //   WaterFlow.onScrollIndex((first,last)=>…) / onReachStart / onReachEnd /
  //     onScroll((offset,state)=>…) / onScrollStart / onScrollStop
  //   FlowItem.create(); FlowItem.height(60); FlowItem.width(120); …子 Text…; FlowItem.pop();
  //
  // DOM 映射（CSS 无原生瀑布流）：根 div position:relative + overflow 由 layoutDirection 决定
  // （默认 Column→overflow-y:auto）；FlowItem 子项 style.position='absolute' + left/top/width。
  // 排布逐行复刻真机 top_down 算法（water_flow_layout_algorithm.cpp / water_flow_layout_info.cpp）：
  //   GetCrossIndexForNextItem(:271-298)：空列直接选 → 否则累计主轴【严格更小】才换列
  //   （LessNotEqual 容差 -0.001）→ 平高保左列（.d.ts:856 'leftmost column is prioritized'）。
  // 布局时机：属性应用/子增删/resize 后 setTimeout(0) 合并重排（禁 rAF，坑 ⑧）；首排前
  // clientWidth=0 则顺延一轮。事件时序照真机 TriggerPostLayoutEvents（water_flow_pattern.cpp:354-393）：
  //   ① onScroll(delta,state) → ② onScrollIndex(first,last)（区间变才发）→ ③ onReachStart/End
  //   （过境判定 ReachStart/ReachEnd，water_flow_layout_info.cpp:410-428：prev 与 current 分居
  //   minOffset=内容高-视口高 两侧才发）→ ④ onScrollStart。onScrollIndex/onReachStart 首帧必发
  //   （itemRange_ 初始 {-1,-1}；ReachStart 的 firstLayout 分支）→ 工厂里 setTimeout(0) 补发，
  //   排在布局 flush 之后（属性晚于 create 应用，同步发会丢——animator.js R47 教训）。
  //   首帧不发 onReachEnd（真机首帧特殊分支只发 observer 不发应用回调，:429-430）。
  //   onScrollStart/Stop 是 DOM 近似：首个滚动事件发 start、静默 80ms 收口 stop（scroll.js 同款）。
  //   真机 scrollToIndex(4)=120 恰为 max scroll 时 offsetEnd_=true（150-(-120)≥270）→
  //   ReachEnd 过境成立发 RE（夹具已按真机语义修正 R48 摘要漏记的这次 RE）。
  // 默认档（.d.ts 专属默认，≠Scroll）：scrollBar=Off(0)（common.d.ts:25192）、
  //   edgeEffect=None(2)（:25291）→ overscrollBehavior:none。
  /** @type {Record<number, string|null>} */
  const WFD_LAYOUT_MODE = { 1: null, 3: null, 0: 'row', 2: 'row' };  // Column/ColumnReverse/Row/RowReverse
  // 轨道解析：'1fr 1fr' / 'repeat(auto-fill, 120px)' / '120px 1fr' → [{px}]（内容宽 cross、gap px）
  /**
   * @param {any} tpl
   * @param {number} cross
   * @param {number} gap
   * @returns {{px: number}[]}
   */
  const wfdParseTracks = (tpl, cross, gap) => {
    const s = String(tpl === undefined || tpl === null ? '' : tpl).trim();
    if (!s) return [{ px: cross }];
    const autoFill = s.match(/^repeat\(auto-fill,\s*([\d.]+)px\)$/i);
    let defs;
    if (autoFill) {
      const track = Number(autoFill[1]);
      const n = Math.max(1, Math.floor((cross + gap) / (track + gap)));
      defs = new Array(n).fill('1fr');
      return wfdShareTracks(defs, cross, gap, { 0: track });
    }
    return wfdShareTracks(s.split(/\s+/), cross, gap, null);
  };
  /**
   * @param {string[]} defs
   * @param {number} cross
   * @param {number} gap
   * @param {Record<number, number>|null} fixedOverride
   * @returns {{px: number}[]}
   */
  const wfdShareTracks = (defs, cross, gap, fixedOverride) => {
    let fr = 0;
    let fixed = 0;
    /** @type {Record<string, number>} */
    const fixedPx = {};
    defs.forEach((d, i) => {
      const f = fixedOverride && fixedOverride[i] !== undefined ? fixedOverride[i]
        : (d.match(/^([\d.]+)px$/) ? Number((/** @type {RegExpMatchArray} */ (d.match(/^([\d.]+)px$/)))[1]) : null);
      if (f !== null) { fixedPx[i] = f; fixed += f; } else { fr += Number(d) || 1; }
    });
    const unit = defs.length > 1 ? (cross - fixed - gap * (defs.length - 1)) / fr : (cross - fixed);
    return defs.map((d, i) => ({ px: fixedPx[i] !== undefined ? fixedPx[i] : Math.max(0, (Number(d) || 1) * unit) }));
  };
  /** @type {Record<string, (n: HTMLDivElement, v: any) => void>} */
  const WATERFLOW_ATTRS = {
    columnsTemplate: (n, v) => {
      n.dataset.columnsTemplate = String(v);          // 原样记（断言要 '1fr 1fr'），换算在排布里
      wfdSchedule(n);
    },
    rowsTemplate: (n, v) => {
      n.dataset.rowsTemplate = String(v);
      layoutWarnings.push('WaterFlow.rowsTemplate 仅记 data-*（横向瀑布布局本实现未开）');
    },
    columnsGap: (n, v) => { n.dataset.columnsGap = String(Number(resolveResource(v))); wfdSchedule(n); },
    rowsGap: (n, v) => { n.dataset.rowsGap = String(Number(resolveResource(v))); wfdSchedule(n); },
    layoutDirection: (n, v) => {
      const d = Number(resolveResource(v));           // FlexDirection：Row=0 Column=1 RowReverse=2 ColumnReverse=3
      n.dataset.layoutDirection = String(d);
      const horizontal = d === 0 || d === 2;
      n.style.overflowX = horizontal ? 'auto' : 'hidden';
      n.style.overflowY = horizontal ? 'hidden' : 'auto';
      if (d === 2 || d === 3) layoutWarnings.push(`WaterFlow.layoutDirection(${d})：Reverse 主轴翻转未实现（记 data-*）`);
      wfdSchedule(n);
    },
    itemConstraintSize: (n, v) => {
      n.dataset.itemConstraintSize = 'recorded';
      layoutWarnings.push('WaterFlow.itemConstraintSize 只记 data-*（子项 min/max 约束未施加）');
    },
    nestedScroll: (n, v) => {
      const o = v || {};
      n.dataset.nestedScroll = `${Number(resolveResource(o.scrollForward))},${Number(resolveResource(o.scrollBackward))}`;
    },
    enableScrollInteraction: (n, v) => {
      const on = v !== false;
      n.dataset.enableScrollInteraction = String(on);
      n.style.pointerEvents = on ? '' : 'none';       // false：手势滚不动（Scroller API 不受影响）
    },
    friction: (n, v) => { n.dataset.friction = String(Number(resolveResource(v))); },
    cachedCount: (n, v) => {
      n.dataset.cachedCount = String(Number(resolveResource(v)));
      layoutWarnings.push('WaterFlow.cachedCount 只记 data-*（DOM 全量渲染，无窗口释放语义）');
    },
    syncLoad: (n, v) => { n.dataset.syncLoad = String(v !== false); },
    supportEmptyBranchInLazyLoading: (n, v) => { n.dataset.supportEmptyBranch = String(v === true); },
    fadingEdge: (n, v) => { n.dataset.fadingEdge = String(v === true); },
    flingSpeedLimit: (n, v) => { n.dataset.flingSpeedLimit = String(Number(resolveResource(v))); },
    backToTop: (n, v) => { n.dataset.backToTop = String(v === true); },
    clipContent: (n, v) => { n.dataset.clipContent = String(Number(resolveResource(v))); },
    contentStartOffset: (n, v) => { n.dataset.contentStartOffset = String(Number(resolveResource(v))); },
    contentEndOffset: (n, v) => { n.dataset.contentEndOffset = String(Number(resolveResource(v))); },
    // 与 Scroll 同款落点（scrollBar 默认 Off 是 WaterFlow 专属，工厂里已预置）
    scrollBar: SCROLL_ATTRS.scrollBar,
    scrollBarColor: SCROLL_ATTRS.scrollBarColor,
    scrollBarWidth: SCROLL_ATTRS.scrollBarWidth,
    edgeEffect: SCROLL_ATTRS.edgeEffect,
    onScrollIndex: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).scrollIndex = v; },
    onReachStart: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).reachStart = v; },
    onReachEnd: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).reachEnd = v; },
    onScroll: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).scroll = v; },
    onDidScroll: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).didScroll = v; },
    onScrollStart: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).start = v; },
    onScrollStop: (n, v) => { (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).stop = v; },
    onScrollFrameBegin: (n, v) => {
      (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).frameBegin = v;
      layoutWarnings.push('WaterFlow.onScrollFrameBegin 只登记不触发（真机仅用户交互/惯性时前置回调，程序 API 不触发；原生滚轮无法前置拦截）');
    },
    onWillScroll: (n, v) => {
      (/** @type {any} */ (n.__wfCbs = n.__wfCbs || {})).willScroll = v;
      layoutWarnings.push('WaterFlow.onWillScroll 只登记（滚动量改写无前置拦截点）');
    },
  };
  // 排布调度：同一轮多个属性变更合并成一次 flush（坑 ⑥ 同值守卫的重排 counterpart）
  /** @param {HTMLDivElement} n */
  const wfdSchedule = (n) => {
    const w = /** @type {any} */ (n).__wf;
    if (!w) return;
    if (w.pending) return;
    w.pending = setTimeout(() => { w.pending = null; wfdLayout(n); }, 0);
  };
  /** @param {HTMLDivElement} root */
  const wfdLayout = (root) => {
    const w = /** @type {any} */ (root).__wf;
    if (!w) return;
    const cross = root.clientWidth;
    if (cross <= 0) { wfdSchedule(root); return; }    // 未挂载/零宽：顺延一轮
    const colGap = Number(root.dataset.columnsGap) || 0;
    const rowGap = Number(root.dataset.rowsGap) || 0;
    const horizontal = root.style.overflowX === 'auto';
    if (horizontal) layoutWarnings.push('WaterFlow 横向瀑布（layoutDirection Row）本实现未排布（记 data-*）');
    // 段切分：sections 启用时按段排（columnsTemplate/rowsTemplate 被忽略，.d.ts:350-353），
    // 段列数 = crossCount（缺省 1，water_flow_segmented_layout.cpp:303 的 max(crossCount,1)）
    const secs = w.sections && typeof w.sections.values === 'function' ? w.sections.values() : null;
    const items = wfdItems(root);
    /** @type {{items: any[], crossCount: number, gap: number, tracks?: {px: number}[]}[]} */
    let segs;
    if (secs && secs.length) {
      segs = [];
      let cursor = 0;
      secs.forEach((/** @type {any} */ s) => {
        const count = Math.max(0, Math.floor(Number(s.itemsCount) || 0));
        segs.push({ items: items.slice(cursor, cursor + count), crossCount: Math.max(1, Math.floor(Number(s.crossCount) || 1)), gap: s.columnsGap !== undefined && s.columnsGap !== null ? Number(resolveResource(s.columnsGap)) : colGap });
        cursor += count;
      });
      if (cursor !== items.length) {
        layoutWarnings.push(`WaterFlow.sections 的 itemsCount 总和(${cursor}) ≠ 子项数(${items.length})：布局可能异常（.d.ts :136-140 同款警告）`);
      }
    } else {
      const tracks = wfdParseTracks(root.dataset.columnsTemplate, cross, colGap);
      segs = [{ items, crossCount: tracks.length, gap: colGap, tracks }];
    }
    let crossCursor = 0;
    segs.forEach((seg) => {
      const tracks = seg.tracks || (() => {
        const n = seg.crossCount;
        const unit = n > 1 ? (cross - seg.gap * (n - 1)) / n : cross;
        return new Array(n).fill(0).map(() => ({ px: Math.max(0, unit) }));
      })();
      // 真机换列（water_flow_layout_info.cpp:271-298）：空列直接选 → 累计主轴严格更小才换
      // → 平高保左列（LessNotEqual 容差 -0.001）
      const colH = new Array(tracks.length).fill(0);
      const used = new Array(tracks.length).fill(false);
      const segStart = crossCursor;                   // 段沿主轴续排（section 混列不换行）
      seg.items.forEach((/** @type {HTMLElement} */ item) => {
        if (item.style.display === 'none') {           // display:none 不参与（visibility 语义未分档）
          return;
        }
        let col = -1;
        let minH = Infinity;
        for (let i = 0; i < colH.length; i++) {
          if (!used[i]) { col = i; break; }            // 空列直接选中并 break（真机同款）
          if (colH[i] < minH - 0.001) { minH = colH[i]; col = i; }  // 严格更小才换列
        }
        if (col < 0) col = 0;
        used[col] = true;
        const main = colH[col];
        const trackW = tracks[col].px;
        item.style.position = 'absolute';              // 没有它 left/top 全部无效（首跑抓到）
        if (horizontal) {
          item.style.left = segStart + main + 'px';
          item.style.top = '0px';
        } else {
          item.style.left = col * (trackW + seg.gap) + 'px';
          item.style.top = segStart + main + 'px';
        }
        item.style.width = trackW + 'px';
        colH[col] = main + item.offsetHeight + rowGap;
      });
      crossCursor += Math.max.apply(null, colH.concat([0]));
    });
  };
  /** @param {any[]} args */
  const WaterFlow = ensureComponent('WaterFlow', (args) => {
    const el = document.createElement('div');
    el.__arkuiWaterFlow = true;
    el.style.position = 'relative';                   // 滚动容器一律 relative：offsetTop 以它为基准
    el.style.overflowY = 'auto';                      // 默认 layoutDirection=Column（value_or(COLUMN)）
    el.style.overflowX = 'hidden';
    el.style.display = 'block';
    el.style.overscrollBehavior = 'none';             // 默认 edgeEffect=None（common.d.ts:25291）
    el.dataset.scrollBar = '0';                       // 默认 scrollBar=Off（WaterFlow 专属，≠Scroll 的 Auto）
    el.dataset.layoutMode = '0';                      // WaterFlowLayoutMode.ALWAYS_TOP_DOWN（显式 =0）
    el.dataset.edgeEffect = '2';
    el.dataset.layoutDirection = '1';
    const w = /** @type {any} */ (el).__wf = { pending: null, sections: null, lastTop: 0 };
    /** @type {any} */ (el).__wfCbs = {};
    const a0 = args && args[0];
    if (a0 && typeof a0 === 'object') {
      if (a0.sections) { w.sections = a0.sections; el.dataset.sections = 'present'; }
      if (a0.layoutMode !== undefined) el.dataset.layoutMode = String(Number(resolveResource(a0.layoutMode)));
      if (a0.footer || a0.footerContent) {
        el.dataset.footerPresent = 'true';
        layoutWarnings.push('WaterFlow footer/footerContent 未渲染（CustomBuilder 产物形态未接，记 data-*）');
      }
    }
    /**
     * @param {string} name
     * @param {any=} [a]
     * @param {any=} [b]
     */
    const fire = (name, a, b) => {
      const cb = /** @type {any} */ (el).__wfCbs[name];
      if (typeof cb !== 'function') return;
      try { cb(a, b); }
      catch (e) { layoutWarnings.push(`WaterFlow.on* 回调抛错：${e && e.message}`); }
    };
    // 可见区间（FastSolveStart/EndIndex 语义）：first=首个底缘越过视口顶者，last=末个顶缘在视口底之上者
    const visibleRange = () => {
      const items = wfdItems(el);
      if (!items.length) return null;
      const st = el.scrollTop;
      const end = st + el.clientHeight;
      let first = -1;
      let last = -1;
      items.forEach((it, i) => {
        if (it.offsetTop + it.offsetHeight > st && first < 0) first = i;
        if (it.offsetTop < end) last = i;
      });
      return first < 0 ? null : { first, last };
    };
    el.addEventListener('scroll', () => {
      const w2 = /** @type {any} */ (el).__wf;
      const st = el.scrollTop;
      if (st === w2.lastTop) return;                  // 原生异步 scroll 事件与手动同步派发重复（首跑抓到
      const delta = st - w2.lastTop;                  // 的 D0 尾巴）；停止收口走 80ms 静默，不靠 delta=0
      w2.lastTop = st;
      fire('scroll', delta, 1);                       // ScrollState.Scroll=1（Idle=0/Fling=2）
      fire('didScroll', delta, 1);
      const r = visibleRange();
      if (r && (!w2.lastRange || r.first !== w2.lastRange.first || r.last !== w2.lastRange.last)) {
        w2.lastRange = r;
        fire('scrollIndex', r.first, r.last);
      }
      // 到达沿（过境判定）：分居 minOffset 两侧才发；lastEdge 记忆防重复（scroll.js 同款）
      const atTop = st <= 0;
      const atBottom = el.scrollHeight > el.clientHeight && st >= el.scrollHeight - el.clientHeight;
      const edge = atTop ? 'top' : (atBottom ? 'bottom' : '');
      if (edge && edge !== w2.edgeMem) {
        if (edge === 'top') fire('reachStart'); else fire('reachEnd');
      }
      w2.edgeMem = edge;
      if (!w2.scrolling) { w2.scrolling = true; fire('start'); }
      if (w2.settleTimer) clearTimeout(w2.settleTimer);
      w2.settleTimer = setTimeout(() => { w2.scrolling = false; fire('stop'); }, 80);
    });
    // 排布先于初始事件调度（同为 0ms 定时器按插入序执行）：首帧必发的 onScrollIndex/
    // onReachStart（itemRange_={-1,-1} / firstLayout 分支）必须看到排布后的几何——首跑抓到
    // 反序时 init 读到未排布的堆叠几何发出 I0,1。首帧不发 RE（真机首帧只发 observer）。
    wfdSchedule(el);
    setTimeout(() => {
      const r = visibleRange();
      if (r) {
        /** @type {any} */ (el).__wf.lastRange = r;
        fire('scrollIndex', r.first, r.last);
      }
      if (el.scrollTop <= 0) {
        /** @type {any} */ (el).__wf.edgeMem = 'top';
        fire('reachStart');
      }
    }, 0);
    // 子增删（ForEach/条件渲染）后重排；窗口 resize 同理
    new MutationObserver(() => wfdSchedule(el)).observe(el, { childList: true });
    return el;
  });
  // 参与排布的 FlowItem：直接子项 + ForEach 包裹层（display:contents）里的孙子都算，
  // 但嵌套 WaterFlow 的不算（closest 归属守卫）
  /** @param {HTMLElement} root @returns {HTMLElement[]} */
  const wfdItems = (root) => /** @type {HTMLElement[]} */ (Array.prototype.filter.call(
    root.querySelectorAll('[data-arkui-comp="FlowItem"]'),
    (/** @type {Element} */ c) => { const w = c.closest('[data-arkui-comp="WaterFlow"]'); return !w || w === root; }));
  // FlowItem：WaterFlow 专属子项（.d.ts 'can be used only as a child of WaterFlow'，无专有属性）
  const FlowItem = ensureComponent('FlowItem', () => {
    const el = document.createElement('div');
    el.__arkuiFlowItem = true;
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    return el;
  });
  // WaterFlowSections shim（water_flow.d.ts:148-236）：itemsCount 必须非负，非法 push/splice 返 false
  class WaterFlowSections {
    constructor() { this._secs = /** @type {any[]} */ ([]); }
    /** @param {any} s */
    _valid(s) { return !!s && typeof s.itemsCount === 'number' && s.itemsCount >= 0; }
    /** @param {any} section */
    push(section) { if (!this._valid(section)) return false; this._secs.push(Object.assign({}, section)); return true; }
    /** @param {number} start @param {number} deleteCount @returns {boolean} */
    splice(start, deleteCount) {
      const add = Array.prototype.slice.call(arguments, 2);
      for (let i = 0; i < add.length; i++) { if (!this._valid(add[i])) return false; }
      this._secs.splice.apply(this._secs, [start, deleteCount].concat(add.map((/** @type {any} */ s) => Object.assign({}, s))));
      return true;
    }
    /**
     * @param {number} sectionIndex
     * @param {any} section
     */
    update(sectionIndex, section) {
      if (!this._valid(section) || sectionIndex < 0 || sectionIndex >= this._secs.length) return false;
      this._secs[sectionIndex] = Object.assign({}, section);
      return true;
    }
    values() { return this._secs.map((s) => Object.assign({}, s)); }
    length() { return this._secs.length; }
  }

  // ────────────────── CalendarPicker 日期选择入口（R54）──────────────────
  //
  // 产物形态（实测 fixtures/pages/CalendarPickerDemo.ts）：
  //   CalendarPicker.create({ selected, start?, end?, disabledDateRange?, hintRadius? });
  //   CalendarPicker.edgeAlign(CalendarAlign.START); CalendarPicker.markToday(true);
  //   CalendarPicker.textStyle({...}); CalendarPicker.onChange((d: Date) => …);
  //   CalendarPickerDialog.show({ selected, onAccept, onCancel, onChange? });
  //
  // 真机结构（calendar_picker_model_ng.cpp LayoutPicker:89-113 / calendar_picker_pattern.cpp）：
  //   入口 = 年/月/日三段文本 + 加/减两按钮；点日期段 → ShowDialog + 记活动段（:404-427）；
  //   点 +/- → HandleAddButtonClick(:561-584)：NextDateBySelectedType 步进活动段 →
  //   GetAvailableNextDay 跳过 disabledDateRange 且夹在 [start,end]（无可到日返回 year<=0
  //   哨兵 → 不动不发）→ SetDate + FireChangeEvents——【+/- 也触发 onChange】；
  //   非 YEAR/MONTH 段步进后回贴 DAY（:420-430）。
  // 弹层（calendar_dialog_pattern.cpp）：点日期 → ReportChangeEvent("CalendarPicker","onChange")
  //   由 CanReportChangeEvent 同值不重发（:1615-1620）；弹层不因点日期关闭
  //   （OK=accept 关、外点=cancel 关）。月历首列【周日】（calendar_paint_method.cpp:531
  //   weekNumbers_[(startOfWeek_+1)%7]，startOfWeek_ 默认 64→log2=6→首列=weekNumbers_[0]=SUN）。
  // selected 缺省/非法 → 系统今天（.d.ts:101）；AdjustDateToRange 夹入 [start,end]（model_ng:98）。
  // DOM 映射：入口 inline-flex（span 三段 + button 两枚）；弹层 = 入口内绝对定位面板
  //   （edgeAlign START/CENTER/END → left/居中/right，缺省 END .d.ts:198）；网格 7 列 grid，
  //   前置空格 = 首日 getDay()（周日=0）；语言取 zh（本项目夹具环境，标注）。
  const CALP_WEEK = ['日', '一', '二', '三', '四', '五', '六'];   // 首列周日（真机同序）
  /** @param {number} y @param {number} m */
  const calpDaysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  /** @param {any} p */
  const calpDateOf = (p) => new Date(p.y, p.m, p.d);
  /** @param {Date} date */
  const calpPartsOf = (date) => ({ y: date.getFullYear(), m: date.getMonth(), d: date.getDate() });
  /** @param {any} a @param {any} b */
  const calpLe = (a, b) => calpDateOf(a).getTime() <= calpDateOf(b).getTime();
  /** @param {any} a @param {any} b */
  const calpLt = (a, b) => calpDateOf(a).getTime() < calpDateOf(b).getTime();
  /** @param {any} a @param {any} b */
  const calpEq = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
  // AdjustDateToRange（calendar_picker_model_ng.cpp:98）：夹入 [start,end]
  /** @param {any} p @param {any} start @param {any} end */
  const calpAdjust = (p, start, end) => {
    if (start && calpLt(p, start)) return Object.assign({}, start);   // p 在 start 前 → 抬到 start
    if (end && calpLt(end, p)) return Object.assign({}, end);         // p 在 end 后 → 压到 end
    return p;
  };
  // hintRadius（.d.ts:73-83）：0=直角矩形、(0,16)=圆角 px、负数或>16=回落缺省 16（圆形 → 50%）
  /** @param {any} hr */
  const calpRadius = (hr) => (hr === undefined || hr === null || hr < 0 || hr > 16)
    ? '50%' : (hr === 0 ? '0px' : `${hr}px`);
  // 禁用判定：越 [start,end] 边界，或落在任一 disabledDateRange 区间内
  /** @param {any} p @param {any} st */
  const calpDisabled = (p, st) => {
    if (st.start && !calpLe(st.start, p)) return true;
    if (st.end && !calpLe(p, st.end)) return true;
    return (st.dis || []).some((/** @type {any} */ r) => calpLe(r.start, p) && calpLe(p, r.end));
  };
  // GetAvailableNextDay（:563-566）：从 p 沿 dir 找第一个可用日；无可到日返 null（=真机 year<=0 哨兵）
  /** @param {any} p @param {number} dir @param {any} st */
  const calpNextAvail = (p, dir, st) => {
    let cur = Object.assign({}, p);
    for (let i = 0; i < 4000; i++) {
      const cand = calpPartsOf(new Date(cur.y, cur.m, cur.d + dir));
      if (calpDisabled(cand, st)) { cur = cand; continue; }
      return cand;
    }
    return null;
  };
  /** @param {HTMLElement} el */
  const calpRender = (el) => {
    const st = /** @type {any} */ (el).__calp;
    el.querySelectorAll('[data-cal-seg]').forEach((s) => {
      const k = s.getAttribute('data-cal-seg');
      s.textContent = k === 'year' ? `${st.sel.y}年` : k === 'month' ? `${st.sel.m + 1}月` : `${st.sel.d}日`;
    });
  };
  /** @param {HTMLElement} el @param {Date} date */
  const calpFire = (el, date) => {
    const st = /** @type {any} */ (el).__calp;
    if (typeof st.cbs.change !== 'function') return;
    try { st.cbs.change(date); }
    catch (e) { layoutWarnings.push(`CalendarPicker.onChange 回调抛错：${e && e.message}`); }
  };
  // 入口 +/-（真机 HandleAddButtonClick/HandleSubButtonClick 全流程）
  /** @param {HTMLElement} el @param {number} dir */
  const calpStep = (el, dir) => {
    const st = /** @type {any} */ (el).__calp;
    let cand;
    if (st.seg === 'year') cand = Object.assign({}, st.sel, { y: st.sel.y + dir });
    else if (st.seg === 'month') {
      cand = calpPartsOf(new Date(st.sel.y, st.sel.m + dir, 1));
      const dim = calpDaysIn(cand.y, cand.m);
      if (st.sel.d > dim) cand.d = dim;                      // 步月：日超出当月则贴月末
    } else cand = Object.assign({}, st.sel);
    const avail = calpNextAvail(cand, dir, st) || cand;
    if (calpEq(avail, st.sel)) return;                       // 无可到日：不动不发（真机 year<=0）
    if (st.seg !== 'year' && st.seg !== 'month') st.seg = 'day';   // 真机：非年月段回贴 DAY
    st.sel = avail;
    calpRender(el);
    calpFire(el, calpDateOf(st.sel));
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CALPICK_ATTRS = {
    edgeAlign: (n, v) => {
      const a = Number(resolveResource(v));                  // START=0 CENTER=1 END=2（.d.ts 显式）
      n.dataset.align = String(a);
      (/** @type {any} */ (n).__calp).align = a;
    },
    textStyle: (n, v) => {
      const o = v || {};
      n.dataset.textStyle = 'set';
      n.querySelectorAll('[data-cal-seg]').forEach((/** @type {any} */ s) => {
        if (o.color !== undefined) s.style.color = colorOf(o.color);
        if (o.font && o.font.size !== undefined) s.style.fontSize = toCssSize(o.font.size);
        if (o.font && o.font.weight !== undefined) s.style.fontWeight = String(resolveResource(o.font.weight));
      });
    },
    markToday: (n, v) => {
      (/** @type {any} */ (n).__calp).markToday = v === true;   // 状态必须接线（首跑抓到只写 dataset）
      n.dataset.markToday = String(v === true);
    },
    onChange: (n, v) => { (/** @type {any} */ (n).__calp).cbs.change = v; },
  };
  // 弹层网格（组件弹层与静态 Dialog 共用）：首列周日、前置空格、选中/禁用/今天标记
  /** @param {HTMLElement} grid @param {any} st @param {(d: Date) => void=} [onChangeTap] */
  const calpBuildGrid = (grid, st, onChangeTap) => {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    const render = () => {
      grid.textContent = '';
      CALP_WEEK.forEach((w) => {
        const c = document.createElement('span');
        c.setAttribute('data-cal-wk', '');
        c.textContent = w;
        grid.appendChild(c);
      });
      for (let i = 0; i < new Date(st.view.y, st.view.m, 1).getDay(); i++) {
        grid.appendChild(document.createElement('span'));    // 前置空格 = 首日 getDay()（周日=0）
      }
      const dim = calpDaysIn(st.view.y, st.view.m);
      for (let d = 1; d <= dim; d++) {
        const p = { y: st.view.y, m: st.view.m, d };
        const cell = document.createElement('button');
        cell.setAttribute('data-cal-day', String(d));
        cell.textContent = String(d);
        if (calpEq(p, st.sel)) {
          cell.setAttribute('data-cal-selected', 'true');
          cell.style.borderRadius = calpRadius(st.hr);       // hintRadius 视觉（缺省圆形）
        }
        if (calpDisabled(p, st)) cell.setAttribute('data-cal-disabled', 'true');
        if (st.markToday && calpEq(p, calpPartsOf(new Date()))) cell.setAttribute('data-cal-today', 'true');
        cell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (calpDisabled(p, st)) return;                   // 禁用日点击忽略
          const prevSel = st.sel;
          st.sel = p;
          if (!calpEq(prevSel, p) && onChangeTap) onChangeTap(calpDateOf(p));   // 同值不重发
          render();
        });
        grid.appendChild(cell);
      }
    };
    render();
    return render;
  };
  /** @param {HTMLElement} el */
  const calpOpenDialog = (el) => {
    const st = /** @type {any} */ (el).__calp;
    if (st.dlg && el.contains(st.dlg)) return;               // IsDialogShow 守卫（:536）
    st.view = { y: st.sel.y, m: st.sel.m };                  // 打开时落在 selected 所在月
    const dlg = document.createElement('div');
    dlg.setAttribute('data-arkui-calpick-dlg', '');
    dlg.setAttribute('data-open', 'true');
    const a = st.align;
    if (a === 0) dlg.style.left = '0px';
    else if (a === 1) { dlg.style.left = '50%'; dlg.style.transform = 'translateX(-50%)'; }
    else dlg.style.right = '0px';                            // 缺省 END（.d.ts:198）
    dlg.style.top = el.offsetHeight + 'px';
    const title = document.createElement('div');
    title.setAttribute('data-cal-title', '');
    const prev = document.createElement('button');
    prev.setAttribute('data-cal-prev', ''); prev.textContent = '‹';
    const next = document.createElement('button');
    next.setAttribute('data-cal-next', ''); next.textContent = '›';
    const tt = document.createElement('span');
    title.appendChild(prev); title.appendChild(tt); title.appendChild(next);
    const grid = document.createElement('div');
    grid.setAttribute('data-cal-grid', '');
    const renderGrid = calpBuildGrid(grid, st, (date) => calpFire(el, date));
    prev.addEventListener('click', (ev) => {
      ev.stopPropagation();
      st.view = calpPartsOf(new Date(st.view.y, st.view.m - 1, 1));
      tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
      renderGrid();
    });
    next.addEventListener('click', (ev) => {
      ev.stopPropagation();
      st.view = calpPartsOf(new Date(st.view.y, st.view.m + 1, 1));
      tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
      renderGrid();
    });
    tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
    dlg.appendChild(title);
    dlg.appendChild(grid);
    dlg.addEventListener('click', (ev) => ev.stopPropagation());   // 弹层内点击不算外点
    el.appendChild(dlg);
    st.dlg = dlg;
    setTimeout(() => {                                       // 开层这一笔点击不能自己关自己
      st.outside = (/** @type {any} */ ev) => {
        if (!el.contains(ev.target)) calpCloseDialog(el);
      };
      document.addEventListener('click', st.outside);
    }, 0);
  };
  /** @param {HTMLElement} el */
  const calpCloseDialog = (el) => {
    const st = /** @type {any} */ (el).__calp;
    if (st.dlg && st.dlg.parentNode) st.dlg.parentNode.removeChild(st.dlg);
    st.dlg = null;
    if (st.outside) {
      document.removeEventListener('click', st.outside);
      st.outside = null;
    }
  };
  const CalendarPicker = ensureComponent('CalendarPicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiCalPick = true;
    el.dataset.calPick = '';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.position = 'relative';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const st = /** @type {any} */ (el).__calp = /** @type {any} */ ({
      sel: null, start: null, end: null, dis: [], hr: undefined,
      align: 2, markToday: false, seg: 'day', cbs: {}, dlg: null, outside: null, view: null,
    });
    if (o.start instanceof Date) { st.start = calpPartsOf(o.start); el.dataset.start = calpIso(o.start); }
    if (o.end instanceof Date) { st.end = calpPartsOf(o.end); el.dataset.end = calpIso(o.end); }
    if (Array.isArray(o.disabledDateRange)) {
      st.dis = o.disabledDateRange
        .filter((/** @type {any} */ r) => r && r.start instanceof Date && r.end instanceof Date)
        .map((/** @type {any} */ r) => ({ start: calpPartsOf(r.start), end: calpPartsOf(r.end) }));
      el.dataset.disabledRange = String(st.dis.length);
    }
    st.sel = o.selected instanceof Date
      ? calpPartsOf(o.selected)
      : calpPartsOf(new Date());                             // 缺省 = 系统今天（.d.ts:101）
    st.sel = calpAdjust(st.sel, st.start, st.end);           // AdjustDateToRange
    if (o.hintRadius !== undefined) st.hr = Number(resolveResource(o.hintRadius));
    el.dataset.hintRadius = String(st.hr === undefined ? 16 : st.hr);   // 缺省 16（.d.ts:85）
    el.dataset.align = '2';                                  // 缺省 END（.d.ts:198）
    el.dataset.markToday = 'false';                          // 缺省 false（.d.ts:291）
    ['year', 'month', 'day'].forEach((k) => {
      const s = document.createElement('span');
      s.setAttribute('data-cal-seg', k);
      s.style.cursor = 'pointer';
      s.addEventListener('click', (ev) => {
        ev.stopPropagation();
        st.seg = k;                                          // 点段：记活动段 + 开弹层（真机 :404-427）
        calpOpenDialog(el);
      });
      el.appendChild(s);
    });
    const sub = document.createElement('button');
    sub.setAttribute('data-cal-btn', 'sub');
    sub.textContent = '−';
    sub.addEventListener('click', (ev) => { ev.stopPropagation(); calpStep(el, -1); });
    const add = document.createElement('button');
    add.setAttribute('data-cal-btn', 'add');
    add.textContent = '+';
    add.addEventListener('click', (ev) => { ev.stopPropagation(); calpStep(el, 1); });
    el.appendChild(sub);
    el.appendChild(add);
    el.addEventListener('click', () => calpOpenDialog(el));  // 其余区域点击 → 开弹层（:440）
    calpRender(el);
    return el;
  });
  /** @param {Date} date */
  const calpIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  // CalendarPickerDialog.show（静态弹层）：带 OK/Cancel（onAccept/onCancel，.d.ts:332-344）。
  // 与组件弹层共用 calpBuildGrid；面板 fixed 居中（DOM 无 OverlayManager 弹簧动画，标注）。
  const CalendarPickerDialog = {
    /** @param {any} options */
    show(options) {
      const o = options || {};
      const host = document.createElement('div');
      host.setAttribute('data-arkui-calpick-static', '');
      host.setAttribute('data-open', 'true');
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.top = '50%';
      host.style.transform = 'translate(-50%, -50%)';
      host.style.zIndex = '9999';
      const st = {
        sel: o.selected instanceof Date ? calpPartsOf(o.selected) : calpPartsOf(new Date()),
        start: o.start instanceof Date ? calpPartsOf(o.start) : null,
        end: o.end instanceof Date ? calpPartsOf(o.end) : null,
        dis: Array.isArray(o.disabledDateRange)
          ? o.disabledDateRange
            .filter((/** @type {any} */ r) => r && r.start instanceof Date && r.end instanceof Date)
            .map((/** @type {any} */ r) => ({ start: calpPartsOf(r.start), end: calpPartsOf(r.end) }))
          : [],
        hr: o.hintRadius !== undefined ? Number(resolveResource(o.hintRadius)) : undefined,
        align: 1, markToday: o.markToday === true, seg: 'day',
        cbs: {}, dlg: null, outside: null,
        view: { y: 0, m: 0 },
      };
      st.view = { y: st.sel.y, m: st.sel.m };
      const title = document.createElement('div');
      title.setAttribute('data-cal-title', '');
      const tt = document.createElement('span');
      tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
      title.appendChild(tt);
      const grid = document.createElement('div');
      grid.setAttribute('data-cal-grid', '');
      calpBuildGrid(grid, st, (date) => {
        if (typeof o.onChange === 'function') {
          try { o.onChange(date); }
          catch (e) { layoutWarnings.push(`CalendarPickerDialog.onChange 抛错：${e && e.message}`); }
        }
      });
      const ok = document.createElement('button');
      ok.setAttribute('data-cal-ok', '');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        close();
        if (typeof o.onAccept === 'function') {
          try { o.onAccept(calpDateOf(st.sel)); }
          catch (e) { layoutWarnings.push(`CalendarPickerDialog.onAccept 抛错：${e && e.message}`); }
        }
      });
      const cancel = document.createElement('button');
      cancel.setAttribute('data-cal-cancel', '');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        close();
        if (typeof o.onCancel === 'function') {
          try { o.onCancel(); }
          catch (e) { layoutWarnings.push(`CalendarPickerDialog.onCancel 抛错：${e && e.message}`); }
        }
      });
      host.appendChild(title);
      host.appendChild(grid);
      host.appendChild(ok);
      host.appendChild(cancel);
      const close = () => { if (host.parentNode) host.parentNode.removeChild(host); };
      document.body.appendChild(host);
    },
  };

  // ────────────────── 小件收官（R36）：Flex / Span / LoadingProgress / Blank ──────────────────
  //
  // 产物形态（实测 fixtures/pages/SmallDemo.ts）：
  //   Flex.create({direction, wrap, justifyContent, alignItems});   ← 与 CSS 同名对齐（style 透传）
  //   Span.create('…'); Span.fontColor/fontSize/decoration;   ← Text 的【内联子段】（Text 栈内挂）
  //   LoadingProgress.create(); LoadingProgress.color(...);   ← spinner
  //   Blank.create(); Blank.color(...);                       ← Row/Column 里的 flex 占位
  //
  // 语义锚点：Flex 的 create 参数与 CSS flex 同名同义（对齐值已由取值层对齐 CSS 关键字，
  // style 透传即可）；Blank 在 Row/Column 内 = flex:1 自动填充；color = 空白背景色。
  // Span 的语义 = Text 内联子段：字体属性落在自身 span 元素上（与 Text 手写实现的
  // 内联文本模型一致——见 §4.1 Text 的 node 结构）。
  const Flex = ensureComponent('Flex', defaultDom('div', {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
  }));
  const Span = ensureComponent('Span', (args) => {
    const el = document.createElement('span');
    el.__arkuiSpan = true;
    el.textContent = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SPAN_ATTRS = {
    fontColor: (n, v) => { n.style.color = colorOf(v); },
    fontSize: (n, v) => { n.style.fontSize = `${dimOf(v, 16)}px`; },
    fontStyle: (n, v) => { n.style.fontStyle = String(resolveResource(v)); },
    fontWeight: (n, v) => { n.style.fontWeight = String(resolveResource(v)); },
    decoration: (n, v) => {
      const o = (v && typeof v === 'object' && v) || {};
      // TextDecorationType 的枚举值就是 CSS 关键字（挂 global 时已对齐），t 直接可用
      const t = String(resolveResource(o.type === undefined ? 'none' : o.type));
      n.style.textDecorationLine = t === 'line-through' ? 'line-through' : t;
      if (t !== 'none' && o.color !== undefined) n.style.textDecorationColor = colorOf(o.color);
    },
    textCase: (n, v) => { n.dataset.textCase = String(resolveResource(v)); },
    textShadow: (n, v) => { n.dataset.textShadow = '1'; },
  };
  const LoadingProgress = ensureComponent('LoadingProgress', () => {
    const el = document.createElement('div');
    el.__arkuiLoading = true;
    el.dataset.loadingProgress = '';
    if (!document.getElementById('arkui-loading-keyframes')) {
      const kf = document.createElement('style');
      kf.id = 'arkui-loading-keyframes';
      kf.textContent = '@keyframes arkuiLoading{to{transform:rotate(360deg)}}';
      document.head.appendChild(kf);
    }
    el.style.border = '3px solid currentColor';
    el.style.borderTopColor = 'transparent';
    el.style.borderRadius = '50%';
    el.style.boxSizing = 'border-box';
    el.style.animation = 'arkuiLoading 1s linear infinite';
    return el;
  });
  const Blank = ensureComponent('Blank', () => {
    const el = document.createElement('div');
    el.__arkuiBlank = true;
    el.__arkuiBlankMin = 0;
    // Row/Column 内：flex:1 占满剩余空间；无父 flex 时按 min 呈现
    el.style.flex = '1 1 auto';
    return el;
  });

  // ────────────────── 分步器（R37）：Stepper / StepperItem ──────────────────
  //
  // 产物形态（实测 fixtures/pages/StepDemo.ts）：
  //   Stepper.create({index: 0}); Stepper.onChange((prevIndex, index) => …);
  //     Stepper.onNext/onPrevious/onSkip/onFinish
  //   StepperItem.create(); StepperItem.prevLabel/nextLabel; StepperItem.status(ItemState.Skip)
  //
  // 语义锚点（stepper.d.ts / stepper_item.d.ts 原文）：
  //   onFinish —— 最后一页（ItemState=Normal）点 nextLabel 触发；
  //   onSkip —— 当前页 status=ItemState.Skip 时点 nextLabel 触发；
  //   onNext/onPrevious —— Normal 页点 nextLabel/prevLabel 触发（参数 (index, pendingIndex)）；
  //   onChange —— 切换完成派发 (prevIndex, index)。ItemState = { Normal, Skip, Waiting }。
  //
  // DOM 映射：Stepper = 竖排容器（页区 + 内置导航条 prev/pages/next）；StepperItem 挂进 pages；
  // 汇入 label/status 后接通导航条点击 → 按 .d.ts 原文派发事件（Skip 页点 next → onSkip；
  // 最后一页 Normal 点 next → onFinish；其余 → onNext；prev → onPrevious），完成切换再派发
  // onChange(prev, index)。StepperItem.status → data-status（Skip 语义）。
  // ItemState 枚举值必须按 .d.ts 声明顺序（Normal/Disabled/Waiting/Skip），产物把
  // ItemState.Skip 原样留给运行时求值，值错了 onSkip 永远不触发（同坑 83 的枚举两套来源）
  const ItemState = { Normal: 0, Disabled: 1, Waiting: 2, Skip: 3 };
  const StepperItem = ensureComponent('StepperItem', () => {
    const el = document.createElement('div');
    el.__arkuiStepperItem = true;
    el.dataset.stepperItem = '';
    el.style.display = 'none';          // 挂进 Stepper 的 pages 区（由导航逻辑控制显隐）
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const XC_ITEM_ATTRS = {
    prevLabel: (n, v) => {
      n.dataset.prevLabel = String(resolveResource(v));
      const sp = n.closest('[data-arkui-stepper]');
      if (sp && sp.__arkuiStepperSync) sp.__arkuiStepperSync();
    },
    nextLabel: (n, v) => {
      n.dataset.nextLabel = String(resolveResource(v));
      const sp = n.closest('[data-arkui-stepper]');
      if (sp && sp.__arkuiStepperSync) sp.__arkuiStepperSync();
    },
    status: (n, v) => { n.dataset.status = String(Number(resolveResource(v))); },   // ItemState
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const STEP_ATTRS = {
    onChange: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).change = v; },
    onNext: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).next = v; },
    onPrevious: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).prev = v; },
    onSkip: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).skip = v; },
    onFinish: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).finish = v; },
  };
  const Stepper = ensureComponent('Stepper', () => {
    const el = document.createElement('div');
    el.__arkuiStepper = true;
    el.dataset.stepper = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.__arkuiStepperIndex = 0;
    // 内置导航条（prev/pages/next 三段）；StepperItem 挂进 pages 段，label 汇入导航条
    const prev = document.createElement('div');
    prev.setAttribute('data-arkui-stepper-prev', '');
    prev.style.cursor = 'pointer';
    prev.style.padding = '4px 8px';
    prev.textContent = '‹';
    const pages = document.createElement('div');
    pages.setAttribute('data-arkui-stepper-pages', '');
    pages.style.flex = '1';
    const next = document.createElement('div');
    next.setAttribute('data-arkui-stepper-next', '');
    next.style.cursor = 'pointer';
    next.style.padding = '4px 8px';
    next.textContent = '›';
    el.appendChild(prev);
    el.appendChild(pages);
    el.appendChild(next);
    // 派发（R39 照真机源码 ace_engine stepper_pattern.cpp 的 HandlingRight/LeftButtonClickEvent）：
    // · 右键：当前页 skip → 只发 onSkip，【不切页、不发 onChange】（去向由 app 决定）；
    //   normal 末页 → 只发 onFinish，同样不切页；normal 非末页 → 先 onChange(index, index+1)
    //   【再】onNext(index, index+1)，然后才切页；waiting/disabled/未知 → 点击整体忽略
    // · 左键：先 onChange(index, clamp(index-1)) 再 onPrevious(index, clamp(index-1))，然后切页
    //   （clamp 下界 0：真机在第 0 页点 prev 也会发 change(0,0)+prev(0,0)，此处照抄）
    // · 编程改 index（swiper 桥）只切页，不发 Stepper 事件 —— goTo 是纯切页
    // 回调走 wrapper 闭包引用 __stepCbs（覆盖语义，重渲染重挂安全）；.d.ts 只给了签名，
    // 时序与切页行为以真机源码为准（坑 94）
    // @type 档位：querySelectorAll 返回 NodeListOf<Element>，而 style/dataset 在 HTMLElement 上
    const fireNext = () => {
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      const idx = /** @type {number} */ (el.__arkuiStepperIndex);
      const cur = items[idx];
      const curStatus = cur ? Number(cur.dataset.status || 0) : 0;
      const cbs = el.__stepCbs;
      if (curStatus === ItemState.Skip) {
        if (cbs && typeof cbs.skip === 'function') { try { cbs.skip(); } catch (e) { layoutWarnings.push(`onSkip 抛错：${e && e.message}`); } }
        return;
      }
      if (curStatus !== ItemState.Normal) return;
      if (idx >= items.length - 1) {
        if (cbs && typeof cbs.finish === 'function') { try { cbs.finish(); } catch (e) { layoutWarnings.push(`onFinish 抛错：${e && e.message}`); } }
        return;
      }
      if (cbs && typeof cbs.change === 'function') { try { cbs.change(idx, idx + 1); } catch (e) { layoutWarnings.push(`Stepper.onChange 抛错：${e && e.message}`); } }
      if (cbs && typeof cbs.next === 'function') { try { cbs.next(idx, idx + 1); } catch (e) { layoutWarnings.push(`onNext 抛错：${e && e.message}`); } }
      goTo(idx + 1);
    };
    const firePrev = () => {
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      const idx = /** @type {number} */ (el.__arkuiStepperIndex);
      const p2 = Math.max(0, idx - 1);
      const cbs = el.__stepCbs;
      if (cbs && typeof cbs.change === 'function') { try { cbs.change(idx, p2); } catch (e) { layoutWarnings.push(`Stepper.onChange 抛错：${e && e.message}`); } }
      if (cbs && typeof cbs.prev === 'function') { try { cbs.prev(idx, p2); } catch (e) { layoutWarnings.push(`onPrevious 抛错：${e && e.message}`); } }
      goTo(p2);
    };
    // 纯切页：显隐 + label 汇入 + index 更新，不发任何事件（与真机 swiper 桥一致）
    /** @param {number} i */
    const goTo = (i) => {
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      if (i < 0 || i >= items.length) return;
      items.forEach((m, k) => { m.style.display = k === i ? 'block' : 'none'; });
      el.__arkuiStepperIndex = i;
      // 导航条文案随子项 label 汇入
      prev.textContent = (items[i] && items[i].dataset.prevLabel) || '‹';
      next.textContent = (items[i] && items[i].dataset.nextLabel) || '›';
    };
    el.__arkuiStepperGo = goTo;
    // 初始显隐 + label 汇入：StepperItem 挂在根上（与 prev/pages/next 并列）——汇入时
    // 移进 pages 段（不变量 18：等渲染后同步阶段）
    const syncStepper = () => {
      const strays = el.querySelectorAll(':scope > [data-stepper-item]');
      strays.forEach((m) => pages.appendChild(m));
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      items.forEach((m, k) => { m.style.display = k === /** @type {number} */ (el.__arkuiStepperIndex) ? 'block' : 'none'; });
      if (items.length) goTo(/** @type {number} */ (el.__arkuiStepperIndex));
    };
    setTimeout(syncStepper, 0);
    // 导航条点击 → 派发语义（.d.ts 原文）
    prev.addEventListener('click', () => firePrev());
    next.addEventListener('click', () => fireNext());
    el.__arkuiStepperSync = syncStepper;
    return el;
  });

  // R66/R67 批量分片（batch-*）：组件注册 + 枚举/效果类常量本体在此定义；
  // global 挂载见下方「安装全局」块（分片只声明，不自行挂 global）
  // ────────────────── 批次 E：布局/叠放/内部组件（R67）──────────────────
  //
  // 六组件（权威出处）：
  //   FolderStack   —— component/folder_stack.d.ts（public，since 11）
  //   GridContainer —— component/grid_container.d.ts（deprecated since 9，useinstead GridRow/GridCol）
  //   Section       —— build-tools/ets-loader/components/section.json（内部组件：attrs=[]，无 d.ts）
  //   Sheet         —— build-tools/ets-loader/components/sheet.json（内部组件：children=["Section"]，attrs=[]，无 d.ts）
  //   UnionEffectContainer —— build-tools/ets-loader/components/union_effect_container.json（systemApi:true，attrs=["pointLight"]，无 d.ts）
  //   XComponentNode —— api/arkui/XComponentNode.d.ts（deprecated since 12，useinstead typeNode#XComponent）
  //
  // ⚠️ Section/Sheet/UnionEffectContainer 在本 SDK 里【没有 d.ts 声明】——它们只存在于
  //    ets-loader 的组件表（generated-components.js 的 149 个骨架即来源于此）。字段形态
  //    以那三个 JSON 为唯一权威，DOM 语义按组件名/父子关系做保守近似（全部注明）。

  // FolderStack 回调载荷里的两个枚举（enums.d.ts:4431/4482，显式数值）
  const FoldStatus = { UNKNOWN: 0, EXPANDED: 1, FOLDED: 2, HALF_FOLDED: 3 };
  const AppRotation = { ROTATION_0: 0, ROTATION_90: 1, ROTATION_180: 2, ROTATION_270: 3 };
  // GridContainer 的 SizeType（grid_container.d.ts:28-74，声明顺序 Auto/XS/SM/MD/LG）
  const SizeType = { Auto: 0, XS: 1, SM: 2, MD: 3, LG: 4 };
  // XComponentNode.changeRenderType 的 NodeRenderType（api/arkui/BuilderNode.d.ts:87-107）
  const NodeRenderType = { RENDER_TYPE_DISPLAY: 0, RENDER_TYPE_TEXTURE: 1 };

  // ────────────────── FolderStack（叠放 + 折叠屏悬停）──────────────────
  //
  // 产物形态（FolderStackInterface，folder_stack.d.ts:66-80）：
  //   FolderStack.create({ upperItems: ['a', 'b'] });
  //   FolderStack.alignContent(Alignment.Start); FolderStack.enableAnimation(false);
  //   FolderStack.autoHalfFold(true);
  //   FolderStack.onFolderStateChange((e: {foldStatus}) => …);
  //   FolderStack.onHoverStatusChange((p: HoverEventParam) => …);
  //
  // 语义（folder_stack.d.ts）：Stack 叠放基座 + 折叠屏悬停 —— 悬停态下 upperItems 里
  //   的子组件（按 .id() 匹配）避开折痕区移到上半屏，其余子组件留在下半屏；
  //   alignContent 默认 Alignment.Center；enableAnimation/autoHalfFold 默认 true。
  // DOM：与 Stack 同款 grid 同格叠放（子项 gridArea 1/1，mountNode 只认 __arkuiComp==='Stack'，
  //   所以这里用 MutationObserver 给新挂子项补 gridArea——self-contained，不动共享文件）。
  //   悬停态是 DOM 无触发源的系统能力（真机由折屏硬件驱动）：提供状态袋方法
  //   setFoldStatus(status) / setHoverStatus(param) 编程驱动；悬停时 upperItems 子项
  //   绝对定位到上半屏（top:0 h:50%），其余子项到下半屏（top:50% h:50%）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const FOLDERSTACK_ATTRS = {
    // alignContent 刻意【不在本表】：area.js 的通用分支 `prop === 'alignContent' →
    // applyAlignment` 已按同一语义处理（Stack 同款），表里再放一份是双路径漂移点。
    onFolderStateChange: (n, v) => {
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.cbs.foldStatus = v;
    },
    onHoverStatusChange: (n, v) => {
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.cbs.hoverStatus = v;
    },
    enableAnimation: (n, v) => {
      // DOM 无折屏开合动画管道：只落语义标记（与 Panel.dragBar 同级的"记而未演"）
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.enableAnimation = v !== false;
      n.dataset.enableAnimation = String(v !== false);
    },
    autoHalfFold: (n, v) => {
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.autoHalfFold = v !== false;
      n.dataset.autoHalfFold = String(v !== false);
    },
  };
  /** @param {any} n */
  function applyFolderStackLayout(n) {
    const w = /** @type {any} */ (n).__folderstack;
    if (!w) return;
    for (const k of Array.prototype.slice.call(n.children)) {
      const kid = /** @type {any} */ (k);
      if (!kid || !kid.style) continue;
      if (!w.hoverMode) {
        // 悬停退出：清掉覆盖样式，回到 grid 同格叠放
        kid.style.position = ''; kid.style.top = ''; kid.style.left = '';
        kid.style.width = ''; kid.style.height = '';
        kid.removeAttribute('data-folder-upper'); kid.removeAttribute('data-folder-lower');
        kid.style.gridArea = '1 / 1';
        continue;
      }
      const upper = kid.id !== undefined && w.upperItems.indexOf(String(kid.id)) >= 0;
      kid.style.gridArea = '';                       // 绝对定位脱离网格流
      kid.style.position = 'absolute';
      kid.style.left = '0';
      kid.style.width = '100%';
      kid.style.height = '50%';
      if (upper) { kid.style.top = '0'; kid.setAttribute('data-folder-upper', ''); }
      else { kid.style.top = '50%'; kid.setAttribute('data-folder-lower', ''); }
    }
  }
  /** @param {any[]} args */
  const FolderStack = ensureComponent('FolderStack', (args) => {
    const el = document.createElement('div');
    el.dataset.folderStack = '';
    (/** @type {any} */ (el)).__arkuiFolderStack = true;   // area.js 属性分派的身份守卫（同 GridContainer 等）
    // Stack 同款叠放：grid 同格 + 默认 Alignment.Center（d.ts:147 "Default value: Alignment.Center"）
    el.style.display = 'grid';
    el.style.justifyItems = 'center';
    el.style.alignItems = 'center';
    el.style.position = 'relative';                  // 悬停态子项以它为包含块
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__folderstack = /** @type {any} */ ({
      upperItems: Array.isArray(o.upperItems) ? o.upperItems.map(String) : [],
      foldStatus: 0,
      hoverMode: false,
      enableAnimation: true,                         // d.ts:190 "Default value: true"
      autoHalfFold: true,                            // d.ts:206 "Default value: true"
      cbs: {},
    });
    if (Array.isArray(o.upperItems)) el.dataset.upperItems = JSON.stringify(o.upperItems);
    // 编程驱动（真机由折屏硬件产生，DOM 无触发源 —— 测试/上层用它发事件）
    w.setFoldStatus = (/** @type {any} */ status) => {
      w.foldStatus = status;
      el.dataset.foldStatus = String(status);
      const cb = w.cbs.foldStatus;
      if (typeof cb === 'function') {
        try { cb({ foldStatus: status }); }
        catch (e) { layoutWarnings.push(`FolderStack.onFolderStateChange 回调抛错：${e && e.message}`); }
      }
    };
    w.setHoverStatus = (/** @type {any} */ param) => {
      // param 形状 = HoverEventParam（folder_stack.d.ts:225-262）：
      //   { foldStatus, isHoverMode, appRotation, windowStatusType }
      w.hoverMode = !!(param && param.isHoverMode);
      el.dataset.hoverMode = String(w.hoverMode);
      applyFolderStackLayout(el);
      const cb = w.cbs.hoverStatus;
      if (typeof cb === 'function') {
        try { cb(param); }
        catch (e) { layoutWarnings.push(`FolderStack.onHoverStatusChange 回调抛错：${e && e.message}`); }
      }
    };
    // mountNode 只给 __arkuiComp==='Stack' 的子项补 gridArea（main.js mountNode）；
    // FolderStack 的子项在这里补——观察 childList 即可覆盖 create 后挂进来的全部子项。
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((/** @type {any} */ nd) => {
          if (nd && nd.style && !w.hoverMode) nd.style.gridArea = '1 / 1';
        });
      }
    });
    mo.observe(el, { childList: true });
    return el;
  });

  // ────────────────── GridContainer（deprecated 列网格容器）──────────────────
  //
  // 产物形态（GridContainerInterface，grid_container.d.ts:135-147）：
  //   GridContainer.create({ columns: 4, sizeType: SizeType.SM, gutter: 8, margin: 12 });
  //
  // 语义（grid_container.d.ts，deprecated since 9）：options =
  //   { columns?: number|"auto", sizeType?: SizeType, gutter?: number|string, margin?: number|string }；
  //   GridContainerAttribute extends ColumnAttribute —— 链式属性与 Column 同（无自有 setter）。
  // DOM：display:grid + repeat(N, 1fr)；gutter → column-gap；margin → 左右 padding。
  //   columns:"auto"/缺省：真机按设备宽度档位（SizeType）解析列数，DOM 无设备型号 ——
  //   固定按 12 列渲染并 warnOnce 记差异（不静默）。
  /** @param {any} el @param {any} o */
  function applyGridContainerOptions(el, o) {
    if (o.columns !== undefined && o.columns !== 'auto') {
      const cols = Number(resolveResource(o.columns)) || 12;
      el.dataset.columns = String(cols);
      el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    } else {
      el.dataset.columns = 'auto';
      // DOM 侧固定 12 列的取舍（真机 "auto" 按设备解析）必须留痕：
      warnOnce('GridContainer.columns 为 auto/缺省：真机按设备宽度档位解析列数，DOM 固定按 12 列渲染');
      el.style.gridTemplateColumns = 'repeat(12, 1fr)';
    }
    if (o.sizeType !== undefined) {
      el.dataset.sizeType = String(Number(resolveResource(o.sizeType)));
    }
    if (o.gutter !== undefined) el.style.columnGap = toCssSize(resolveResource(o.gutter));
    if (o.margin !== undefined) {
      const m = toCssSize(resolveResource(o.margin));
      el.style.paddingLeft = m;                      // "Spacing on both sides"（d.ts:117）
      el.style.paddingRight = m;
    }
  }
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDCONTAINER_ATTRS = {
    // 四个 options 键同时接受链式 setter（防编译产物把选项摊平成属性链的形态）
    columns: (n, v) => { applyGridContainerOptions(n, { columns: v }); },
    sizeType: (n, v) => { applyGridContainerOptions(n, { sizeType: v }); },
    gutter: (n, v) => { applyGridContainerOptions(n, { gutter: v }); },
    margin: (n, v) => { applyGridContainerOptions(n, { margin: v }); },
  };
  /** @param {any[]} args */
  const GridContainer = ensureComponent('GridContainer', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiGridContainer = true;
    el.dataset.gridContainer = '';
    el.style.display = 'grid';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    applyGridContainerOptions(el, o);
    return el;
  });

  // ────────────────── Sheet / Section（内部组件对）──────────────────
  //
  // 语义（sheet.json："children": ["Section"]；section.json："attrs": []）：真机 bindSheet
  //   的内部承载结构 —— Sheet 是弹层面板容器，Section 是其中的内容段。本 SDK 无公开 d.ts、
  //   无公开属性；产物里也不会出现用户态的 Sheet.create()（由框架内部建出）。
  // DOM：Sheet → 白底 flex column 面板（弹层定位由上层驱动，这里只做承载）；
  //   Section → flex column 内容段（flex:1 占满面板剩余空间）。
  // 无 SHEET_ATTRS/SECTION_ATTRS：attrs 为空表时 area.js 无需分派分支（通用属性走通用规则）。
  const Sheet = ensureComponent('Sheet', () => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiSheet = true;
    el.dataset.sheet = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.backgroundColor = '#ffffff';
    return el;
  });
  const Section = ensureComponent('Section', () => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiSection = true;
    el.dataset.section = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.flex = '1';
    el.style.minHeight = '0';
    el.style.minWidth = '0';
    return el;
  });

  // ────────────────── UnionEffectContainer（systemApi 联动光效容器）──────────────────
  //
  // 语义（union_effect_container.json，systemApi:true）：唯一属性 pointLight（本 SDK 无该
  //   属性的任何 d.ts 声明 —— 无参数形状可依，按 options 对象/布尔宽容记录）。
  // DOM：普通容器（block + relative）；pointLight 的视觉光效（真机渲染管线特效）在 DOM 无
  //   对应物 —— 参数落 data-* 并记 layoutWarnings（不静默忽略）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const UNIONEFFECT_ATTRS = {
    pointLight: (n, v) => {
      try { n.dataset.pointLight = JSON.stringify(v); }
      catch (e) { n.dataset.pointLight = String(v); }
      warnOnce('UnionEffectContainer.pointLight 视觉光效无 DOM 对应物（渲染管线特效），参数已记 data-point-light');
    },
  };
  /** @param {any[]} args */
  const UnionEffectContainer = ensureComponent('UnionEffectContainer', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiUnionEffect = true;
    el.dataset.unionEffectContainer = '';
    el.style.display = 'block';
    el.style.position = 'relative';
    return el;
  });

  // ────────────────── XComponentNode（自定义节点宿主）──────────────────
  //
  // 这个名字在 SDK 里有【两副面孔】，两副都实现、共用同一个导出名：
  // ① 声明式组件（ets-loader components/xcomponentNode.json，attrs 共 7 个）——
  //    ensureComponent 注册（进 components 表 → generated-components.js 的同名骨架被
  //    "手写优先"跳过），工厂产出宿主 div。
  // ② 类（api/arkui/XComponentNode.d.ts:32-81，extends FrameNode，deprecated since 12）——
  //    constructor(uiContext, options, id, type, libraryName?)；
  //    onCreate(event?)/onDestroy() 是子类覆写的生命周期；changeRenderType(type): boolean。
  //    DOM 无 FrameNode 基类：实例自带状态袋 __xcn，宿主 DOM 由 __arkuiBindHost 绑定。
  //    按 id 注册进 xcNodeRegistry —— 声明式面的宿主 div 建出时按 id 认领实例并在
  //    surface 就绪刻度（setTimeout(0)，与 canvas.js XComponent.onLoad 同款）触发 onCreate。
  // changeRenderType 只认 NodeRenderType（BuilderNode.d.ts:87-107 DISPLAY=0/TEXTURE=1），
  //   非法值返回 false 并记警告；合法值落 dataset.renderType。
  /** @type {Map<string, any>} */
  const xcNodeRegistry = new Map();
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const XCNODE_ATTRS = {
    type: (n, v) => { n.dataset.xcnType = String(resolveResource(v)); },
    libraryName: (n, v) => { n.dataset.xcnLibrary = String(resolveResource(v)); },
    onCreate: (n, v) => {
      n.__arkuiXcnOnCreate = v;
      if (n.__arkuiXcnScheduled) return;             // 覆盖语义：cb 替换、调度只排一次
      n.__arkuiXcnScheduled = true;
      setTimeout(() => {
        if (typeof n.__arkuiXcnOnCreate === 'function') {
          try { n.__arkuiXcnOnCreate({ surfaceId: 'XComponent-' + (n.dataset.xcnId || '') }); }
          catch (e) { layoutWarnings.push(`XComponentNode.onCreate 抛错：${e && e.message}`); }
        }
      }, 0);
    },
    onDestroy: (n, v) => {
      n.__arkuiXcnOnDestroy = v;                     // DOM 销毁时机无卸载钩子，只登记
    },
    changeRenderType: (n, v) => {
      const t = Number(resolveResource(v));
      if (t !== 0 && t !== 1) {
        layoutWarnings.push(`XComponentNode.changeRenderType(${String(v)}): 非法 NodeRenderType，已忽略`);
        return;
      }
      n.dataset.renderType = String(t);
    },
  };
  /** @param {any[]} args */
  const XComponentNodeComp = ensureComponent('XComponentNode', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiXComponentNodeFlag = true;
    el.dataset.xcomponentNode = '';
    el.style.position = 'relative';
    const id = o.id === undefined ? '' : String(o.id);
    if (id) el.dataset.xcnId = id;
    if (o.type !== undefined) el.dataset.xcnType = String(o.type);
    if (o.libraryName !== undefined) el.dataset.xcnLibrary = String(o.libraryName);
    // 宿主建出 → 认领同类面实例，按 surface 就绪刻度触发 onCreate（真机时序的 DOM 近似）
    const inst = id !== '' ? xcNodeRegistry.get(id) : null;
    if (inst) {
      setTimeout(() => {
        try {
          /** @type {any} */ (inst).__arkuiBindHost(el);
          /** @type {any} */ (inst).onCreate({ surfaceId: 'XComponent-' + id });
        } catch (e) { layoutWarnings.push(`XComponentNode.onCreate 抛错：${e && e.message}`); }
      }, 0);
    }
    return el;
  });
  class XComponentNodeHost {
    /** @param {any} uiContext @param {any} options @param {any} id @param {any} type @param {any=} [libraryName] */
    constructor(uiContext, options, id, type, libraryName) {
      const self = /** @type {any} */ (this);
      self.__xcn = /** @type {any} */ ({
        uiContext: uiContext || null,                // DOM 运行时不使用 UIContext，仅存档
        options: options || null,
        id: String(id === undefined ? '' : id),
        type: type,
        libraryName: libraryName === undefined ? '' : String(libraryName),
        renderType: 0,                               // NodeRenderType.RENDER_TYPE_DISPLAY
        hostEl: null,
        created: false,
        destroyed: false,
      });
      if (self.__xcn.id) xcNodeRegistry.set(self.__xcn.id, self);
    }
    /** @param {any=} [event] */
    onCreate(event) {
      const w = /** @type {any} */ (this).__xcn;
      if (w) { w.created = true; w.lastCreateEvent = event || null; }
    }
    onDestroy() {
      const w = /** @type {any} */ (this).__xcn;
      if (w) w.destroyed = true;
    }
    /** @param {any} type */
    changeRenderType(type) {
      const w = /** @type {any} */ (this).__xcn;
      const ok = type === 0 || type === 1;
      if (!w) return ok;
      if (!ok) {
        layoutWarnings.push(`XComponentNode.changeRenderType(${String(type)}): 非法 NodeRenderType，返回 false`);
        return false;
      }
      w.renderType = type;
      if (w.hostEl) w.hostEl.dataset.renderType = String(type);
      return true;
    }
    /** @param {HTMLElement} el */
    __arkuiBindHost(el) {
      const w = /** @type {any} */ (this).__xcn;
      if (w) w.hostEl = el;
    }
  }
  // 类面作导出名；create/pop 从声明式面的 ensureComponent 实例借来（同一闭包，行为一致）
  const XComponentNode = /** @type {any} */ (XComponentNodeHost);
  XComponentNode.create = XComponentNodeComp.create;
  XComponentNode.pop = XComponentNodeComp.pop;

  // ────────────────── 批量输入收官（R66）：CheckboxGroup / ColorPicker / ColorPickerDialog
  //  / Option / PatternLock / SelectionContainer ──────────────────
  //
  // 语义锚点（SDK 实测路径）：
  //   • checkboxgroup.d.ts（全文已读）：CheckboxGroup(options?: {group?: string})；
  //     selectAll(boolean)、selectedColor、unselectedColor、mark(MarkStyle)、
  //     onChange(CheckboxGroupResult { name: string[], status: SelectStatus })、
  //     checkboxShape(CheckBoxShape)、contentModifier(21+)。
  //     SelectStatus 按声明顺序：All=0 / Part=1 / None=2（enums 声明不带初值）。
  //   • pattern_lock.d.ts（全文已读）：PatternLock(controller?)；sideLength/circleRadius/
  //     backgroundColor/regularColor/selectedColor/activeColor/pathColor/pathStrokeWidth/
  //     onPatternComplete(Array<number>)/autoReset/onDotConnect(number)/
  //     activateCircleStyle({color,radius,enableWaveEffect,enableForeground})/
  //     skipUnselectedPoint（⚠️ d.ts 有、ets-loader pattern_lock.json 无）。
  //     PatternLockController: reset() / setChallengeResult(PatternLockChallengeResult
  //     {CORRECT=1, WRONG=2}，d.ts 显式赋值）。onPatternComplete 的点位编号 d.ts 未写死，
  //     本实现取官方文档惯例 1~9（行优先）；取舍记录在此，测试按 1 基断言。
  //   • api/@ohos.arkui.components.SelectionContainer.d.ts（全文已读）：
  //     SelectionContainer({controller})；copyOption/caretColor/selectedBackgroundColor/
  //     enableHapticFeedback/textJoinStyle(NEWLINE=0/DIRECT=1)/bindSelectionMenu/
  //     editMenuOptions/onTextSelectionChange(Callback<Array<string>>)/
  //     onWillCopy((content)=>boolean)/onCopy((content)=>void)。
  //     SelectionContainerController: closeSelectionMenu() / clearTextSelection()。
  //   • ⚠️ ColorPicker / ColorPickerDialog / Option：本 SDK 安装里【没有 d.ts】
  //     （component/、api/、ets-loader/declarations/ 三处 grep 均无）。
  //     唯一权威是 ets-loader 组件表（本机实测路径 build-tools/ets-loader/components/）：
  //       colorPicker.json        attrs: colors, onSelect, setAlignment, setColunms, setRows
  //                               （"setColunms" 是 SDK 原始拼写——setColumns 的笔误，原样保留）
  //       colorPickerDialog.json  attrs: show
  //       option.json             parents: [Menu]；attrs: fontColor, fontSize, fontWeight, fontFamily
  //     三者的 create 签名/回调参数形状官方未在本机 SDK 出面，本实现按 attrs 表 +
  //     ArkUI 同族语义外推，凡外推处都有注释标记；colors/onSelect 用于 ColorPickerDialog
  //     属外推超集（JSON 只列 show），取舍在此记录。
  //
  // DOM 映射：
  //   CheckboxGroup → 原生 <input type=checkbox>（全选母 Checkbox，Part 态走 indeterminate）；
  //     组员同步：优先找带 data-arkui-checkbox-group="<组名>" 标记的原生 checkbox（标记
  //     约定见 docs；input.js 的 Checkbox 目前不落 group，补一行 dataset 即生效）；
  //     无标记时退化为"页面上全部真 Checkbox"（排除 Toggle：input.js 给 Toggle 落
  //     data-toggle-type，Checkbox 没有——可据此区分）；多组并存时退化路径会串组，
  //     每个母 Checkbox 只报一次 layoutWarning，不静默。
  //   PatternLock → div（CSS grid 3×3 点位）+ SVG 连线层；pointer 手势驱动。
  //   SelectionContainer → div（user-select:text）；selectionchange/copy 事件派发回调。
  //   Option → Menu（popup.js 的 flex 列 div）里的行式菜单项（同族 MenuItem 形态）。
  //   ColorPicker → CSS grid 色块阵；ColorPickerDialog → fixed 遮罩 + 居中卡片。
  //
  // 事件派发纪律（坑 86 同族）：onSelect/onPatternComplete/onDotConnect/
  // onTextSelectionChange/onCopy/onWillCopy 全是函数值——必须抢在通用 on* 规则之前登记，
  // 否则会变成永不触发的 DOM 事件监听。统一走 __arkuiBatchIn 标记 + BATCHINPUT_ATTRS
  // 单分派分支（需要的 area.js 接线见分片报告）。
  const SelectStatus = { All: 0, Part: 1, None: 2 };              // checkboxgroup.d.ts 声明顺序
  const CopyOptions = { None: 0, InApp: 1, LocalDevice: 2 };      // enums.d.ts:3229（None=0/InApp=1/LocalDevice=2）
  const CheckBoxShape = { CIRCLE: 0, ROUNDED_SQUARE: 1 };         // enums.d.ts:29（显式赋值）
  const PatternLockChallengeResult = { CORRECT: 1, WRONG: 2 };    // pattern_lock.d.ts 显式赋值
  const SelectionContainerTextJoinStyle = { NEWLINE: 0, DIRECT: 1 }; // SelectionContainer.d.ts 显式赋值

  // ── CheckboxGroup：组员发现与全选同步 ──
  // 组员标记约定：原生 checkbox 带 data-arkui-checkbox-group="<组名>" 即属于该组。
  // input.js 的 Checkbox.create({name, group}) 目前丢弃 group（input.js:39-41 只落 name），
  // 补一行 `el.dataset.arkuiCheckboxGroup = String(o.group)` 即可让本发现路径精确命中。
  /** @type {Set<any>} */
  const cgMasters = new Set();                                    // 页面上所有 CheckboxGroup 母节点
  /** @param {any} master @returns {any[]} */
  const cgMembers = (master) => {
    const g = master.__cg.group;
    // ① 精确路径：带组标记的原生 checkbox（不含母节点自身、不含 Toggle）
    const marked = Array.from((master.ownerDocument || document)
      .querySelectorAll('input[type=checkbox][data-arkui-checkbox-group]'))
      .filter((/** @type {any} */ m) => m !== master && m.dataset.arkuiCheckboxGroup === g);
    if (marked.length) return marked;
    // ② 退化路径：整页所有"真 Checkbox"（Toggle 有 data-toggle-type，Checkbox 没有）
    const all = Array.from((master.ownerDocument || document)
      .querySelectorAll('input[type=checkbox]:not([data-toggle-type])'))
      .filter((/** @type {any} */ m) => m !== master && !m.__cgClaimed);
    if (cgMasters.size > 1) {
      // 多组并存时退化路径会串组（组员无法按组名区分）——只报一次，不静默
      if (!master.__cg.warnedFallback) {
        master.__cg.warnedFallback = true;
        layoutWarnings.push(`CheckboxGroup('${g}') 组员发现退化为全页 Checkbox`
          + '（无 data-arkui-checkbox-group 标记）；多组并存会串组，请给 Checkbox 落组标记');
      }
    }
    all.forEach((/** @type {any} */ m) => { m.__cgClaimed = master; });   // 先到先得，减少串组面
    return all;
  };
  /** @param {any[]} members @returns {number} SelectStatus（All/Part/None） */
  const cgStatusOf = (members) => {
    if (!members.length) return -1;                                 // 无组员：由母节点自态决定
    const on = members.filter((/** @type {any} */ m) => m.checked).length;
    if (on === members.length) return SelectStatus.All;
    return on === 0 ? SelectStatus.None : SelectStatus.Part;
  };
  /** @param {any} master @param {boolean=} [fire] */
  const cgSyncAndFire = (master, fire) => {
    const w = master.__cg;
    const members = cgMembers(master);
    members.forEach((/** @type {any} */ m) => { m.checked = w.all; });     // 编程同步不派发 change（DOM 语义，input.js 同取舍）
    const st = cgStatusOf(members);
    const status = st === -1 ? (w.all ? SelectStatus.All : SelectStatus.None) : st;
    master.indeterminate = status === SelectStatus.Part;
    master.dataset.status = String(status);
    if (fire !== false && typeof w.cbs.change === 'function') {
      const names = members.filter((/** @type {any} */ m) => m.checked)
        .map((/** @type {any} */ m) => String(m.name || ''));
      try { w.cbs.change({ name: names, status }); }
      catch (e) { layoutWarnings.push(`CheckboxGroup.onChange 派发抛错：${e && e.message}`); }
    }
  };
  // 组员自态变化 → 组状态变化也要发 CheckboxGroup.onChange（d.ts："Triggered when the
  // selected status of the check box group or any check box wherein changes"）。
  // 单个捕获监听统一收口；未认领的组员且页面恰有一个组 → 自动认领（单组演示页成立）。
  document.addEventListener('change', (/** @type {Event} */ e) => {
    const t = /** @type {any} */ (e.target);
    // Toggle 不参与；母节点自身的 change 由工厂 click 处理器收口（这里只收组员）
    if (!t || t.type !== 'checkbox' || t.dataset.toggleType || t.__cg) return;
    let master = t.__cgClaimed;
    if (!master && t.dataset.arkuiCheckboxGroup) {
      master = Array.from(cgMasters).find((/** @type {any} */ m) => m.__cg.group === t.dataset.arkuiCheckboxGroup) || null;
      if (master) t.__cgClaimed = master;
    }
    if (!master && cgMasters.size === 1) {
      master = Array.from(cgMasters)[0];
      t.__cgClaimed = master;
    }
    if (!master) return;
    const members = cgMembers(master);
    const st = cgStatusOf(members);
    const status = st === -1 ? (master.checked ? SelectStatus.All : SelectStatus.None) : st;
    master.indeterminate = status === SelectStatus.Part;
    master.__cg.all = status === SelectStatus.All;
    master.checked = status === SelectStatus.All;
    master.dataset.status = String(status);
    if (typeof master.__cg.cbs.change === 'function') {
      const names = members.filter((/** @type {any} */ m) => m.checked).map((/** @type {any} */ m) => String(m.name || ''));
      try { master.__cg.cbs.change({ name: names, status }); }
      catch (err) { layoutWarnings.push(`CheckboxGroup.onChange(组员) 派发抛错：${err && err.message}`); }
    }
  }, true);

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const BATCHINPUT_ATTRS = {
    // ── CheckboxGroup ──
    selectAll: (n, v) => {
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      n.__cg.all = !!v;
      n.checked = !!v;
      cgSyncAndFire(n);                                             // selectAll 走完整"同步+派发"路径
    },
    // selectedColor 双组件同名属性合并为一个条目（同一对象字面量禁止同名键，TS1117）：
    // 按 __arkuiComp 身份分身守卫 —— CheckboxGroup 走 accentColor，PatternLock 走状态袋
    selectedColor: (n, v) => {
      if (n.__arkuiComp === 'CheckboxGroup') { n.style.accentColor = colorOf(v); return; }
      if (n.__arkuiComp === 'PatternLock') {
        const w = n.__patternLock; if (!w) return;
        w.selectedColor = colorOf(v);
        n.dataset.selectedColor = w.selectedColor;
      }
    },
    unselectedColor: (n, v) => { if (n.__arkuiComp === 'CheckboxGroup') n.dataset.unselectedColor = colorOf(v); },
    mark: (n, v) => { if (n.__arkuiComp === 'CheckboxGroup') n.dataset.mark = JSON.stringify(v); },
    checkboxShape: (n, v) => {
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      const s = Number(resolveResource(v));                         // CheckBoxShape：CIRCLE=0 / ROUNDED_SQUARE=1
      n.dataset.checkboxShape = String(s);
      n.style.borderRadius = s === 0 ? '50%' : '';
    },
    contentModifier: (n, v) => {
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      n.dataset.contentModifier = 'recorded';
      layoutWarnings.push('CheckboxGroup.contentModifier 记 data-*（自定义内容区本实现未渲染）');
    },
    onChange: (n, v) => {
      // 六件里只有 CheckboxGroup 的 onChange 是语义回调；其余组件没有该属性，
      // 走不到这条（分派按 __arkuiBatchIn 身份 + 表名双保险）
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      n.__cg.cbs.change = v;
    },
    // ── ColorPicker（ets-loader colorPicker.json attrs）──
    colors: (n, v) => {
      const w = n.__batchPicker; if (!w) return;
      w.colors = Array.isArray(v) ? v : [];
      if (w.kind === 'grid') w.rebuild();
      else if (w.kind === 'dialog') w.rebuildDialog();
    },
    onSelect: (n, v) => {
      const w = n.__batchPicker; if (!w) return;
      w.cbs.select = v;
    },
    setColunms: (n, v) => {                                         // SDK 原始拼写（setColumns 笔误），原样接
      const w = n.__batchPicker; if (!w) return;
      w.cols = Number(resolveResource(v)) || 0;
      if (w.kind === 'grid') w.el.style.gridTemplateColumns = w.cols > 0 ? `repeat(${w.cols}, 1fr)` : '';
      else n.dataset.cols = String(w.cols);
    },
    setRows: (n, v) => {
      const w = n.__batchPicker; if (!w) return;
      w.rows = Number(resolveResource(v)) || 0;
      if (w.kind === 'grid') w.el.style.gridTemplateRows = w.rows > 0 ? `repeat(${w.rows}, 1fr)` : '';
      else n.dataset.rows = String(w.rows);
    },
    setAlignment: (n, v) => {
      // 无 d.ts，取值形状官方未出面：字符串按 CSS 对齐关键字透传，其余记 data-*
      const w = n.__batchPicker; if (!w) return;
      w.alignment = v;
      n.dataset.alignment = String(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
      if (typeof v === 'string') { n.style.justifyItems = v; n.style.alignItems = v; }
    },
    // ── ColorPickerDialog（ets-loader colorPickerDialog.json attrs：show；colors/onSelect 为外推超集）──
    show: (n, v) => {
      const w = n.__batchPicker; if (!w || w.kind !== 'dialog') return;
      const on = v === true || v === 'true';
      n.style.display = on ? '' : 'none';                           // 显隐整个遮罩（卡片随遮罩）
      n.dataset.show = String(on);
    },
    // ── PatternLock（pattern_lock.d.ts）──
    sideLength: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') { n.dataset.sideLength = String(resolveResource(v)); return; }
      const s = toCssSize(v);
      n.style.width = s; n.style.height = s;
      n.dataset.sideLength = s;
      if (n.__patternLock) n.__patternLock.layout();
    },
    circleRadius: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') { n.dataset.circleRadius = String(resolveResource(v)); return; }
      const w = n.__patternLock; if (!w) return;
      w.radius = Number(resolveResource(v)) || 14;
      n.dataset.circleRadius = String(w.radius);
      w.layout();
    },
    regularColor: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      n.dataset.regularColor = colorOf(v);
      n.querySelectorAll('[data-pl-dot]').forEach((/** @type {any} */ d) => { d.style.borderColor = colorOf(v); });
    },
    // selectedColor 已并入上方 CheckboxGroup 段的合并条目（同名键 TS1117，按 __arkuiComp 分身守卫）
    activeColor: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.activeColor = colorOf(v);
      n.dataset.activeColor = w.activeColor;
    },
    pathColor: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.pathColor = colorOf(v);
      n.dataset.pathColor = w.pathColor;
      const line = n.querySelector('[data-pl-line]');
      if (line) line.setAttribute('stroke', w.pathColor);
    },
    pathStrokeWidth: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.strokeWidth = Number(resolveResource(v)) || 6;
      n.dataset.pathStrokeWidth = String(w.strokeWidth);
      const line = n.querySelector('[data-pl-line]');
      if (line) line.setAttribute('stroke-width', String(w.strokeWidth));
    },
    autoReset: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.autoReset = v !== false;                                    // .d.ts 默认 true
      n.dataset.autoReset = String(w.autoReset);
    },
    skipUnselectedPoint: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.skipUnselected = !!v;                                       // d.ts 有、ets-loader 表无——按 d.ts 补面
      n.dataset.skipUnselectedPoint = String(w.skipUnselected);
    },
    activateCircleStyle: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      const o = (v && typeof v === 'object') ? v : {};
      w.actColor = o.color !== undefined ? colorOf(o.color) : w.actColor;
      if (o.radius !== undefined) w.actRadius = Number(resolveResource(o.radius)) || w.actRadius;
      w.actWave = !!o.enableWaveEffect;
      w.actForeground = !!o.enableForeground;
      n.dataset.activateCircleStyle = JSON.stringify(o);
      w.layout();
    },
    onPatternComplete: (n, v) => {
      const w = n.__patternLock; if (!w) return;
      w.cbs.complete = v;
    },
    onDotConnect: (n, v) => {
      const w = n.__patternLock; if (!w) return;
      w.cbs.dotConnect = v;
    },
    // ── SelectionContainer（@ohos.arkui.components.SelectionContainer.d.ts）──
    copyOption: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.copyOption = Number(resolveResource(v));
      n.dataset.copyOption = String(w.copyOption);
    },
    caretColor: (n, v) => {
      if (!n.__selContainer) return;
      n.dataset.caretColor = colorOf(v);                            // 光标色只在可编辑区可见，DOM 选择容器记 data-*
    },
    selectedBackgroundColor: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.selBg = colorOf(v);
      n.dataset.selectedBackgroundColor = w.selBg;
      if (!w.styleEl) {                                             // ::selection 只能走样式表（每实例一条规则）
        w.styleEl = document.createElement('style');
        document.head.appendChild(w.styleEl);
      }
      w.styleEl.textContent = `[data-arkui-selc="${w.seq}"]::selection{background:${w.selBg}}`
        + `[data-arkui-selc="${w.seq}"]::-moz-selection{background:${w.selBg}}`;
    },
    enableHapticFeedback: (n, v) => {
      if (!n.__selContainer) return;
      n.dataset.enableHapticFeedback = String(!!v);                 // DOM 无触感反馈，只记录
    },
    textJoinStyle: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.joinStyle = Number(resolveResource(v));                     // NEWLINE=0 / DIRECT=1
      n.dataset.textJoinStyle = String(w.joinStyle);
    },
    bindSelectionMenu: (n, v) => {
      if (!n.__selContainer) return;
      n.dataset.bindSelectionMenu = 'recorded';
      layoutWarnings.push('SelectionContainer.bindSelectionMenu 记 data-*（选择菜单本实现不渲染）');
    },
    editMenuOptions: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.editMenu = v;
      n.dataset.editMenuOptions = 'recorded';
    },
    onTextSelectionChange: (n, v) => {
      const w = n.__selContainer; if (!w) return;
      w.cbs.selectionChange = v;
    },
    onWillCopy: (n, v) => {
      const w = n.__selContainer; if (!w) return;
      w.cbs.willCopy = v;
    },
    onCopy: (n, v) => {
      const w = n.__selContainer; if (!w) return;
      w.cbs.copy = v;
    },
  };

  // ── CheckboxGroup（checkboxgroup.d.ts）──
  /** @param {any[]} args */
  const CheckboxGroup = ensureComponent('CheckboxGroup', (args) => {
    const el = document.createElement('input');
    el.style.display = 'inline-block';
    (/** @type {any} */ (el)).type = 'checkbox';
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__cg = /** @type {any} */ ({
      group: o.group !== undefined && o.group !== null ? String(resolveResource(o.group)) : '',
      all: false,
      cbs: {},
      warnedFallback: false,
    });
    el.dataset.checkboxGroup = w.group;
    cgMasters.add(el);
    // 点击母 Checkbox：全选 ↔ 全不选翻转，同步组员并派发 onChange
    el.addEventListener('click', () => {
      w.all = el.checked;
      cgSyncAndFire(el);
    });
    return el;
  });

  // ── PatternLock（pattern_lock.d.ts）──
  // 控制器：产物里是 `new PatternLockController()` 自由变量引用，须挂 global。
  // 绑定走 __el 弱关联（create(args) 的 args[0] 就是控制器本身）。
  class PatternLockController {
    constructor() { this.__el = /** @type {any} */ (null); }
    reset() {
      if (this.__el && this.__el.__patternLock) this.__el.__patternLock.reset();
      else layoutWarnings.push('PatternLockController.reset: 尚未绑定到任何 PatternLock');
    }
    /** @param {number} result */
    setChallengeResult(result) {
      if (!this.__el || !this.__el.__patternLock) {
        layoutWarnings.push('PatternLockController.setChallengeResult: 尚未绑定到任何 PatternLock');
        return;
      }
      const w = this.__el.__patternLock;
      w.challenge = Number(result);                                 // CORRECT=1 / WRONG=2（d.ts 显式赋值）
      this.__el.dataset.challengeResult = String(w.challenge);
      this.__el.classList.remove('pl-wrong', 'pl-correct');
      this.__el.classList.add(w.challenge === PatternLockChallengeResult.WRONG ? 'pl-wrong' : 'pl-correct');
    }
  }
  /** @param {number} a @param {number} b 相邻判（skipUnselectedPoint 用）：相邻点才可直连 */
  const isAdjacent = (a, b) => {
    const ra = Math.floor((a - 1) / 3), ca = (a - 1) % 3;
    const rb = Math.floor((b - 1) / 3), cb = (b - 1) % 3;
    return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
  };
  /** @param {any[]} args */
  const PatternLock = ensureComponent('PatternLock', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    Object.assign(el.style, {
      position: 'relative', touchAction: 'none', boxSizing: 'border-box',
      width: '300px', height: '300px',                             // .d.ts 默认 sideLength 300vp
    });
    // SVG 连线层（viewBox 随 sideLength 重算，点位坐标即像素）
    const svg = svgEl('svg', { 'data-pl-svg': '', width: '100%', height: '100%' });
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.pointerEvents = 'none';
    const line = svgEl('polyline', {
      'data-pl-line': '', fill: 'none', stroke: '#007dff', 'stroke-width': '6',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', visibility: 'hidden',
    });
    svg.appendChild(line);
    el.appendChild(svg);
    // 9 个点位（行优先 1..9），网格坐标由 layout() 摆放
    /** @type {any[]} */
    const dots = [];
    for (let i = 1; i <= 9; i++) {
      const d = document.createElement('div');
      d.setAttribute('data-pl-dot', String(i));
      Object.assign(d.style, {
        position: 'absolute', boxSizing: 'border-box', borderRadius: '50%',
        border: '2px solid #b3b7bb', background: 'transparent',
      });
      el.appendChild(d);
      dots.push(d);
    }
    const w = /** @type {any} */ (el).__patternLock = /** @type {any} */ ({
      seq: [],
      drawing: false,
      radius: 14, strokeWidth: 6,
      side: 300,                                                    // .d.ts 默认 sideLength 300vp
      autoReset: true,
      skipUnselected: false,
      regularColor: '#b3b7bb', selectedColor: '#007dff', activeColor: '#007dff',
      pathColor: '#007dff', actColor: '', actRadius: 0, actWave: false, actForeground: false,
      challenge: 0,
      cbs: {},
      dots,
    });
    // 摆放：3×3 网格中心坐标 = (col+0.5)/3 × side；点直径 = 2×circleRadius
    w.layout = () => {
      const side = el.clientWidth || w.side;
      for (let i = 0; i < 9; i++) {
        const d = /** @type {any} */ (dots[i]);
        const cx = (((i % 3) + 0.5) / 3) * side;
        const cy = ((Math.floor(i / 3) + 0.5) / 3) * side;
        const rr = w.radius;
        d.style.left = (cx - rr) + 'px';
        d.style.top = (cy - rr) + 'px';
        d.style.width = (rr * 2) + 'px';
        d.style.height = (rr * 2) + 'px';
      }
      svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
    };
    // 选中/激活态上色
    /** @param {number} i @param {string} color */
    const paintDot = (i, color) => {
      const d = /** @type {any} */ (dots[i - 1]);
      d.style.borderColor = color;
      if (w.actColor && color === w.selectedColor) {
        d.style.background = w.actColor;                            // activateCircleStyle.color 外环填充近似
        d.style.boxShadow = (w.actRadius > w.radius)
          ? `0 0 0 ${(w.actRadius - w.radius).toFixed(2)}px ${w.actColor}33` : '';
      }
    };
    /** @param {number} i */
    const connectDot = (i) => {
      if (w.seq.includes(i)) return;
      w.seq.push(i);
      paintDot(i, w.selectedColor);
      el.dataset.lastDot = String(i);
      el.dataset.sequence = w.seq.join('-');
      if (typeof w.cbs.dotConnect === 'function') {
        try { w.cbs.dotConnect(i); }
        catch (e) { layoutWarnings.push(`PatternLock.onDotConnect 派发抛错：${e && e.message}`); }
      }
    };
    /** @param {number[]} seq */
    const drawPath = (seq) => {
      const side = el.clientWidth || w.side;
      const pts = seq.map((/** @type {number} */ i) => {
        const k = i - 1;
        return `${(((k % 3) + 0.5) / 3) * side},${((Math.floor(k / 3) + 0.5) / 3) * side}`;
      }).join(' ');
      line.setAttribute('points', pts);
      line.setAttribute('stroke', w.pathColor);
      line.setAttribute('stroke-width', String(w.strokeWidth));
      line.setAttribute('visibility', seq.length ? 'visible' : 'hidden');
    };
    w.reset = () => {
      w.seq = [];
      w.drawing = false;
      el.dataset.sequence = '';
      dots.forEach((/** @type {any} */ d) => {
        d.style.borderColor = w.regularColor;
        d.style.background = 'transparent';
        d.style.boxShadow = '';
      });
      line.setAttribute('visibility', 'hidden');
    };
    /** @param {PointerEvent} e */
    const hitDot = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const d = /** @type {any} */ (t && (t.closest ? t.closest('[data-pl-dot]') : null));
      return d ? Number(d.getAttribute('data-pl-dot')) : 0;
    };
    el.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
      w.reset();
      w.drawing = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 无捕获时退化为 elementFromPoint 命中 */ }
      const i = hitDot(e);
      if (i) connectDot(i);
      drawPath(w.seq);
    });
    el.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
      if (!w.drawing) return;
      const i = hitDot(e);
      if (!i) return;
      if (w.seq.includes(i)) return;
      // skipUnselectedPoint(true)：跨过的未选中点不自动入串（d.ts 属性语义）
      if (w.skipUnselected && w.seq.length && !isAdjacent(w.seq[w.seq.length - 1], i)) return;
      connectDot(i);
      drawPath(w.seq);
    });
    el.addEventListener('pointerup', () => {
      if (!w.drawing) return;
      w.drawing = false;
      const out = w.seq.slice();
      if (typeof w.cbs.complete === 'function') {
        try { w.cbs.complete(out); }
        catch (e) { layoutWarnings.push(`PatternLock.onPatternComplete 派发抛错：${e && e.message}`); }
      }
      el.dataset.completed = out.join('-');
      if (w.autoReset) setTimeout(() => { w.reset(); }, 300);       // autoReset（默认 true）：完成即重置
    });
    // 初始摆放：等一次布局（clientWidth 才可信），与 Stepper 的 setTimeout(syncStepper,0) 同理
    setTimeout(() => { w.layout(); w.reset(); }, 0);
    // create(args)：args[0] 就是 controller 本体（PatternLockInterface 单参）
    const c = args && args[0];
    if (c && typeof c.reset === 'function' && 'setChallengeResult' in c) c.__el = el;
    return el;
  });

  // ── SelectionContainer（@ohos.arkui.components.SelectionContainer.d.ts）──
  class SelectionContainerController {
    constructor() { this.__el = /** @type {any} */ (null); }
    closeSelectionMenu() {
      if (!this.__el || !this.__el.__selContainer) {
        layoutWarnings.push('SelectionContainerController.closeSelectionMenu: 尚未绑定');
        return;
      }
      this.__el.__selContainer.menuOpen = false;
      this.__el.dataset.selectionMenu = 'closed';
    }
    clearTextSelection() {
      const w = this.__el && this.__el.__selContainer;
      if (!w) { layoutWarnings.push('SelectionContainerController.clearTextSelection: 尚未绑定'); return; }
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      w.lastTexts = [];
      if (typeof w.cbs.selectionChange === 'function') {
        try { w.cbs.selectionChange([]); }
        catch (e) { layoutWarnings.push(`SelectionContainer.onTextSelectionChange 派发抛错：${e && e.message}`); }
      }
    }
  }
  /** @type {number} */ let selcSeq = 0;
  /** @param {any[]} args */
  const SelectionContainer = ensureComponent('SelectionContainer', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    Object.assign(el.style, { userSelect: 'text', WebkitUserSelect: 'text' });
    const my = ++selcSeq;
    el.setAttribute('data-arkui-selc', String(my));
    const w = /** @type {any} */ (el).__selContainer = /** @type {any} */ ({
      seq: my,
      copyOption: CopyOptions.InApp,                                // Text 族同款缺省（copyOption 缺省 InApp）
      joinStyle: SelectionContainerTextJoinStyle.NEWLINE,
      selBg: '', styleEl: null, editMenu: null,
      menuOpen: false,
      lastTexts: [],
      cbs: {},
    });
    // create({controller})：SelectionContainerOptions.controller 必填（d.ts）
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.controller && typeof o.controller === 'object') o.controller.__el = el;
    // 选区文本收集：range 与容器求交，逐 range 取克隆文本（数组形态对齐 d.ts Callback<Array<string>>）
    /** @returns {string[]} */
    const collect = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return [];
      /** @type {string[]} */
      const out = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i);
        if (!el.contains(r.commonAncestorContainer)) continue;
        const frag = r.cloneContents();
        const holder = document.createElement('div');
        holder.appendChild(frag);
        const text = (holder.textContent || '').trim();
        if (text) out.push(text);
      }
      return out;
    };
    let selTimer = 0;
    const onSelChange = () => {
      if (selTimer) return;
      selTimer = setTimeout(() => {
        selTimer = 0;
        const texts = collect();
        if (texts.length === 0 && w.lastTexts.length === 0) return;   // 空选区只发一次（离开选择不发重复空）
        w.lastTexts = texts;
        if (typeof w.cbs.selectionChange === 'function') {
          try { w.cbs.selectionChange(texts); }
          catch (e) { layoutWarnings.push(`SelectionContainer.onTextSelectionChange 派发抛错：${e && e.message}`); }
        }
      }, 0);
    };
    document.addEventListener('selectionchange', onSelChange);
    el.addEventListener('copy', (/** @type {ClipboardEvent} */ e) => {
      const texts = collect();
      const content = texts.join(w.joinStyle === SelectionContainerTextJoinStyle.NEWLINE ? '\n' : '');
      // copyOption None=0：禁止复制（preventDefault）；其余档位放行
      if (w.copyOption === CopyOptions.None) { e.preventDefault(); return; }
      if (typeof w.cbs.willCopy === 'function') {
        let ok = true;
        try { ok = w.cbs.willCopy(content) !== false; }              // Callback<string, boolean>：false 拦截
        catch (err) { layoutWarnings.push(`SelectionContainer.onWillCopy 派发抛错：${err && err.message}`); }
        if (!ok) { e.preventDefault(); return; }
      }
      if (e.clipboardData) e.clipboardData.setData('text/plain', content);
      e.preventDefault();
      el.dataset.lastCopied = content;
      if (typeof w.cbs.copy === 'function') {
        try { w.cbs.copy(content); }
        catch (err) { layoutWarnings.push(`SelectionContainer.onCopy 派发抛错：${err && err.message}`); }
      }
    });
    return el;
  });

  // ── Option（ets-loader option.json：parents=[Menu]，attrs=字体四件）──
  // ⚠️ 无 d.ts：create 签名官方未在本机 SDK 出面。取宽容形态：字符串或 {value, icon?}。
  // 字体四件（fontColor/fontSize/fontWeight/fontFamily）不进本表——cssPropSize/cssPropRaw
  // 通用落点已覆盖（fontColor→color 等），别处拦会吞掉通用路径。
  /** @param {any[]} args */
  const Option = ensureComponent('Option', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    el.dataset.option = '';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.cursor = 'pointer';
    el.style.padding = '4px 8px';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? (args[0] || {})
      : { value: args && args[0] !== undefined ? args[0] : '' };
    if (o.icon !== undefined && o.icon !== null) {
      const ic = document.createElement('span');
      ic.setAttribute('data-option-icon', '');
      ic.textContent = String(resolveResource(o.icon));
      el.appendChild(ic);
    }
    const text = document.createElement('span');
    text.setAttribute('data-option-value', '');
    text.textContent = String(resolveResource(o.value === undefined ? '' : o.value));
    el.appendChild(text);
    // 点击：记录选中并派发 CustomEvent（attrs 表无 onSelect——点击消费方是 Menu/Select，
    // DOM 侧用事件冒泡给宿主，不虚构 attrs 表之外的属性）
    el.addEventListener('click', () => {
      el.dataset.selected = 'true';
      el.dispatchEvent(new CustomEvent('optionselect', { bubbles: true, detail: { value: text.textContent } }));
    });
    return el;
  });

  // ── ColorPicker（ets-loader colorPicker.json）──
  /** @param {any[]} args @param {string} kind 'grid'=组件本体 / 'dialog'=对话框内嵌 */
  function buildPickerGrid(args, kind) {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    Object.assign(el.style, { display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(5, 28px)' });
    const w = /** @type {any} */ (el).__batchPicker = /** @type {any} */ ({
      kind, el,
      colors: [], cols: 0, rows: 0, alignment: '',
      cbs: {},
      /** 按当前 colors 重建色块阵 */
      rebuild: () => {
        el.querySelectorAll('[data-swatch]').forEach((/** @type {any} */ s) => s.remove());
        w.colors.forEach((/** @type {any} */ c) => {
          const sw = document.createElement('div');
          sw.setAttribute('data-swatch', '');
          sw.dataset.color = colorOf(c);
          Object.assign(sw.style, {
            width: '28px', height: '28px', borderRadius: '4px',
            background: colorOf(c), cursor: 'pointer', boxSizing: 'border-box',
          });
          sw.addEventListener('click', () => {
            el.querySelectorAll('[data-swatch]').forEach((/** @type {any} */ s) => {
              s.style.border = 'none'; s.dataset.selected = 'false';
            });
            sw.style.border = '2px solid #1a1a1a';
            sw.dataset.selected = 'true';
            el.dataset.lastColor = sw.dataset.color;
            if (typeof w.cbs.select === 'function') {
              try { w.cbs.select(sw.dataset.color); }
              catch (e) { layoutWarnings.push(`ColorPicker.onSelect 派发抛错：${e && e.message}`); }
            }
          });
          el.appendChild(sw);
        });
      },
      /** 对话框形态：colors 落到内嵌网格（外推超集，见头注） */
      rebuildDialog: () => {
        if (!w.gridEl || !w.gridEl.__batchPicker) return;
        w.gridEl.__batchPicker.colors = w.colors;
        w.gridEl.__batchPicker.cbs = w.cbs;
        w.gridEl.__batchPicker.rebuild();
      },
      card: /** @type {any} */ (null),
      gridEl: /** @type {any} */ (null),
    });
    if (kind === 'dialog') {
      // fixed 遮罩 + 居中卡片：show(true/false) 只切卡片显示（BATCHINPUT_ATTRS.show）
      el.style.position = 'fixed';
      el.style.inset = '0';
      el.style.background = 'rgba(0,0,0,0.3)';
      el.style.display = 'none';                                    // 缺省隐藏（show 控制）
      el.style.zIndex = '999';
      const card = document.createElement('div');
      card.setAttribute('data-picker-card', '');
      Object.assign(card.style, {
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        background: '#fff', borderRadius: '8px', padding: '12px',
      });
      const grid = buildPickerGrid([], 'grid');
      grid.removeAttribute('data-arkui-comp');                      // 内嵌网格不冒充独立组件
      (/** @type {any} */ (grid)).__arkuiBatchIn = false;
      w.card = card;
      w.gridEl = grid;
      card.appendChild(grid);
      el.appendChild(card);
    }
    if (args && Array.isArray(args[0])) {                           // 宽容：create([...colors]) 直落
      w.colors = args[0];
      if (kind === 'grid') w.rebuild(); else w.rebuildDialog();
    }
    return el;
  }
  /** @param {any[]} args */
  const ColorPicker = ensureComponent('ColorPicker', (args) => buildPickerGrid(args, 'grid'));
  /** @param {any[]} args */
  const ColorPickerDialog = ensureComponent('ColorPickerDialog', (args) => buildPickerGrid(args, 'dialog'));

  // ══════════ batch-media（R66）：ContainerSpan / ImageSpan / RichText /
  //            SymbolGlyph / SymbolSpan / Web ══════════
  //
  // 产物形态（实测 fixtures/pages/BatchMediaDemo.ts）：
  //   Text() { ContainerSpan() { Span('A'); ImageSpan('…png'); } }
  //     .textBackgroundStyle({ color: '#ffe0b2', radius: 6 });
  //   SymbolGlyph($r('sys.symbol.ohos_wifi')).fontSize(24).fontColor(['#f00'])
  //     .renderingStrategy(SymbolRenderingStrategy.SINGLE)
  //     .effectStrategy(SymbolEffectStrategy.SCALE);
  //   RichText('<p>hi</p>').onStart(cb).onComplete(cb);
  //   Web({ src: '…', controller: new WebController() }).onPageBegin(cb).onPageEnd(cb);
  //
  // 真机语义与 DOM 映射：
  //   · ContainerSpan（container_span.d.ts:52-78）——Text 的内联子段，只支持
  //     textBackgroundStyle（TextBackgroundStyle = { color?, radius? }，span.d.ts:28-45），
  //     统一管理内部多个 Span/ImageSpan 的背景与圆角 → <span>（display:inline）+
  //     background-color/border-radius。子项未自设背景时视觉透出包裹层背景（CSS 天然成立）。
  //   · ImageSpan（image_span.d.ts:66-169）——Text 内联图 → <span>（inline-block，
  //     vertical-align 默认 BOTTOM，JSDoc 原话）内含 <img>；objectFit → CSS object-fit；
  //     colorFilter 的 4x5 矩阵无法用 CSS filter 表达 → data-* + 诊断；onComplete 载荷用
  //     真实解码尺寸（naturalWidth/Height）；onError → img error。坑 ⑧ 收口：load 可能晚于
  //     onComplete 属性挂载——回调经状态袋间接引用 + complete 已成立时补派发。
  //   · RichText（rich_text.d.ts:29-77）——HTML 内容独立渲染上下文 → <iframe srcdoc>；
  //     sandbox="allow-same-origin"（不给 allow-scripts，与真机"独立上下文"一致，
  //     又允许测试读 contentDocument）；onStart 在内容装载开始时派发、onComplete 挂在
  //     iframe load 事件上。内容变化（重渲染）经 contentUpdater diff 更新 srcdoc。
  //   · SymbolGlyph / SymbolSpan（symbolglyph.d.ts:618+ / symbol_span.d.ts:65-187）——
  //     符号图标 → 文本元素，textContent = 符号名（浏览器没有 HM Symbol 字体，
  //     显示名字本身 = 如实降级且可断言）；fontColor 数组按 renderingStrategy 取第一层
  //     （SINGLE 本来就只应用第一色；MULTIPLE_COLOR/MULTIPLE_OPACITY 的分层着色
  //     无法在纯文本上表达 → 记 data-* + 诊断）；effectStrategy=SCALE 给一次性 CSS
  //     缩放动画，HIERARCHICAL 记诊断。SymbolSpan 是 Text 内联子段（<span>），
  //     未设置的字体属性继承父 Text（d.ts NOTE：inherits from its parent Text——CSS 继承天然成立）。
  //   · Web（web.d.ts:3446 WebOptions{src,controller} / 5814+ WebAttribute）——
  //     → <iframe>（无 sandbox：真机 Web 可执行 JS）；src → iframe.src；加载生命周期
  //     桥接：onPageBegin（src 赋值时登记 pending，load 时补派发，保证 begin 先于 end）、
  //     onPageEnd/onLoadFinished（iframe load）、onProgressChange({newProgress:100}
  //     ——DOM 观测不到渐进进度，只在完成时派发终值）、onTitleReceive（同源才读得到
  //     contentDocument.title）、onErrorReceive（iframe error，极少触发）。
  //     布尔开关族（javaScriptAccess/domStorageAccess/…）逐项落 data-*；userAgent/
  //     initialScale/textZoomRatio/javaScriptProxy/javaScriptOnDocument* 无法作用于
  //     原生 iframe → data-* + 诊断。WebController（web.d.ts:3216，deprecated but valid）
  //     loadUrl/refresh/backward/forward/accessBackward/runJavaScript/stop 映射到
  //     iframe 同源 API（try/catch 兜底跨域）；clearHistory/getCookieManager 等无法
  //     实现的显式记诊断，不静默假装成功。

  // ── Resource / 字符串 → 符号名（SymbolGlyph/SymbolSpan 共用）──
  // $r('sys.symbol.x') 的最小形态是 { id, params: ['sys.symbol.x'] }：名字在 params[0]，
  // 必须先于 resolveResource 查表（查表只会把它换成数字 id，名字就丢了）。
  /** @param {any} v */
  const symbolNameOf = (v) => {
    if (v === undefined || v === null) return '';
    // 名字在原始资源的 params[0]，必须【先于】resolveResource 检查——
    // resolveResource 对带 id/type 的对象直接查表，查不到会把整个资源换成 undefined
    if (v && typeof v === 'object' && Array.isArray(v.params) && typeof v.params[0] === 'string') {
      return v.params[0];
    }
    const r = resolveResource(v);
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object') {
      if (r.id !== undefined) return String(r.id);
    }
    return '';
  };
  // 符号缩放动画的 keyframes 只注入一次（同 LoadingProgress 的 keyframes 做法）
  const ensureSymbolKeyframes = () => {
    if (!document.getElementById('arkui-symbol-keyframes')) {
      const st = document.createElement('style');
      st.id = 'arkui-symbol-keyframes';
      st.textContent = '@keyframes arkuiSymScale{0%,100%{transform:scale(1)}50%{transform:scale(0.5)}}';
      document.head.appendChild(st);
    }
  };
  // SymbolEffectStrategy（symbolglyph.d.ts:118-152）：NONE=0 / SCALE=1 / HIERARCHICAL=2
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_STRATEGY = { NONE: 0, SCALE: 1, HIERARCHICAL: 2 };
  // SymbolRenderingStrategy（symbolglyph.d.ts:55-106）：SINGLE=0 / MULTIPLE_COLOR=1 / MULTIPLE_OPACITY=2
  /** @type {Record<string, number>} */
  const SYMBOL_RENDERING_STRATEGY = { SINGLE: 0, MULTIPLE_COLOR: 1, MULTIPLE_OPACITY: 2 };
  // EffectScope / EffectDirection / EffectFillStyle / ReplaceEffectType（symbolglyph.d.ts:163-310）
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_SCOPE = { LAYER: 0, WHOLE: 1 };
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_DIRECTION = { DOWN: 0, UP: 1 };
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_FILL_STYLE = { OPACITY: 0, COLOR: 1, GRADIENT: 2 };
  /** @type {Record<string, number>} */
  const SYMBOL_REPLACE_EFFECT_TYPE = { DIRECT: 0, CROSS_FADE: 1 };
  // 符号字体属性族（SymbolGlyph / SymbolSpan 共用实现）
  /** @param {any} n @param {any} v */
  const symFontSize = (n, v) => { n.style.fontSize = `${dimOf(v, 16)}px`; };
  /** @param {any} n @param {any} v */
  const symFontColor = (n, v) => {
    const arr = Array.isArray(v) ? v : [v];
    const w = n.__sym;
    if (w) w.colors = arr;
    if (arr.length > 0) n.style.color = colorOf(arr[0]);    // 单色模式：只应用第一色
    n.dataset.fontColorLayers = String(arr.length);
  };
  /** @param {any} n @param {any} v */
  const symFontWeight = (n, v) => { n.style.fontWeight = String(resolveResource(v)); };
  /** @param {any} n @param {any} v */
  const symEffectStrategy = (n, v) => {
    const k = Number(resolveResource(v));
    n.dataset.effectStrategy = String(k);
    if (k === SYMBOL_EFFECT_STRATEGY.SCALE) {
      ensureSymbolKeyframes();
      n.style.animation = 'arkuiSymScale 0.6s ease-in-out 1';   // 一次性整体缩放
    } else if (k === SYMBOL_EFFECT_STRATEGY.HIERARCHICAL) {
      // 分层透明度动效需要逐层节点，纯文本降级无法表达
      layoutWarnings.push('Symbol 组件 effectStrategy=HIERARCHICAL 的分层动效未实现（记 data-effectStrategy）');
    }
  };
  /** @param {any} n @param {any} v */
  const symRenderingStrategy = (n, v) => {
    const k = Number(resolveResource(v));
    n.dataset.renderingStrategy = String(k);
    const w = n.__sym;
    if (w) w.renderingStrategy = k;
    if (k !== SYMBOL_RENDERING_STRATEGY.SINGLE) {
      // MULTIPLE_COLOR（最多三层配色）/ MULTIPLE_OPACITY（100%/50%/20% 分层透明度）
      // 都要逐层节点着色，纯文本降级只应用第一层
      layoutWarnings.push('Symbol 组件 renderingStrategy 的分层着色未实现，只应用第一层色（记 data-renderingStrategy）');
    }
  };
  /** @param {any} n @param {any} v */
  const symSymbolEffect = (n, v) => {
    const name = v && v.constructor && v.constructor.name ? v.constructor.name : String(v);
    n.dataset.symbolEffect = name;
    layoutWarnings.push(`Symbol 组件 symbolEffect(${name}) 的对象式动效 API 未实现（记 data-symbolEffect）`);
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SYMBOLGLYPH_ATTRS = {
    fontSize: symFontSize,
    fontColor: symFontColor,
    fontWeight: symFontWeight,
    effectStrategy: symEffectStrategy,
    renderingStrategy: symRenderingStrategy,
    symbolEffect: symSymbolEffect,
    // minFontScale/maxFontScale/symbolShadow/shaderStyle 落通用 data-*（无 DOM 对应物）
  };

  // ── ① ContainerSpan（container_span.d.ts）：Text 内联背景/圆角包裹层 ──
  // TextBackgroundStyle.radius 是 Dimension | BorderRadiuses（span.d.ts:40-45）：后者按四角展开
  /** @param {any} n @param {any} v */
  const applyTextBackground = (n, v) => {
    const o = (v && typeof v === 'object' && v) || {};
    if (o.color !== undefined) n.style.backgroundColor = colorOf(o.color);
    const r = o.radius;
    if (r !== undefined && r !== null && typeof r === 'object' && !Array.isArray(r)) {
      n.style.borderRadius = `${dimOf(r.topLeft, 0)}px ${dimOf(r.topRight, 0)}px`
        + ` ${dimOf(r.bottomRight, 0)}px ${dimOf(r.bottomLeft, 0)}px`;
    } else if (r !== undefined && r !== null) {
      n.style.borderRadius = toCssSize(r);
    }
    try { n.dataset.textBackgroundStyle = JSON.stringify(v); }
    catch (e) { n.dataset.textBackgroundStyle = String(v); }
  };
  const ContainerSpan = ensureComponent('ContainerSpan', () => {
    const el = document.createElement('span');
    (/** @type {any} */ (el)).__arkuiContainerSpan = true;
    el.dataset.containerSpan = '';
    el.style.display = 'inline';            // 内联子段：不参与 Text 的行内断行布局
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CONTAINERSPAN_ATTRS = {
    textBackgroundStyle: applyTextBackground,
  };

  // ── ② ImageSpan（image_span.d.ts）：Text 内联图 ──
  // ImageSpanAlignment（enums.d.ts:3635-3686）：BASELINE=0 / BOTTOM=1 / CENTER=2 / TOP=3 /
  // FOLLOW_PARAGRAPH=4（跟随父 Text 的对齐 = 清掉自身设置）
  /** @type {Record<string, number>} */
  const IMAGESPAN_ALIGNMENT = { BASELINE: 0, BOTTOM: 1, CENTER: 2, TOP: 3, FOLLOW_PARAGRAPH: 4 };
  /** @type {Record<string, string>} */
  const IMAGESPAN_VALIGN_CSS = { 0: 'baseline', 1: 'bottom', 2: 'middle', 3: 'top' };
  // ImageFit → CSS（Contain=0/Cover=1/Fill=3/ScaleDown=4/None=5；Auto=2 如实不映射）
  /** @type {Record<string, string>} */
  const IMAGESPAN_FIT_CSS = { 0: 'contain', 1: 'cover', 3: 'fill', 4: 'scale-down', 5: 'none' };
  const ImageSpan = ensureComponent('ImageSpan', (args) => {
    const el = document.createElement('span');
    (/** @type {any} */ (el)).__arkuiImageSpan = true;
    el.dataset.imageSpan = '';
    // inline-block 才能 width/height/object-fit；vertical-align 默认 BOTTOM（JSDoc 原话）
    el.style.display = 'inline-block';
    el.style.verticalAlign = 'bottom';
    el.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.setAttribute('data-arkui-imagespan-img', '');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.display = 'block';
    const src = args && args[0] !== undefined && args[0] !== null ? resolveResource(args[0]) : null;
    if (src != null) img.src = String(src);
    el.appendChild(img);
    const w = /** @type {any} */ (el).__imgs = /** @type {any} */ ({ img, cbs: {}, loaded: false, failed: false, fired: false });
    // 事件收口（坑 ⑧）：回调经 __imgs.cbs 间接引用（覆盖语义）；补派发只跑一次
    w.tryFire = () => {
      if (w.fired) return;
      if (!w.loaded && !w.failed) return;
      w.fired = true;
      if (w.loaded) {
        const cb = w.cbs.complete;
        if (typeof cb === 'function') {
          setTimeout(() => {
            try {
              const cr = img.getBoundingClientRect();
              const er = el.getBoundingClientRect();
              // ImageLoadResult（image_span.d.ts:216-344）：宽高用真实解码尺寸（px），
              // contentOffset 置 0（DOM 的 object-fit 模型下内容从盒子左上角起）
              cb({
                width: img.naturalWidth, height: img.naturalHeight,
                componentWidth: er.width, componentHeight: er.height,
                loadingStatus: 1,                       // 1 = 成功解码（JSDoc 原话）
                contentWidth: cr.width, contentHeight: cr.height,
                contentOffsetX: 0, contentOffsetY: 0,
              });
            } catch (e) { layoutWarnings.push(`ImageSpan.onComplete 回调抛错：${e && e.message}`); }
          }, 0);
        }
      } else {
        const cb = w.cbs.error;
        if (typeof cb === 'function') {
          setTimeout(() => {
            try { cb({ name: 'ImageSpan', message: `load failed: ${img.src}` }); }
            catch (e) { layoutWarnings.push(`ImageSpan.onError 回调抛错：${e && e.message}`); }
          }, 0);
        }
      }
    };
    img.addEventListener('load', () => { w.loaded = true; w.tryFire(); });
    img.addEventListener('error', () => { w.failed = true; w.tryFire(); });
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const IMAGESPAN_ATTRS = {
    verticalAlign: (n, v) => {
      const k = Number(resolveResource(v));
      n.dataset.verticalAlign = String(k);
      const css = IMAGESPAN_VALIGN_CSS[k];
      if (css) n.style.verticalAlign = css;
      else if (k === IMAGESPAN_ALIGNMENT.FOLLOW_PARAGRAPH) n.style.verticalAlign = '';
    },
    objectFit: (n, v) => {
      const fit = Number(resolveResource(v));
      n.dataset.objectFit = String(fit);
      const css = IMAGESPAN_FIT_CSS[fit];
      const w = /** @type {any} */ (n).__imgs;
      if (css && w && w.img) w.img.style.objectFit = css;
    },
    colorFilter: (n, v) => {
      try { n.dataset.colorFilter = JSON.stringify(v); }
      catch (e) { n.dataset.colorFilter = '1'; }
      layoutWarnings.push('ImageSpan.colorFilter 的 4x5 矩阵未映射为 CSS filter（记 data-colorFilter）');
    },
    alt: (n, v) => {
      // 真机 alt 是 PixelMap（image_span.d.ts:168）；DOM 无 PixelMap，只如实记录
      const r = resolveResource(v);
      n.dataset.alt = typeof r === 'string' ? r : String(v);
    },
    supportSvg2: (n, v) => { n.dataset.supportSvg2 = String(v === true); },
    onComplete: (n, v) => {
      const w = /** @type {any} */ (n).__imgs;
      if (!w) return;
      w.cbs.complete = v;
      w.tryFire();                              // 图已在缓存里完成时补派发
    },
    onError: (n, v) => {
      const w = /** @type {any} */ (n).__imgs;
      if (!w) return;
      w.cbs.error = v;
      w.tryFire();
    },
    textBackgroundStyle: applyTextBackground,   // BaseSpan 家族属性（span.d.ts:49-66）
  };

  // ── ③ RichText（rich_text.d.ts）：HTML 内容 → <iframe srcdoc> ──
  /** @param {any} el @param {any} content */
  const applyRichTextContent = (el, content) => {
    const w = /** @type {any} */ (el).__richTxt;
    if (!w) return;
    const s = content === undefined || content === null ? '' : String(resolveResource(content));
    w.lastContent = s;
    w.started = true;
    // onStart 延后一拍派发，且【派发时才读回调】——属性此刻还没挂上，提前捕获必丢（坑 ⑧）
    setTimeout(() => {
      const cbStart = w.cbs.start;
      if (typeof cbStart === 'function') {
        try { cbStart(); }
        catch (e) { layoutWarnings.push(`RichText.onStart 回调抛错：${e && e.message}`); }
      }
    }, 0);
    // 相同内容重赋 srcdoc 会触发整页重载——diff 掉
    if (w.frame.getAttribute('srcdoc') !== s) w.frame.setAttribute('srcdoc', s);
  };
  const RichText = ensureComponent('RichText', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiRichText = true;
    el.dataset.richText = '';
    el.style.position = 'relative';
    el.style.width = '100%';
    const frame = document.createElement('iframe');
    frame.setAttribute('data-arkui-richtext-frame', '');
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = 'none';
    frame.style.display = 'block';
    // allow-same-origin：让测试能读 contentDocument 断言渲染结果；
    // 不给 allow-scripts——真机 RichText 的 HTML 跑在独立上下文
    frame.setAttribute('sandbox', 'allow-same-origin');
    el.appendChild(frame);
    const w = /** @type {any} */ (el).__richTxt = /** @type {any} */ ({ frame, cbs: {}, lastContent: null, started: false });
    applyRichTextContent(el, args && args[0]);
    // load 挂在首份内容装载之后（避免 about:blank 的首次空 load 误派发 onComplete）
    frame.addEventListener('load', () => {
      if (!w.started) return;
      const cbDone = w.cbs.complete;
      if (typeof cbDone === 'function') {
        setTimeout(() => {
          try { cbDone(); }
          catch (e) { layoutWarnings.push(`RichText.onComplete 回调抛错：${e && e.message}`); }
        }, 0);
      }
    });
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    const content = args && args[0];
    const s = content === undefined || content === null ? '' : String(resolveResource(content));
    const w = /** @type {any} */ (node).__richTxt;
    if (w && w.lastContent !== s) applyRichTextContent(node, content);
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const RICHTEXT_ATTRS = {
    onStart: (n, v) => {
      const w = /** @type {any} */ (n).__richTxt;
      if (w) w.cbs.start = v;
    },
    onComplete: (n, v) => {
      const w = /** @type {any} */ (n).__richTxt;
      if (w) w.cbs.complete = v;
    },
  };

  // ── ④ SymbolGlyph（symbolglyph.d.ts）：独立符号图标 ──
  const SymbolGlyph = ensureComponent('SymbolGlyph', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiSymbolGlyph = true;
    el.dataset.symbolGlyph = '';
    /** @type {any} */ (el).__sym = /** @type {any} */ ({ renderingStrategy: 0, colors: null });
    const name = symbolNameOf(args && args[0]);
    if (name) {
      el.dataset.symbol = name;
      // 浏览器没有 HM Symbol 字体：符号名作为可见文本 = 如实降级 + 可断言
      el.textContent = name;
    } else if (args && args[0] !== undefined) {
      el.dataset.symbolSrc = String(args[0]);   // 解析不出名字的资源：记原始引用
    }
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    return el;
  });

  // ── ⑤ SymbolSpan（symbol_span.d.ts）：Text 内联符号子段 ──
  // d.ts NOTE：未设置的属性继承父 Text——DOM 里不设 inline 样式即天然继承
  const SymbolSpan = ensureComponent('SymbolSpan', (args) => {
    const el = document.createElement('span');
    (/** @type {any} */ (el)).__arkuiSymbolSpan = true;
    el.dataset.symbolSpan = '';
    /** @type {any} */ (el).__sym = /** @type {any} */ ({ renderingStrategy: 0, colors: null });
    const name = symbolNameOf(args && args[0]);
    if (name) {
      el.dataset.symbol = name;
      el.textContent = name;                    // 同 SymbolGlyph 的如实降级
    } else if (args && args[0] !== undefined) {
      el.dataset.symbolSrc = String(args[0]);
    }
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SYMBOLSPAN_ATTRS = {
    fontSize: symFontSize,
    fontColor: symFontColor,
    fontWeight: symFontWeight,
    effectStrategy: symEffectStrategy,
    renderingStrategy: symRenderingStrategy,
  };

  // ── ⑥ Web（web.d.ts）：<iframe> 垫片 + WebController ──
  /** @param {string} key */
  const webFlag = (key) => (/** @type {any} */ n, /** @type {any} */ v) => {
    n.dataset[key] = String(!!resolveResource(v));
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const WEB_ATTRS = {
    // 布尔开关族：DOM iframe 无逐项对应物，逐项落 data-*（不静默丢失）
    javaScriptAccess: webFlag('javaScriptAccess'),
    domStorageAccess: webFlag('domStorageAccess'),
    fileAccess: webFlag('fileAccess'),
    onlineImageAccess: webFlag('onlineImageAccess'),
    imageAccess: webFlag('imageAccess'),
    zoomAccess: webFlag('zoomAccess'),
    multiWindowAccess: webFlag('multiWindowAccess'),
    databaseAccess: webFlag('databaseAccess'),
    geolocationAccess: webFlag('geolocationAccess'),
    mediaPlayGestureAccess: webFlag('mediaPlayGestureAccess'),
    overviewModeAccess: webFlag('overviewModeAccess'),
    verticalScrollBarAccess: webFlag('verticalScrollBarAccess'),
    horizontalScrollBarAccess: webFlag('horizontalScrollBarAccess'),
    blockNetwork: webFlag('blockNetwork'),
    wideViewModeAccess: webFlag('wideViewModeAccess'),
    cacheMode: (n, v) => { n.dataset.cacheMode = String(Number(resolveResource(v))); },
    darkMode: (n, v) => {
      n.dataset.darkMode = String(resolveResource(v));
      layoutWarnings.push('Web.darkMode 无法作用于原生 iframe（记 data-darkMode）');
    },
    forceDarkAccess: (n, v) => {
      n.dataset.forceDarkAccess = String(!!v);
      layoutWarnings.push('Web.forceDarkAccess 无法作用于原生 iframe（记 data-forceDarkAccess）');
    },
    userAgent: (n, v) => {
      n.dataset.userAgent = String(resolveResource(v));
      layoutWarnings.push('Web.userAgent 无法作用于原生 iframe（记 data-userAgent）');
    },
    initialScale: (n, v) => {
      n.dataset.initialScale = String(resolveResource(v));
      layoutWarnings.push('Web.initialScale 无法作用于原生 iframe（记 data-initialScale）');
    },
    textZoomRatio: (n, v) => {
      n.dataset.textZoomRatio = String(resolveResource(v));
      layoutWarnings.push('Web.textZoomRatio 无法作用于原生 iframe（记 data-textZoomRatio）');
    },
    javaScriptProxy: (n, v) => {
      try { n.dataset.javaScriptProxy = JSON.stringify(v && v.name ? v.name : v); }
      catch (e) { n.dataset.javaScriptProxy = '1'; }
      layoutWarnings.push('Web.javaScriptProxy 无法注入原生 iframe（记 data-javaScriptProxy）');
    },
    javaScriptOnDocumentStart: (n, v) => {
      n.dataset.javaScriptOnDocumentStart = String(typeof v === 'function' ? 'fn' : v);
      layoutWarnings.push('Web.javaScriptOnDocumentStart 无法注入原生 iframe（记 data-*）');
    },
    javaScriptOnDocumentEnd: (n, v) => {
      n.dataset.javaScriptOnDocumentEnd = String(typeof v === 'function' ? 'fn' : v);
      layoutWarnings.push('Web.javaScriptOnDocumentEnd 无法注入原生 iframe（记 data-*）');
    },
    // ── 加载生命周期（函数值抢在通用 on* 规则之前，坑 86）──
    onPageBegin: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (!w) return;
      w.cbs.pageBegin = v;
      // src 赋值时登记的 pendingBegin：回调挂上后补派发（已由 load 派发过则 pending 为空）
      if (w.pendingBegin) {
        setTimeout(() => {
          if (!w.pendingBegin) return;
          const ev = w.pendingBegin;
          w.pendingBegin = null;
          try { w.cbs.pageBegin(ev); }
          catch (e) { layoutWarnings.push(`Web.onPageBegin 回调抛错：${e && e.message}`); }
        }, 0);
      }
    },
    onPageEnd: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.pageEnd = v;
    },
    onLoadStarted: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.loadStarted = v;
    },
    onLoadFinished: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.loadFinished = v;
    },
    onProgressChange: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.progressChange = v;
    },
    onTitleReceive: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.titleReceive = v;
    },
    onErrorReceive: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.errorReceive = v;
    },
    onControllerAttached: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (!w) return;
      w.cbs.controllerAttached = v;
      // 真机在 controller 绑定后触发；DOM 里 create 与属性链同一 tick，
      // 延后一拍保证回调已挂上（坑 ⑧）
      setTimeout(() => {
        const cb = w.cbs.controllerAttached;
        if (typeof cb === 'function') {
          try { cb(); }
          catch (e) { layoutWarnings.push(`Web.onControllerAttached 回调抛错：${e && e.message}`); }
        }
      }, 0);
    },
  };
  const Web = ensureComponent('Web', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiWeb = true;
    el.dataset.web = '';
    el.style.position = 'relative';
    const frame = document.createElement('iframe');
    frame.setAttribute('data-arkui-web-frame', '');
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = 'none';
    frame.style.display = 'block';
    el.appendChild(frame);
    const w = /** @type {any} */ (el).__web = /** @type {any} */ ({ frame, cbs: {}, url: '', pendingBegin: null });
    /** @param {any} k @param {any} payload */
    const fire = (k, payload) => {
      const cb = w.cbs[k];
      if (typeof cb !== 'function') return;
      try { cb(payload); }
      catch (e) { layoutWarnings.push(`Web.${k} 回调抛错：${e && e.message}`); }
    };
    /** @param {any} rawUrl */
    const loadTo = (rawUrl) => {
      const url = String(resolveResource(rawUrl));
      w.url = url;
      w.pendingBegin = { url };
      frame.src = url;
      el.dataset.src = url;
      const cbStart = w.cbs.loadStarted;
      if (typeof cbStart === 'function') {
        setTimeout(() => {
          try { cbStart({ url }); }
          catch (e) { layoutWarnings.push(`Web.onLoadStarted 回调抛错：${e && e.message}`); }
        }, 0);
      }
    };
    w.loadTo = loadTo;
    // 加载生命周期桥：iframe load → begin(补) → end → finished → progress(100) → title
    frame.addEventListener('load', () => {
      if (w.pendingBegin) {
        const ev = w.pendingBegin;
        w.pendingBegin = null;
        fire('pageBegin', ev);
      }
      fire('pageEnd', { url: w.url });
      fire('loadFinished', { url: w.url });
      // DOM 观测不到渐进加载进度，只在完成时派发终值 100
      fire('progressChange', { newProgress: 100 });
      let title = null;
      try { title = frame.contentDocument ? frame.contentDocument.title : null; } catch (e) { title = null; }
      if (title) fire('titleReceive', { title, isRealTitle: true });
    });
    frame.addEventListener('error', () => {
      // OnErrorReceiveEvent 的 request/response 形态拿不到，给最小载荷
      fire('errorReceive', { url: w.url });
    });
    if (o.src !== undefined && o.src !== null) loadTo(o.src);
    if (o.controller && typeof o.controller._bind === 'function') {
      o.controller._bind({
        /** @param {any} url */
        loadUrl(url) { loadTo(url); },
        /** @param {any} opts */
        loadData(opts) {
          const data = opts && opts.data !== undefined ? String(opts.data) : '';
          w.url = String((opts && opts.baseUrl) || 'about:blank');
          w.pendingBegin = { url: w.url };
          frame.setAttribute('srcdoc', data);
        },
        refresh() {
          try { w.frame.contentWindow.location.reload(); }
          catch (e) { w.frame.src = w.frame.src; }          // 跨域退化为整页重载
        },
        backward() {
          try { w.frame.contentWindow.history.back(); }
          catch (e) { layoutWarnings.push('WebController.backward: 跨域 iframe 历史不可控'); }
        },
        forward() {
          try { w.frame.contentWindow.history.forward(); }
          catch (e) { layoutWarnings.push('WebController.forward: 跨域 iframe 历史不可控'); }
        },
        /** @returns {boolean} */
        accessBackward() {
          try { return w.frame.contentWindow.history.length > 1; }
          catch (e) { return false; }
        },
        /** @returns {boolean} */
        accessForward() { return false; },                   // 前向历史 DOM 无法探测，保守 false
        /** @param {any} _step */
        accessStep(_step) { layoutWarnings.push('WebController.accessStep 未实现'); },
        clearHistory() { layoutWarnings.push('WebController.clearHistory 无法清除 iframe 历史（已忽略）'); },
        /** @param {any} _name */
        deleteJavaScriptRegister(_name) { /* 登记表随 iframe 重载天然失效 */ },
        /** @param {any} obj @param {any} name @param {any} _methods */
        registerJavaScriptProxy(obj, name, _methods) {
          w.jsProxy = { obj, name };
          layoutWarnings.push('WebController.registerJavaScriptProxy 无法注入沙箱 iframe（已登记）');
        },
        /** @param {any} script @returns {any} */
        runJavaScript(script) {
          try { return w.frame.contentWindow.eval(String(script)); }
          catch (e) {
            layoutWarnings.push(`WebController.runJavaScript 抛错：${e && e.message}`);
            return undefined;
          }
        },
        /** @returns {null} */
        getCookieManager() { layoutWarnings.push('WebController.getCookieManager 未实现'); return null; },
        /** @returns {number} */
        getHitTest() { layoutWarnings.push('WebController.getHitTest 未实现'); return 0; },
        requestFocus() {
          try { w.frame.contentWindow.focus(); }
          catch (e) { w.frame.focus(); }
        },
        onActive() { /* 前后台事件无 DOM 对应物 */ },
        onInactive() { /* 前后台事件无 DOM 对应物 */ },
        stop() {
          try { w.frame.contentWindow.stop(); }
          catch (e) { /* 旧引擎无 stop：静默 */ }
        },
        /** @param {any} _factor */
        zoom(_factor) { layoutWarnings.push('WebController.zoom 未实现（iframe 缩放不可控）'); },
      });
    }
    return el;
  });
  // WebController（web.d.ts:3216，API 8 deprecated，方法面与上面 _bind 的一一对应）
  class WebController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    /** @param {any} url */
    loadUrl(url) { if (this._api) this._api.loadUrl(url); }
    /** @param {any} opts */
    loadData(opts) { if (this._api) this._api.loadData(opts); }
    refresh() { if (this._api) this._api.refresh(); }
    backward() { if (this._api) this._api.backward(); }
    forward() { if (this._api) this._api.forward(); }
    /** @returns {boolean} */
    accessBackward() { return this._api ? !!this._api.accessBackward() : false; }
    /** @returns {boolean} */
    accessForward() { return this._api ? !!this._api.accessForward() : false; }
    /** @param {any} step */
    accessStep(step) { if (this._api) this._api.accessStep(step); }
    clearHistory() { if (this._api) this._api.clearHistory(); }
    /** @param {any} name */
    deleteJavaScriptRegister(name) { if (this._api) this._api.deleteJavaScriptRegister(name); }
    /** @param {any} obj @param {any} name @param {any} methods */
    registerJavaScriptProxy(obj, name, methods) { if (this._api) this._api.registerJavaScriptProxy(obj, name, methods); }
    /** @param {any} script @returns {any} */
    runJavaScript(script) { return this._api ? this._api.runJavaScript(script) : undefined; }
    /** @returns {null} */
    getCookieManager() { return this._api ? this._api.getCookieManager() : null; }
    /** @returns {number} */
    getHitTest() { return this._api ? this._api.getHitTest() : 0; }
    requestFocus() { if (this._api) this._api.requestFocus(); }
    onActive() { if (this._api) this._api.onActive(); }
    onInactive() { if (this._api) this._api.onInactive(); }
    stop() { if (this._api) this._api.stop(); }
    /** @param {any} factor */
    zoom(factor) { if (this._api) this._api.zoom(factor); }
  }
  // 枚举自由变量（产物里 `SymbolGlyph…(SymbolRenderingStrategy.SINGLE)` 这类引用）——
  // 与取值表同值（symbolglyph.d.ts:55-152 / enums.d.ts:3635-3686）
  const SymbolRenderingStrategy = { SINGLE: 0, MULTIPLE_COLOR: 1, MULTIPLE_OPACITY: 2 };
  const SymbolEffectStrategy = { NONE: 0, SCALE: 1, HIERARCHICAL: 2 };
  const EffectScope = { LAYER: 0, WHOLE: 1 };
  const EffectDirection = { DOWN: 0, UP: 1 };
  const EffectFillStyle = { OPACITY: 0, COLOR: 1, GRADIENT: 2 };
  const ReplaceEffectType = { DIRECT: 0, CROSS_FADE: 1 };
  const ImageSpanAlignment = { BASELINE: 0, BOTTOM: 1, CENTER: 2, TOP: 3, FOLLOW_PARAGRAPH: 4 };
  // SymbolEffect 族（symbolglyph.d.ts:312-616）：DOM 降级只记录构造参数，动效不实现
  class SymbolEffect { }
  class ScaleSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] @param {any} [direction] */
    constructor(scope, direction) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
      this.direction = direction === undefined ? EffectDirection.DOWN : direction;
    }
  }
  class HierarchicalSymbolEffect extends SymbolEffect {
    /** @param {any} [fillStyle] */
    constructor(fillStyle) {
      super();
      this.fillStyle = fillStyle === undefined ? EffectFillStyle.OPACITY : fillStyle;
    }
  }
  class AppearSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] */
    constructor(scope) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
    }
  }
  class DisappearSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] */
    constructor(scope) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
    }
  }
  class BounceSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] @param {any} [direction] */
    constructor(scope, direction) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
      this.direction = direction === undefined ? EffectDirection.DOWN : direction;
    }
  }
  class ReplaceSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] @param {any} [replaceType] */
    constructor(scope, replaceType) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
      this.replaceType = replaceType;
    }
  }
  class PulseSymbolEffect extends SymbolEffect { }

  // ────────────────── 批次 D：导航 / 页面转场 / 工具栏项 / 选择器（R66）──────────────────
  //
  // 六组件（权威出处：nav_router.d.ts / navigator.d.ts / page_transition.d.ts / toolbar.d.ts
  // / ui_picker_component.d.ts）：
  //
  //   NavRouter(value?: RouteInfo)   —— deprecated since 13（useinstead NavPathStack）。
  //     .onStateChange((isActivated: boolean) => …) / .mode(NavRouteMode)
  //     真机语义：点击后自动把 RouteInfo 压入所属 Navigation 的路由栈（"default processing
  //     logic for responding to clicks"）。本垫片：click → 向上找带 __navState.stack 的
  //     Navigation，调 NavPathStack.pushPathByName /（REPLACE 时）replacePathByName；
  //     push 同步建出目的地（navBuildDest），返回即"已激活"→ onStateChange(true)；
  //     pop 包装（实例级补丁，不动 nav.js）→ 被弹出的是自己时 onStateChange(false)。
  //     ⚠️ 真机旧 API 的目的地是 NavRouter 的【第二个子组件】按结构注册；本运行时的目的地
  //     只能由 PageMap builder 建出（navBuildDest 按 builder 找 name）——所以 NavRouter 里
  //     内联的那个 NavDestination 子组件会被 mountNavDestination 挂成 display:none 并记
  //     layoutWarning（"不在目标区内"），实际显示的是 PageMap 建的那份。结构性差异，非缺陷。
  //
  //   Navigator(value?: { target, type }) —— deprecated since 13。
  //     .active(bool) / .type(NavigationType) / .target(string) / .params(object)
  //     真机语义：点击整块区域按 type 跳转；active=false 时不生效（默认激活）。
  //     Push=0/Back=1/Replace=2（.d.ts 声明顺序）。Back → __arkui_dom_back()；
  //     Push/Replace → __arkui_dom_navigate(target)（本运行时 router 的既定模型：清根重建、
  //     页面实例留在 pageStack —— 与 router.pushUrl 垫片一致）。Replace 的"销毁当前页"
  //     未建模，点一次记一条 layoutWarning。params 存 global.__arkui_dom_navigatorParams。
  //
  //   PageTransitionEnter / PageTransitionExit(options) —— 页面级声明（真机在 pageTransition()
  //     钩子里，不在 build 里）。CommonTransition 五属性：slide/translate/scale/opacity +
  //     onEnter/onExit 逐帧回调（(type: RouteType, progress: 0..1)）。options：type/duration
  //     (默认 1000ms)/curve(默认 linear)/delay(默认 0)。RouteType：None=0（任意方向生效）/
  //     Push=1/Pop=2；SlideEffect：Left=0/Right=1/Top=2/Bottom=3/START=5/END=6（LTR 下
  //     START≡Left、END≡Right）。本垫片：元素 display:none 只做【规格登记】
  //     （__arkui_dom_pageTransitionSpecs），驱动入口 __arkui_dom_playPageTransition(kind, rt)
  //     —— 对页面根做 Web Animations + rAF 逐帧回调。路由变更不自动触发（运行时 router 无
  //     pageTransition 钩子，需主会话接线或测试显式驱动）。
  //
  //   ToolBarItem(options?: { placement }) —— API 20。ToolBarItemAttribute 是【空类】
  //     （明确不支持通用属性），唯一参数 placement：TOP_BAR_LEADING=0/TOP_BAR_TRAILING=1。
  //     真机与 toolbar 通用属性（标题栏列）配合；本垫片只落语义标记（dataset.placement），
  //     标题栏列分配未接线（toolbar 通用属性属于另一批）。
  //
  //   UIPickerComponent(options?: { selectedIndex }) —— API 22。子组件即选项（Text/Image/
  //     Row，Row 整体算一项）。滚轮：itemHeight 默认 40vp、displayedItemCount 默认 7、选中项
  //     指示器 BACKGROUND(0,默认)/DIVIDER(1)。事件 onChange/onScrollStop 回调签名是
  //     (selectedIndex: number)。canLoop/enableHapticFeedback 落 dataset（循环滚动与震动
  //     未实现，≥8 项且 canLoop 时记一条 layoutWarning）。子项在 pop 时收割（Tabs 模式）：
  //     节点挪进隐藏 stash 保留复用，标签取 textContent 重建滚轮。
  //
  // DOM 概览：
  //   NavRouter   <div data-arkui-comp="NavRouter">            display:block，整块可点
  //   Navigator   <div data-arkui-comp="Navigator">            display:block，整块可点
  //   PageTrans*  <div data-arkui-comp="PageTransitionEnter">  display:none（纯规格）
  //   ToolBarItem <div data-arkui-comp="ToolBarItem">          inline-flex
  //   UIPicker    <div data-arkui-comp="UIPickerComponent">    flex；[data-upx-indicator] +
  //               [data-upx-wheel]（滚轮，translateY 定位，中行高亮）+ 隐藏 stash

  // ── 枚举：值照 .d.ts 声明顺序（显式数值照原文）。产物里都是自由变量引用，主会话挂 global ──
  const NavRouteMode = { PUSH_WITH_RECREATE: 0, PUSH: 1, REPLACE: 2 };
  const NavigationType = { Push: 0, Back: 1, Replace: 2 };
  const RouteType = { None: 0, Push: 1, Pop: 2 };
  const SlideEffect = { Left: 0, Right: 1, Top: 2, Bottom: 3, START: 5, END: 6 };
  const ToolBarItemPlacement = { TOP_BAR_LEADING: 0, TOP_BAR_TRAILING: 1 };
  const PickerIndicatorType = { BACKGROUND: 0, DIVIDER: 1 };

  // ── NavRouter ──
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const NAVROUTER_ATTRS = {
    onStateChange: (n, v) => {
      const w = /** @type {any} */ (n).__navRouter;
      if (w) w.cbs.stateChange = v;
    },
    mode: (n, v) => {
      const w = /** @type {any} */ (n).__navRouter;
      if (!w) return;
      w.mode = Number(resolveResource(v)) || 0;
      n.dataset.mode = String(w.mode);
    },
  };
  /** @param {HTMLElement} el */
  const navRouterStackOf = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const st = /** @type {any} */ (p).__navState;
      if (st && st.stack) return /** @type {any} */ (st.stack);
    }
    return null;
  };
  /** @param {any} el @param {boolean} on */
  const navRouterSetState = (el, on) => {
    const w = /** @type {any} */ (el).__navRouter;
    if (!w || w.state === on) return;
    w.state = on;
    el.dataset.state = String(on);
    const cb = w.cbs.stateChange;
    if (typeof cb === 'function') {
      try { cb(on); }
      catch (e) { layoutWarnings.push(`NavRouter.onStateChange 回调抛错：${e && e.message}`); }
    }
  };
  /** @param {any[]} args */
  const NavRouter = ensureComponent('NavRouter', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiNavRouter = true;
    el.style.display = 'block';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    // RouteInfo：{ name: string, param?: unknown }
    const w = /** @type {any} */ (el).__navRouter = /** @type {any} */ ({
      route: {
        name: o.name === undefined ? '' : String(resolveResource(o.name)),
        param: o.param,
      },
      mode: 0,                       // 默认 NavRouteMode.PUSH_WITH_RECREATE（.d.ts JSDoc）
      state: false,
      popPatched: false,
      cbs: {},
    });
    el.dataset.routeName = w.route.name;
    el.dataset.mode = String(w.mode);
    el.dataset.state = 'false';
    el.addEventListener('click', () => {
      const stack = navRouterStackOf(el);
      if (!stack) {
        layoutWarnings.push('NavRouter 点击：向上找不到绑定了 NavPathStack 的 Navigation，路由跳过');
        return;
      }
      if (!w.route.name) { layoutWarnings.push('NavRouter 缺少 RouteInfo.name，无法路由'); return; }
      if (w.mode === NavRouteMode.REPLACE) {
        stack.replacePathByName(w.route.name, w.route.param);
      } else {
        // PUSH_WITH_RECREATE 与 PUSH 都走 pushPathByName —— "当前页是否重建"未建模
        stack.pushPathByName(w.route.name, w.route.param);
      }
      // push 同步建出目的地（navBuildDest），返回即视为"已激活 + NavDestination 已加载"
      navRouterSetState(el, true);
      // 实例级 pop 包装（不动 nav.js）：被弹出的栈顶是自己时回落 onStateChange(false)
      if (!w.popPatched && typeof stack.pop === 'function') {
        w.popPatched = true;
        const prevPop = stack.pop;
        /** @param {any=} [a1] @param {any=} [a2] */
        stack.pop = function (a1, a2) {
          const paths = /** @type {any} */ (stack)._paths;
          const top = paths && paths.length ? paths[paths.length - 1] : null;
          const r = prevPop.call(stack, a1, a2);
          if (top && top.name === w.route.name) navRouterSetState(el, false);
          return r;
        };
      }
    });
    return el;
  });

  // ── Navigator ──
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const NAVIGATOR_ATTRS = {
    active: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.active = v === true;
      n.dataset.active = String(w.active);
    },
    type: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.type = Number(resolveResource(v)) || 0;
      n.dataset.type = String(w.type);
    },
    target: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.target = String(resolveResource(v));
      n.dataset.target = w.target;
    },
    params: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.params = v;
      try { n.dataset.params = JSON.stringify(v); }
      catch (e) { n.dataset.params = '[unserializable]'; }
    },
  };
  /** @param {any[]} args */
  const Navigator = ensureComponent('Navigator', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiNavigator = true;
    el.style.display = 'block';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    // active 的默认值 .d.ts 未写；取 true 依据是"组件缺省即可用"（点一下就该跳），**这是推断**
    const w = /** @type {any} */ (el).__navigator = /** @type {any} */ ({
      active: true,
      type: o.type === undefined ? 0 : Number(resolveResource(o.type)),   // 默认 NavigationType.Push
      target: o.target === undefined ? '' : String(resolveResource(o.target)),
      params: undefined,
      warnedReplace: false,
    });
    el.dataset.active = String(w.active);
    el.dataset.type = String(w.type);
    el.dataset.target = w.target;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (!w.active) return;
      if (!w.target) { layoutWarnings.push(`Navigator 点击：target 未设置（type=${w.type}）`); return; }
      if (w.type === NavigationType.Back) {
        (/** @type {any} */ (global)).__arkui_dom_back();
        return;
      }
      (/** @type {any} */ (global)).__arkui_dom_navigatorParams = { target: w.target, params: w.params };
      if (w.type === NavigationType.Replace) {
        // "替换并销毁当前页"未建模：走同一清根重建通道，差异记诊断（每实例只记一次）
        if (!w.warnedReplace) {
          layoutWarnings.push('Navigator type=Replace：当前页销毁语义未建模，按 Push 通道处理');
          w.warnedReplace = true;
        }
      }
      (/** @type {any} */ (global)).__arkui_dom_navigate(w.target);
    });
    return el;
  });

  // ── PageTransitionEnter / PageTransitionExit ──
  /** @type {any[]} */
  const pageTransitionSpecs = [];
  /**
   * slide/translate 的起止偏移（enter 的"从哪来"、exit 的"到哪去"），单位 px。
   * slide 优先（.d.ts：与 translate 同设时 slide 生效）；START/END 按 LTR 折算。
   * @param {any} spec
   * @param {HTMLElement} root
   * @returns {{x: number, y: number}}
   */
  const pageTransOffset = (spec, root) => {
    const r = root.getBoundingClientRect();
    if (spec.slide !== null && spec.slide !== undefined) {
      const s = Number(spec.slide);
      if (s === SlideEffect.Right || s === SlideEffect.END) return { x: r.width, y: 0 };
      if (s === SlideEffect.Top) return { x: 0, y: -r.height };
      if (s === SlideEffect.Bottom) return { x: 0, y: r.height };
      return { x: -r.width, y: 0 };                     // Left 与 START（LTR）都从左来
    }
    const t = spec.translate && typeof spec.translate === 'object' ? spec.translate : {};
    return { x: Number(t.x) || 0, y: Number(t.y) || 0 };
  };
  /** @param {any} cb @param {number} rt @param {number} p */
  const pageTransFrame = (cb, rt, p) => {
    if (typeof cb !== 'function') return;
    try { cb(rt, p); }
    catch (e) { layoutWarnings.push(`PageTransition onEnter/onExit 回调抛错：${e && e.message}`); }
  };
  /**
   * 页面转场驱动：对当前页面根按已登记规格播一次 enter/exit 动画，逐帧派发 onEnter/onExit。
   * 返回 Web Animations 句柄（无匹配规格或无根时返回 null）。
   * @param {string} kind 'enter' | 'exit'
   * @param {any=} [routeType] RouteType（缺省 None=0：任意方向规格都命中）
   */
  const playPageTransition = (kind, routeType) => {
    const rt = routeType === undefined ? RouteType.None : Number(routeType);
    const spec = pageTransitionSpecs.find((s) => s.kind === kind && (s.type === RouteType.None || s.type === rt));
    const root = currentRoot();
    if (!spec || !root || !root.animate) return null;
    const dur = Math.max(0, Number(spec.duration) || 0);
    const delay = Math.max(0, Number(spec.delay) || 0);
    // curve：字符串（Curve 枚举值与 CSS 关键字对齐）直接透传；ICurve 对象未实现 → linear
    const easing = typeof spec.curve === 'string' && spec.curve ? spec.curve : 'linear';
    const off = pageTransOffset(spec, root);
    const op = spec.opacity === null || spec.opacity === undefined ? 1 : Number(spec.opacity);
    const sc = spec.scale && typeof spec.scale === 'object' ? spec.scale : null;
    const tf = (/** @type {number} */ sx, /** @type {number} */ sy) =>
      `translate(${off.x * sx}px, ${off.y * sy}px)` + (sc ? ` scale(${Number(sc.x) || 1}, ${Number(sc.y) || 1})` : '');
    const frames = kind === 'enter'
      ? [{ transform: tf(1, 1), opacity: op }, { transform: 'none', opacity: 1 }]
      : [{ transform: 'none', opacity: 1 }, { transform: tf(1, 1), opacity: op }];
    const anim = root.animate(frames, { duration: dur, delay, easing, fill: 'none' });
    // 逐帧回调：progress 0→1（含 delay；总时长为 0 时直接派发 1）
    const total = delay + dur;
    const t0 = performance.now();
    const tick = (/** @type {number} */ now) => {
      const p = total <= 0 ? 1 : Math.min(1, (now - t0) / total);
      pageTransFrame(spec.cbs.frame, rt, p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return anim;
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const PAGE_TRANSITION_ATTRS = {
    slide: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      w.slide = Number(resolveResource(v));
      n.dataset.slide = String(w.slide);
    },
    translate: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (w) w.translate = v;
    },
    scale: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (w) w.scale = v;
    },
    opacity: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      w.opacity = Number(v);
      n.dataset.opacity = String(w.opacity);
    },
    onEnter: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      if (w.kind !== 'enter') { layoutWarnings.push('onEnter 只属于 PageTransitionEnter，已在 Exit 上忽略'); return; }
      w.cbs.frame = v;
    },
    onExit: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      if (w.kind !== 'exit') { layoutWarnings.push('onExit 只属于 PageTransitionExit，已在 Enter 上忽略'); return; }
      w.cbs.frame = v;
    },
  };
  /** @param {string} kind */
  const pageTransitionDom = (kind) => (/** @type {any[]} */ args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiPageTransition = kind;
    el.style.display = 'none';                 // 非可视声明组件：只做规格载体
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__pageTransition = /** @type {any} */ ({
      kind,
      type: o.type === undefined ? RouteType.None : Number(resolveResource(o.type)),
      duration: o.duration === undefined ? 1000 : Number(o.duration),   // 默认 1000（.d.ts JSDoc）
      curve: o.curve === undefined ? 'linear' : o.curve,                 // 默认 Curve.Linear
      delay: o.delay === undefined ? 0 : Number(o.delay),
      slide: null, translate: null, scale: null, opacity: null,
      cbs: {},
    });
    el.dataset.pageTransition = kind;
    el.dataset.type = String(w.type);
    el.dataset.duration = String(w.duration);
    pageTransitionSpecs.push(w);
    return el;
  };
  const PageTransitionEnter = ensureComponent('PageTransitionEnter', pageTransitionDom('enter'));
  const PageTransitionExit = ensureComponent('PageTransitionExit', pageTransitionDom('exit'));
  // 自省/驱动入口走 defineProperty —— 不进 main.js 的 Object.assign 块（stats.mjs 按第一个
  // assign 块统计 global 面，分片里再开一个 assign 块会污染统计口径）
  Object.defineProperty(global, '__arkui_dom_pageTransitionSpecs', {
    get: () => pageTransitionSpecs.slice(), configurable: true,
  });
  Object.defineProperty(global, '__arkui_dom_playPageTransition', {
    get: () => playPageTransition, configurable: true,
  });

  // ── ToolBarItem（API 20；属性类为空 → 无 ATTRS 表，唯一参数是 create 的 options.placement）──
  /** @param {any[]} args */
  const ToolBarItem = ensureComponent('ToolBarItem', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiToolBarItem = true;
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const placement = o.placement === undefined ? 0 : Number(resolveResource(o.placement));
    el.dataset.placement = String(placement);   // 0=TOP_BAR_LEADING（默认）1=TOP_BAR_TRAILING
    return el;
  });

  // ── UIPickerComponent ──
  const UPX_DEFAULT_ROW_H = 40;      // .d.ts NOTE：选项高度固定 40vp（vp→px 1:1 近似）
  const UPX_DEFAULT_ROWS = 7;        // .d.ts NOTE：最多显示 7 项
  const UPX_IND_BG = '#f1f3f5';      // comp_background_tertiary 的近似色（拿不到资源表）
  const UPX_IND_DIVIDER = '#e5e5e5'; // comp_divider 的近似色
  /** LengthMetrics/Length → px 数值（vp/fp/lpx/px 一律 1:1 近似，本项目一贯做法） */
  /** @param {any} v */
  const upxLengthPx = (v) => {
    const r = resolveResource(v);
    if (typeof r === 'number') return r;
    if (r && typeof r === 'object' && typeof r.value === 'number') return r.value;
    const n = parseFloat(String(r));
    return Number.isFinite(n) ? n : 0;
  };
  /** @param {any} el */
  const upxApplyIndicator = (el) => {
    const w = /** @type {any} */ (el).__picker;
    const ind = w && w.indEl;
    if (!w || !ind) return;
    const mid = Math.floor(w.displayed / 2);
    const rowH = w.itemHeight;
    ind.style.top = mid * rowH + 'px';
    ind.style.height = rowH + 'px';
    ind.style.left = (w.indicator.startMargin || 0) + 'px';
    ind.style.right = (w.indicator.endMargin || 0) + 'px';
    if (w.indicator.type === PickerIndicatorType.DIVIDER) {
      const sw = w.indicator.strokeWidth === undefined ? 2 : w.indicator.strokeWidth;
      ind.style.background = 'transparent';
      ind.style.borderTop = sw + 'px solid ' + colorOf(w.indicator.dividerColor === undefined || w.indicator.dividerColor === null ? UPX_IND_DIVIDER : w.indicator.dividerColor);
      ind.style.borderBottom = ind.style.borderTop;
      ind.style.borderRadius = '0';
    } else {
      ind.style.background = colorOf(w.indicator.backgroundColor === undefined || w.indicator.backgroundColor === null ? UPX_IND_BG : w.indicator.backgroundColor);
      ind.style.borderTop = 'none';
      ind.style.borderBottom = 'none';
      ind.style.borderRadius = (w.indicator.borderRadius === undefined || w.indicator.borderRadius === null ? 12 : upxLengthPx(w.indicator.borderRadius)) + 'px';
    }
    ind.style.boxSizing = 'border-box';
  };
  /**
   * 滚轮：在 wheelEl 里建 displayed 行（中行高亮、translateY 定位），步进后派发回调。
   * 视觉与 TextPicker 的 tpxEngine 同族（R56），但行数/行高可配且回调签名是 (index: number)。
   * @param {any} el
   */
  const upxBuildWheel = (el) => {
    const w = /** @type {any} */ (el).__picker;
    if (!w) return;
    const wheel = document.createElement('div');
    wheel.setAttribute('data-upx-wheel', '');
    wheel.style.flex = '1';
    wheel.style.position = 'relative';
    wheel.style.overflow = 'hidden';
    wheel.style.height = w.displayed * w.itemHeight + 'px';
    const inner = document.createElement('div');
    inner.style.position = 'absolute';
    inner.style.left = '0';
    inner.style.right = '0';
    inner.style.willChange = 'transform';
    const rows = /** @type {any[]} */ ([]);
    const mid = Math.floor(w.displayed / 2);
    for (let r = 0; r < w.displayed; r++) {
      const row = document.createElement('div');
      row.setAttribute('data-upx-row', String(r));
      row.style.height = w.itemHeight + 'px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'center';
      row.style.fontSize = r === mid ? '20px' : '16px';
      row.style.fontWeight = r === mid ? '500' : 'normal';
      row.style.color = r === mid ? 'rgb(0, 125, 255)' : 'rgb(24, 36, 49)';
      inner.appendChild(row);
      rows.push(row);
    }
    wheel.appendChild(inner);
    /** @param {number} dir */
    const step = (dir) => {
      const n = w.items.length;
      const next = Math.max(0, Math.min(n - 1, w.sel + dir));
      if (next === w.sel) return;                     // 边界：不动不发（canLoop 未实现）
      w.sel = next;
      render();
      el.dataset.selectedIndex = JSON.stringify([w.sel]);
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(w.sel); }
        catch (e) { layoutWarnings.push(`UIPickerComponent.onChange 回调抛错：${e && e.message}`); }
      }
      // onScrollStop：步进即"一小段滚动结束"，用短去抖近似（连续滚只发最后一次）
      if (w.stopTimer) clearTimeout(w.stopTimer);
      w.stopTimer = setTimeout(() => {
        const cb2 = w.cbs.stop;
        if (typeof cb2 === 'function') {
          try { cb2(w.sel); }
          catch (e) { layoutWarnings.push(`UIPickerComponent.onScrollStop 回调抛错：${e && e.message}`); }
        }
      }, 60);
    };
    const render = () => {
      for (let r = 0; r < w.displayed; r++) {
        const oi = w.sel - mid + r;
        rows[r].textContent = (oi >= 0 && oi < w.items.length) ? w.items[oi] : '';
      }
      inner.style.transform = `translateY(${(mid - w.sel) * w.itemHeight}px)`;
    };
    wheel.addEventListener('wheel', (e) => {
      e.preventDefault();
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    wheel.addEventListener('click', (e) => {
      const box = wheel.getBoundingClientRect();
      step(e.clientY < box.top + box.height / 2 ? -1 : 1);
    });
    w.render = render;
    w.step = step;
    return wheel;
  };
  /** pop 时收割子项（Tabs 模式）：节点挪进隐藏 stash 保留复用，标签取 textContent 重建滚轮 */
  /** @param {any} el */
  const upxFinalize = (el) => {
    const w = /** @type {any} */ (el).__picker;
    if (!w) return;
    // 收割：跳过指示器/滚轮/stash，其余直接子节点都是选项（Row 容器整体算一项）
    for (const kid of Array.from(el.children)) {
      const k = /** @type {any} */ (kid);
      if (k === w.indEl || k === w.stash || k.hasAttribute('data-upx-wheel')) continue;
      w.stash.appendChild(k);
      k.style.display = 'none';
    }
    w.items = Array.from(w.stash.children).map((/** @type {any} */ k) => k.textContent || '');
    if (!w.items.length) layoutWarnings.push('UIPickerComponent 内没有任何子组件，滚轮为空');
    if (w.canLoop && w.items.length >= 8) {
      layoutWarnings.push('UIPickerComponent canLoop=true：循环滚动未实现（当前按有界滚动处理）');
    }
    w.sel = Math.max(0, Math.min(w.items.length - 1, w.sel));
    let wheel = /** @type {any} */ (el.querySelector('[data-upx-wheel]'));
    if (wheel) wheel.remove();
    wheel = upxBuildWheel(el);
    if (wheel) el.insertBefore(wheel, w.stash);      // 滚轮在 stash（display:contents 不可见）之前
    w.render();
    upxApplyIndicator(el);
    el.dataset.selectedIndex = JSON.stringify([w.sel]);
    el.dataset.itemCount = String(w.items.length);
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const UIPICKER_ATTRS = {
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (w) w.cbs.change = v;
    },
    onScrollStop: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (w) w.cbs.stop = v;
    },
    canLoop: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      w.canLoop = v !== false;                       // undefined 按缺省 true（.d.ts JSDoc）
      n.dataset.canLoop = String(w.canLoop);
    },
    enableHapticFeedback: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      w.haptic = v !== false;
      n.dataset.hapticFeedback = String(w.haptic);   // 震动依赖硬件，DOM 侧只落语义标记
    },
    selectionIndicator: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      const s = v && typeof v === 'object' ? v : {};
      if (s.type !== undefined) w.indicator.type = Number(resolveResource(s.type));
      if (s.strokeWidth !== undefined) w.indicator.strokeWidth = upxLengthPx(s.strokeWidth);
      if (s.dividerColor !== undefined) w.indicator.dividerColor = s.dividerColor;
      if (s.startMargin !== undefined) w.indicator.startMargin = upxLengthPx(s.startMargin);
      if (s.endMargin !== undefined) w.indicator.endMargin = upxLengthPx(s.endMargin);
      if (s.backgroundColor !== undefined) w.indicator.backgroundColor = s.backgroundColor;
      if (s.borderRadius !== undefined) w.indicator.borderRadius = s.borderRadius;
      n.dataset.indicatorType = String(w.indicator.type);
      upxApplyIndicator(n);
    },
    itemHeight: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      const h = upxLengthPx(v);
      if (h > 0) w.itemHeight = h;
      n.dataset.itemHeight = String(w.itemHeight);
      upxApplyIndicator(n);
    },
    displayedItemCount: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      const c = Math.floor(Number(resolveResource(v)));
      if (Number.isFinite(c) && c >= 1) w.displayed = c;
      n.dataset.displayedItemCount = String(w.displayed);
      upxApplyIndicator(n);
    },
  };
  /** @param {any[]} args */
  const UIPickerComponent = ensureComponent('UIPickerComponent', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiPicker = true;
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__picker = /** @type {any} */ ({
      // selectedIndex 缺省 0；小数向下取整（.d.ts JSDoc 原文）
      sel: o.selectedIndex === undefined ? 0 : Math.max(0, Math.floor(Number(o.selectedIndex) || 0)),
      itemHeight: UPX_DEFAULT_ROW_H,
      displayed: UPX_DEFAULT_ROWS,
      canLoop: true,
      haptic: true,
      indicator: { type: PickerIndicatorType.BACKGROUND, strokeWidth: 2, dividerColor: undefined,
        startMargin: 0, endMargin: 0, backgroundColor: undefined, borderRadius: undefined },
      items: [], cbs: {}, stopTimer: null,
    });
    el.dataset.itemHeight = String(w.itemHeight);
    el.dataset.displayedItemCount = String(w.displayed);
    el.dataset.indicatorType = String(w.indicator.type);
    // 选中项指示器：绝对定位横带，滚轮建好后按 itemHeight/displayed 定位
    const ind = document.createElement('div');
    ind.setAttribute('data-upx-indicator', '');
    ind.style.position = 'absolute';
    ind.style.pointerEvents = 'none';
    el.appendChild(ind);
    w.indEl = ind;
    // 子项 stash：收割后的选项节点藏在这里（复用靠它——节点永不销毁）
    const stash = document.createElement('div');
    stash.setAttribute('data-upx-stash', '');
    stash.style.display = 'none';
    el.appendChild(stash);
    w.stash = stash;
    return el;
  }, (/** @type {any} */ node, /** @type {any[]} */ args) => {
    // 重渲染：create 选项里的 selectedIndex 变化 → 重定位（不发 onChange，与 TextPicker 同语义）
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : null;
    const w2 = node && node.__picker;
    if (!o || !w2 || o.selectedIndex === undefined) return;
    w2.sel = Math.max(0, Math.floor(Number(o.selectedIndex) || 0));
    if (w2.render) w2.render();
    node.dataset.selectedIndex = JSON.stringify([w2.sel]);
  });
  // pop 收尾：子组件此时才齐（Tabs 同款）。覆写实例 pop —— Proxy 无 set 陷阱，落到 target 上
  {
    const prevPop = UIPickerComponent.pop;
    /** @param {...any} args */
    UIPickerComponent.pop = function (...args) {
      const top = ViewStackProcessor.top();
      prevPop.apply(null, args);
      if (top && /** @type {any} */ (top).__arkuiPicker) upxFinalize(top);
    };
  }

  // ────────────────── R66 动效族 + 滚动条（7 件：Animator / ScrollBar / FrictionMotion /
  // ────────────────── ScrollMotion / SpringMotion / SpringProp / GeometryView）──────────
  //
  // SDK 依据（本机 26.0.0.821 SDK）：
  //   - build-tools/ets-loader/components/{animator,friction_motion,scroll_motion,
  //     spring_motion,spring_prop,geometryView,scroll_bar}.json —— 组件存在性与属性清单。
  //     前六者是 atomic 原子件（框架内部件）；ScrollBar 非 atomic（single:true），有公开 d.ts。
  //   - component/scroll_bar.d.ts —— ScrollBarInterface{ scroller: Scroller（必填）,
  //     direction?: ScrollBarDirection（默认 Vertical）, state?: BarState（默认 Auto）}；
  //     属性 enableNestedScroll(boolean)（API14）/ scrollBarColor(ColorMetrics)（API20，
  //     默认 ColorMetrics.numeric(0x66182431)=rgba(24,36,49,0.4)，仅无子组件时生效）；
  //     "child nodes define the behavior style of the scrollbar"（有子组件则子组件即滑块）；
  //     API12+ 无子组件时显示默认样式；与被绑容器方向一致才能滚动；一比一绑定。
  //   - api/@ohos.animator.d.ts —— AnimatorOptions{ duration/easing/delay/fill/direction/
  //     iterations/begin(默认0)/end(默认1) } + AnimatorResult{ play/pause/finish/cancel/
  //     reverse + onFrame(progress)/onFinish/onCancel/onRepeat/onPause/onStart }。
  //     ScrollBarDirection/PlayMode/FillMode 取值均按 .d.ts 声明顺序（Vertical=0/Horizontal=1；
  //     Normal=0..AlternateReverse=3——PlayMode 全局已有；None=0/Forwards=1/Backwards=2/Both=3）。
  //   - FrictionMotion / ScrollMotion / SpringMotion / SpringProp：atomic 且 attrs 为空，
  //     无公开 d.ts（滚动惯性的物理模型内部件）；GeometryView：atomic（几何转场载体）。
  //     DOM 侧没有可实现的公开语义——做惰性标记件，create 参数记 bag + data-*，
  //     供 Animator.motion 引用与测试探针。
  //
  // DOM 映射：
  //   Animator     → 不可见 div + setTimeout 逐帧引擎。R47 教训：不用 rAF（headless 虚拟时间
  //                  下不确定）；生命周期回调延时派发（state 属性先于 onStart 应用，同步发会丢）；
  //                  同值守卫防重渲染重置帧序（坑 88 同族）。state 取 AnimationStatus 口径
  //                  （Initial=0/Running=1/Paused=2/Stopped=3，与 R47 ImageAnimator 同空间；
  //                  atomic Animator 无公开 state 枚举，此处沿用运行时家族口径并注明）。
  //   ScrollBar    → 覆盖层 div（Stack 里 gridArea 1/1 自动叠放）+ 绝对定位滑块。
  //                  双向绑定 Scroller：观察目标容器 'scroll' 算滑块尺寸/位移；拖滑块反写
  //                  scrollTop（并同步派发 'scroll'，与 Scroller.scrollBy 同口径）。
  //                  防 _bind 抢绑：main.js:1045 的通用 create 绑定会把 scroller._el 抢成
  //                  滚动条自身——包装 _bind，滚动条绑定改记 __sbEl，不覆盖容器 _el。
  //   motion ×4 /  → display:none / display:contents 标记件（见上）。
  //   GeometryView
  //
  // ⚠️ 命名：ANIMATOR_ATTRS / __arkuiAnimator 已被 R47 ImageAnimator 占用（animator.js:18,52；
  //    area.js:281）——本片的 Animator 用 ANIM_COMP_ATTRS / __arkuiAnimComp，勿混。

  // ── Animator 逐帧引擎 ──────────────────────────────────────────────
  /** @type {number} */ const ANIM_FRAME_MS = 16;               // 帧步长（~60fps；setTimeout 确定性）
  /** @type {Record<string, (number[]|null)>} */
  const ANIM_EASE_PRESETS = {
    linear: null,
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  /** @type {Record<string, string>} */
  const ANIM_FILL_MODE_CSS = { 0: 'none', 1: 'forwards', 2: 'backwards', 3: 'both' };  // FillMode 声明序

  /** @param {number[]} b @param {number} x */
  const animBezierAt = (b, x) => {
    // 三次贝塞尔 y(x)：x 由 [x1,x2] 段二分解 t（24 轮收敛，确定性，无浮点库）
    /** @param {number} t @param {number} p1 @param {number} p2 */
    const axis = (t, p1, p2) => 3 * p1 * t * (1 - t) * (1 - t) + 3 * p2 * t * t * (1 - t) + t * t * t;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (axis(mid, b[0], b[2]) < x) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    return axis(t, b[1], b[3]);
  };

  /**
   * curve → 贝塞尔参数（null=线性）。输入可为 CSS 关键字 / cubic-bezier(...) 串 /
   * Curve 枚举数值（复用 R22 animCurveCss 归一，ICurve 对象在那里面已警告退化）。
   * @param {any} curve
   */
  const animParseEase = (curve) => {
    const css = animCurveCss(curve);
    if (css === 'linear') return null;
    if (ANIM_EASE_PRESETS[css] !== undefined) return ANIM_EASE_PRESETS[css];
    const m = css.match(/cubic-bezier\(([^)]*)\)/);
    if (m) {
      const nums = m[1].split(',').map((/** @type {string} */ s) => Number(s.trim()));
      if (nums.length === 4 && nums.every((/** @type {number} */ n) => !isNaN(n))) return nums;
    }
    return ANIM_EASE_PRESETS['ease'];                            // 未知关键字按 CSS 语义回落 ease
  };

  /** @param {any} w */
  const animForwardOf = (w) => {
    // PlayMode: Normal=0 Reverse=1 Alternate=2 AlternateReverse=3（animation.js:30）
    if (w.playMode === 1) return false;
    if (w.playMode === 2) return w.cycle % 2 === 0;
    if (w.playMode === 3) return w.cycle % 2 === 1;
    return true;
  };

  /** @param {any} w */
  const animStopTimer = (w) => { if (w.timer) { clearTimeout(w.timer); w.timer = null; } };

  /** @param {any} w @param {any} el @param {number} p */
  const animEmit = (w, el, p) => {
    w.last = p;
    el.dataset.animProgress = String(p);
    const cb = w.cbs.frame;
    if (typeof cb === 'function') {
      try { cb(p); }
      catch (e) { layoutWarnings.push(`Animator.onFrame 回调抛错：${e && e.message}`); }
    }
  };

  /** @param {any} w @param {any} el @param {string} name */
  const animFire = (w, el, name) => {
    // 延时派发：state 属性先于 onStart/onFinish 应用（产物顺序实测，R47 同坑），同步发会丢
    setTimeout(() => {
      const cb = w.cbs[name];
      if (typeof cb === 'function') {
        try { cb(); }
        catch (e) { layoutWarnings.push(`Animator.${name} 回调抛错：${e && e.message}`); }
      }
    }, 0);
  };

  /** @param {any} w @param {any} el */
  const animSchedule = (w, el) => {
    animStopTimer(w);
    if (w.state !== 1) return;
    w.timer = setTimeout(() => animTick(w, el), ANIM_FRAME_MS);
  };

  /** @param {any} w @param {any} el */
  const animTick = (w, el) => {
    w.timer = null;
    if (w.state !== 1) return;
    const now = Date.now();
    const total = now - w.t0 - w.delay;
    if (total < 0) {                                             // delay 期：不派发 onFrame（fill 由
      animSchedule(w, el); return;                               // fillMode 语义描述，无视觉载体）
    }
    const iter = Math.floor(total / w.duration);
    if (w.iterations !== Infinity && iter >= w.iterations) {     // 播完：落 Stopped，保持末值
      const lastIter = Math.max(0, w.iterations - 1);
      const fwdLast = w.playMode === 1 ? false
        : w.playMode === 2 ? lastIter % 2 === 0
          : w.playMode === 3 ? lastIter % 2 === 1 : true;
      w.cycle = lastIter;
      animEmit(w, el, fwdLast ? w.end : w.begin);
      w.state = 3;
      el.dataset.animState = '3';
      animFire(w, el, 'finish');
      return;
    }
    if (iter > w.cycle) { w.cycle = iter; animFire(w, el, 'repeat'); }
    const local = (total - iter * w.duration) / w.duration;
    const t = animForwardOf(w) ? local : 1 - local;
    const eased = w.ease ? animBezierAt(w.ease, t) : t;
    animEmit(w, el, w.begin + (w.end - w.begin) * eased);
    animSchedule(w, el);
  };

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const ANIM_COMP_ATTRS = {
    state: (n, v) => { const w = n.__anim; if (w && n.__animApplyState) n.__animApplyState(v); },
    duration: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const d = Number(resolveResource(v));
      if (d > 0) w.duration = d;          // ≤0 不落（@ohos 默认 0 会让引擎除零；沿用 R47 的 1000 兜底）
      n.dataset.duration = String(w.duration);
    },
    curve: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const css = animCurveCss(resolveResource(v));
      w.ease = animParseEase(css);
      n.dataset.curve = css;
    },
    delay: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      w.delay = Math.max(0, Number(resolveResource(v)) || 0);
      n.dataset.delay = String(w.delay);
    },
    fillMode: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const r = resolveResource(v);
      w.fill = typeof r === 'string' ? r : (ANIM_FILL_MODE_CSS[Number(r)] || 'forwards');
      n.dataset.fillMode = w.fill;
    },
    iterations: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const i = Number(resolveResource(v));
      w.iterations = i === -1 ? Infinity : (i >= 1 ? i : 1);
      n.dataset.iterations = i === -1 ? '-1' : String(w.iterations);
    },
    playMode: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      w.playMode = Number(resolveResource(v)) || 0;
      n.dataset.playMode = String(w.playMode);
    },
    motion: (n, v) => {
      // motion 接动效参数（物理模型件实例/参数对象）：只记录——DOM 无物理惯性引擎
      const w = n.__anim;
      if (!w) return;
      w.motion = v && v.__motionParams ? v.__motionParams : v;
      try { n.dataset.motion = JSON.stringify(w.motion); }
      catch { n.dataset.motion = String(w.motion); }
      layoutWarnings.push('Animator.motion 的物理惯性插值无 DOM 对应（参数记 data-*，不模拟）');
    },
    onStart: (n, v) => { const w = n.__anim; if (w) w.cbs.start = v; },
    onPause: (n, v) => { const w = n.__anim; if (w) w.cbs.pause = v; },
    onRepeat: (n, v) => { const w = n.__anim; if (w) w.cbs.repeat = v; },
    onCancel: (n, v) => { const w = n.__anim; if (w) w.cbs.cancel = v; },
    onFinish: (n, v) => { const w = n.__anim; if (w) w.cbs.finish = v; },
    onFrame: (n, v) => { const w = n.__anim; if (w) w.cbs.frame = v; },
  };

  const Animator = ensureComponent('Animator', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiAnimComp = 'Animator';
    el.dataset.animator = '';
    el.dataset.animState = '0';
    el.dataset.animProgress = '0';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__anim = /** @type {any} */ ({
      duration: o.duration > 0 ? Number(o.duration) : 1000,      // @ohos 默认 0；引擎兜底 1000（见上）
      delay: Math.max(0, Number(o.delay) || 0),
      ease: animParseEase(o.easing !== undefined ? o.easing : 'ease'),
      fill: ANIM_FILL_MODE_CSS[Number(o.fill)] || (typeof o.fill === 'string' ? o.fill : 'forwards'),
      playMode: Number(o.direction) || 0,                        // AnimatorOptions.direction ↔ PlayMode
      iterations: o.iterations === -1 ? Infinity : (Number(o.iterations) >= 1 ? Number(o.iterations) : 1),
      begin: o.begin != null ? Number(o.begin) : 0,              // @ohos.animator.d.ts:129 默认 0
      end: o.end != null ? Number(o.end) : 1,                    // 同上 :143 默认 1
      state: 0, started: false, cycle: 0, elapsed: 0, last: 0, t0: 0,
      timer: /** @type {any} */ null, motion: null,
      cbs: /** @type {any} */ ({}),
    });
    // state 属性可能先于回调注册应用（R47 同款包装），暴露 bag 供测试/复位直调
    (/** @type {any} */ (el)).__animApplyState = (/** @type {any} */ nv) => {
      nv = Number(resolveResource(nv));
      if (nv === w.state) return;                                // 重渲染同值 → 无操作（坑 88 同族）
      const prev = w.state;
      w.state = nv;
      el.dataset.animState = String(nv);
      if (nv === 1) {                                            // → Running
        if (!w.started) { w.started = true; animFire(w, el, 'start'); }
        w.t0 = Date.now() - w.elapsed;                           // Paused 恢复：从已走时间续播
        animSchedule(w, el);
      } else if (nv === 2) {                                     // → Paused：停表保持当前值
        if (prev === 1) {
          w.elapsed = Date.now() - w.t0;
          animStopTimer(w);
          animFire(w, el, 'pause');
        }
      } else if (nv === 3) {                                     // → Stopped：停表回初值
        animStopTimer(w);
        if (prev === 1) animFire(w, el, 'cancel');
        w.elapsed = 0; w.cycle = 0;
        el.dataset.animProgress = String(w.begin);
      } else {                                                   // → Initial：整体复位（重启再发 start）
        animStopTimer(w);
        w.elapsed = 0; w.cycle = 0; w.started = false; w.last = w.begin;
        el.dataset.animProgress = String(w.begin);
      }
    };
    return el;
  });

  // ── ScrollBar（scroll_bar.d.ts：唯一有公开 d.ts 的一件）────────────────
  const ScrollBarDirection = { Vertical: 0, Horizontal: 1 };     // 声明顺序（scroll_bar.d.ts:38,48）

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SCROLLBAR_ATTRS = {
    enableNestedScroll: (n, v) => {
      const w = n.__sbar;
      const on = !!resolveResource(v);
      if (w) w.nested = on;
      n.dataset.enableNestedScroll = String(on);                 // 默认 false（scroll_bar.d.ts:173）
    },
    scrollBarColor: (n, v) => {
      const c = colorOf(v);
      n.dataset.scrollBarColor = c;
      const th = n.__sbar && n.__sbar.thumb;
      if (th) th.style.background = c;                           // 仅无子组件时生效（d.ts:183）
    },
  };

  /** @param {any} w */
  const sbScheduleSync = (w) => {
    if (w.syncScheduled) return;
    w.syncScheduled = true;
    setTimeout(() => { w.syncScheduled = false; sbSync(w); }, 0);
  };

  /** @param {any} w */
  const sbEnsureDefaultThumb = (w) => {
    // API12+ 无子组件时的默认滑块样式（scroll_bar.d.ts:62；默认色 0x66182431 = :186）
    const el = w.el;
    const th = document.createElement('div');
    th.setAttribute('data-sb-thumb', 'default');
    th.style.position = 'absolute';
    th.style.pointerEvents = 'auto';                             // 只有滑块可拖（根覆盖层不收事件）
    th.style.borderRadius = '2px';
    th.style.background = 'rgba(24, 36, 49, 0.4)';
    if (w.dir !== ScrollBarDirection.Horizontal) {
      th.style.width = '4px'; th.style.right = '0'; th.style.top = '0';
    } else {
      th.style.height = '4px'; th.style.bottom = '0'; th.style.left = '0';
    }
    el.appendChild(th);
    return th;
  };

  /** @param {any} w */
  const sbSync = (w) => {
    const el = w.el;
    if (!el || !el.isConnected) return;
    const vert = w.dir !== ScrollBarDirection.Horizontal;
    // 子组件滑块模式：排除我方默认滑块后的首个元素子节点（d.ts："single child component"）
    const kids = /** @type {any[]} */ (Array.prototype.filter.call(
      el.children, (/** @type {any} */ c) => c.getAttribute && c.getAttribute('data-sb-thumb') === null));
    const userThumb = kids.length ? /** @type {any} */ (kids[0]) : null;
    let thumb = userThumb;
    if (!thumb) {
      thumb = /** @type {any} */ (el.querySelector('[data-sb-thumb="default"]') || sbEnsureDefaultThumb(w));
    }
    if (userThumb) {
      if (!w.userPrepared) {                                     // 子组件即滑块：绝对定位 + 沿轴位移
        w.userPrepared = true;
        userThumb.style.position = 'absolute';
        userThumb.style.pointerEvents = 'auto';
        if (vert) { userThumb.style.right = '0'; userThumb.style.top = '0'; }
        else { userThumb.style.left = '0'; userThumb.style.bottom = '0'; }
      }
    } else if (w.thumb !== thumb) {
      w.thumb = thumb;                                           // 记住默认滑块（scrollBarColor 生效对象）
    }
    const target = w.scroller ? w.scroller._el : null;
    if (!target) {                                               // 未绑到可滚容器：滑块停在起点
      el.dataset.sbTarget = 'none';
      el.style.opacity = w.state === 0 ? '0' : '1';
      thumb.style.transform = vert ? 'translateY(0px)' : 'translateX(0px)';
      return;
    }
    // 'scroll' 观察只挂一次（换绑才重挂——Scroller._el 理论上不换，防御性）
    if (w.listened !== target) {
      if (w.listened && w.onScrollEv) w.listened.removeEventListener('scroll', w.onScrollEv);
      w.listened = target;
      w.onScrollEv = () => sbScheduleSync(w);
      target.addEventListener('scroll', w.onScrollEv);
    }
    const cs = getComputedStyle(target);
    const canV = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    const canH = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    if (!w.warned && ((vert && !canV && canH) || (!vert && !canH && canV))) {
      w.warned = true;                                           // 方向不一致：真机不可滚动（d.ts:57）
      layoutWarnings.push('ScrollBar.direction 与被绑容器滚动轴不一致：真机语义下无法滚动该容器');
    }
    const scrollSize = vert ? target.scrollHeight : target.scrollWidth;
    const clientSize = vert ? target.clientHeight : target.clientWidth;
    const pos = vert ? target.scrollTop : target.scrollLeft;
    el.dataset.sbTarget = vert ? 'v' : 'h';
    // 轨道长 = 自身主轴长；未布局（clientHeight 还没量出来）时回落到被绑视口长——
    // ScrollBar 常与 Scroll 同尺寸叠放（Stack gridArea 1/1），两者口径一致
    const trackLen = vert
      ? (el.clientHeight || target.clientHeight)
      : (el.clientWidth || target.clientWidth);
    if (!(scrollSize > clientSize) || trackLen <= 0) {           // 无可滚内容：真机不显示滚动条
      el.style.opacity = '0';
      el.dataset.sbOverflow = '0';
      return;
    }
    el.dataset.sbOverflow = '1';
    // 可见性：Off=0 常隐；On=2 常显；Auto=1 滚动时显、静默 600ms 淡出（d.ts:64 BarState 口径）
    if (w.state === 0) el.style.opacity = '0';
    else if (w.state === 2) el.style.opacity = '1';
    else {
      el.style.opacity = '1';
      if (w.hideTimer) clearTimeout(w.hideTimer);
      w.hideTimer = setTimeout(() => { if (w.state === 1) el.style.opacity = '0'; }, 600);
    }
    const maxScroll = scrollSize - clientSize;
    const ratio = maxScroll > 0 ? pos / maxScroll : 0;
    let thumbLen = vert ? thumb.offsetHeight : thumb.offsetWidth;
    if (!thumbLen) thumbLen = Math.max(24, Math.round(trackLen * clientSize / scrollSize));
    const offset = Math.round(ratio * Math.max(0, trackLen - thumbLen));
    thumb.style.transform = vert ? `translateY(${offset}px)` : `translateX(${offset}px)`;
    el.dataset.sbOffset = String(offset);
  };

  /** @param {any} w */
  const sbBindDrag = (w) => {
    const el = w.el;
    // 拖滑块反写容器滚动（真机 ScrollBar 可交互；事件口径与 Scroller.scrollBy 一致：改完即派发）
    el.addEventListener('pointerdown', (/** @type {any} */ ev) => {
      const th = /** @type {any} */ (ev.target);
      if (!th || th.parentNode !== el) return;                   // 只有滑块可拖（默认或用户子组件）
      const target = w.scroller ? w.scroller._el : null;
      if (!target) return;
      const vert = w.dir !== ScrollBarDirection.Horizontal;
      const scrollSize = vert ? target.scrollHeight : target.scrollWidth;
      const clientSize = vert ? target.clientHeight : target.clientWidth;
      const trackLen = vert ? el.clientHeight : el.clientWidth;
      const thumbLen = vert ? th.offsetHeight : th.offsetWidth;
      const maxScroll = Math.max(0, scrollSize - clientSize);
      const travel = Math.max(1, trackLen - thumbLen);
      const startPos = vert ? target.scrollTop : target.scrollLeft;
      const startPt = vert ? ev.clientY : ev.clientX;
      ev.preventDefault();
      /** @param {any} mv */
      const onMove = (mv) => {
        const delta = (vert ? mv.clientY : mv.clientX) - startPt;
        const val = startPos + (delta * maxScroll / travel);
        if (vert) target.scrollTop = val; else target.scrollLeft = val;
        target.dispatchEvent(new Event('scroll'));
      };
      /** @return {void} */
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  };

  const ScrollBar = ensureComponent('ScrollBar', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiScrollBar = true;
    el.dataset.scrollBar = '';
    el.style.position = 'relative';
    el.style.pointerEvents = 'none';                             // 覆盖层不挡内容；滑块单独放开
    el.style.transition = 'opacity 0.2s';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__sbar = /** @type {any} */ ({
      el,
      scroller: o.scroller && typeof o.scroller._bind === 'function' ? o.scroller : null,
      dir: Number(resolveResource(o.direction != null ? o.direction : 0)) || 0,   // 默认 Vertical
      state: o.state != null ? Number(resolveResource(o.state)) : 1,              // 默认 BarState.Auto
      nested: false, warned: false, userPrepared: false, syncScheduled: false,
      thumb: /** @type {any} */ null, hideTimer: /** @type {any} */ null,
      listened: /** @type {any} */ null, onScrollEv: /** @type {any} */ null,
    });
    // _bind 抢绑防护：main.js:1045 对 {scroller} 选项的通用绑定会把 scroller._el 覆盖成
    // 滚动条自身——滚动条要"观察"容器而不是"成为"容器。包装后：滚动条绑定记 __sbEl，
    // 容器绑定照旧走原型方法（晚建 Scroll 也能补首同步）。
    if (w.scroller && !w.scroller.__sbBindWrapped) {
      w.scroller.__sbBindWrapped = true;
      const protoBind = /** @type {any} */ (Object.getPrototypeOf(w.scroller))._bind;
      /** @param {any} target */
      w.scroller._bind = (target) => {
        if (target && target.__arkuiScrollBar) {
          w.scroller.__sbEl = target;
          sbScheduleSync(w);
          return;
        }
        protoBind.call(w.scroller, target);
        sbScheduleSync(w);
      };
    }
    sbBindDrag(w);
    // 首同步延后一拍：等 builder 子组件/容器尺寸就绪（headless 下 setTimeout 确定性）
    sbScheduleSync(w);
    return el;
  });

  // ── 物理动效四件 + GeometryView（atomic 原子件：无公开 d.ts/attrs）──────
  /**
   * 惰性标记件：create 参数记 bag（__motionParams，供 Animator.motion 取用）+ data-*。
   * @param {string} kind @param {any[]} args
   */
  const buildMotionEl = (kind, args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiMotion = kind;
    el.dataset[kind] = '';
    el.style.display = 'none';                                   // 内部件：不参与布局、不可见
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : null;
    const params = o ? Object.assign({}, o)
      : (args || []).filter((/** @type {any} */ a) => a !== undefined).map((/** @type {any} */ a) => Number(a));
    (/** @type {any} */ (el)).__motionParams = params;
    try { el.dataset.motionParams = JSON.stringify(params); }
    catch { el.dataset.motionParams = String(params); }
    return el;
  };

  const FrictionMotion = ensureComponent('FrictionMotion', (args) => buildMotionEl('frictionMotion', args));
  const ScrollMotion = ensureComponent('ScrollMotion', (args) => buildMotionEl('scrollMotion', args));
  const SpringMotion = ensureComponent('SpringMotion', (args) => buildMotionEl('springMotion', args));
  const SpringProp = ensureComponent('SpringProp', (args) => buildMotionEl('springProp', args));

  const GeometryView = ensureComponent('GeometryView', () => {
    // 几何转场载体：display:contents —— 自身零布局参与，转场作用在其包裹的内容上
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiGeometryView = true;
    el.dataset.geometryView = '';
    el.style.display = 'contents';
    return el;
  });

  // ────────── 批量功能组件（R66）：Calendar / ContainerReader / IndicatorComponent /
  // MenuItemGroup / Repeat / WithTheme ──────────
  //
  // 权威来源：
  //   Repeat           component/repeat.d.ts（Repeat(arr) → .each/.key/.template/.templateId/
  //                    .virtualScroll；each 是必填；templateId 未命中任何 template 时回落 each）
  //   WithTheme        component/with_theme.d.ts（WithThemeOptions {theme?, colorMode?}；
  //                    ThemeColorMode：SYSTEM=0 / LIGHT=1 / DARK=2，common.d.ts:6808）
  //   MenuItemGroup    component/menu_item_group.d.ts（MenuItemGroupOptions {header?, footer?}，
  //                    header/footer: ResourceStr | CustomBuilder；子组件只有 MenuItem）
  //   IndicatorComponent component/indicatorcomponent.d.ts（create(controller?) + initialIndex/
  //                    count/style/loop/vertical/onChange + IndicatorComponentController）
  //   ContainerReader  api/@ohos.arkui.components.ContainerReader.d.ts（create({size,
  //                    widthBreakpoint?, heightBreakpoint?}) + .breakpointConfig({width?[], height?[]})）
  //   Calendar         【无 d.ts】——本 SDK 只发布了 CalendarPicker；Calendar 是 systemApi 老组件，
  //                    声明文件未随 SDK 发布（component/index-full.d.ts 引用 ./calendar.d.ts 但文件
  //                    缺失）。属性面取自 ets-loader/components/calendar.json（date/showLunar/
  //                    startOfWeek/offDays/onSelectChange/onRequestData/currentData/preData/
  //                    nextData/needSlide/showHoliday/direction + 五个样式对象）；无权威文本的
  //                    语义（onRequestData 入参、CalendarDay 结构）按字段名近似，见各 handler 注释。
  //
  // 产物形态（ets-loader lib/process_component_build.js：recurseRepeatExpression 会给 Repeat
  // 调用追加 this 实参；其余按 component_map 通用 create/attr 形态）：
  //   Repeat.create(this.arr, this); Repeat.each((ri) => {…}); Repeat.key((item, i) => …);
  //     Repeat.templateId(fn)?; Repeat.template('t', (ri) => {…})?; Repeat.virtualScroll({...})?;
  //   Repeat.pop();
  //   WithTheme.create({ colorMode: 1 }); …子组件…; WithTheme.pop();
  //   MenuItemGroup.create({ header: '组一' }); …MenuItem…; MenuItemGroup.pop();
  //   IndicatorComponent.create(this.ctrl); IndicatorComponent.count(3); …; IndicatorComponent.pop();
  //   ContainerReader.create({ size: { width: 700, height: 500 } }); …; ContainerReader.pop();
  //
  // DOM 策略：
  //   Repeat/WithTheme 是"逻辑容器"——Repeat 用 display:contents（同 ForEach，不引入盒子）；
  //   WithTheme 用真块级盒（color-scheme 要作用到后代原生控件）。Item 渲染走 microtask 批处理：
  //   属性方法在首渲染与每次重渲染都会重放（updateFunc 重跑），而 pop() 只在 initialRender 出现，
  //   所以渲染触发点放【属性应用】上（同 ForEach 把 forEachUpdateFunction 放 updateFunc 内的思路），
  //   用 scheduled 标记去重、lastSig 快照去重（数组没变就不重建）。

  // ════════════════════ Repeat ════════════════════
  /** @param {any[]} prev @param {any[]} next @param {number} n */
  const repeatSigSame = (prev, next, n) => prev.length === n && next.length >= n
    && prev.every((/** @type {any} */ v, /** @type {number} */ k) => Object.is(v, next[k]));

  /** @param {any} st */
  function repeatSchedule(st) {
    if (st.scheduled) return;
    st.scheduled = true;
    Promise.resolve().then(() => {
      st.scheduled = false;
      repeatRender(st);
    });
  }

  /** @param {any} st */
  function repeatRender(st) {
    // virtualScroll 的总数语义（repeat.d.ts VirtualScrollOptions JSDoc）：
    //   totalCount ∈ (0, 数据源长度] → 只渲染 [0, totalCount-1]；=0 → 不渲染；
    //   缺省/非法 → 数据源长度。onTotalCount() 与 totalCount 二选一，前者优先。
    let total = st.arr.length;
    if (st.vs && typeof st.vs === 'object') {
      let want = null;
      if (typeof st.vs.onTotalCount === 'function') {
        try { want = Number(st.vs.onTotalCount()); } catch (e) {
          warnOnce('Repeat.virtualScroll.onTotalCount 抛错：' + (e && e.message));
        }
      } else if (st.vs.totalCount !== undefined) {
        want = Number(st.vs.totalCount);
      }
      if (want !== null && Number.isFinite(want) && want >= 0) total = Math.min(total, Math.floor(want));
      if (!st.warnedVs) {
        st.warnedVs = true;
        // 如实：DOM 运行时不做真·懒加载（onLazyLoading 没有触发源——本实现从不渲染
        // 超出数据源的项），只保留 totalCount 的"裁剪渲染条数"语义。
        layoutWarnings.push('Repeat.virtualScroll 未实现真懒加载：onLazyLoading 不会触发，'
          + 'totalCount/onTotalCount 仅用于裁剪渲染条数');
      }
    }
    const n = Math.max(0, Math.min(st.arr.length, total));
    if (st.lastSig && repeatSigSame(st.lastSig, st.arr, n)) return;
    st.lastSig = st.arr.slice(0, n);

    st.el.textContent = '';
    purgeDetachedRecords();
    let rendered = 0;
    for (let i = 0; i < n; i++) {
      const item = st.arr[i];
      let b = st.eachB;
      if (st.templateIdFn) {
        let t = null;
        try { t = st.templateIdFn(item, i); } catch (e) {
          warnOnce('Repeat.templateId 抛错：' + (e && e.message));
        }
        if (t !== undefined && t !== null && st.templates[String(t)]) b = st.templates[String(t)];
      }
      if (typeof b !== 'function') {
        if (!st.warnedEach) {
          st.warnedEach = true;
          // repeat.d.ts："The each property is mandatory. If it is omitted, runtime errors
          // will occur." —— 真机直接报错；这里降级为警告 + 跳过该项，其余项照常渲染。
          layoutWarnings.push('Repeat 缺少 .each 构建器（必填），未命中模板的项不会渲染');
        }
        continue;
      }
      // repeat.d.ts：itemGenerator 收到 RepeatItem {item, index}，且【不要解构】（保持可观测）
      const ri = { item, index: i };
      runBuilderInto(st.el, () => b(ri), 'Repeat.item' + i);
      rendered++;
    }
    st.el.dataset.repeatCount = String(rendered);
  }

  // repeat.json 属性面：each/key/onMove/template/templateId/virtualScroll。
  // 注意 main.js 通用代理只把 attr 前两个实参透传给 applyAttr（args[0]→v、args[1]→opts），
  // 所以 template(type, itemBuilder, templateOptions?) 的【第三个参 cachedCount 到不了这里】
  // ——如实记录：TemplateOptions.cachedCount 是缓存池容量（纯性能参数，不影响行为）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const REPEAT_ATTRS = {
    each: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.eachB = typeof v === 'function' ? v : null;
      repeatSchedule(st);
    },
    key: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.keyFn = typeof v === 'function' ? v : null;
      // 键生成器只服务 diff 复用；本实现是"数组变了整体重建"（同 ForEach 基线），键不参与
      n.dataset.key = typeof v === 'function' ? 'custom' : 'default';
    },
    template: (n, v, opts) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.templates[String(v)] = typeof opts === 'function' ? opts : null;
      repeatSchedule(st);
    },
    templateId: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.templateIdFn = typeof v === 'function' ? v : null;
      repeatSchedule(st);
    },
    virtualScroll: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.vs = v && typeof v === 'object' ? v : null;
      n.dataset.virtualScroll = st.vs ? 'on' : 'off';
      repeatSchedule(st);
    },
    onMove: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.onMove = typeof v === 'function' ? v : null;
      n.dataset.onMove = st.onMove ? 'registered' : 'none';
      if (st.onMove && !st.warnedMove) {
        st.warnedMove = true;
        // 如实：DOM 垫片没有列表拖拽排序的触发源（ArkUI 的拖拽排序由容器拖拽手势驱动），
        // 回调只登记、不由本实现派发。
        layoutWarnings.push('Repeat.onMove 已登记，但本实现没有拖拽排序触发源，回调不会被派发');
      }
    },
  };

  /** @param {any[]} args */
  const Repeat = ensureComponent('Repeat', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiRepeat = true;
    el.setAttribute('data-arkui-repeat', '');
    el.style.display = 'contents';              // 逻辑容器：不引入盒子（同 ForEach）
    const st = /** @type {any} */ (el).__repeat = /** @type {any} */ ({
      el,
      arr: args && Array.isArray(args[0]) ? args[0] : [],
      eachB: null, keyFn: null, templateIdFn: null,
      /** @type {Record<string, any>} */ templates: {},
      vs: null, onMove: null,
      scheduled: false, lastSig: null,
      warnedEach: false, warnedVs: false, warnedMove: false,
    });
    return st.el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    // 重渲染：Repeat.create(arr, this) 重放 → 只更新数据源；构建器由属性重放重新登记
    const st = (/** @type {any} */ (node)).__repeat;
    if (!st) return;
    st.arr = args && Array.isArray(args[0]) ? args[0] : [];
    repeatSchedule(st);
  });

  // ════════════════════ WithTheme ════════════════════
  /** @param {HTMLElement} el @param {any} o @returns {any} */
  function applyWithThemeOptions(el, o) {
    const anyEl = /** @type {any} */ (el);
    if (!o || typeof o !== 'object') return anyEl.__wtheme;
    const st = anyEl.__wtheme || (anyEl.__wtheme = /** @type {any} */ ({
      colorMode: 0, hasTheme: false, warnedTheme: false,
    }));
    if (o.colorMode !== undefined) {
      // ThemeColorMode：SYSTEM=0 / LIGHT=1 / DARK=2（common.d.ts:6808 起）
      const m = Number(resolveResource(o.colorMode)) || 0;
      st.colorMode = m;
      el.dataset.colorMode = String(m);
      // DOM 对应物：CSS color-scheme 作用域（后代原生控件的浅/深色默认皮肤随之切换）
      el.style.colorScheme = m === 2 ? 'dark' : (m === 1 ? 'light' : '');
    }
    if (o.theme !== undefined) {
      st.hasTheme = o.theme !== null;
      el.dataset.theme = st.hasTheme ? 'custom' : 'none';
      if (st.hasTheme && !st.warnedTheme) {
        st.warnedTheme = true;
        // 如实：CustomTheme 是令牌表（@ohos.arkui.theme），没有到 CSS 变量的映射，只记录
        layoutWarnings.push('WithTheme({theme}) 的 CustomTheme 令牌未映射到 DOM（仅记录 data-theme）；'
          + 'colorMode 生效');
      }
    }
    return st;
  }

  /** @param {any[]} args */
  const WithTheme = ensureComponent('WithTheme', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiWithTheme = true;
    el.dataset.withTheme = '';
    el.style.display = 'block';
    applyWithThemeOptions(el, args && args[0]);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => { applyWithThemeOptions(node, args && args[0]); });

  // ════════════════════ MenuItemGroup ════════════════════
  // header/footer: ResourceStr | CustomBuilder（menu_item_group.d.ts）。真机序是
  // header → items → footer（同 ListItemGroup）；items 由框架在 create..pop 之间 appendChild，
  // 会排在【DOM 里最后】的 footerWrap 之后 → 给 footerWrap 设 flex order:1（header/items 缺省 0，
  // DOM 序先行），视觉序仍是 header → items → footer。
  /** @param {HTMLElement} slot @param {any} v @param {string} what */
  function applyMigSlot(slot, v, what) {
    if (typeof v === 'function') {
      runBuilderInto(slot, v, 'MenuItemGroup.' + what);
      return;
    }
    slot.textContent = String(resolveResource(v));
  }

  /** @param {any[]} args */
  const MenuItemGroup = ensureComponent('MenuItemGroup', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiMenuItemGroup = true;
    el.dataset.menuItemGroup = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    const st = /** @type {any} */ (el).__mig = /** @type {any} */ ({ header: null, footer: null });
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.header !== undefined) st.header = o.header;
    if (o.footer !== undefined) st.footer = o.footer;
    const headerWrap = document.createElement('div');
    headerWrap.setAttribute('data-arkui-mig-header', '');
    el.appendChild(headerWrap);
    if (st.header !== null) applyMigSlot(headerWrap, st.header, 'header');
    const footerWrap = document.createElement('div');
    footerWrap.setAttribute('data-arkui-mig-footer', '');
    footerWrap.style.order = '1';
    el.appendChild(footerWrap);
    if (st.footer !== null) applyMigSlot(footerWrap, st.footer, 'footer');
    return el;
  });

  // ════════════════════ IndicatorComponent ════════════════════
  // 指示器条（indicatorcomponent.d.ts，since 15）：create(controller?)；属性 initialIndex/count/
  // style/loop/vertical/onChange；控制器 showNext/showPrevious/changeIndex(i, useAnimation?)。
  // DOM：一排圆点（flex row/column）；活动点由 loop 决定越界回卷或停在边界（同 Swiper 基线）。
  let indicSeq = 0;

  class IndicatorComponentController {
    constructor() {
      /** @type {number} */ this._id = ++indicSeq;
      /** @type {any} */ this._state = null;
    }
    showNext() { return indicStep(this._state, 1); }
    showPrevious() { return indicStep(this._state, -1); }
    /** @param {number} i @param {boolean=} [useAnimation] */
    changeIndex(i, useAnimation) {
      if (useAnimation === true) {
        warnOnce('IndicatorComponentController.changeIndex(useAnimation=true)：无动画实现，已忽略动画');
      }
      return indicStep(this._state, 0, Number(i));
    }
  }

  /** @param {any} st @param {any} ctl */
  function bindIndicController(st, ctl) {
    if (!ctl || typeof ctl !== 'object') return;
    if (typeof ctl.showNext !== 'function') {
      layoutWarnings.push('IndicatorComponent.create 的参数不是 IndicatorComponentController');
      return;
    }
    if (ctl._state && ctl._state !== st) {
      layoutWarnings.push('同一个 IndicatorComponentController 被绑定到多个 IndicatorComponent（后绑定的生效）');
    }
    ctl._state = st;
    st.controller = ctl;
  }

  /** @param {any} st @param {number} delta @param {number=} [absolute] */
  function indicStep(st, delta, absolute) {
    if (!st) {
      layoutWarnings.push('IndicatorComponentController 尚未绑定到任何 IndicatorComponent');
      return false;
    }
    const n = st.count;
    if (!n) {
      layoutWarnings.push('IndicatorComponent.count 为 0，无法切换指示点');
      return false;
    }
    let next = (absolute !== undefined) ? absolute : st.index + delta;
    if (st.loop) next = ((next % n) + n) % n;
    return indicSetActive(st, next, true);
  }

  /** @param {any} st @param {number} i @param {boolean} fire */
  function indicSetActive(st, i, fire) {
    const n = st.count;
    let idx = Number(i);
    if (!st.loop && (idx < 0 || idx >= n)) {
      layoutWarnings.push(`IndicatorComponent 切换越界（index=${i}，count=${n}，loop=false）`);
      return false;
    }
    if (st.loop) idx = ((idx % n) + n) % n;
    st.index = idx;
    st.dots.forEach((/** @type {any} */ d, /** @type {number} */ k) => {
      d.setAttribute('data-indic-active', k === idx ? 'true' : 'false');
    });
    if (fire) {
      const cb = st.cbs.change;
      if (typeof cb === 'function') {
        try { cb(idx); } catch (e) { layoutWarnings.push(`IndicatorComponent.onChange 抛错：${e && e.message}`); }
      }
    }
    return true;
  }

  /** @param {any} st */
  function indicRender(st) {
    const el = st.el;
    el.textContent = '';
    st.dots = [];
    for (let k = 0; k < st.count; k++) {
      const d = document.createElement('div');
      d.setAttribute('data-indic-dot', String(k));
      d.setAttribute('data-indic-active', 'false');
      d.style.width = '8px';
      d.style.height = '8px';
      d.style.borderRadius = '50%';
      d.style.background = '#bbb';
      d.style.cursor = 'pointer';
      d.addEventListener('click', () => indicSetActive(st, k, true));
      el.appendChild(d);
      st.dots.push(d);
    }
    if (st.count) indicSetActive(st, st.index, false);
  }

  /** @param {any} st */
  function indicSchedule(st) {
    if (st.scheduled) return;
    st.scheduled = true;
    Promise.resolve().then(() => {
      st.scheduled = false;
      indicRender(st);
    });
  }

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const INDIC_ATTRS = {
    initialIndex: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.index = Math.max(0, Number(resolveResource(v)) || 0);
    },
    count: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (!st) return;
      st.count = Math.max(0, Math.floor(Number(resolveResource(v)) || 0));
      indicSchedule(st);
    },
    style: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (!st) return;
      n.dataset.style = 'custom';
      if (!st.warnedStyle) {
        st.warnedStyle = true;
        // 与 Swiper.indicator 同一口径：DotIndicator/DigitIndicator 的配置读不到，退化为默认圆点
        layoutWarnings.push('IndicatorComponent.style 只支持默认圆点；DotIndicator/DigitIndicator 的配置未实现');
      }
    },
    loop: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.loop = !!v;
      n.dataset.loop = String(!!v);
    },
    vertical: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.vertical = !!v;
      n.style.flexDirection = v ? 'column' : 'row';
      n.dataset.vertical = String(!!v);
    },
    onChange: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.cbs.change = v;
    },
  };

  /** @param {any[]} args */
  const IndicatorComponent = ensureComponent('IndicatorComponent', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiIndicator = true;
    el.dataset.indicator = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'center';
    el.style.gap = '8px';
    const st = /** @type {any} */ (el).__indic = /** @type {any} */ ({
      el, index: 0, count: 0, loop: false, vertical: false,
      cbs: {}, dots: [], controller: null,
      scheduled: false, warnedStyle: false,
    });
    bindIndicController(st, args && args[0]);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    const st = (/** @type {any} */ (node)).__indic;
    if (st) bindIndicController(st, args && args[0]);
  });

  // ════════════════════ ContainerReader ════════════════════
  // 容器断点读取（@ohos.arkui.components.ContainerReader.d.ts，since 26.0.0）：
  //   create({size:{width,height}, widthBreakpoint?, heightBreakpoint?}) + .breakpointConfig(
  //   {width?: number[], height?: number[]})。桶序 = 【不小于】阈值的连续个数（阈值升序）；
  //   未配置阈值时透传 create 里的 WidthBreakpoint/HeightBreakpoint 枚举值。
  /** @param {any[]} th @param {number} v @returns {number} */
  function creaderBucket(th, v) {
    const arr = [...th].sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    let i = 0;
    while (i < arr.length && v >= arr[i]) i++;
    return i;
  }

  /** @param {any} st */
  function creaderApply(st) {
    const w = (st.size && Number(st.size.width)) || 0;
    const h = (st.size && Number(st.size.height)) || 0;
    st.activeW = (st.cfg.width && st.cfg.width.length) ? creaderBucket(st.cfg.width, w) : st.widthBp;
    st.activeH = (st.cfg.height && st.cfg.height.length) ? creaderBucket(st.cfg.height, h) : st.heightBp;
    st.el.dataset.widthBp = String(st.activeW);
    st.el.dataset.heightBp = String(st.activeH);
  }

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CREADER_ATTRS = {
    breakpointConfig: (n, v) => {
      const st = (/** @type {any} */ (n)).__creader;
      if (!st) return;
      const o = v && typeof v === 'object' ? v : {};
      st.cfg.width = Array.isArray(o.width) ? o.width.map(Number) : [];
      st.cfg.height = Array.isArray(o.height) ? o.height.map(Number) : [];
      n.dataset.bpWidth = JSON.stringify(st.cfg.width);
      n.dataset.bpHeight = JSON.stringify(st.cfg.height);
      creaderApply(st);
    },
  };

  /** @param {any[]} args */
  const ContainerReader = ensureComponent('ContainerReader', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiCReader = true;
    el.dataset.containerReader = '';
    el.style.display = 'block';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const st = /** @type {any} */ (el).__creader = /** @type {any} */ ({
      el,
      size: o.size && typeof o.size === 'object' ? o.size : { width: 0, height: 0 },
      widthBp: Number(o.widthBreakpoint) || 0,
      heightBp: Number(o.heightBreakpoint) || 0,
      cfg: { width: [], height: [] },
      activeW: 0, activeH: 0,
    });
    creaderApply(st);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    // 重渲染：create({size}) 重放 → 只刷新 size 与断点（breakpointConfig 由属性重放重新应用）
    const st = (/** @type {any} */ (node)).__creader;
    if (!st) return;
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.size && typeof o.size === 'object') st.size = o.size;
    if (o.widthBreakpoint !== undefined) st.widthBp = Number(o.widthBreakpoint) || 0;
    if (o.heightBreakpoint !== undefined) st.heightBp = Number(o.heightBreakpoint) || 0;
    creaderApply(st);
  });

  // ════════════════════ Calendar（systemApi 老组件，无随包 d.ts）════════════════════
  // 属性面 = ets-loader/components/calendar.json。无权威文本处按字段名近似（已标注）：
  //   date：锚定月份 + 选中日（接受 Date/时间戳/'YYYY-MM-DD'）；
  //   startOfWeek：0=周日（getDay 口径）；offDays：休息日 weekday 数组；
  //   currentData：当月天数据（按 {year,month,day} 匹配标记，month 为 1 基的近似口径）；
  //   preData/nextData：相邻月数据，只记条数（本实现不显示相邻月格子）；
  //   onRequestData：挂载/翻月时回调 currentYearMonth（'YYYY-MM' 字符串——近似口径）；
  //   needSlide：显示 ‹ › 翻月按钮（真机是手势滑动，DOM 近似为按钮）；
  //   direction：Axis 竖排（周头条在上）/ 横排（周头条在左）；运行时全局 Axis 的取值是
  //     'vertical'/'horizontal' 字符串（layout.js），SDK 枚举是 0/1，两者都认。
  const CAL_WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  /** @param {any} v @returns {Date} */
  function calToDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const m = v.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
    }
    return new Date();
  }

  /** @param {Date} d @returns {string} */
  function calKeyOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** @param {Date} d @returns {string} */
  function calMonthKeyOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** @param {HTMLElement} c @param {any} s */
  function calApplyTextStyle(c, s) {
    if (!s || typeof s !== 'object') return;
    // CalendarDayStyle 近似字段面：dayColor/dayFontSize/dayFontWeight/dayFontFamily 作用到
    // 【公历】文本；lunarColor 等 Lunar 系字段没有对应渲染物（本实现不排农历），只落 data-*
    if (s.dayColor !== undefined) c.style.color = colorOf(s.dayColor);
    if (s.dayFontSize !== undefined) c.style.fontSize = toCssSize(s.dayFontSize);
    if (s.dayFontWeight !== undefined) c.style.fontWeight = String(resolveResource(s.dayFontWeight));
    if (s.dayFontFamily !== undefined) c.style.fontFamily = String(resolveResource(s.dayFontFamily));
    if (s.lunarColor !== undefined) (/** @type {any} */ (c)).__lunarColor = colorOf(s.lunarColor);
  }

  /** @param {any} st */
  function calSchedule(st) {
    if (st.scheduled) return;
    st.scheduled = true;
    Promise.resolve().then(() => {
      st.scheduled = false;
      calRender(st);
    });
  }

  /** @param {any} st */
  function calRender(st) {
    const el = st.el;
    const anchor = st.anchor;
    const y = anchor.getFullYear();
    const m = anchor.getMonth();

    // 头部：‹ YYYY-MM ›（needSlide=false 时隐藏按钮）
    const label = el.querySelector('[data-cal-month]');
    if (label) label.textContent = calMonthKeyOf(anchor);
    const prevBtn = el.querySelector('[data-cal-prev]');
    const nextBtn = el.querySelector('[data-cal-next]');
    if (prevBtn) (/** @type {HTMLElement} */ (prevBtn)).style.display = st.needSlide ? '' : 'none';
    if (nextBtn) (/** @type {HTMLElement} */ (nextBtn)).style.display = st.needSlide ? '' : 'none';

    // 周头条（按 startOfWeek 旋起）；横排方向时整条变竖列
    const weeksEl = /** @type {HTMLElement} */ (el.querySelector('[data-cal-weeks]'));
    weeksEl.textContent = '';
    weeksEl.style.display = st.horizontal ? 'flex' : 'grid';
    if (!st.horizontal) {
      weeksEl.style.gridTemplateColumns = 'repeat(7, 1fr)';
    }
    for (let k = 0; k < 7; k++) {
      const wd = (st.startOfWeek + k) % 7;
      const c = document.createElement('div');
      c.setAttribute('data-cal-week', String(wd));
      c.textContent = CAL_WEEK_CN[wd];
      c.style.textAlign = 'center';
      calApplyTextStyle(c, st.styles.weekStyle);
      weeksEl.appendChild(c);
    }

    // 日格：首列按 startOfWeek 对齐；前导补空位；选中/今天/休息日/已登记数据落 data-*
    const gridEl = /** @type {HTMLElement} */ (el.querySelector('[data-cal-grid]'));
    gridEl.textContent = '';
    gridEl.style.display = 'grid';
    gridEl.style.gridTemplateColumns = 'repeat(7, 1fr)';
    const first = new Date(y, m, 1);
    const lead = (first.getDay() - st.startOfWeek + 7) % 7;
    for (let p = 0; p < lead; p++) {
      const pad = document.createElement('div');
      pad.setAttribute('data-cal-pad', String(p));
      gridEl.appendChild(pad);
    }
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    const tKey = calKeyOf(today);
    // currentData 的标记索引（近似口径：{year,month,day}，month 为 1 基）
    /** @type {Record<string, any>} */
    const marks = {};
    for (const e of (st.dataCur || [])) {
      if (e && typeof e === 'object' && e.year !== undefined && e.day !== undefined) {
        const key = Number(e.year) + '-' + String(Number(e.month || (m + 1))).padStart(2, '0')
          + '-' + String(Number(e.day)).padStart(2, '0');
        marks[key] = e;
      }
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const key = calKeyOf(date);
      const c = document.createElement('div');
      c.setAttribute('data-cal-day', String(d));
      c.setAttribute('data-date', key);
      c.textContent = String(d);
      c.style.textAlign = 'center';
      c.style.cursor = 'pointer';
      const wd = date.getDay();
      if (st.offDays.indexOf(wd) >= 0) {
        c.setAttribute('data-off-day', 'true');
        calApplyTextStyle(c, st.styles.workStateStyle);
      } else {
        calApplyTextStyle(c, st.styles.currentDayStyle);
      }
      if (key === tKey) {
        c.setAttribute('data-today', 'true');
        calApplyTextStyle(c, st.styles.todayStyle);
      }
      if (st.selected && calKeyOf(st.selected) === key) c.setAttribute('data-selected', 'true');
      if (marks[key]) {
        c.setAttribute('data-marked', 'true');
        const mk = marks[key].mark || (marks[key].status && marks[key].status.mark);
        if (mk !== undefined && mk !== null) c.setAttribute('data-mark', String(mk));
      }
      c.addEventListener('click', () => {
        st.selected = date;
        calMarkSelection(st);
        const cb = st.cbs.select;
        if (typeof cb === 'function') {
          try { cb(new Date(y, m, d)); } catch (e) {
            layoutWarnings.push(`Calendar.onSelectChange 抛错：${e && e.message}`);
          }
        }
      });
      gridEl.appendChild(c);
    }
    el.dataset.currentCount = String(st.dataCur ? st.dataCur.length : 0);
    if (!st.requested) {
      st.requested = true;
      const cb = st.cbs.request;
      if (typeof cb === 'function') {
        try { cb(calMonthKeyOf(anchor)); } catch (e) {
          layoutWarnings.push(`Calendar.onRequestData 抛错：${e && e.message}`);
        }
      }
    }
  }

  /** @param {any} st */
  function calMarkSelection(st) {
    const gridEl = st.el.querySelector('[data-cal-grid]');
    if (!gridEl) return;
    const sel = st.selected ? calKeyOf(st.selected) : null;
    [...gridEl.children].forEach((/** @type {any} */ c) => {
      if (c.getAttribute('data-cal-day') === null) return;
      const on = sel !== null && c.getAttribute('data-date') === sel;
      if (on) c.setAttribute('data-selected', 'true');
      else c.removeAttribute('data-selected');
    });
  }

  /** @param {any} st @param {number} delta */
  function calShiftMonth(st, delta) {
    const a = st.anchor;
    st.anchor = new Date(a.getFullYear(), a.getMonth() + delta, 1);
    calRender(st);
    const cb = st.cbs.request;
    if (typeof cb === 'function') {
      try { cb(calMonthKeyOf(st.anchor)); } catch (e) {
        layoutWarnings.push(`Calendar.onRequestData 抛错：${e && e.message}`);
      }
    }
  }

  // 应用 create 选项 / 属性共用的入口（键面与 calendar.json 一致 + selected/lunar 等别名）
  /** @param {any} st @param {any} o */
  function applyCalOptions(st, o) {
    if (!o || typeof o !== 'object') return;
    if (o.date !== undefined || o.selected !== undefined) {
      const d = calToDate(o.date !== undefined ? o.date : o.selected);
      st.anchor = new Date(d.getFullYear(), d.getMonth(), 1);
      st.selected = d;
    }
    if (o.showLunar !== undefined) {
      st.showLunar = !!o.showLunar;
      if (st.showLunar && !st.warnedLunar) {
        st.warnedLunar = true;
        // 如实：农历换算没有实现，showLunar=true 只落标记、不排农历文本
        layoutWarnings.push('Calendar.showLunar 已记录，但本实现不排农历文本（无农历换算）');
      }
    }
    if (o.startOfWeek !== undefined) {
      st.startOfWeek = Math.min(6, Math.max(0, Math.floor(Number(resolveResource(o.startOfWeek)) || 0)));
    }
    if (o.offDays !== undefined) {
      st.offDays = Array.isArray(o.offDays) ? o.offDays.map((/** @type {any} */ x) => Number(x) % 7) : [];
    }
    if (o.onSelectChange !== undefined) st.cbs.select = o.onSelectChange;
    if (o.onRequestData !== undefined) st.cbs.request = o.onRequestData;
    if (o.currentData !== undefined) st.dataCur = Array.isArray(o.currentData) ? o.currentData : [];
    if (o.preData !== undefined) {
      st.el.dataset.preCount = String(Array.isArray(o.preData) ? o.preData.length : 0);
    }
    if (o.nextData !== undefined) {
      st.el.dataset.nextCount = String(Array.isArray(o.nextData) ? o.nextData.length : 0);
    }
    if (o.needSlide !== undefined) st.needSlide = !!o.needSlide;
    if (o.showHoliday !== undefined) {
      st.showHoliday = !!o.showHoliday;
      if (st.showHoliday && !st.warnedHoliday) {
        st.warnedHoliday = true;
        layoutWarnings.push('Calendar.showHoliday 已记录，但本实现无节假日数据，不显示节假日名');
      }
    }
    if (o.direction !== undefined) st.horizontal = isHorizontalAxis(o.direction);
    const styleKeys = ['currentDayStyle', 'nonCurrentDayStyle', 'todayStyle', 'weekStyle', 'workStateStyle'];
    for (const k of styleKeys) {
      if (o[k] !== undefined) st.styles[k] = o[k];
    }
    calSchedule(st);
  }

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CALGRID_ATTRS = {
    date: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { date: v });
    },
    showLunar: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { showLunar: v });
      n.dataset.showLunar = String(!!v);
    },
    startOfWeek: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { startOfWeek: v });
    },
    offDays: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { offDays: v });
    },
    onSelectChange: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) st.cbs.select = v;
    },
    onRequestData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) st.cbs.request = v;
    },
    currentData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { currentData: v });
    },
    preData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { preData: v });
    },
    nextData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { nextData: v });
    },
    needSlide: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) {
        st.needSlide = !!v;
        calSchedule(st);
      }
      n.dataset.needSlide = String(!!v);
    },
    showHoliday: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { showHoliday: v });
      n.dataset.showHoliday = String(!!v);
    },
    direction: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) {
        st.horizontal = isHorizontalAxis(v);
        n.dataset.direction = st.horizontal ? 'horizontal' : 'vertical';
        calSchedule(st);
      }
    },
    currentDayStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { currentDayStyle: v });
    },
    nonCurrentDayStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { nonCurrentDayStyle: v });
    },
    todayStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { todayStyle: v });
    },
    weekStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { weekStyle: v });
    },
    workStateStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { workStateStyle: v });
    },
  };

  /** @param {any[]} args */
  const Calendar = ensureComponent('Calendar', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiCalendar = true;
    el.dataset.calendar = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    const st = /** @type {any} */ (el).__calgrid = /** @type {any} */ ({
      el,
      anchor: new Date(),
      selected: null,
      startOfWeek: 0,
      offDays: [],
      showLunar: false, showHoliday: false, needSlide: true,
      horizontal: false,
      dataCur: [],
      styles: {},
      cbs: {},
      scheduled: false, requested: false,
      warnedLunar: false, warnedHoliday: false,
    });

    const head = document.createElement('div');
    head.setAttribute('data-cal-head', '');
    head.style.display = 'flex';
    head.style.flexDirection = 'row';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'center';
    head.style.gap = '8px';
    const prev = document.createElement('div');
    prev.setAttribute('data-cal-prev', '');
    prev.textContent = '‹';
    prev.style.cursor = 'pointer';
    prev.addEventListener('click', () => calShiftMonth(st, -1));
    const label = document.createElement('div');
    label.setAttribute('data-cal-month', '');
    const next = document.createElement('div');
    next.setAttribute('data-cal-next', '');
    next.textContent = '›';
    next.style.cursor = 'pointer';
    next.addEventListener('click', () => calShiftMonth(st, 1));
    head.appendChild(prev);
    head.appendChild(label);
    head.appendChild(next);
    el.appendChild(head);

    const body = document.createElement('div');
    body.setAttribute('data-cal-body', '');
    body.style.display = 'flex';
    body.style.flexDirection = 'row';
    body.style.gap = '4px';
    const weeks = document.createElement('div');
    weeks.setAttribute('data-cal-weeks', '');
    weeks.style.flex = 'none';
    const grid = document.createElement('div');
    grid.setAttribute('data-cal-grid', '');
    grid.style.flex = '1 1 auto';
    body.appendChild(weeks);
    body.appendChild(grid);
    el.appendChild(body);

    applyCalOptions(st, args && args[0]);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    const st = (/** @type {any} */ (node)).__calgrid;
    if (st) applyCalOptions(st, args && args[0]);
  });

  // ════════════════════ 安装全局 ════════════════════
  // 产物里这些名字是【自由变量】引用（不走 import）。registerGeneratedComponents 只给
  // 【生成骨架】装全局；手写组件如果只进 components 注册表而不上 global，页面一跑就是
  // ReferenceError —— 所以这里按 main.js Object.assign 的同一口径自己装上。
  (/** @type {any} */ (global)).Calendar = Calendar;
  (/** @type {any} */ (global)).ContainerReader = ContainerReader;
  (/** @type {any} */ (global)).IndicatorComponent = IndicatorComponent;
  (/** @type {any} */ (global)).IndicatorComponentController = IndicatorComponentController;
  (/** @type {any} */ (global)).MenuItemGroup = MenuItemGroup;
  (/** @type {any} */ (global)).Repeat = Repeat;
  (/** @type {any} */ (global)).WithTheme = WithTheme;

  // ── 由 tools/gen-components.mjs 生成的 149 个组件骨架 ──
  // 手写实现（上面那些，已被测试覆盖）优先；生成的只补缺口。
  // 骨架保证"能建出正确的 DOM 标签 + 基础样式"，精细化布局语义按需手补（见 docs）。
  let generatedRegistered = false;
  function registerGeneratedComponents() {
    const reg = (/** @type {any} */ (global)).__ARKUI_COMPONENTS;
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
      (/** @type {any} */ (global))[name] = comp;
      n++;
    }
    generatedRegistered = true;
    if (overwritten.length) {
      (/** @type {any} */ (global)).__arkui_dom_overwrittenGlobals = overwritten;
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
  // 为什么装饰器不挂 global：`Event` 既是装饰器名也是浏览器全局，挂上去会把 window.Event
  // 覆盖掉（test/lazy.html 等页面脚本在用 new Event）。R38 再进一步：IIFE 【内部】的装饰器
  // 绑定也不能叫 Event（会遮蔽 Scroller 的 new Event，见下方 EventDeco 处的说明）。
  // 改为导出装饰器表 __arkui_dom_decorators，
  // 由 tools/extract.mjs 在产物里生成【作用域内】的绑定前奏（只绑实际用到的名字）。

  const v2InstCells = new WeakMap();   // 任意对象 -> Map<字段名, 依赖单元>（复用 propDeps 机制）
  const v2ProtoMeta = new WeakMap();   // 原型 -> {observed, consumers, providers, monitors, computed}

  // 依赖单元的粒度是【实例 × 字段】。若按原型共享，同类多实例会互相触发多余重渲染。
  /** @param {any} inst @param {string} key */
  function v2Cell(inst, key) {
    let m = v2InstCells.get(inst);
    if (!m) v2InstCells.set(inst, (m = new Map()));
    let c = m.get(key);
    if (!c) m.set(key, (c = { __v2: true, __name: key }));
    return c;
  }

  /** @param {any} proto */
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
  /** @param {any} inst @param {(info: any, out: any[]) => void} pick @param {any[]=} [out] */
  function v2Collect(inst, pick, out = []) {
    for (let p = Object.getPrototypeOf(inst); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      const info = v2ProtoMeta.get(p);
      if (info) pick(info, out);
    }
    return out;
  }

  // 字段存储的隐藏槽。名字带前缀避免与产物的其它字段撞车。
  /** @param {string} key */
  const v2Slot = (key) => '__v2slot_' + key;

  /** @param {any} proto @param {string} key @param {string} kind */
  function installV2Accessor(proto, key, kind) {
    const existing = /** @type {any} */ (Object.getOwnPropertyDescriptor(proto, key));
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
    const d = /** @type {any} */ (Object.getOwnPropertyDescriptor(proto, key));
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
  /** @param {any} inst @param {string} key @param {any} value @param {any} before */
  function fireV2Monitors(inst, key, value, before) {
    const methods = v2Collect(inst, (info, out) => {
      const s = info.monitors.get(key);
      if (s) for (const m of s) out.push(m);
    });
    if (!methods.length) return;
    const entries = [{ path: key, now: value, before }];
    const monitor = {
      dirty: entries.map((e) => e.path),
      /** @param {string=} [path] */
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

  /** @param {string} kind */
  const v2Field = (kind) => function (/** @type {any} */ target, /** @type {any} */ key) {
    if (typeof key === 'string') installV2Accessor(target, key, kind);
    return undefined;                                  // 属性装饰器的返回值被 __decorate 忽略
  };

  const Param = v2Field('param');
  const Local = v2Field('local');
  const Once = v2Field('once');
  // ⚠️ 内部绑定名【不能】叫 Event：整个 runtime 是一个 IIFE，这里的 `const Event` 会把
  // 同作用域里 Scroller 的 `new Event('scroll')`（layout.js scrollToIndex 未渲染分支）一并
  // 遮蔽掉——IIFE 求值完成后那次 new 构造的是装饰器函数实例，dispatchEvent 直接 TypeError。
  // 该分支有 flush() 兜底所以 lazy.html 一直绿，炸点是潜伏的（R38 tsc --checkJs 抓出）。
  // 装饰器表的【键名】保持 'Event'（extract.mjs 给产物生成的作用域绑定按表键取，不受影响）。
  const EventDeco = v2Field('event');
  const Trace = v2Field('trace');

  /** @param {string=} [name] */
  const Provider = (name) => function (/** @type {any} */ target, /** @type {any} */ key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).providers.set(key, name || key);
    return undefined;
  };

  /** @param {string=} [name] */
  const Consumer = (name) => function (/** @type {any} */ target, /** @type {any} */ key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).consumers.set(key, name || key);
    return undefined;
  };

  /** @param {...string} keys */
  const Monitor = (...keys) => function (/** @type {any} */ target, /** @type {any} */ key, /** @type {any} */ desc) {
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
  /** @param {any} target @param {any} key @param {any} desc */
  function Computed(target, key, desc) {
    if (typeof key === 'string') {
      if (desc && typeof desc.get === 'function') v2Info(target).computed.add(key);
      else installV2Accessor(target, key, 'local');     // 容错：@Computed 用在字段上
    }
    return desc;
  }

  // @ObservedV2 是【类装饰器】：__decorate([ObservedV2], Cls) 只有 1 个实参，
  // 助手会当成"整体替换"处理，所以必须返回这个类本身。
  /** @param {any} target */
  function ObservedV2(target) {
    v2Info(target.prototype);
    return target;
  }

  class ViewV2 extends ViewPU {
    // 注意产物调用的是 super(parent, elmtId, extraInfo) —— 比 ViewPU 少一个
    // __localStorage。这里补上 undefined 以复用 ViewPU 的全部机制。
    /** @param {any} parent @param {number} elmtId @param {any} extraInfo */
    constructor(parent, elmtId, extraInfo) {
      super(parent, undefined, elmtId, extraInfo);
      this.__v2consumerBind = null;
    }

    // ── 产物契约：initParam / updateParam / resetParam ──
    /** @param {string} name @param {any} value */
    initParam(name, value) { (/** @type {any} */ (this))[name] = value; }
    /** @param {string} name @param {any} value */
    updateParam(name, value) { (/** @type {any} */ (this))[name] = value; }
    /** @param {string} name @param {any} value */
    resetParam(name, value) { (/** @type {any} */ (this))[name] = value; }

    /** @param {string} fieldKey @param {any} fallback */
    resetConsumer(fieldKey, fallback) {
      const provName = v2Collect(this, (info, out) => {
        const n = info.consumers.get(fieldKey);
        if (n) out.push(n);
      })[0] || fieldKey;
      // 直接写槽，绕过 setter（此刻尚未绑定，走 setter 会平白触发一次通知）
      if (fallback !== undefined && (/** @type {any} */ (this))[v2Slot(fieldKey)] === undefined) {
        (/** @type {any} */ (this))[v2Slot(fieldKey)] = fallback;
      }
      if (!this.__v2consumerBind) this.__v2consumerBind = new Map();
      this.bindConsumer(fieldKey, provName, true);
    }

    // 无缓存实现 → 无需失效；保留方法只为对齐产物契约
    /** @param {string=} [_name] */
    resetComputed(_name) {}
    resetMonitorsOnReuse() {}
    /** @param {any=} [_params] */
    resetStateVarsOnReuse(_params) {}

    /** @param {string} fieldKey @param {string} provName @param {boolean=} [quiet] */
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
        const inst = /** @type {any} */ (this);
        // 同时提供 get/set：这样 V1 的 @Consume（initializeConsume 期望拿到 prop 对象）
        // 也能消费 V2 的 @Provider，反之亦然。
        this.__providedVars.set(name, {
          __v2provider: true, inst, key,
          get() { return inst[key]; },
          set(/** @type {any} */ v) { inst[key] = v; },
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
    ViewV2, Param, Local, Once, Event: EventDeco, Monitor, Computed, Provider, Consumer, ObservedV2, Trace,
    Observed,
  };

  // ────────────────────── @ohos:* 模块别名层（④） ──────────────────────
  // 产物里的 `import X from "@ohos:xxx"` 经 CommonJS 转译后是 require("@ohos:xxx").default
  const ohosModules = new Map();
  /** @param {any} name @param {any} impl */
  function defineOhosModule(name, impl) {
    // 同时接受 @ohos:x 与 x 两种写法；require 返回 {default, ...impl} 以兼容 TS 的 default interop
    const ns = Object.assign({}, impl);
    ns.default = impl;
    ns.__esModule = true;
    ohosModules.set('@ohos:' + name, ns);
    ohosModules.set(name, ns);
  }
  /** @param {any} spec */
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
  /** @param {any} id @param {any} factory */
  function defineCommonJS(id, factory) { cjsModules.set(id, factory); }
  /** @param {any} id */
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
  /** @type {any[]} */
  const abilityStack = [];
  // @type 档位：history 不写会推成 never[]
  // @type 档位：history 不写会推成 never[]（属性位置的 JSDoc 在 TS4.9 不生效，整袋收）
  const abilityWindowStats = /** @type {any} */ ({ created: 0, closed: 0, history: [] });
  /** @type {any} */ let abilityClassForChildren = null;     // 同一进程内再起实例时用的类（不按 abilityName 路由）

  /** @param {any} rec */
  function abilityLog(rec) {
    ((/** @type {any} */ (global)).__arkui_dom_logs = (/** @type {any} */ (global)).__arkui_dom_logs || []).push(rec);
  }
  /** @param {number} code @param {string} message */
  function bizError(code, message) { return Object.assign(new Error(message), { code }); }
  const okRes = () => ({ code: 0, message: '' });

  /** @param {any} entry */
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

  /** @param {any} entry */
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
  /** @param {any} entry @param {() => any} fn */
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

  /** @param {any} entry */
  function makeWindowStage(entry) {
    return {
      /** @param {string} page @param {any} cb */
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
  /** @param {Promise<any>} promise @param {any=} [cb] */
  function withCallback(promise, cb) {
    if (typeof cb !== 'function') return promise;
    promise.then(
      (v) => Promise.resolve().then(() => cb(okRes(), v)),
      (e) => Promise.resolve().then(() => cb(bizError(e.code || 1, e.message), undefined)),
    );
    return undefined;
  }

  /** @param {any} want @param {any} parent @param {any=} [onResult] */
  function spawnChildAbility(want, parent, onResult) {
    if (!want || typeof want !== 'object') {
      throw bizError(401, 'startAbilityForResult: 缺少必填参数 want（BusinessError 401）');
    }
    const AbilityClass = abilityClassForChildren;
    if (typeof AbilityClass !== 'function') {
      throw bizError(16000001, '没有可启动的 ability：本运行时只会启动 '
        + '__arkui_dom_startAbility 注册的那个类（不按 want.abilityName 路由，见 docs 已知限制）');
    }
    // @type 档位：windowEl/context/ability 是 null↔对象 摆动（生命周期里先后赋值）
    const entry = /** @type {any} */ ({
      name: (want.abilityName !== undefined && want.abilityName !== null) ? String(want.abilityName) : AbilityClass.name,
      role: 'child', parent, rootEl: null, windowEl: null, pagePath: null,
      ability: null, context: null, terminated: false,
      pending: onResult ? [onResult] : [],   // 先登记结果接收者：子 ability 可能在自己的
    });                                      // 生命周期里【同步】就 terminateSelfWithResult
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
  /** @param {any} entry @param {any=} [parameter] */
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

  /** @param {any} entry */
  function makeAbilityContext(entry) {
    const appContext = {
      /** @param {any} mode */
      setColorMode(mode) { abilityLog({ t: 'setColorMode', mode }); },
      getApplicationContext() { return appContext; },
    };
    return {
      getApplicationContext: () => appContext,
      resourceManager: {
        /** @param {any} k */
        getStringSync: (k) => k,
        /** @param {any} k */
        getStringByNameSync: (k) => k,
      },
      /** @param {any} want @param {any} optionsOrCb @param {any=} [cbMaybe] */
      startAbility(want, optionsOrCb, cbMaybe) {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : cbMaybe;
        return withCallback(Promise.resolve().then(() => { spawnChildAbility(want, entry, null); }), cb);
      },
      // Promise 形态与 AsyncCallback 形态（want, cb）/（want, options, cb）
      /** @param {any} want @param {any} optionsOrCb @param {any=} [cbMaybe] */
      startAbilityForResult(want, optionsOrCb, cbMaybe) {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : cbMaybe;
        const started = new Promise((resolve, reject) => {
          spawnChildAbility(want, entry, { resolve, reject });
        });
        return withCallback(started, cb);
      },
      /** @param {any=} [cb] */
      terminateSelf(cb) {
        return withCallback(Promise.resolve().then(() => terminateEntry(entry, null)), cb);
      },
      /** @param {any} parameter @param {any=} [cb] */
      terminateSelfWithResult(parameter, cb) {
        return withCallback(Promise.resolve().then(() => terminateEntry(entry, parameter)), cb);
      },
    };
  }

  // 扮演"框架"启动 ability：onCreate → onWindowStageCreate(loadContent 真的渲染页面) → onForeground
  /** @param {any} AbilityClass @param {any=} [opts] */
  function startAbility(AbilityClass, opts) {
    const { rootEl, want = {} } = opts || {};
    const logs = ((/** @type {any} */ (global)).__arkui_dom_logs = (/** @type {any} */ (global)).__arkui_dom_logs || []);
    abilityClassForChildren = AbilityClass;

    // @type 档位：windowEl/context/ability 是 null↔对象 摆动（同 child entry）
    const entry = /** @type {any} */ ({
      name: AbilityClass.name, role: 'root', parent: null, rootEl, windowEl: null,
      pagePath: null, ability: null, context: null, terminated: false, pending: [],
    });
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
      if (!(/** @type {any} */ (global)).__arkui_dom_sm) {
        (/** @type {any} */ (global)).__arkui_dom_sm = new SubscriberManager();
      }
      return (/** @type {any} */ (global)).__arkui_dom_sm;
    }
    /** @param {any} id */
    delete(id) { this._subs.delete(id); }
  }

  /** @type {Map<string, any>} */
  const routes = new Map();
  /** @param {() => any} factory @param {string=} [_name] @param {any=} [info] */
  function registerNamedRoute(factory, _name, info) {
    if (info && info.pagePath) routes.set(info.pagePath, factory);
  }

  // 页面栈：[{path, view}] —— ArkUI 的 router 会【保留页面实例】，back 回去时 @State 不丢
  //（这也是 onPageShow 与 aboutToAppear 存在的区别：前者每次显示都调，后者只首次）
  /** @type {any[]} */
  const pageStack = [];
  function currentRoot() { return rootNode; }

  /** @param {string} pagePath */
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

  /** @param {any} view */
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

  /** @param {string} pagePath @param {HTMLElement} rootEl */
  function loadRoute(pagePath, rootEl) {
    if (rootEl) rootNode = rootEl;
    const view = createPage(pagePath);
    pageStack.push({ path: pagePath, view });
    return renderView(view);
  }

  /** @param {string} pagePath */
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

  /** @param {string} pagePath */
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
    // R33：信息展示收官（QRCode 组件；R41 起编码器为真机 arkui-qrcodegen 的 WASM，runtime/vendor/arkui-qrcodegen.js）
    QRCode,
    // R34：输入收官。EnterKeyType 是产物里的自由变量枚举
    TextInput, TextArea, Search, Hyperlink, TextInputController, TextInputControllerBase, EnterKeyType,
    // R36：小件收官。FlexDirection/FlexAlign/ItemAlign/TextDecorationType 已在安装全局（R2）
    Flex, Span, LoadingProgress, Blank,
    // R36 补：FlexDirection/TextDecorationType 在产物里也是自由变量枚举（此前产物没引用，
    // 本轮起挂 global）。成员与值照 .d.ts 声明顺序：Row=0/Column=1/RowReverse=2/ColumnReverse=3；
    // None=0/Underline=1/Overline=2/LineThrough=3
    FlexDirection: { Row: 'row', Column: 'column', RowReverse: 'row-reverse', ColumnReverse: 'column-reverse' },
    TextDecorationType: { None: 'none', Underline: 'underline', Overline: 'overline', LineThrough: 'line-through' },
    // R37：分步器。ItemState 同为产物里的自由变量枚举
    Stepper, StepperItem, ItemState,
    // R49：ListItemGroup + 三个枚举（值照 .d.ts 声明顺序/显式数值）
    ListItemGroup,
    ListItemGroupStyle: { NONE: 0, CARD: 1 },
    ListItemGroupHeaderFooterStyle: { NONE: 0, FLOATING: 1 },
    StickyStyle: { None: 0, Header: 1, Footer: 2, BOTH: 3 },
    // R47：ImageAnimator + AnimationStatus（值照 .d.ts：Initial=0/Running=1/Paused=2/Stopped=3）
    ImageAnimator, AnimationStatus: { Initial: 0, Running: 1, Paused: 2, Stopped: 3 },
    // R51：DatePicker + 枚举（DatePickerMode 声明在 date_picker.d.ts 而非 enums.d.ts）
    DatePicker, DatePickerMode: { DATE: 0, YEAR_AND_MONTH: 1, MONTH_AND_DAY: 2 },
    TimePicker, TimePickerFormat: { HOUR_MINUTE: 0, HOUR_MINUTE_SECOND: 1 },
    // R56：TextPicker（选择器三部曲收官）+ R58 静态弹层
    TextPicker, TextPickerDialog,
    // R59：TextClock/TextTimer（时间文本双件）+ 双控制器
    TextClock, TextClockController, TextTimer, TextTimerController,
    // R60：AlphabetIndexer（字母索引条）
    AlphabetIndexer,
    // R65：RichEditor（富文本编辑器）/ Video（视频播放器）
    RichEditor, RichEditorController, Video, VideoController,
    // 批量媒体分片（batch-media）：ContainerSpan/ImageSpan/RichText/SymbolGlyph/SymbolSpan/Web。
    // 常量本体都在分片内定义，这里只挂 global —— 产物里 `Web.create(...)`、`new WebController()`、
    // `SymbolEffectStrategy.NONE` 等全是自由变量引用，不挂直接 ReferenceError
    ContainerSpan, ImageSpan, RichText, SymbolGlyph, SymbolSpan, Web, WebController,
    ImageSpanAlignment, SymbolRenderingStrategy, SymbolEffectStrategy,
    EffectScope, EffectDirection, EffectFillStyle, ReplaceEffectType,
    SymbolEffect, ScaleSymbolEffect, HierarchicalSymbolEffect, AppearSymbolEffect,
    DisappearSymbolEffect, BounceSymbolEffect, ReplaceSymbolEffect, PulseSymbolEffect,
    // R61：SideBarContainer（侧边栏容器）
    SideBarContainer, SideBarContainerType: { Embed: 0, Overlay: 1 },
    // R62：RowSplit/ColumnSplit（分隔容器）
    RowSplit, ColumnSplit,
    // R64：GridRow/GridCol（响应式网格）
    GridRow, GridCol,
    // R63：Panel（底部滑出面板）+ PanelMode
    Panel, PanelMode: { Mini: 0, Half: 1, Full: 2 },
    // 批量导航分片（batch-nav）。枚举定义在分片内，值照 .d.ts 声明顺序：
    // NavRouteMode PUSH_WITH_RECREATE=0/PUSH=1/REPLACE=2；NavigationType Push=0/Back=1/Replace=2；
    // RouteType None=0/Push=1/Pop=2；SlideEffect 0..3,5,6；ToolBarItemPlacement 0/1；
    // PickerIndicatorType 0/1。__arkui_dom_pageTransitionSpecs / __arkui_dom_playPageTransition
    // 由分片自带 Object.defineProperty(global) 挂载，刻意不走本 assign 块
    //（防 stats.mjs 的 assignBlock 正则误吸分片段）
    NavRouter, Navigator, PageTransitionEnter, PageTransitionExit, ToolBarItem,
    UIPickerComponent, NavRouteMode, NavigationType, RouteType, SlideEffect,
    ToolBarItemPlacement, PickerIndicatorType,
    // 批量布局分片（batch-layout）。SizeType/NodeRenderType 是 fixture 产物的运行期自由变量
    // （必需）；XComponentType/Alignment 已有导出（R32/安装全局），勿重复
    FolderStack, GridContainer, Section, Sheet, UnionEffectContainer, XComponentNode,
    FoldStatus, AppRotation, SizeType, NodeRenderType,
    // 批量输入收官（batch-input）：CheckboxGroup/ColorPicker/ColorPickerDialog/Option/
    // PatternLock/SelectionContainer。generated-components.js 骨架表虽有这些名字，但其注册
    // 循环对手写已注册名 continue 跳过且因此不挂 global —— 不追加这里，产物里
    // `ColorPicker()`、`new PatternLockController()`、`CopyOptions.InApp`、`CheckBoxShape.CIRCLE`
    // 等自由变量引用直接 ReferenceError
    CheckboxGroup, ColorPicker, ColorPickerDialog, Option, PatternLock, SelectionContainer,
    PatternLockController, SelectionContainerController, PatternLockChallengeResult,
    SelectionContainerTextJoinStyle, CopyOptions, CheckBoxShape, SelectStatus,
    // 批量动效分片（batch-motion）。BarState/PlayMode/AnimationStatus 已挂过勿重复；
    // FillMode 不需要 —— 分片内 ANIM_FILL_MODE_CSS 按值映射 0..3
    Animator, ScrollBar, ScrollBarDirection, FrictionMotion, ScrollMotion,
    SpringMotion, SpringProp, GeometryView,
    // 批量函数组件收官（batch-func）：Repeat/Calendar/ContainerReader/Indicator + Menu/Theme 件
    Calendar, ContainerReader, IndicatorComponent, IndicatorComponentController,
    MenuItemGroup, Repeat, WithTheme,
    // R57：Grid/GridItem（CSS grid 同构基座 + 滚动事件族）
    Grid, GridItem,
    // R50：Refresh + RefreshStatus（声明顺序：Inactive=0/Drag=1/OverDrag=2/Refresh=3/Done=4，
    // refresh.d.ts 无显式数值）。注意：Refresh 内部 RefreshAnimationState(1..3) 是另一个
    // 数值空间，勿混用
    Refresh, RefreshStatus: { Inactive: 0, Drag: 1, OverDrag: 2, Refresh: 3, Done: 4 },
    // R53：WaterFlow 瀑布流 + 枚举/shim。WaterFlowLayoutMode 是【显式】=0/=1（water_flow.d.ts:258,295）
    WaterFlow, FlowItem, WaterFlowSections,
    WaterFlowLayoutMode: { ALWAYS_TOP_DOWN: 0, SLIDING_WINDOW: 1 },
    // R54：CalendarPicker 日期选择入口 + 静态弹层 + 枚举（CalendarAlign 显式 =0/1/2）
    CalendarPicker, CalendarPickerDialog,
    CalendarAlign: { START: 0, CENTER: 1, END: 2 },
    // R46：Scroll 组件（手写接管骨架）+ 枚举。Edge：Top=0 Center=1 Bottom=2
    Scroll,
    // Baseline=3 Start=4 Middle=5 End=6
    Edge: { Top: 0, Center: 1, Bottom: 2, Baseline: 3, Start: 4, Middle: 5, End: 6 },
    ScrollDirection: { Vertical: 0, Horizontal: 1, Free: 2, None: 3 },
    BarState: { Off: 0, Auto: 1, On: 2 },
    EdgeEffect: { Spring: 0, Fade: 1, None: 2 },
    // R45：Image。ImageFit 枚举值照 .d.ts 声明顺序（Contain=0..None=5，对齐族 7..15，MATRIX=16）
    Image, ImageFit: {
      Contain: 0, Cover: 1, Auto: 2, Fill: 3, ScaleDown: 4, None: 5,
      TOP_START: 7, TOP: 8, TOP_END: 9, START: 10, CENTER: 11, END: 12,
      BOTTOM_START: 13, BOTTOM: 14, BOTTOM_END: 15, MATRIX: 16,
    },
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
    __arkui_dom_gestures: (/** @type {any} */ el) => {
      const st = el && el.__arkuiGestureState;
      return {
        types: gestureTypes(el),
        attachCount: gestureAttachCount,
        dragState: st ? st.gestures.length : 0,
        groups: gestureGroups(el),
        priority: st ? [...new Set(st.gestures.map((/** @type {any} */ r) => (r.__priority === GesturePriority.High ? 'high'
          : (r.__priority === GesturePriority.Parallel ? 'parallel' : 'low'))))] : [],
        masks: st ? [...new Set(st.gestures.map((/** @type {any} */ r) => GESTURE_MASK_NAME[r.__mask] || String(r.__mask)))] : [],
        arbClass: st ? st.arbClass : 'idle',
        arb: st ? gestureArbState(st) : 'idle',
      };
    },
    // 动画自省：证明"过渡真的挂在被重渲染的节点上、到点真的清掉了"，而不是只看某次 style 非空
    __arkui_dom_animations: () => ({
      active: animWindow ? { seq: animWindow.seq, duration: animWindow.duration, els: animWindow.els.length } : null,
      history: animHistory.map((/** @type {any} */ h) => Object.assign({}, h)),
      onFinishCount,
    }),
    // DataPanel 自省：证明"段占比真按 values/max 算出来了"，而不只看某个背景串。
    __arkui_dom_dataPanel: (/** @type {any} */ el) => {
      if (!el || el.__drawKind !== 'DataPanel') return null;
      const g = panelGeometry(el);
      return { type: el.__panelType, segments: g.segs, stops: g.stops, max: el.__panelMax };
    },
    // Rating 自省：区分"满星/半星"（渲染上只是个位数，机制上要能证明）
    __arkui_dom_rating: (/** @type {any} */ el) => {
      if (!el || el.__drawKind !== 'Rating') return null;
      const { lit, full, half } = ratingLit(el);
      return {
        rating: el.__rating, stars: el.__starCount, stepSize: el.__step,
        indicator: !el.__interactive, lit, full, half,
      };
    },
    // 虚拟列表自省：证明"偏移是真的按实测高度算出来的"，而不只看某个 scrollTop 数字
    __arkui_dom_lazyInfo: (/** @type {any} */ el) => {
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
        offsetOf: (/** @type {any} */ i) => (st.offsetOf ? st.offsetOf(i) : 0),
      };
    },
    // 自定义布局自省：证明"measure() 真的量了、layout() 真的摆了"，而不只看最终矩形
    __arkui_dom_customLayout: (/** @type {any} */ el) => {
      const m = el && customLayoutMeta.get(el);
      return m ? JSON.parse(JSON.stringify(m)) : null;
    },
    __arkui_dom_syncAlignRules: syncAlignRules,
    __arkui_dom_syncDrawings: syncDrawings,   // R44：测试侧触发补画（DSL 建的绘制类组件不经过渲染管线）
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
      open: abilityStack.filter((/** @type {any} */ e) => e.windowEl).length,
      depth: abilityStack.length,
      history: abilityWindowStats.history.map((/** @type {any} */ h) => ({ ability: h.ability, page: h.page, text: h.text })),
    }),
    // 组件骨架（生成）
    __arkui_dom_registerGenerated: registerGeneratedComponents,
    __arkui_dom_componentNames: () => Object.keys(components).sort(),
    // 状态管理 v2 的装饰器表。刻意【不】把裸名挂 global：`Event` 与浏览器全局同名，
    // 挂上去会打断页面脚本里的 `new Event(...)`（test/lazy.html 在用）。
    // IIFE 内部的绑定已改名 EventDeco（R38：原先 `const Event` 把 Scroller 的 new Event
    // 一并遮蔽了——潜伏炸点，见 v2.js EventDeco 处说明）。
    // 由 tools/extract.mjs 在产物里生成作用域内绑定，只绑实际用到的名字。
    __arkui_dom_decorators: decorators,
    // V1 深度观测自省：断言"@Observed 确实产出了可观测代理"，而不只看渲染结果。
    // （Meta 这类非 @Observed 的嵌套对象必须返回 false —— 这是负向断言的依据。）
    __arkui_dom_isObserved: (/** @type {any} */ v) => !!observedCells.get(v),
    // Tabs 自省：证明"控制器真绑上了、标签真来自 tabBar、活动索引真的变了"，
    // 而不是只看"某个 div 的 display 恰好是 none"。
    __arkui_dom_tabsState: (/** @type {any} */ el) => {
      const st = el && el.__tabsState;
      if (!st) return null;
      return {
        index: st.index,
        count: st.contents.length,
        labels: st.contents.map((/** @type {any} */ c) => c.label),
        barPosition: st.barPosition,
        hasController: !!st.controller,
        controller: st.controller,
      };
    },
    // Swiper 自省：证明"控制器真绑上了、loop/autoPlay 真生效"，而不只看某个 div 的 display。
    __arkui_dom_swiperState: (/** @type {any} */ el) => {
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
    __arkui_dom_navState: (/** @type {any} */ el) => {
      const st = el && el.__navState;
      if (!st) return null;
      return {
        size: st.paths.length,
        names: st.paths.map((/** @type {any} */ p) => p.name),
        params: st.paths.map((/** @type {any} */ p) => p.param),
        hasBuilder: typeof st.builder === 'function',
        mode: st.mode,
        stack: st.stack,
      };
    },
    // R12 收口自省：标题栏 / 工具栏 / 分栏的【实际形态】（断言读这个，而不是读 style 字符串猜）
    __arkui_dom_navChrome: (/** @type {any} */ el) => {
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
    __arkui_dom_guideLines: (/** @type {any} */ el) => {
      const m = el && el.__guideLineBoxes;
      if (!m) return null;
      /** @type {Record<string, any>} */ const out = {};
      for (const k of Object.keys(m)) out[k] = { x: m[k].x, y: m[k].y, axis: m[k].axis };
      return out;
    },
    // 只读自省：供测试断言"装饰器确实在原型上装了访问器"，而不是只看渲染结果。
    // 注意 v2ProtoMeta 是 WeakMap（不可枚举，没有 keys()），所以只按类查询。
    __arkui_dom_v2Introspect: () => ({
      observedOf: (/** @type {any} */ cls) => v2Collect({ __proto__: cls.prototype }, (/** @type {any} */ info, /** @type {any} */ out) => {
        for (const k of info.observed) out.push(k);
      }),
      monitorsOf: (/** @type {any} */ cls) => v2Collect({ __proto__: cls.prototype }, (/** @type {any} */ info, /** @type {any} */ out) => {
        for (const [k, s] of info.monitors) out.push(`${k}→${[...s].join('|')}`);
      }),
      computedOf: (/** @type {any} */ cls) => v2Collect({ __proto__: cls.prototype }, (/** @type {any} */ info, /** @type {any} */ out) => {
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
