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
                                   //            activeBranch, forEachSnapshot, rowRecs}
  const deepRendering = new Set(); // 正在执行 deepRender 的 elmtId，防止递归再进入
  const propDeps = new Map();      // ObservedProperty -> Set<elmtId>
  /** @type {any} */ let currentNodeElmtId = null;    // 正在执行哪个 elmtId 的渲染（依赖追踪 + If/ForEach 归属）
  /** @type {any} */ let rootNode = null;
  /** @type {number} */ let viewSeq = 0;
  // R77：重渲染剖面（永久轻量——每 flush 4 对 performance.now）。页面可读
  // __arkui_dom_perf 看单轮管道分布（flushMs 总账 + update/align/draw/areas/nav 分段）。
  // 用前先清零：const P=__arkui_dom_perf; Object.keys(P).forEach(k=>P[k]=0);
  (/** @type {any} */ (global)).__arkui_dom_perf =
    { flushMs: 0, updateMs: 0, alignMs: 0, drawMs: 0, areasMs: 0, navMs: 0, n: 0 };
  // R76：ForEach 行级复用——key 稳定的行重入时沿用旧 elmtId（isFirst=false → 静态守卫生效、
  // 节点走复用+contentUpdater），而不是拆掉重建。rowReentryIds 是当前重入行的既有 elmtId 名册
  //（按行内组件出现序），rowReentryCursor 是行内游标。
  /** @type {any[] | null} */ let rowReentryIds = null;
  let rowReentryCursor = 0;

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

  // HTML void 元素（结构上不可能有子）——挂它们内部 = 序列化必丢、视觉必缺，
  // 属于「无论哪个组件漏标 leaf 都不可恢复」的层级
  /** @type {Record<string, number>} */
  const VOID_ELEMENT_TAGS = { INPUT: 1, IMG: 1, HR: 1, BR: 1, SOURCE: 1, TRACK: 1, WBR: 1 };

  const parentOfTop = () => {
    // 叶组件（编译产物缺 .pop()，坑 97）挂载后自动弹出，避免后续兄弟挂进叶内。
    // R165 全页审计补结构兜底：top 是 void 元素也弹（坑 97 家族双保险——leaf
    // 标记管语义叶，void 兜底管 HTML 层）
    let top = ViewStackProcessor.top();
    while (top && (top.__arkuiLeaf || (top.tagName && VOID_ELEMENT_TAGS[top.tagName]))) {
      ViewStackProcessor.pop(); top = ViewStackProcessor.top();
    }
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
    const pf0 = performance.now();
    const ids = [...dirty].sort((a, b) => a - b);
    dirty.clear();
    // E0-1：逐 elmtId 独立 try/catch——单组件 updateFunc 抛错进环形缓冲 + 边界派发，
    // 批次里其余 elmtId 照常渲染（errorboundary 分片的统一入口，函数声明提升可用）
    for (const id of ids) {
      try { rerenderElmt(id); }
      catch (e) {
        const rec = elmtRecords.get(id);
        __arkuiReportRenderError('rerender', id, e, rec && rec.node);
      }
    }
    // R142：批末尾部 sync（原在 rerenderElmt 内逐 id 执行）——登记集驱动下批级一次
    const pf1 = performance.now();
    syncAlignRules(rootNode);          // 重渲染后几何可能变，重新同步
    const pf2 = performance.now();
    syncDrawings(rootNode);            // 弧形要用真实尺寸重画
    const pf3 = performance.now();
    syncAreas(rootNode);               // onAreaChange 要按真实几何派发
    const pf4 = performance.now();
    syncNavChrome(rootNode);           // 标题栏高度/分栏宽度/Auto 模式判定都要真实尺寸
    const pf5 = performance.now();
    const P = (/** @type {any} */ (global)).__arkui_dom_perf;
    if (P) {
      P.drawMs += pf2 - pf1;
      P.areasMs += pf3 - pf2;
      P.navMs += pf4 - pf3;
      P.flushMs += performance.now() - pf0;
      P.n++;
    }
  }

  /** @param {number} elmtId */
  function rerenderElmt(elmtId) {
    const rec = elmtRecords.get(elmtId);
    if (!rec || !rec.updateFunc || !rec.node) return;
    const pf0 = performance.now();
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
    // R142：4 个尾部 sync（alignRules/draw/areas/navChrome）提升到 flush() 批末执行——
    // 批内 N 个 dirty id 原本各跑 4 次（13200 次登记扫描@3300 行），批级一次语义等价
    //（sync 作用于登记集全局终态）且数量降为 4。PERF 记账同步移至 flush。
    const P = (/** @type {any} */ (global)).__arkui_dom_perf;
    if (P) P.updateMs += performance.now() - pf0;
  }

  // 分支切换/列表重建后，把已脱离 DOM 树的记录清掉，避免 elmtId 泄漏与重复节点
  // R151：var 赋值式（函数声明不可重绑，TS2630）——v2.js 的 @Reusable 入池包装需要
  // 重绑此绑定；调用点全在运行期渲染管线，var 的提升差异无影响
  var purgeDetachedRecords = function () {
    if (!rootNode) return;
    for (const [id, rec] of [...elmtRecords]) {
      if (rec.node && !rootNode.contains(rec.node)) {
        if (rec.updateFunc) dropPropDeps(id);
        elmtRecords.delete(id);
      }
    }
  }

  // @include animation
  // @include gesture
  // @include builtin
  // @include errorboundary
  // @include focus
  // @include a11y
  // R139 E2-1：增量走查登记表（须在 area/draw/show/nav 之前——登记函数声明提升，但注释置顶）
  // @include incremental
  // @include generated-app-resources
  // @include generated-sys-resources
  // @include i18n
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
      // R76：行级复用——forEachUpdateFunction 的重入行把既有 elmtId 名册放进 rowReentryIds，
      // 行内第 k 个组件沿用名册第 k 项（存在即复用，isFirst=false → 静态守卫跳过）；否则新分配并登记。
      let elmtId;
      if (rowReentryIds && rowReentryCursor < rowReentryIds.length &&
          elmtRecords.has(rowReentryIds[rowReentryCursor])) {
        elmtId = rowReentryIds[rowReentryCursor];
      } else {
        elmtId = ++elmtIdSeq;
        if (rowReentryIds) rowReentryIds[rowReentryCursor] = elmtId;  // 首建登记，供下次重入
      }
      rowReentryCursor++;
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

    // ForEach：数组变化才整体重建（键级 diff 留待后续优化）；大数组走窗口化引擎
    /** @param {number} elmtId @param {any[]} arr @param {any} itemGenFunc @param {any} keyGenFunc */
    forEachUpdateFunction(elmtId, arr, itemGenFunc, keyGenFunc) {
      const rec = elmtRecords.get(elmtId);
      if (!rec || !rec.node) return;
      const snap = (arr || []).slice();
      // C1-v2：已窗口化的 ForEach 重入——数据变化只重算窗口（引擎自带滚动监听/锚定），
      // 同值重放直接跳过（与全量路径的快照守卫同语义）。
      if (rec.forEachWindow) {
        const prev = rec.forEachSnapshot;
        const same = !!(prev && prev.length === snap.length &&
          prev.every((/** @type {any} */ v, /** @type {number} */ i) => Object.is(v, snap[i])));
        rec.forEachSnapshot = snap;
        rec.forEachWindow.spec.itemAt = (/** @type {number} */ i) => snap[i];
        if (!same) rec.forEachWindow.refresh(snap.length);
        return;
      }
      // C1-v2：大数组窗口化闸门——≥500 项 + 真滚动祖先/文档滚动根 + 估高超视口 1.5×。
      // 保守线把全部既有小表（≤350 项）钉在全量挂载语义上零偏差；ARKUI_NO_FOREACH_WINDOW
      // （全局旋钮 __arkui_dom_noForEachWindow）一票否决回全量。spacer 撑总高 →
      // scrollHeight/锚距口径不变（c-v:auto 否决的对照面）。
      if (forEachWindowEligible(rec.node, snap)) {
        rec.forEachSnapshot = snap;
        rec.rowRecs = null;                       // 行级复用名册不参与窗口语义（窗口重建即换行）
        const holder = rec.node;
        holder.style.display = 'block';           // contents 层没有盒，spacer 需要真盒子撑高
        holder.setAttribute('data-arkui-foreach-window', '1');
        const pcs = holder.parentElement ? getComputedStyle(holder.parentElement) : null;
        rec.forEachWindow = createWindowEngine(holder, {
          total: snap.length,
          gap: (pcs && (parseFloat(pcs.rowGap) || parseFloat(pcs.gap))) || 0,
          scrollEl: forEachScrollEl(holder),
          itemAt: (/** @type {number} */ i) => snap[i],
          itemGen: (/** @type {any} */ it, /** @type {number} */ i) => itemGenFunc(it, i),
          convergeEst: true,
        });
        return;
      }
      const changed = !rec.forEachSnapshot
        || rec.forEachSnapshot.length !== snap.length
        || rec.forEachSnapshot.some((/** @type {any} */ v, /** @type {number} */ i) => !Object.is(v, snap[i]));
      const newKeys = keyGenFunc ? snap.map((/** @type {any} */ v, /** @type {number} */ i) => keyGenFunc(v, i)) : null;
      const oldRowRecs = rec.rowRecs || null;
      // R76：key 稳定（长度同 + 逐位 key 相等）→ 行级复用（重入旧行 elmtId，不拆不建）；
      // 否则维持整列表重建语义（R22 消失动画走原 detach 路径）。无 keyGenFunc → 恒为重建。
      const keysStable = !!(newKeys && oldRowRecs && oldRowRecs.length === newKeys.length &&
        newKeys.every((/** @type {any} */ k, /** @type {number} */ i) =>
          oldRowRecs[i] && Object.is(oldRowRecs[i].key, k)));
      if (changed && rec.forEachSnapshot && !keysStable) {
        // 列表重建时，带"消失过渡"的项先把动画走完（R22 收口）。
        // key 稳定的值更新不拆除——走行级复用（这正是 R76 的收益所在）。
        detachChildren(rec.node);
        purgeDetachedRecords();
      }
      rec.forEachSnapshot = snap;
      rec.rowRecs = newKeys
        ? newKeys.map((/** @type {any} */ k, /** @type {number} */ i) => ({
            key: k,
            ids: keysStable && oldRowRecs[i] ? oldRowRecs[i].ids : [],
          }))
        : null;

      const savedStack = ViewStackProcessor.snapshot();
      const savedElmt = currentNodeElmtId;
      const savedIds = rowReentryIds;
      const savedCursor = rowReentryCursor;
      ViewStackProcessor.restore([]);
      ViewStackProcessor.push(rec.node);
      currentNodeElmtId = elmtId;
      if (changed) {
        for (let i = 0; i < snap.length; i++) {
          rowReentryIds = rec.rowRecs ? rec.rowRecs[i].ids : null;
          rowReentryCursor = 0;
          // R90：真机 itemGenerator 签名是 (item, index)——ets-loader 产物的 itemGen
          // 第二参是 index（NotesHome 的 pushUrl params 用它），不传则产物里 idx=undefined
          itemGenFunc(snap[i], i);
          if (rec.rowRecs) rec.rowRecs[i].ids.length = rowReentryCursor;  // 结构收缩时截断残留
        }
      }
      rowReentryIds = savedIds;
      rowReentryCursor = savedCursor;
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

  // R134：资源 base 探测——生成表里的 media 路径相对【仓库根】；测试页住在 /test/ 下，
  // fetch/解析都要加一层前缀。规则：URL 路径含 /test/ → base='../'（仓库根的相对形态，
  // http 与 file:// 双态同构）；否则 base='./'（页已在仓库根形态，如打包冒烟直开包内页）。
  const resBase = () => {
    try { return /\/test\//.test(global.location.pathname) ? '../' : './'; }
    catch (e) { return '../'; }
  };

  // ────────────────────── 属性映射 ──────────────────────
  /** @param {any} v */
  const resolveResource = (v) => {
    if (v && typeof v === 'object' && 'id' in v && 'type' in v) {
      // R128：app.* 资源（编译器把 $r 预展开成带 app-id 的字面量）→ 生成表解析。
      // string → 文本；color → '#RRGGBB'（CSS 同构）；float/integer → 裸数字
      //（'24fp'→24，vp/fp 与 px 1:1 项目口径）；media → 仓库相对路径串（双端 <img> 可用）
      const app = (/** @type {any} */ (global)).__arkui_app_res;
      if (app && app.byId[v.id]) {
        const r = app.byId[v.id];
        if (r.type === 'string') return app.values.string[r.name] !== undefined ? app.values.string[r.name] : r.name;
        if (r.type === 'color') return app.values.color[r.name] !== undefined ? app.values.color[r.name] : v;
        if (r.type === 'float' || r.type === 'integer') {
          const raw = app.values[r.type][r.name];
          return typeof raw === 'string' ? (parseFloat(raw) || 0) : raw;
        }
        if (r.type === 'media') return app.media[r.name] !== undefined ? resBase() + app.media[r.name] : v;
        return v;
      }
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

  // @include layout

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
  //   <div data-arkui-comp="Tabs">           flex；方向由 vertical×barPosition 矩阵决定
  //     <div data-arkui-tabs-bar>            恒为第一个子元素（视觉位置由 direction 表达）
  //     <div data-arkui-tabs-content>        TabContent 挂在这里（不是 Tabs 本身）
  //
  // 为什么 TabContent 要"跳过"父节点另挂：若直接挂进 Tabs 包装元素，就会和 tab bar 同级，
  // 且 Tabs.width()/height() 会作用到内容区而不是整体。故由 TabContent 主动认领内容区
  // （挂靠点 node.__tabsContentEl 在 createTabsState 里指到 contentEl——旧实现漏挂，
  //  TabContent 落成了 bar/空内容区/Tabs 平级的第三个 flex 子级，竖排 row 下会挤成一团）。
  const BarPosition = { Start: 'start', End: 'end' };
  const BarMode = { Fixed: 'fixed', Scrollable: 'scrollable' };

  // Tabs 的语义性属性里本实现未覆盖的部分。回调类尤其不能静默——写上去却永远不触发，
  // 比报错更难查。纯外观项（颜色/模糊/divider/fadingEdge）不在此列。
  // R125：scrollable 移出本表（内置拖拽翻页真语义，默认 true，tabs.d.ts JSDoc 原文）。
  // W4（R151）：vertical/barMode/barWidth/barHeight/barOverlap 与回调 onTabBarClick/
  // onSelected/onUnselected 一并移出本表——它们改由 ensureComponent('Tabs') 里的
  // 【组件自有方法】拦截（原因见该处注释：applyAttr 的通用函数分支会把 onXxx 吞成
  // 永不触发的死监听，且它排在 TABS_UNSUPPORTED 诊断之前，连警告都发不出）。
  // R152-B：动画/拖拽族四件（animationDuration/onAnimationStart/onAnimationEnd/
  // onGestureSwipe）也移出本表走自有方法拦截（同 R151 原因 ①，且由内置拖拽生命周期派发）。
  // barGridAlign 实参是 BarGridColumnOptions{sm?,md?,lg?,margin?,gutter?}（tabs.d.ts:762-830），
  // 不是 Alignment 枚举（C 简报纠偏）——R153-B 已按真语义实现（见 normalizeBarGridAlign /
  // applyTabsBarGrid 注释里的 cpp 对照），移出本表走自有方法拦截。
  // R153-B：animationCurve（tabs.d.ts:1537-1551，Curve|ICurve 双缺省）/pageFlipMode
  //（tabs.d.ts:1885-1911，鼠标滚轮翻页）/cachedMaxCount（tabs.d.ts:1913-1958，TabsCacheMode）
  // 同批移出本表。
  // R155-B：edgeEffect（tabs.d.ts:1273-1282，since 12，缺省 EdgeEffect.Spring）移出本表走
  // 自有方法拦截——到边行为开关真语义长在 builtin.js attachPagedDrag 的 edgeEffect 槽位
  //（R153-B 记档的"需要动 builtin.js"欠账就此结清）。
  // R158：animationMode（tabs.d.ts:80 AnimationMode 枚举）/ onContentWillChange（tabs.d.ts:1636）/
  // onContentDidScroll（tabs.d.ts:1637+）一并移出本表真语义（见 applyTabsAttr 对应 case 与
  // createTabsState 的 gesture 槽位）。仍不覆盖的只剩：
  //   customContentTransition（tabs.d.ts:1532，自定义内容转场 delegate）——本运行时内容切换
  //   是 display 切换 + 入场 transform 近似，没有可逐帧接管的内容转场管线，delegate 的
  //   interpolate 回调无处消费；继续记"未实现"警告（认知/复杂面，不静默）。
  const TABS_UNSUPPORTED = new Set([
    'customContentTransition',
  ]);

  // R153-B：interpolatingSpring(-1,1,228,30) 的内禀时长近似（ms）。ω=√(k/m)≈15.1 rad/s、
  // ζ=c/(2√(km))≈0.993（近临界阻尼、无可见过冲），2% 稳态时间 ≈ 4/(ζω) ≈ 265ms → 取 270。
  // 两处使用者：① 拖拽释放翻页的 CSS 过渡时长（d.ts animationDuration JSDoc：animationDuration
  // 【不控制】拖拽释放，时长由该 spring 内禀参数决定）；② spring 族 animationCurve 的点击路径
  //（spring 族不受 animationDuration 影响，d.ts animationDuration JSDoc "For details about curves
  // unaffected by animationDuration" 原文）。
  const TABS_SPRING_SWITCH_MS = 270;
  // 点击 tab / changeIndex 路径的缺省曲线（tabs.d.ts:1537-1551 JSDoc：双缺省之点击侧
  // cubicBezierCurve(0.2,0.0,0.1,1.0)；拖拽侧缺省 interpolatingSpring(-1,1,228,30) 见上）。
  const TABS_CLICK_CURVE = 'cubic-bezier(0.2, 0, 0.1, 1)';
  // spring 族进 CSS transition 的近似曲线：ζ≈0.993 无可见过冲 → 无过冲快出缓入贝塞尔
  //（真机是逐帧解算的弹簧，CSS 只能曲线近似，差异已在此记录）。
  const TABS_SPRING_CSS = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

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
      scrollable: true,               // tabs.d.ts JSDoc："**true** (default)"——内容区可滑动翻页
      // W4.1-W4.4 状态（tabs.d.ts 缺省值）：
      vertical: false,                // tabs.d.ts:1027-1043：false=水平（默认）
      barMode: 'fixed',               // tabs.d.ts:1099：默认 BarMode.Fixed
      barWidth: null, barHeight: null,// Length；null=走 d.ts 缺省（竖 56 宽 / 横 56 高）
      barOverlap: false,              // tabs.d.ts:1454-1467：bar 悬浮在 TabContent 上（默认 false）
      onTabBarClick: null, onSelected: null, onUnselected: null,   // 覆盖语义单槽（d.ts 单 Callback 入参）
      // R152-B 动画/拖拽族状态（C 简报纠偏后的权威缺省）：
      animationDuration: 300,         // 真机 ANIMATION_DURATION_DEFAULT=300（tab_theme.cpp:27,51-52；
                                      //   API11+ 非 BottomTabBarStyle 缺省 300，d.ts:1240）；只有
                                      //   BottomTabBarStyle 才是 0（tab_bar_pattern.cpp:3444-3462）。
                                      //   0=无动画且不触发动画回调（swiper_pattern.cpp:2270-2273）
      animStart: [], animEnd: [],     // onAnimationStart/End 多播（真机 SwiperEventHub 是 list
                                      //   emplace_back，swiper_event_hub.h:162-163，重复注册都发）
      gestureSwipe: null,             // onGestureSwipe 单槽覆盖（真机 SetGestureSwipeEvent swap，
                                      //   swiper_event_hub.h:79-84/164——与 R125 Swiper 的数组实现不同，此处照真机）
      tabAnim: null,                  // 进行中的切页动画舞台（animateTabSwitch 建立，settle 时清）
      // R153-B 长尾第三片状态（d.ts 缺省值）：
      barGridAlign: null,             // BarGridColumnOptions 归一化产物（normalizeBarGridAlign）；null=未设=整宽
      animCurveKind: 'css',           // 'css'=缺省点击曲线（TABS_CLICK_CURVE）；'spring'=spring 族
                                      //   （interpolatingSpring/springMotion 等，内禀时长、不受 duration 控制）
      animCurveSet: false,            // R154：是否显式设过 animationCurve——未设时拖拽释放保持 ease-out
                                      //   （R125 既有行为）；显式设过才把曲线接到 builtin.js finishCurve 槽位
      animCurveCss: TABS_CLICK_CURVE, // 点击/changeIndex 路径实际进 CSS transition 的曲线串
      pageFlipMode: 0,                // PageFlipMode{CONTINUOUS=0, SINGLE=1}（tabs.d.ts:1885-1911 默认 CONTINUOUS）
      cachedMaxCount: -1,             // -1=未设=全部缓存（swiper_pattern.cpp:868-869：<0 或 ≥ 页数 → 不设限）
      cacheMode: 0,                   // TabsCacheMode{CACHE_BOTH_SIDE=0, CACHE_LATEST_SWITCHED=1}
                                      //   （swiper_pattern.cpp:816：缺省 CACHE_BOTH_SIDE）
      cachedLru: [],                  // CACHE_LATEST_SWITCHED 的最近切换索引（容量 cachedMaxCount+1，
                                      //   swiper_pattern.cpp:838-842）
      // R155-B EdgeEffect（tabs.d.ts:1273-1282 缺省 EdgeEffect.Spring；enums.d.ts:1494 枚举序
      // Spring=0/Fade=1/None=2——本 SDK 枚举无 Shadow 成员，'shadow' 是任务书收的前向扩展值）：
      edgeEffect: 'spring',           // 'spring'|'none'|'shadow'（builtin.js attachPagedDrag 槽位读取）
      edgeAlwaysEnabled: null,        // EdgeEffectOptions.alwaysEnabled 记录面；null=未设（见 case 注释）
      // R158 长尾第四片状态：
      animationMode: 0,               // AnimationMode{CONTENT_FIRST=0, ACTION_FIRST=1, NO_ANIMATION=2}
                                      //   （tabs.d.ts:80，since 12；缺省 CONTENT_FIRST——先加载目标
                                      //   页内容再播切换动画，本运行时"可见性立即落新页 + 入场
                                      //   transform"正是 CONTENT_FIRST 语义，缺省无需额外改动）
      contentWillChange: null,        // onContentWillChange 单槽覆盖（(cur, coming)=>boolean，
                                      //   false=拒绝切换，tabs.d.ts:1636）
      contentDidScroll: null,         // onContentDidScroll 单槽覆盖（拖拽逐帧，tabs.d.ts:1637+）
    });
    node.__tabsState = st;
    node.dataset.edgeEffect = st.edgeEffect;   // R155-B：缺省面可观测（d.ts 缺省 Spring）
    // R158：AnimationMode 缺省面可观测（CONTENT_FIRST；三值登记面见 applyTabsAttr case）
    node.dataset.animationMode = 'content_first';
    node.style.display = 'flex';
    node.style.flexDirection = 'column';
    node.style.overflow = 'hidden';
    node.style.position = 'relative';   // barOverlap 的 absolute bar 以此为包含块

    st.barEl = document.createElement('div');
    st.barEl.setAttribute('data-arkui-tabs-bar', st.barPosition);
    st.barEl.style.display = 'flex';
    st.barEl.style.flexDirection = 'row';
    st.barEl.style.flex = 'none';
    // R153-B：bar 内层栅格 wrapper——tab_bar_layout_algorithm.cpp:186/1090-1127 的 DOM 对应物
    //（barGridAlign 把 bar 内容限定在 gridWidth 内水平居中）。结构恒存在：未设栅格时 max-width
    // 不设=整宽，避免"有无栅格"两套条目结构（条目全部挂进它，见 finalizeTabs）。
    st.barGridEl = document.createElement('div');
    st.barGridEl.setAttribute('data-arkui-tabs-bar-grid', '');
    st.barGridEl.style.display = 'flex';
    st.barGridEl.style.width = '100%';
    st.barEl.appendChild(st.barGridEl);

    st.contentEl = document.createElement('div');
    st.contentEl.setAttribute('data-arkui-tabs-content', '');
    st.contentEl.style.flex = '1 1 auto';
    st.contentEl.style.position = 'relative';
    st.contentEl.style.overflow = 'hidden';

    node.appendChild(st.barEl);
    node.appendChild(st.contentEl);
    // TabContent 的挂靠点：mountTabContent 认领这里（此前恒走 parent 兜底，TabContent
    // 落成了 Tabs 的直接子级，见上方结构注释）
    (/** @type {any} */ (node)).__tabsContentEl = st.contentEl;   // R151 自有扩展属性
    applyTabsOptions(st, opt);
    applyTabsBarLayout(st);           // 初始方向/尺寸（含 d.ts 缺省：竖 56 宽、横 56 高）
    // R125 内置拖拽：内容区横扫翻 TabContent（scrollable 开关控制；恒横向、无 loop）
    // R152-B：duration 接 animationDuration（0=即时翻页）；gesture/animStart/animEnd 由
    // 拖拽生命周期派发到 Tabs 回调（门控与事件序见各 fireTabsXxx / setActiveTab 注释）
    attachPagedDrag(st.contentEl, {
      /** @returns {string} */
      axis: () => 'x',
      /** @returns {boolean} */
      canDrag: () => st.scrollable,
      /** @returns {number} */
      index: () => st.index,
      /** @returns {number} */
      count: () => st.contents.length,
      /** @returns {boolean} */
      loop: () => false,
      /** @returns {number} */
      size: () => st.contentEl.clientWidth,
      /** @returns {number} */
      duration: () => TABS_SPRING_SWITCH_MS,  // 拖拽释放翻页时长=spring 内禀近似（R153-B 纠偏：
                                              //   d.ts animationDuration JSDoc 明说 animationDuration
                                              //   只控制点击/changeIndex，拖拽释放由 interpolatingSpring
                                              //   内禀参数决定——R152 曾把 animationDuration 接到这里）
      // R154：拖拽释放曲线槽位（builtin.js builtinFinishPagedDrag 读取）——显式设过
      // animationCurve 才接管曲线（spring=真机 interpolatingSpring 的解算器近似；
      // css=点击曲线串）；未设返回 null 保持 R125 既有 ease-out 行为
      finishCurve: () => (st.animCurveSet
        ? (st.animCurveKind === 'spring'
          ? { kind: 'spring' }
          : { kind: 'css', css: st.animCurveCss })
        : null),
      // R155-B：到边行为开关槽位（builtin.js builtinEdgeEffect 读取）——edgeEffect 属性
      //（applyTabsAttr case 'edgeEffect'）落在 st.edgeEffect，拖拽越界分支（outward 摩擦）
      // 与松手回弹分支按它分支化
      edgeEffect: () => st.edgeEffect,
      /** @param {number} i */
      pageAt: (i) => (st.contents[i] ? st.contents[i].el : null),
      /** @param {number} i */
      commit: (i) => { setActiveTab(st, i, true, true); },   // fromDrag：动画事件对由拖拽收口自己发
      /** @param {number} i @param {any} extra */
      gesture: (i, extra) => {
        // 真机拖拽期 extra 只填 currentOffset、velocity 恒 0（C 简报对齐；
        // builtin 拖拽舞台给的采样速度在 Tabs 侧丢弃，形状收敛到 TabsAnimationEvent 缺省）
        const off = extra && typeof extra.currentOffset === 'number' ? extra.currentOffset : 0;
        fireTabsGestureSwipe(st, i, {
          currentOffset: off,
          targetOffset: 0,
          velocity: 0,
        });
        // R158 onContentDidScroll（tabs.d.ts:1637+，since 12）：与 onGestureSwipe 同期逐帧派发
        //（builtin attachPagedDrag 的 gesture 槽位，每次 move 一帧）。真机每帧按 viewport 内
        // 页数调用（两页各一次）；position 本实现取位移/size（任务书口径——真机是 vp 偏移，
        // 单位偏差已记录，页宽归一后形状同构）。当前页 position=off/size；邻页贴在拖拽方向
        // 前方一整页，position=off/size±1（同 builtin.js nbOff=shown+sign*size 的几何）；
        // 界外拖拽无邻页（drag.nIdx=-1 同判）→ 只发当前页一帧。
        const size = st.contentEl.clientWidth;
        if (size > 0 && st.contentDidScroll) {
          const ratio = off / size;
          fireTabsContentDidScroll(st, i, i, ratio, size);
          const nb = i + (off < 0 ? 1 : -1);
          if (nb >= 0 && nb < st.contents.length) {
            fireTabsContentDidScroll(st, i, nb, ratio + (nb > i ? 1 : -1), size);
          }
        }
      },
      /** @param {number} idx @param {number} target */
      animStart: (idx, target) => { fireTabsAnimStart(st, idx, target); },
      /** @param {number} i */
      animEnd: (i) => { fireTabsAnimEnd(st, i); },
      // R153-B：拖拽路径的动画事件不再受 animationDuration 门控（R152 的 >0 门控随 duration
      // 纠偏一并移除——spring 内禀动画与 animationDuration 无关；点击路径的 duration=0 门控
      // 仍在 setActiveTab 的 animate 判定里，语义分家）
    });
    // R153-B pageFlipMode（tabs.d.ts:1885-1911；swiper_pattern.cpp:3027-3049 的 DOM 等价）：
    // 鼠标滚轮在内容区翻页。每轴事件翻一页，主轴位移取 |deltaX|/|deltaY| 的主者；方向取 DOM
    // 惯例"下滚=下一页"（真机 AXIS mainDelta>0→ShowPrevious 是 ACE 轴坐标"内容前进为正"的
    // 约定，换算后同为下滚前进，swiper_pattern.cpp:3039-3044）。SINGLE：翻页动画进行中忽略
    // 后续滚轮（swiper_pattern.cpp:3041——"一次一页"）；CONTINUOUS：不设闸连滚连翻（动画重定靶
    // =打断补发 End 再开新场，settleTabsAnim 既有语义）。边界不翻页（真机无 loop），preventDefault
    // 阻止页面随滚；Ctrl+滚轮是缩放手势，不参与翻页。
    st.contentEl.addEventListener('wheel', (/** @type {WheelEvent} */ ev) => {
      const n = st.contents.length;
      if (n < 2 || ev.ctrlKey) return;
      const d = Math.abs(ev.deltaX) >= Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (!d) return;
      ev.preventDefault();
      if (st.pageFlipMode === 1 && st.tabAnim) return;   // SINGLE：上一页动画没收口
      const target = st.index + (d > 0 ? 1 : -1);
      if (target < 0 || target >= n) return;
      setActiveTab(st, target, true);
    }, { passive: false });
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
    // barPosition（重渲染重建路径也走这里）决定方向矩阵的一维 → 统一重算几何（幂等）
    applyTabsBarLayout(st);
  }

  // ── W4.1-W4.4：vertical / barMode / barWidth·barHeight·barOverlap / 三回调 ──
  // 统一入口：ensureComponent('Tabs') 的组件自有方法把属性链转发到这里。
  /** @param {any} node @param {string} key @param {any} value @param {any} extra */
  function applyTabsAttr(node, key, value, extra) {
    const st = node && node.__tabsState;
    if (!st) {
      layoutWarnings.push(`Tabs.${key}: 栈顶不是 Tabs（属性方法必须紧跟 Tabs.create）`);
      return;
    }
    switch (key) {
      case 'vertical':
        // d.ts tabs.d.ts:1027-1043：true=竖排（tab 栏在左/右），false=横排（上/下）
        st.vertical = !!value;
        applyTabsBarLayout(st);
        return;
      case 'barMode': {
        // d.ts tabs.d.ts:59/69 枚举序：Scrollable=0、Fixed=1；:1099 默认 Fixed
        const m = String(resolveResource(value));
        if (m === 'scrollable' || m === '0') st.barMode = 'scrollable';
        else if (m === 'fixed' || m === '1') st.barMode = 'fixed';
        else {
          layoutWarnings.push(`Tabs.barMode('${value}') 不是 Fixed/Scrollable，按 Fixed 处理`);
          st.barMode = 'fixed';
        }
        // 第二参 ScrollableBarModeOptions（margin/nonScrollableLayoutStyle，tabs.d.ts:744-772）
        // 本片不接——按纪律记诊断，不静默吞
        if (extra && typeof extra === 'object') {
          layoutWarnings.push('Tabs.barMode 的 ScrollableBarModeOptions'
            + '（margin/nonScrollableLayoutStyle）未实现，已忽略');
        }
        applyTabsBarLayout(st);
        return;
      }
      case 'barWidth':
      case 'barHeight':
        // 真机不随轴交换：setter 直接写 TabBar 节点的 userDefinedIdealSize 宽/高
        // （tabs_model_ng.cpp:285-325）——width 恒作用宽、height 恒作用高；横排常设
        // height、竖排常设 width 只是缺省方向不同（缺省见 applyTabsBarLayout）。
        // 小于 0 按 d.ts "用缺省值" 处理（tabs.d.ts:1110-1111）；> Tabs 自身尺寸的
        // 钳制需要几何信息，本片不做。
        st[key] = (typeof value === 'number' && value < 0) ? null : value;
        applyTabsBarLayout(st);
        return;
      case 'barOverlap':
        // d.ts tabs.d.ts:1454-1467：true=bar 带模糊底悬浮在 TabContent 上（默认 COMPONENT_THICK）。
        // 几何真做（absolute 悬浮 + 内容区不避让，tabs_layout_algorithm.cpp:898-940 overlap
        // 分支不减 bar 尺寸）；模糊用 backdrop-filter 近似 + 记诊断（不是真机 BlurStyle）。
        if (!!value && !st.barOverlap) {
          layoutWarnings.push('Tabs.barOverlap(true)：模糊底为 backdrop-filter 近似'
            + '（真机 BlurStyle.COMPONENT_THICK，tabs_model_ng.cpp:498-507），色彩/材质与设备有差');
        }
        st.barOverlap = !!value;
        applyTabsBarLayout(st);
        return;
      case 'onTabBarClick':   // d.ts tabs.d.ts:1344-1355：点击 tab 触发，入参=点击索引
      case 'onSelected':      // d.ts tabs.d.ts:1314-1342：选中变化，入参=新选中索引
      case 'onUnselected':    // d.ts tabs.d.ts:1357-1377：选中变化，入参=即将隐藏的旧索引
        // 覆盖语义（与通用事件 __arkuiEv 同口径）：重渲染重复应用不翻倍
        if (typeof value === 'function') st[key] = value;
        else {
          st[key] = null;
          layoutWarnings.push(`Tabs.${key} 需要函数，收到 ${typeof value}，已忽略`);
        }
        return;
      // ── R152-B：动画/拖拽族四件（此前在 TABS_UNSUPPORTED，现真语义）──
      case 'animationDuration': {
        // d.ts tabs.d.ts:1221-1246：ms，[0,+∞)；只控制点击 tab / changeIndex 触发的切换动画
        //（拖拽释放由 interpolatingSpring(-1,1,228,30) 内禀参数决定，【不受本值控制】——
        // R153-B 纠偏：拖拽收口时长改取 TABS_SPRING_SWITCH_MS，见 createTabsState 的拖拽 api）。
        // 负值/非法【不生效】（tabs_model_ng.cpp:474-490 只在 ≥0 时写，保持现值=缺省 300，
        // 真机静默忽略故不记警告，避免重渲染刷屏）；0=点击路径无动画且不触发动画回调
        //（spring 族曲线除外，见 setActiveTab 的 springSwitch 判定）。
        const n = Number(resolveResource(value));
        if (Number.isFinite(n) && n >= 0) st.animationDuration = n;
        return;
      }
      case 'onAnimationStart':  // d.ts tabs.d.ts:1379-1392：(index, targetIndex, extraInfo) 三参
      case 'onAnimationEnd':    // d.ts tabs.d.ts:1395-1408：(index, extraInfo) 两参
        // 多播（真机 SwiperEventHub list emplace_back，swiper_event_hub.h:69-77——重复注册都发，
        // 与 R125 Swiper 的 push 数组同款；重渲染重复应用会翻倍是已知取舍，与 area.js 的
        // Tabs/Swiper onChange push 同口径）
        if (typeof value === 'function') {
          (key === 'onAnimationStart' ? st.animStart : st.animEnd).push(value);
        } else {
          layoutWarnings.push(`Tabs.${key} 需要函数，收到 ${typeof value}，已忽略`);
        }
        return;
      case 'onGestureSwipe':    // d.ts tabs.d.ts:1411-1423：(index, extraInfo) 逐帧
        // 单槽覆盖（真机 SetGestureSwipeEvent swap，swiper_event_hub.h:79-84——后注册替前注册）
        if (typeof value === 'function') st.gestureSwipe = value;
        else {
          st.gestureSwipe = null;
          layoutWarnings.push(`Tabs.${key} 需要函数，收到 ${typeof value}，已忽略`);
        }
        return;
      // ── R153-B：长尾第三片四件（此前在 TABS_UNSUPPORTED，现真语义）──
      case 'barGridAlign':
        // 入参面见 normalizeBarGridAlign；几何单一出口 applyTabsBarGrid（applyTabsBarLayout 末尾
        // 统一调，finalizeTabs 后有真实宽度才量得出档位——这里只落参数）
        st.barGridAlign = normalizeBarGridAlign(value);
        applyTabsBarLayout(st);
        return;
      case 'animationCurve': {
        // d.ts tabs.d.ts:1537-1551（since 20）：Curve | ICurve。双缺省（未设时）：点击 tab /
        // changeIndex = cubicBezierCurve(0.2,0,0.1,1)；拖拽释放 = interpolatingSpring(-1,1,228,30)
        //（内禀时长，不受 animationDuration 控制——JSDoc 原文）。设置自定义曲线后作用于所有切换
        // 动画（SetAnimationCurve 同时写 bar 与 swiper，tabs_model_ng.cpp:1192-1204；bar 侧指示条
        // 动画本实现无对应物、无 DOM 可观测面，不实现）。spring 族近似曲线见 TABS_SPRING_CSS。
        const parsed = parseTabsAnimCurve(value);
        if (!parsed) {
          layoutWarnings.push(`Tabs.animationCurve(${JSON.stringify(value)}) `
            + '不是 Curve 枚举/spring 族名/CSS 曲线串（ICurve 对象本运行时读不出参数），保持现值');
          return;
        }
        st.animCurveKind = parsed.kind;
        st.animCurveCss = parsed.css;
        st.animCurveSet = true;   // R154：显式设过才接 builtin.js 的 finishCurve 槽位（拖拽释放曲线）
        return;
      }
      case 'pageFlipMode': {
        // d.ts tabs.d.ts:1885-1911：鼠标滚轮翻页模式，默认 CONTINUOUS；非法值回退 CONTINUOUS
        //（swiper_pattern.cpp:8196-8202 静默回退，真机同——不记警告）。PageFlipMode 枚举序：
        // CONTINUOUS=0 / SINGLE=1。
        const m = resolveResource(value);
        st.pageFlipMode = (m === 1 || m === '1' || m === 'single' || m === 'SINGLE') ? 1 : 0;
        return;
      }
      case 'cachedMaxCount': {
        // d.ts tabs.d.ts:1913-1958：cachedMaxCount(count, mode)——mode 是【第二参】（走 applyTabsAttr
        // 的 extra，同 barMode 的 ScrollableBarModeOptions 通道），缺省 CACHE_BOTH_SIDE
        //（swiper_pattern.cpp:816）。count<0 或 ≥ 页数 → 全部缓存（swiper_pattern.cpp:868-869
        // 静默不设限，真机同）；非数显式记警告（程序错误，与真机静默不同，见报告）。
        const n = Number(resolveResource(value));
        if (!Number.isFinite(n)) {
          layoutWarnings.push(`Tabs.cachedMaxCount(${JSON.stringify(value)}) 不是数字，已忽略`);
          return;
        }
        st.cachedMaxCount = Math.trunc(n);
        const mode = resolveResource(extra);
        if (mode === undefined || mode === null || mode === 0 || mode === '0' ||
            mode === 'cache_both_side' || mode === 'CACHE_BOTH_SIDE') st.cacheMode = 0;
        else if (mode === 1 || mode === '1' || mode === 'cache_latest_switched' ||
                 mode === 'CACHE_LATEST_SWITCHED') st.cacheMode = 1;
        else {
          st.cacheMode = 0;
          layoutWarnings.push(`Tabs.cachedMaxCount 第二参 mode=${JSON.stringify(extra)} `
            + '不是 TabsCacheMode（CACHE_BOTH_SIDE=0 / CACHE_LATEST_SWITCHED=1），按缺省 CACHE_BOTH_SIDE 处理');
        }
        applyTabsCache(st);
        return;
      }
      // ── R155-B：edgeEffect（此前在 TABS_UNSUPPORTED，现真语义）──
      case 'edgeEffect': {
        // d.ts tabs.d.ts:1273-1282（since 12）：edgeEffect(edgeEffect: Optional<EdgeEffect>)，
        // 缺省 EdgeEffect.Spring；真机到边行为：仅 Spring 允许越界（swiper_pattern.cpp:302
        // SetCanOverScroll(effect==SPRING)），None 硬停（:3341-3345 越界钳边界、:4137-4166
        // 松手不 PlaySpringAnimation）。枚举序 enums.d.ts:1494 = Spring=0/Fade=1/None=2
        //（本 SDK 枚举【无 Shadow 成员】——common.d.ts:25290 的 "spring and shadow effects"
        // 是 Scrollable 通用面的 JSDoc 散文；'shadow' 按任务书收作前向扩展值=Spring 行为
        // + 视觉标记）。行为分支在 builtin.js attachPagedDrag 的 edgeEffect 槽位
        //（pointermove outward 硬停 / builtinFinishPagedDrag 的 !flip 直接落位）。
        const prev = st.edgeEffect;
        const parsed = parseEdgeEffect(value);
        if (!parsed) {
          // 未实现/非法入参同槽记警告（含 G8 依赖的 'Tabs.edgeEffect 未实现' 前缀——
          // 传入面只认本运行时 api 值与枚举序数，大小写敏感照 barMode 先例）
          layoutWarnings.push(`Tabs.edgeEffect 未实现入参 ${JSON.stringify(value)}`
            + `（本运行时已接 'spring'|'none'|'shadow' 与枚举序数 Spring=0/None=2；`
            + 'Fade 未实现），保持现值');
          return;
        }
        st.edgeEffect = parsed;
        node.dataset.edgeEffect = parsed;
        if (parsed === 'shadow') {
          if (prev !== 'shadow') {
            layoutWarnings.push('Tabs.edgeEffect(shadow)：真机 Shadow=Spring 行为叠加边界阴影'
              + '视觉——阴影无 DOM 对应物，只落 data-shadow="true" 标记（barOverlap 的 '
              + 'backdrop-filter 先例），行为与 Spring 相同（越界冲激回弹）');
          }
          node.dataset.shadow = 'true';
        } else if (node.dataset.shadow) {
          delete node.dataset.shadow;
        }
        // 第二参 options（EdgeEffectOptions{alwaysEnabled}，common.d.ts:25859）——【按任务书
        // 面收】：本 SDK 的 Tabs.edgeEffect 签名没有 options（tabs.d.ts:1282 单参；带 options
        // 的是 Scrollable 通用面 common.d.ts:25303）。记录 state+data-*，行为无对应如实记警告。
        if (extra !== undefined && extra !== null) {
          if (typeof extra === 'object' && typeof (/** @type {any} */ (extra)).alwaysEnabled === 'boolean') {
            const ae = (/** @type {any} */ (extra)).alwaysEnabled;
            if (st.edgeAlwaysEnabled !== ae) {
              st.edgeAlwaysEnabled = ae;
              node.dataset.edgeAlwaysEnabled = String(ae);
              layoutWarnings.push(`Tabs.edgeEffect 第二参 options.alwaysEnabled=${ae}：仅记录`
                + '（data-edge-always-enabled）——本运行时 Tabs 内容恒满容器，无"内容小于组件"'
                + '的触发面可作用；且本 SDK Tabs.edgeEffect 签名无 options（tabs.d.ts:1282）');
            }
          } else {
            layoutWarnings.push(`Tabs.edgeEffect 第二参 options=${JSON.stringify(extra)} `
              + '不是 EdgeEffectOptions（缺 alwaysEnabled:boolean），已忽略');
          }
        }
        return;
      }
      // ── R158：长尾第四片四件（animationMode/onContentWillChange/onContentDidScroll 真语义；
      // customContentTransition 仍留 TABS_UNSUPPORTED 记警告）──
      case 'animationMode': {
        // d.ts tabs.d.ts:80 AnimationMode 枚举序：CONTENT_FIRST=0 / ACTION_FIRST=1 /
        // NO_ANIMATION=2（since 12，缺省 CONTENT_FIRST）。三值语义对本运行时的对应：
        //   · CONTENT_FIRST（缺省）：先加载目标页内容再播切换动画——既有"可见性立即落新页 +
        //     入场 transform"正是该语义，无需额外改动（登记面 dataset 区分三值）；
        //   · ACTION_FIRST：先播动画再加载目标页内容——仅 tabs 高/宽均非 auto 生效；对本运行时
        //     的 display 切换模型而言与 CONTENT_FIRST 视觉无差（内容页都是即时构建、无"加载"
        //     阶段），如实记 dataset 不做行为分支；
        //   · NO_ANIMATION：禁用默认切换动画——仅【点击路径】生效（setActiveTab 的 fromClick
        //     判定，见该处注释）；changeIndex 不受影响（d.ts/任务书口径）；与 animationDuration
        //     语义分家（duration=0 连 spring 曲线外的所有路径都关，NO_ANIMATION 只关点击路径
        //     且不管曲线）。
        // 入参面照 edgeEffect/barMode 先例：枚举序数（编译产物 AnimationMode.X 就是序数）+
        // 小写枚举名（'content_first'|'action_first'|'no_animation'，精确小写、大小写敏感）。
        // 非法值记警告 + 保持现值（不静默——G8 断言面依赖警告纪律）。
        const r = resolveResource(value);
        const byName = /** @type {Record<string, number>} */ (
          { content_first: 0, action_first: 1, no_animation: 2 });
        let mode = -1;
        if (r === 0 || r === 1 || r === 2) mode = r;
        else if (typeof r === 'string' && r in byName) mode = byName[r];
        if (mode < 0) {
          layoutWarnings.push(`Tabs.animationMode 未实现入参 ${JSON.stringify(value)}`
            + '（本运行时已接枚举序数 CONTENT_FIRST=0/ACTION_FIRST=1/NO_ANIMATION=2 与'
            + "小写枚举名 'content_first'/'action_first'/'no_animation'），保持现值");
          return;
        }
        st.animationMode = mode;
        node.dataset.animationMode = ['content_first', 'action_first', 'no_animation'][mode];
        return;
      }
      case 'onContentWillChange':   // d.ts tabs.d.ts:1636：(currentIndex, comingIndex)=>boolean
      case 'onContentDidScroll': {  // d.ts tabs.d.ts:1637+：(selectedIndex, index, position,
                                    //   mainAxisLength) 拖拽逐帧（builtin gesture 槽位派发）
        // 覆盖语义单槽（与 onGestureSwipe 同口径：后注册替前注册，重复应用不翻倍）。
        // 状态字段名不带 on 前缀（gestureSwipe 先例）——消费点 setActiveTab 守卫 /
        // createTabsState gesture 槽位读 st.contentWillChange / st.contentDidScroll
        const slot = key === 'onContentWillChange' ? 'contentWillChange' : 'contentDidScroll';
        if (typeof value === 'function') st[slot] = value;
        else {
          st[slot] = null;
          layoutWarnings.push(`Tabs.${key} 需要函数，收到 ${typeof value}，已忽略`);
        }
        return;
      }
    }
  }

  // ── R153-B：barGridAlign / animationCurve 入参归一化 ──

  // BarGridColumnOptions{sm?,md?,lg?,margin?,gutter?}（tabs.d.ts:762-830）归一化：sm/md/lg 是
  // 栅格列数（缺省 -1=该档整宽，d.ts JSDoc "The default value is -1"）；margin/gutter 是栅格
  // 边距/列距（d.ts 缺省 24vp——"Default value: 24.0"，tabs_model.h BarGridColumnOptions 同值）。
  // 非对象返回 null（未设）；列数非有限数按缺省 -1（=整宽，与 cpp columnNum<0 分支同义）；
  // margin/gutter 百分比串 d.ts 明令禁止（"cannot be set in percentage"）→ 按缺省 24 处理。
  /** @param {any} v @returns {any} */
  function normalizeBarGridAlign(v) {
    const o = resolveResource(v);
    if (!o || typeof o !== 'object') return null;
    /** @param {any} x @returns {number} */
    const col = (x) => {
      const n = Number(x);
      return Number.isFinite(n) ? Math.trunc(n) : -1;
    };
    /** @param {any} x @param {number} def @returns {number} Dimension 数值（vp≈px 1:1） */
    const dim = (x, def) => {
      if (typeof x === 'number' && Number.isFinite(x)) return Math.max(0, x);
      if (typeof x === 'string') {
        const n = parseFloat(x);
        if (Number.isFinite(n) && !/%\s*$/.test(x)) return Math.max(0, n);
      }
      return def;
    };
    return { sm: col(o.sm), md: col(o.md), lg: col(o.lg), margin: dim(o.margin, 24), gutter: dim(o.gutter, 24) };
  }

  // animationCurve 入参面：Curve 枚举值（数字）/ spring 族名 / CSS 曲线串 / ICurve 对象 → {kind, css}。
  //   · Curve 枚举（d.ts curve.d.ts）：0=Linear 1=Ease 2=EaseIn 3=EaseOut 4=EaseInOut 与 CSS
  //     同名关键字一一对应（真机即同名 bezier）；5=Friction 6=Smooth 无官方 CSS 等价，取近似
  //     （仅近似，不在断言面）。
  //   · spring 族名（curves.interpolatingSpring/springMotion/responsiveSpringMotion/springCurve
  //     对应的字符串形态）→ kind='spring'：内禀时长（TABS_SPRING_SWITCH_MS）、CSS 近似曲线。
  //   · ICurve 对象（R156-B，@ohos:curves 垫片产出、真机形状 { interpolate, __curveString }）：
  //     读 __curveString 序列化参数包（真机 jsi_curves_module.cpp ParseCurves 的 curve->ToString()
  //     产物，6 位小数无空格）——'spring(v,m,s,d)'/'interpolating-spring(v,m,s,d)'/
  //     'responsive-spring-motion(...)' → kind='spring'（内禀时长 + TABS_SPRING_CSS 近似；参数包
  //     语义已由 spring 分族表达，不解参不落状态）；'cubic-bezier(x1,y1,x2,y2)' → kind='css' 直通
  //     （CSS 同名函数原生支持）；'steps(n,end|start)' → kind='css' 归一成 'steps(n, end|start)'
  //     （CSS steps() 原生支持，jump-end/jump-start 语义同构）；枚举名两形态——'Curves.Ease' 驼峰
  //     （C++ Curves::ToString 表，core/animation/curves.cpp:33-40）与小写 kebab（'ease'/
  //     'fast-out-slow-in'/...，dom_type.cpp:292-304 同词汇）→ CSS 关键字或【等参】cubic-bezier
  //     串（参数表见 TABS_ICURVE_ENUM_CSS，core/animation/curves.cpp:22-40 全清单）。
  //   · 'customCallback'（curves.customCurve 产物）/无 __curveString/未识别前缀 → 返回 null 由
  //     调用方记警告保持现值（不静默吞，现口径）。
  // 枚举名 → CSS：前 5 项与 CSS 关键字同名直通；后 8 项 CSS 无对应关键字 → 按真机常数表给等参
  // cubic-bezier（比"近似曲线"更真，值逐项对齐 core/animation/curves.cpp:22-40）。
  /** @type {Record<string, string>} */
  const TABS_ICURVE_ENUM_CSS = {
    'linear': 'linear',
    'ease': 'ease',
    'ease-in': 'ease-in',
    'ease-out': 'ease-out',
    'ease-in-out': 'ease-in-out',
    'fast-out-slow-in': 'cubic-bezier(0.4, 0, 0.2, 1)',
    'linear-out-slow-in': 'cubic-bezier(0, 0, 0.2, 1)',
    'fast-out-linear-in': 'cubic-bezier(0.4, 0, 1, 1)',
    'friction': 'cubic-bezier(0.2, 0, 0.2, 1)',
    'extreme-deceleration': 'cubic-bezier(0, 0, 0, 1)',
    'sharp': 'cubic-bezier(0.33, 0, 0.67, 1)',
    'rhythm': 'cubic-bezier(0.7, 0, 0.2, 1)',
    'smooth': 'cubic-bezier(0.4, 0, 0.4, 1)',
  };
  /** @param {any} v @returns {any} */
  function parseTabsAnimCurve(v) {
    const r = resolveResource(v);
    if (typeof r === 'number') {
      const byNum = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
        'cubic-bezier(0.2, 0.0, 0.0, 1.0)', 'cubic-bezier(0.4, 0.0, 0.2, 1.0)'];
      return { kind: 'css', css: byNum[r] || 'ease' };
    }
    if (typeof r === 'string') {
      const s = r.trim().toLowerCase();
      if (s === 'interpolatingspring' || s === 'spring' || s === 'springcurve' ||
          s === 'springmotion' || s === 'responsivespringmotion') {
        return { kind: 'spring', css: TABS_SPRING_CSS };
      }
      if (/^cubic-bezier\(/.test(s) ||
          ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].indexOf(s) >= 0) {
        return { kind: 'css', css: s };
      }
      return null;
    }
    // R156-B ICurve 对象分支（对象/数组都走这里；数组无 __curveString 落 null 警告路径）
    if (r && typeof r === 'object') {
      // 保留原大小写（驼峰枚举名 'Curves.EaseIn' 的 [A-Z] 是 kebab 化依据）；cs 为小写比较串
      const raw = typeof (/** @type {any} */ (r)).__curveString === 'string'
        ? (/** @type {any} */ (r)).__curveString.trim() : '';
      const cs = raw.toLowerCase();
      if (!cs) return null;                      // 无参数包（裸 {interpolate} / 数组）→ 警告保持现值
      if (/^(?:spring|interpolating-spring|responsive-spring-motion)\(/.test(cs)) {
        return { kind: 'spring', css: TABS_SPRING_CSS };
      }
      if (/^cubic-bezier\(/.test(cs)) {
        return { kind: 'css', css: cs };         // 真机 6 位小数串是合法 CSS，直通
      }
      const steps = /^steps\((\d+),(end|start)\)$/.exec(cs);
      if (steps) return { kind: 'css', css: `steps(${steps[1]}, ${steps[2]})` };
      // 枚举名两形态：'Curves.EaseIn'（C++ Curves::ToString 驼峰，curves.cpp:33-40）→ kebab 化后
      // 查表（驼峰边界取小写字母→大写字母的过渡，首字符大写不产前导连字符）；小写 kebab
      //（'ease-in'，dom_type.cpp:292-304 词汇）直查。'curves.easein' 之类无分隔小写驼峰不认
      //（两形态之外，落警告保持现值）
      const name = raw.startsWith('Curves.')
        ? raw.slice(7).replace(/([a-z])([A-Z])/g, (/** @type {string} */ _m, /** @type {string} */ a, /** @type {string} */ b) => a + '-' + b).toLowerCase()
        : cs;
      if (TABS_ICURVE_ENUM_CSS[name]) return { kind: 'css', css: TABS_ICURVE_ENUM_CSS[name] };
      return null;                               // customCallback / 未识别形状 → 警告保持现值
    }
    return null;
  }

  // EdgeEffect 入参归一化（R155-B）：Tabs.edgeEffect 与 Swiper.effectMode/edgeEffect 共用。
  // 已实现面 = 本运行时 api 字符串 'spring'|'none'|'shadow'（**精确小写**，大小写敏感照
  // barMode 先例——不认 'None'/'Spring' 之类设备上不存在的字符串形态）+ 枚举序数 Spring=0 /
  // None=2（enums.d.ts:1494；编译产物侧 EdgeEffect.X 就是序数）。返回 null = 未实现或非法
  //（调用方记警告 + 保持现值）：1=Fade 是合法设备枚举但本片未实现；'shadow' 不是本 SDK
  // 枚举成员（enums.d.ts:1494 只有 Spring/Fade/None），按任务书收作前向扩展值。
  /** @param {any} v @returns {string|null} 'spring'|'none'|'shadow'，未实现/非法为 null */
  function parseEdgeEffect(v) {
    const r = resolveResource(v);
    if (typeof r === 'number') {
      if (r === 0) return 'spring';          // EdgeEffect.Spring
      if (r === 2) return 'none';            // EdgeEffect.None
      return null;                           // 1=Fade（未实现）与其余越界序数
    }
    if (typeof r === 'string' && (r === 'spring' || r === 'none' || r === 'shadow')) return r;
    return null;
  }

  // ── R153-B：cachedMaxCount 缓存窗口（swiper_pattern.cpp:850-897 HandleTabsCachedMaxCount 的
  // DOM 等价）。真机把窗外页 TabContentPattern::CleanChildren()（销毁子树、回访重建=不保活）；
  // DOM 里 deep-render 内容归框架所有、无法安全销毁重建，以 data-arkui-tab-evicted 标记 +
  // display:none 表达"窗外不保活"（标记语义=该页不在缓存窗口，回访视为重建），偏差已记录。
  // 窗口：CACHE_BOTH_SIDE=[i−n, i+n]（2n+1）；CACHE_LATEST_SWITCHED={当前}∪cachedLru（≤n+1）；
  // cachedMaxCount<0（未设）或 ≥ 页数 → 全部缓存（swiper_pattern.cpp:868-869）。
  /** @param {any} st */
  function applyTabsCache(st) {
    const n = st.contents.length;
    const cap = st.cachedMaxCount;
    const limited = n > 0 && cap >= 0 && cap < n;   // cpp 的设限前置（<0 或 ≥ 总数不限）
    const keep = /** @type {Set<number>} */ (new Set());
    if (limited) {
      if (st.cacheMode === 1) {
        keep.add(st.index);
        for (const idx of st.cachedLru) keep.add(idx);
      } else {
        for (let k = st.index - cap; k <= st.index + cap; k++) {
          if (k >= 0 && k < n) keep.add(k);
        }
      }
    }
    st.contents.forEach((/** @type {any} */ c, /** @type {number} */ k) => {
      c.el.setAttribute('data-arkui-tab-evicted', limited && !keep.has(k) ? 'true' : 'false');
    });
  }

  // bar 的几何单一出口：容器方向矩阵、bar 内条目走向、条目 flex/换行、bar 尺寸/悬浮。
  // finalizeTabs 重建条目后与每个属性 setter 之后都要走一遍（幂等，直接覆盖 style）。
  /** @param {any} st */
  function applyTabsBarLayout(st) {
    const node = st.node, bar = st.barEl;
    if (!node || !bar) return;
    // W4.1 方向矩阵（bar 恒为第一个子元素，视觉位置全部由 direction 表达，不搬 DOM——
    // d.ts tabs.d.ts:147-159：Start=上/左、End=下/右，取哪一维由 vertical 决定；
    // 真机布局同构：VERTICAL+START bar 贴左 / VERTICAL+END bar 贴右，tabs_layout_algorithm.cpp:767-777）：
    //   横 Start=column（bar 上）   横 End=column-reverse（bar 下）
    //   竖 Start=row（bar 左）      竖 End=row-reverse（bar 右）
    node.style.flexDirection = st.vertical
      ? (st.barPosition === 'end' ? 'row-reverse' : 'row')
      : (st.barPosition === 'end' ? 'column-reverse' : 'column');
    // 竖排 Tabs 的 tab 栏是纵向列表（真机 tab_bar 沿主轴排布条目）。R153-B：条目实际住在
    // 内层栅格 wrapper 里，走向由 wrapper 承担（barEl 的方向只约束 wrapper 自身）
    bar.style.flexDirection = st.vertical ? 'column' : 'row';
    const grid = st.barGridEl;
    if (grid) grid.style.flexDirection = st.vertical ? 'column' : 'row';
    // W4.2 barMode（d.ts tabs.d.ts:1068-1095；真机 tab_bar_layout_algorithm.cpp:217-231 均分 /
    // :281-334 按内容自然宽 + bar 可滚动）：Fixed=条目均分 bar 主轴（flex:1）；
    // Scrollable=按内容实际宽/高（flex:0 0 auto + 不换行），超出 bar 沿主轴滚动
    const scrollable = st.barMode === 'scrollable';
    const items = grid ? grid.children : bar.children;
    for (let k = 0; k < items.length; k++) {
      items[k].style.flex = scrollable ? '0 0 auto' : '1';
      items[k].style.whiteSpace = scrollable ? 'nowrap' : '';
    }
    bar.style.overflowX = (!st.vertical && scrollable) ? 'auto' : '';
    bar.style.overflowY = (st.vertical && scrollable) ? 'auto' : '';
    // W4.3 尺寸/悬浮。缺省照 d.ts（tabs.d.ts:1113-1130/1148-1167）+ 真机（barWidth/barHeight
    // 不随轴交换，缺省一轴拉满：竖排 bar 宽 56vp / 高拉满；横排 bar 高 56vp / 宽拉满，
    // tab_bar_layout_algorithm.cpp:101-122——拉满由 flex 交叉轴 stretch 承担）。
    const w = st.barWidth != null ? toCssSize(st.barWidth) : '';
    const h = st.barHeight != null ? toCssSize(st.barHeight) : '';
    if (st.barOverlap) {
      // 悬浮：absolute 脱离 flex 流 → 内容区（flex:1）自动占满整个 Tabs，不避让；
      // 停靠边随 barPosition（Start=左/上，End=右/下）。zIndex 显式压内容之上
      // （真机 bar 在子节点序中后挂、画在 TabContent 之上，tabs_node.h:28-35）
      bar.style.position = 'absolute';
      bar.style.zIndex = '1';
      bar.style.left = (st.vertical && st.barPosition === 'end') ? '' : '0';
      bar.style.right = (st.vertical && st.barPosition === 'end') ? '0' : '';
      bar.style.top = (!st.vertical && st.barPosition === 'end') ? '' : '0';
      bar.style.bottom = (!st.vertical && st.barPosition === 'end') ? '0' : '';
      bar.style.width = st.vertical ? (w || '56px') : (w || '100%');
      bar.style.height = st.vertical ? (h || '100%') : (h || '56px');
      // COMPONENT_THICK 的近似：backdrop-filter 模糊 + 浅色底（真机材质带系统取色，见上诊断）
      bar.style.backdropFilter = 'blur(16px)';
      bar.style.backgroundColor = 'rgba(247,247,247,0.55)';
    } else {
      bar.style.position = '';
      bar.style.zIndex = '';
      bar.style.left = '';
      bar.style.right = '';
      bar.style.top = '';
      bar.style.bottom = '';
      bar.style.backdropFilter = '';
      bar.style.backgroundColor = '';
      bar.style.width = w || (st.vertical ? '56px' : '');
      bar.style.height = h || (st.vertical ? '' : '56px');
    }
    // R153-B：barGridAlign 几何（依赖 bar 实际宽度，finalizeTabs 重建条目后调用本函数时才量得准；
    // 属性 setter 路径先量一次，finalize 后还会再走这里——幂等）
    applyTabsBarGrid(st);
  }

  // barGridAlign 几何（tab_bar_layout_algorithm.cpp:1090-1127 ApplyBarGridAlign +
  // grid_container_info.cpp BuildColumnWidth + grid_column_info.cpp GetWidth 的 DOM 等价）：
  //   ① 档位按【bar 内容宽】判（tabs.d.ts:762-830 字段 JSDoc：≥320 且 <600 为 SM / <840 为 MD /
  //      <1024 为 LG；<320(XS) 与 ≥1024(XL) 落 cpp 的 else 分支=不生效，ApplyBarGridAlign 只认
  //      SM/MD/LG 三档）；
  //   ② columnValue 取该档字段：> 档位上限（SM4/MD8/LG12，tab_bar_layout_algorithm.cpp:38-40）
  //      → 不生效；<0（含缺省 -1）或奇数 → 不生效（=整宽，cpp "columnNum < 0 || columnNum % 2"）；
  //   ③ columnWidth=(W−2×margin−(cols−1)×gutter)/cols（BuildColumnWidth）；gridWidth=
  //      columnValue×columnWidth+(columnValue−1)×gutter（GetWidth）；左右留白=(W−gridWidth)/2
  //      （cpp 返回值即此 margin）→ wrapper 设 max-width + margin auto 居中。
  // 仅水平模式生效（d.ts barGridAlign JSDoc 原文）：vertical 直接还原整宽（真机静默忽略，不记警告）。
  /** @param {any} st */
  function applyTabsBarGrid(st) {
    const bar = st.barEl, grid = st.barGridEl;
    if (!bar || !grid) return;
    const opt = (!st.vertical && st.barGridAlign) ? st.barGridAlign : null;
    let gridWidth = 0;
    if (opt) {
      const w = bar.clientWidth;
      let cols = 0, cap = 0, colNum = -1;
      if (w >= 320 && w < 600) { cols = 4; cap = 4; colNum = opt.sm; }
      else if (w >= 600 && w < 840) { cols = 8; cap = 8; colNum = opt.md; }
      else if (w >= 840 && w < 1024) { cols = 12; cap = 12; colNum = opt.lg; }
      if (cols > 0 && colNum >= 0 && colNum % 2 === 0 && colNum <= cap) {
        const columnWidth = (w - 2 * opt.margin - (cols - 1) * opt.gutter) / cols;
        gridWidth = colNum * columnWidth + (colNum - 1) * opt.gutter;
      }
    }
    if (gridWidth > 0) {
      grid.style.maxWidth = `${gridWidth}px`;
      grid.style.marginLeft = 'auto';     // (W−gridWidth)/2 的居中留白交给 margin:auto，
      grid.style.marginRight = 'auto';    // 宽度变化自愈（与 cpp 每次布局重算同语义）
    } else {
      grid.style.maxWidth = '';
      grid.style.marginLeft = '';
      grid.style.marginRight = '';
    }
  }

  /**
   * 切活动面板。fire=true 才发切换事件；fromDrag=true 表示来自内置拖拽的收口 commit——
   * 动画事件对（onAnimationStart/End）已由拖拽生命周期（builtinFinishPagedDrag）发过，
   * 这里只落内容/事件序，避免二次发。fromClick=true 表示来自 tab bar 条目点击（finalizeTabs
   * 的 click 监听）——仅该路径受 AnimationMode.NO_ANIMATION 影响（d.ts：NO_ANIMATION 禁用
   * 默认切换动画，changeIndex 不受影响；拖拽释放动画由 spring 内禀参数决定、同样不受影响）。
   * R152-B（C 简报对齐）：animationDuration 缺省 300（tab_theme.cpp:27,51-52），>0 时点击
   * tab / changeIndex 路径走 animateTabSwitch 入场动画；=0 时即时切换且不发动画事件
   * （swiper_pattern.cpp:2270-2273：duration=0 无动画、start/end 均不触发）。
   * R158 onContentWillChange（tabs.d.ts:1636）：真实切换（fire && old!==i）在【改 index 之前】
   * 调 handler(currentIndex, comingIndex)，返回 false 拒绝切换——index 不动、可见性不动、
   * 后续事件（onSelected/Unselected/动画对/onChange）全不发。三条路径（点击/changeIndex/
   * 拖拽收口 commit）都过守卫；拖拽路径的偏差：builtin 的收口序是 settle（还原拖拽舞台）→
   * commit → animEnd，拒绝时 commit 返回 false 内容留旧页（视觉正确），但 builtin 仍会补发
   * onAnimationEnd(target)——收口点在 builtin.js（所有权外），无法在该路径上抑制，偏差已记。
   * handler 抛错按 fail-open 处理（放行切换 + 记警告）：拦截器异常不应卡死切页。
   * @param {any} st @param {number} i @param {boolean} fire @param {boolean=} [fromDrag]
   * @param {boolean=} [fromClick]
   */
  function setActiveTab(st, i, fire, fromDrag, fromClick) {
    const n = st.contents.length;
    if (!n || !Number.isInteger(i) || i < 0 || i >= n) {
      layoutWarnings.push(`Tabs.changeIndex(${i}): 越界（共 ${n} 个 TabContent）`);
      return false;
    }
    const old = st.index;
    if (fire && old !== i && typeof st.contentWillChange === 'function') {
      let allow = true;
      try { allow = st.contentWillChange(old, i) !== false; }
      catch (e) { layoutWarnings.push(`Tabs.onContentWillChange 抛错：${e && e.message}`); }
      if (!allow) return false;   // 拒绝切换：不发任何后续事件（真机 willChange 拦截语义）
    }
    st.index = i;
    // 动画路径只认"点击 tab / changeIndex 的真实切换"（fire && old!==i）；拖拽 commit、
    // finalizeTabs 初始定位一律即时落可见性。真机 animateToPage 的内容动画是横向的
    // （Tabs 内容区恒横向滑动，与本实现 R125 拖拽同轴），vertical 时亦然。
    // R153-B：spring 族 animationCurve 不受 animationDuration 控制（d.ts animationDuration
    // JSDoc "curves unaffected by animationDuration"）——duration=0 时 spring 路径仍出动画。
    // R158：NO_ANIMATION 只关点击路径（fromClick）——直接落位（display 切换、无入场
    // transform 舞台、不发动画对），与 duration=0 分工：后者是全局时长门控、前者只关点击
    // 路径的默认动画（changeIndex/拖拽/spring 曲线均不受 NO_ANIMATION 影响）。
    const springSwitch = st.animCurveKind === 'spring';
    const animate = !!(fire && old !== i && !fromDrag && n > 1 &&
      (springSwitch || st.animationDuration > 0) &&
      !(st.animationMode === 2 && fromClick));
    if (animate) animateTabSwitch(st, old, i);
    else {
      // 非动画路径也要收掉可能在飞的上一场（如动画中又点了拖拽翻页）——否则旧舞台
      // settle 时会用【它的】目标页覆盖本次可见性
      settleTabsAnim(st);
      onlyOneVisible(st.contents, i);
    }
    [...(st.barGridEl || st.barEl).children].forEach((b, k) => {
      b.setAttribute('data-arkui-tabbar-active', k === i ? 'true' : 'false');
    });
    applyTabsCache(st);   // R153-B：缓存窗口随活动页/页数重算（BOTH_SIDE 或 LATEST_SWITCHED）
    if (fire && old !== i) {
      // 同索引切换不发切换事件：真机 OnIndexChange 有 oldIndex != targetIndex 前置
      // （swiper_pattern.cpp:339），selected/unselected 还有 selectedIndex_/unselectedIndex_
      // 去重（同 index 重复切不重发）——本实现切页即显（display 语义），old !== i 即等价。
      // 派发序照真机（点击 tab 的完整序列，W4.4 + R152-B 对齐 C 简报）：
      //   onTabBarClick(点击时先发，tab_bar_pattern.cpp:1597，见 finalizeTabs 的 click 监听)
      //   → onSelected(新) → onUnselected(旧)（动画启动时成对发，swiper_pattern.cpp:4389-4390）
      //   → onAnimationStart(旧→新)（swiper_pattern.cpp:4783-4792）
      //   → onChange(索引落定；真机在动画收口、紧贴 onAnimationEnd 之前发，
      //     swiper_pattern.cpp:6435-6481/4943-4952——**onChange 夹在 Start/End 之间**。
      //     本实现保持同步发以保证 R151 事件序断言兼容，但位置移到 Start 之后，序约束成立)
      //   → onAnimationEnd(新)（动画收口时发；duration=0 时不发）
      const safe = (/** @type {string} */ tag, /** @type {any} */ fn, /** @type {number} */ arg) => {
        if (typeof fn !== 'function') return;
        try { fn(arg); } catch (e) { layoutWarnings.push(`Tabs.${tag} 抛错：${e && e.message}`); }
      };
      safe('onSelected', st.onSelected, i);
      safe('onUnselected', st.onUnselected, old);
      if (animate) fireTabsAnimStart(st, old, i);
      if (st.cacheMode === 1 && st.cachedMaxCount >= 0) {
        // CACHE_LATEST_SWITCHED：最近切换 LRU，容量 cachedMaxCount+1（swiper_pattern.cpp:838-842
        // push_back + 超容 pop_front；同索引去重先 remove 再 push）
        const pos = st.cachedLru.indexOf(i);
        if (pos >= 0) st.cachedLru.splice(pos, 1);
        st.cachedLru.push(i);
        while (st.cachedLru.length > st.cachedMaxCount + 1) st.cachedLru.shift();
      }
      for (const cb of st.onChange) {
        try { cb(i); } catch (e) { layoutWarnings.push(`Tabs.onChange 抛错：${e && e.message}`); }
      }
    }
    return true;
  }

  // ── R152-B：动画/拖拽族的事件派发与切页动画舞台 ──
  // extra 都是 TabsAnimationEvent 三字段（tabs.d.ts:606-638）。Start/End 时本实现内容页是
  // display 切换式，切/收口瞬间页内偏移恒 0、无速度 → currentOffset/targetOffset/velocity 填 0
  // （与 R125 Swiper 的 animStart/End 同口径）；onGestureSwipe 的 currentOffset 是拖拽逐帧
  // 真实位移、velocity 恒 0（真机拖拽期同，C 简报）；offsetInCurrentSegment 在 Tabs 上不存在，不实现。

  /** @param {any} st @param {number} i @param {any} extra 逐帧：不受 duration 门控（d.ts 无此条件） */
  function fireTabsGestureSwipe(st, i, extra) {
    if (typeof st.gestureSwipe !== 'function') return;
    try { st.gestureSwipe(i, extra); }
    catch (e) { layoutWarnings.push(`Tabs.onGestureSwipe 抛错：${e && e.message}`); }
  }
  // R158 onContentDidScroll（tabs.d.ts:1637+）逐帧派发器：四参 (selectedIndex, index,
  // position, mainAxisLength)。position=位移/size（页宽归一，见 gesture 槽位注释）；
  // mainAxisLength=内容区主轴长（px≈vp 1:1，normalizeBarGridAlign 同口径）。仅拖拽逐帧派发
  //（点击/changeIndex 路径的入场动画不派发——本实现的动画是 transform 近似、非真实内容
  // 滚动，真机逐帧语义对应的是拖拽跟手）。
  /** @param {any} st @param {number} sel @param {number} idx @param {number} pos @param {number} len */
  function fireTabsContentDidScroll(st, sel, idx, pos, len) {
    if (typeof st.contentDidScroll !== 'function') return;
    try { st.contentDidScroll(sel, idx, pos, len); }
    catch (e) { layoutWarnings.push(`Tabs.onContentDidScroll 抛错：${e && e.message}`); }
  }
  /** @param {any} st @param {number} index @param {number} targetIndex */
  function fireTabsAnimStart(st, index, targetIndex) {
    for (const cb of st.animStart) {
      try { cb(index, targetIndex, { currentOffset: 0, targetOffset: 0, velocity: 0 }); }
      catch (e) { layoutWarnings.push(`Tabs.onAnimationStart 抛错：${e && e.message}`); }
    }
  }
  /** @param {any} st @param {number} index */
  function fireTabsAnimEnd(st, index) {
    for (const cb of st.animEnd) {
      try { cb(index, { currentOffset: 0, targetOffset: 0, velocity: 0 }); }
      catch (e) { layoutWarnings.push(`Tabs.onAnimationEnd 抛错：${e && e.message}`); }
    }
  }

  // 点击 tab / changeIndex 的内容切换动画（动画路径判定见 setActiveTab）：可见性【立即】落到
  // 新页（display 语义不动——既有断言在 tick(50) 内断"恰好一页可见"，中途不能出现两页同显），
  // 动画表达为【入场页纯 transform 滑入】（sign·size → 0），旧页即时离场。真机是两页对滑
  // （swiper AnimateTo 双向 translate），单向滑入是同族近似，偏差已记录。
  // 曲线/时长（R153-B，tabs.d.ts:1537-1551 双缺省 + SetAnimationCurve 全路径生效）：
  //   · css 曲线（含缺省）：时长=animationDuration（点击/changeIndex 路径的语义）；
  //   · spring 族：时长=TABS_SPRING_SWITCH_MS（内禀近似，**不受 animationDuration 控制**——
  //     duration=0 也出动画），曲线=TABS_SPRING_CSS（CSS 近似，差异已在常量处记录）。
  // 拖拽释放路径不经过本函数（builtin.js 收口，duration 由拖拽 api 提供）。
  // 收口"transitionend 见证 + 定时器兜底"（坑 ⑧：headless 动画事件不可靠）。
  /** @param {any} st @param {number} old @param {number} i */
  function animateTabSwitch(st, old, i) {
    settleTabsAnim(st);                         // 先收上一场（打断补发 End，swiper_pattern.cpp:2826-2864）
    const nextEl = st.contents[i] ? st.contents[i].el : null;
    const size = st.contentEl.clientWidth;      // 恒横向（R125 拖拽同轴）
    if (!nextEl || !(size > 0)) {
      // 舞台摆不出来（理论上只在零尺寸/缺页时）：退化为即时切换，但 End 仍要在
      // 下一拍补上，保证 Start/End 成对（setActiveTab 同步先发 Start）
      onlyOneVisible(st.contents, i);
      setTimeout(() => { fireTabsAnimEnd(st, i); }, 0);
      return;
    }
    onlyOneVisible(st.contents, i);             // 可见性立即落新页（display 语义不变）
    const sign = i > old ? 1 : -1;
    const dur = st.animCurveKind === 'spring' ? TABS_SPRING_SWITCH_MS : Math.max(0, st.animationDuration);
    const anim = {
      old, i, settled: false, timer: 0, nextEl,
      snap: { transform: nextEl.style.transform, transition: nextEl.style.transition },
      settle: /** @type {any} */ (null),
    };
    st.tabAnim = anim;
    // 入场舞台：只动 transform（版式/显示语义零接触）
    nextEl.style.transition = 'none';
    nextEl.style.transform = `translateX(${sign * size}px)`;   // 从拖拽方向前方滑入
    anim.settle = () => {
      const a = st.tabAnim;
      if (!a || a.settled) return;
      a.settled = true;
      if (a.timer) clearTimeout(a.timer);
      a.nextEl.removeEventListener('transitionend', a.settle);
      a.nextEl.style.transition = 'none';       // 还原入场舞台，交回静止语义
      a.nextEl.style.transform = a.snap.transform;
      a.nextEl.style.transition = a.snap.transition;
      st.tabAnim = null;                        // R153-B：舞台清场（pageFlipMode SINGLE 的"动画进行中"判据）
      fireTabsAnimEnd(st, a.i);                 // 打断/完成都发（isForceStop 同样发 End）
    };
    requestAnimationFrame(() => {
      const a = st.tabAnim;
      if (!a || a.settled || a !== anim) return;
      a.nextEl.style.transition = `transform ${dur}ms ${st.animCurveCss}`;
      a.nextEl.style.transform = 'translateX(0px)';
    });
    nextEl.addEventListener('transitionend', anim.settle, { once: true });
    anim.timer = setTimeout(anim.settle, dur + 80);   // 坑 ⑧ 兜底
  }
  /** @param {any} st 强制收口进行中的切页动画（无动画则空操作） */
  function settleTabsAnim(st) {
    if (st.tabAnim && typeof st.tabAnim.settle === 'function') {
      const settle = st.tabAnim.settle;
      settle();
    }
    st.tabAnim = null;
  }

  // Tabs.pop() 之后才知道有几个 TabContent、各自的标签是什么 → 那时才建 bar
  /** @param {any} st */
  function finalizeTabs(st) {
    const n = st.node;
    // bar 恒为第一个子元素：视觉位置（上/下/左/右）由 applyTabsBarLayout 的 direction
    // 矩阵表达，不搬 DOM（旧实现 End 时 appendChild 搬到末尾——与 row-reverse 方案冲突）
    if (n.firstElementChild !== st.barEl) n.insertBefore(st.barEl, n.firstChild);
    // 重建（重渲染时不会残留旧项）。R153-B：条目挂进内层栅格 wrapper（恒存在，见 createTabsState）
    const gridWrap = st.barGridEl || st.barEl;
    gridWrap.textContent = '';
    st.contents.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
      const item = document.createElement('div');
      item.setAttribute('data-arkui-tabbar-item', String(i));
      item.setAttribute('data-arkui-tabbar-active', 'false');
      item.textContent = c.label === undefined || c.label === null ? '' : String(c.label);
      item.style.textAlign = 'center';
      item.style.cursor = 'pointer';
      // flex/whiteSpace 由 applyTabsBarLayout 按 barMode 统一落（Fixed=flex:1 均分 /
      // Scrollable=flex:0 0 auto + nowrap），这里不预置
      item.addEventListener('click', () => {
        // 真机：TabBarPattern::HandleClick 先同步发 onTabBarClick(index)（tab_bar_pattern.cpp:1597
        // TabBarClickEvent），再驱动内容切换（ClickTo → swiper 换页）。同索引点击仍发
        // onTabBarClick（点击事件本身），但后续切换事件被 OnIndexChange 的 oldIndex !=
        // targetIndex 前置拦下（swiper_pattern.cpp:339），见 setActiveTab。
        if (typeof st.onTabBarClick === 'function') {
          try { st.onTabBarClick(i); }
          catch (e) { layoutWarnings.push(`Tabs.onTabBarClick 抛错：${e && e.message}`); }
        }
        // setActiveTab 第五参 fromClick=true：该路径受 AnimationMode.NO_ANIMATION 门控
        //（R158；changeIndex/拖拽路径不传，默认关闭）
        setActiveTab(st, i, true, false, true);
      });
      gridWrap.appendChild(item);
    });
    // 条目刚重建 → flex/whiteSpace/尺寸全部按当前 vertical×barMode×barWidth×barOverlap 重落
    applyTabsBarLayout(st);
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
  // R155-B：effectMode（swiper.d.ts:1805-1823，since 8，缺省 EdgeEffect.Spring，仅 loop=false
  // 生效）移出本表真语义——【Swiper 侧的 edgeEffect 属性真名是 effectMode】（common.d.ts:25303
  // 的 edgeEffect 属 Scrollable 通用面，Swiper 没有）；'edgeEffect' 键按任务书作为同路别名一并
  // 接入（SWIPER_ATTRS 两键同一处理器）。到边行为开关长在 builtin.js attachPagedDrag 槽位。
  const SWIPER_UNSUPPORTED = new Set([
    'displayArrow', 'displayMode', 'displayCount', 'nextMargin', 'prevMargin',
    'itemSpace', 'cachedCount', 'customContentTransition',
    'pageFlipMode', 'nestedScroll', 'maintainVisibleContentPosition', 'indicatorStyle', 'indicatorInteractive',
    'onContentDidScroll', 'onContentWillScroll',
    'onSelected', 'onUnselected', 'onScrollStateChanged',
  ]);
  // R125 起真语义：vertical/disableSwipe/duration/onAnimationStart/onAnimationEnd/onGestureSwipe
  // （内置拖拽，attachPagedDrag）；此前它们与上述一并落 data-*。
  // R154-B 起再加两件：curve（拖拽释放翻页曲线槽位，走 SWIPER_ATTRS.curve → api.finishCurve）
  // 与 indicator（DotIndicator/DigitIndicator 真语义，走 SWIPER_ATTRS.indicator）。
  // R155-B 再加 effectMode/edgeEffect（到边行为开关，走 SWIPER_ATTRS 两键 → api.edgeEffect）。

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
    // @type 档位：entries/animStart 等空数组不写会推成 never[]（拖拽 api 里要索引/遍历）
    const st = /** @type {any} */ ({
      node, index: 0, count: 0, entries: [],
      loop: true,                      // ArkUI 默认开启循环
      autoPlay: false, interval: 3000, // 默认间隔 3000ms
      indicatorWanted: false, controller: null, onChange: [], timer: 0,
      dots: [], indicatorEl: null,
      // R154-B indicator 真语义状态（入参面/缺省值取舍见 SWIPER_ATTRS.indicator 处注释）：
      indicatorKind: 'dot',           // 'dot'=圆点 / 'digit'=数字（DigitIndicator）
      indicatorCfg: null,             // DotIndicator/DigitIndicator 配置载体；null=布尔形态（缺省配置）
      dotStyle: null,                 // 圆点几何/配色 {iw,ih,sw,sh,col,sel}（setActiveSwiper 落选中态）
      digitEls: null,                 // DigitIndicator 两段文本 {current,total}（随索引重设）
      // R154-B 曲线槽位状态：'default'=未设 Swiper.curve → 拖拽释放 ease-out 缺省（R125 契约、
      //   向后兼容；d.ts 缺省是 interpolatingSpring(-1,1,328,34)（swiper.d.ts:1858），偏差已记录）；
      //   'css'/'spring'=curve(...) 已设（spring 族不 respect duration，走 R126 解算器）
      curveKind: 'default', curveCss: 'ease-out',
      // R155-B EdgeEffect（effectMode，swiper.d.ts:1805-1823 缺省 EdgeEffect.Spring；枚举序
      // enums.d.ts:1494 Spring=0/Fade=1/None=2）：'spring'|'none'|'shadow'（builtin.js
      // attachPagedDrag 槽位读取；'shadow' 是前向扩展值，同 Tabs 口径）
      edgeEffect: 'spring',
      // R125 内置拖拽
      vertical: false,                 // swiper.d.ts JSDoc：vertical 默认 false（横向）
      disableSwipe: false,
      duration: 400,                   // JSDoc "Default value: 400"
      animStart: [], animEnd: [], gestureSwipe: [],
    });
    node.__swiperState = st;
    node.dataset.edgeEffect = st.edgeEffect;   // R155-B：缺省面可观测（effectMode 缺省 Spring）
    node.style.position = 'relative';
    node.style.overflow = 'hidden';
    node.style.display = 'block';
    bindSwiperController(st, args && args[0]);
    attachPagedDrag(node, {
      /** @returns {string} */
      axis: () => (st.vertical ? 'y' : 'x'),
      /** @returns {boolean} */
      canDrag: () => !st.disableSwipe,
      /** @returns {number} */
      index: () => st.index,
      /** @returns {number} */
      count: () => st.entries.length,
      /** @returns {boolean} */
      loop: () => st.loop,
      /** @returns {number} */
      size: () => (st.vertical ? st.node.clientHeight : st.node.clientWidth),
      /** @returns {number} */
      duration: () => st.duration,
      /** @returns {any} R154-B 曲线槽位：Swiper.curve 声明的翻页过渡曲线（null=缺省 ease-out） */
      finishCurve: () => (st.curveKind === 'default' ? null : { kind: st.curveKind, css: st.curveCss }),
      // R155-B：到边行为开关槽位（builtin.js builtinEdgeEffect 读取）——effectMode/edgeEffect
      // 属性（SWIPER_ATTRS 两键同处理器）落在 st.edgeEffect，越界/回弹分支按它分支化
      edgeEffect: () => st.edgeEffect,
      /** @param {number} i */
      pageAt: (i) => (st.entries[i] ? st.entries[i].el : null),
      /** @param {number} i */
      commit: (i) => { setActiveSwiper(st, i, true); },
      /** @param {number} i @param {any} extra */
      gesture: (i, extra) => {
        for (const cb of st.gestureSwipe) {
          try { cb(i, extra); } catch (e) { layoutWarnings.push(`Swiper.onGestureSwipe 抛错：${e && e.message}`); }
        }
      },
      /** @param {number} idx @param {number} target */
      animStart: (idx, target) => {
        // 三参签名（swiper.d.ts:1339）：(index, targetIndex, extraInfo)
        for (const cb of st.animStart) {
          try { cb(idx, target, { currentOffset: 0, targetOffset: 0, velocity: 0 }); }
          catch (e) { layoutWarnings.push(`Swiper.onAnimationStart 抛错：${e && e.message}`); }
        }
      },
      /** @param {number} i */
      animEnd: (i) => {
        for (const cb of st.animEnd) {
          try { cb(i, { currentOffset: 0, targetOffset: 0, velocity: 0 }); }
          catch (e) { layoutWarnings.push(`Swiper.onAnimationEnd 抛错：${e && e.message}`); }
        }
      },
    });
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
    st.dots.forEach((/** @type {any} */ d, /** @type {number} */ k) => {
      const active = k === idx;
      d.setAttribute('data-arkui-swiper-dot-active', active ? 'true' : 'false');
      // R154-B DotIndicator 选中态：几何（selectedItemWidth/Height）与配色（selectedColor）随
      // 活动点切换（缺省 selected 尺寸=常态 6vp，只有显式配置才见尺寸差）
      const s = st.dotStyle;
      if (s) {
        d.style.width = active ? s.sw : s.iw;
        d.style.height = active ? s.sh : s.ih;
        d.style.background = active ? s.sel : s.col;
      }
    });
    if (st.digitEls) {
      // R154-B DigitIndicator：索引变化事件驱动两段文本重设（current 从 1 起，
      // swiper_indicator_pattern.cpp:2052-2056；total=页数）
      st.digitEls.current.textContent = String(idx + 1);
      st.digitEls.total.textContent = String(n);
    }
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

    if (st.indicatorWanted) refreshSwiperIndicator(st);

    if (!st.entries.length) {
      layoutWarnings.push('Swiper 内没有任何子组件');
    } else {
      const start = st.loop ? st.index : Math.min(Math.max(0, st.index), st.count - 1);
      setActiveSwiper(st, start, false);
    }
    startSwiperAutoPlay(st);
  }

  // ── R154-B：Swiper indicator 真语义（原 main.js:1779 处"只支持 boolean"退化的真实现）──
  //
  // 入参面（swiper.d.ts:1471/:1495 + C 简报 #3）：indicator(true|false) / indicator(new
  // DotIndicator()) / indicator(new DigitIndicator()) 三种。对象是链式 setter 返回 this 的
  // 【配置载体】（内部存 xxxValue 字段），不是 builder——DOM 端照此实现配置类，挂 global
  // （产物里 `new DotIndicator()` 是自由变量引用）。
  //
  // DotIndicator 属性取舍（swiper.d.ts:422-589 JSDoc 逐条）：
  //   DOM 可达 → itemWidth/itemHeight/selectedItemWidth/selectedItemHeight（尺寸落 CSS，d.ts
  //              禁百分比）、color/selectedColor（点色/活动点色）、space（点距，缺省 8vp/PC 10）；
  //              Indicator 基座 left/top/right/bottom/start/end（覆盖层定位；start/end 是 RTL
  //              感知边距，本运行时恒 LTR → 同 left/right）
  //   记警告   → mask(true)（真机按压遮罩）、maxDisplayCount（[6,9] 溢出窗口显示，真机有专门
  //              overflow 效果）、indicatorIcon（since 26 图标点）、按压放大 1.33 倍（交互细节）
  // DigitIndicator（swiper.d.ts:717-711）：文本 = 当前页/总页数【两段独立 Text】（current 从 1
  //   起，swiper_indicator_pattern.cpp:2052-2056）；fontColor/selectedFontColor、digitFont/
  //   selectedDigitFont（d.ts 明说 Font 只有 size/weight 生效）直接落 CSS。
  //
  // 缺省：d.ts 未设 indicator = true（=DotIndicator 形态，swiper.d.ts:1471 JSDoc）——本实现
  //   沿用 R125 以来"未设=false"（既有 fixtures/断言按缺省无指示器写的，改缺省全量换视觉，
  //   偏差已记录；显式 indicator(true|new DotIndicator()) 均可得真机缺省形态）。

  /** DotIndicator 配置载体（swiper.d.ts:422-589；链式 setter 返回 this，字段照真机 xxxValue 惯例） */
  class DotIndicator {
    constructor() {
      /** @type {any} */ this.itemWidthValue = 6;              // 缺省 6vp（swiper.d.ts:449）
      /** @type {any} */ this.itemHeightValue = 6;             // 缺省 6vp（:471）
      /** @type {any} */ this.selectedItemWidthValue = 6;      // 缺省 6vp（:485）
      /** @type {any} */ this.selectedItemHeightValue = 6;     // 缺省 6vp（:499）
      /** @type {boolean} */ this.maskValue = false;           // 缺省 false（:517；DOM 未达，记警告）
      /** @type {any} */ this.colorValue = '#1A182431';        // 缺省浅灰（:533）
      /** @type {any} */ this.selectedColorValue = '#007DFF';  // 缺省蓝（:549）
      /** @type {number} */ this.maxDisplayCountValue = 0;     // 无缺省，范围 [6,9]（:565；DOM 未达）
      /** @type {any} */ this.spaceValue = 8;                  // 缺省 8vp、PC 10vp（:581；取非 PC 值）
      /** @type {any} */ this.iconListValue = null;            // indicatorIcon（since 26；DOM 未达）
      /** @type {any} */ this.leftValue = null;
      /** @type {any} */ this.topValue = null;
      /** @type {any} */ this.rightValue = null;
      /** @type {any} */ this.bottomValue = null;
      /** @type {any} */ this.bottomIgnoreSizeValue = false;
      /** @type {any} */ this.startValue = null;
      /** @type {any} */ this.endValue = null;
    }
    /** @param {any} v @returns {DotIndicator} */
    itemWidth(v) { this.itemWidthValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    itemHeight(v) { this.itemHeightValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    selectedItemWidth(v) { this.selectedItemWidthValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    selectedItemHeight(v) { this.selectedItemHeightValue = v; return this; }
    /** @param {boolean} v @returns {DotIndicator} */
    mask(v) { this.maskValue = !!v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    color(v) { this.colorValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    selectedColor(v) { this.selectedColorValue = v; return this; }
    /** @param {number} v @returns {DotIndicator} */
    maxDisplayCount(v) { this.maxDisplayCountValue = Number(v) || 0; return this; }
    /** @param {any} v @returns {DotIndicator} */
    space(v) { this.spaceValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    indicatorIcon(v) { this.iconListValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    left(v) { this.leftValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    top(v) { this.topValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    right(v) { this.rightValue = v; return this; }
    /** @param {any} v @param {boolean=} [ignoreSize] @returns {DotIndicator} */
    bottom(v, ignoreSize) { this.bottomValue = v; this.bottomIgnoreSizeValue = !!ignoreSize; return this; }
    /** @param {any} v @returns {DotIndicator} */
    start(v) { this.startValue = v; return this; }
    /** @param {any} v @returns {DotIndicator} */
    end(v) { this.endValue = v; return this; }
  }

  /** DigitIndicator 配置载体（swiper.d.ts:717-711；同 DotIndicator 的链式形态） */
  class DigitIndicator {
    constructor() {
      /** @type {any} */ this.fontColorValue = '#ff182431';           // 缺省（swiper.d.ts JSDoc）
      /** @type {any} */ this.selectedFontColorValue = '#ff182431';   // 缺省同上
      /** @type {any} */ this.digitFontValue = { size: 14, weight: 400 };          // Font{size,weight}
      /** @type {any} */ this.selectedDigitFontValue = { size: 14, weight: 400 };  // 同上（选中段）
      /** @type {any} */ this.leftValue = null;
      /** @type {any} */ this.topValue = null;
      /** @type {any} */ this.rightValue = null;
      /** @type {any} */ this.bottomValue = null;
      /** @type {any} */ this.bottomIgnoreSizeValue = false;
      /** @type {any} */ this.startValue = null;
      /** @type {any} */ this.endValue = null;
    }
    /** @param {any} v @returns {DigitIndicator} */
    fontColor(v) { this.fontColorValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    selectedFontColor(v) { this.selectedFontColorValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    digitFont(v) { this.digitFontValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    selectedDigitFont(v) { this.selectedDigitFontValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    left(v) { this.leftValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    top(v) { this.topValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    right(v) { this.rightValue = v; return this; }
    /** @param {any} v @param {boolean=} [ignoreSize] @returns {DigitIndicator} */
    bottom(v, ignoreSize) { this.bottomValue = v; this.bottomIgnoreSizeValue = !!ignoreSize; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    start(v) { this.startValue = v; return this; }
    /** @param {any} v @returns {DigitIndicator} */
    end(v) { this.endValue = v; return this; }
  }

  // indicator 专用长度归一：数字=vp→px（1:1，本项目一贯做法）；'10'/'10vp'/'10px' 字符串取
  // 数值；百分比被 d.ts 明令禁止（itemWidth 等 "cannot be set in percentage"）→ 按缺省处理。
  /** @param {any} v @param {string} def @returns {string} */
  function swiperIndicatorDim(v, def) {
    if (v == null) return def;
    const r = resolveResource(v);
    if (typeof r === 'number' && Number.isFinite(r)) return Math.max(0, r) + 'px';
    if (typeof r === 'string') {
      const m = /^\s*(\d+(?:\.\d+)?)\s*(?:vp|fp|lpx|px)?\s*$/.exec(r);
      if (m) return Math.max(0, parseFloat(m[1])) + 'px';
    }
    return def;
  }

  /** @param {any} st */
  function buildSwiperIndicator(st) {
    const cfg = st.indicatorCfg;
    const digit = st.indicatorKind === 'digit';
    // DotIndicator 未达子集：显式配置了才逐项记警告（不静默；配置载体其余字段全生效）
    if (cfg && !digit) {
      if (cfg.maskValue === true) {
        warnOnce('Swiper indicator：DotIndicator.mask(true) 无 DOM 对应物（真机按压遮罩），未实现');
      }
      if (cfg.maxDisplayCountValue) {
        warnOnce('Swiper indicator：DotIndicator.maxDisplayCount 的溢出窗口显示未实现'
          + '（真机 [6,9] 截断+边缘收缩，swiper.d.ts:565），圆点全量显示');
      }
      if (cfg.iconListValue) {
        warnOnce('Swiper indicator：DotIndicator.indicatorIcon（since 26 图标点）未实现，按普通圆点渲染');
      }
    }
    const wrap = document.createElement('div');
    wrap.setAttribute('data-arkui-swiper-indicator', '');
    wrap.setAttribute('data-arkui-swiper-indicator-kind', digit ? 'digit' : 'dot');
    // 覆盖层定位（C 简报 #4 + Indicator 基座 left/top/right/bottom/start/end，swiper.d.ts:247-410）：
    // 无 left/right → 水平居中；无 top/bottom → 贴底（真机等效 bottom=0）。真机为 indicator 保留
    // 32vp 默认交互区（swiper.d.ts:235-238）故视觉不贴死底边——DOM 缺省沿用 R125 的 bottom:2px
    // 观感（交互区高度不复刻，偏差已记录）；完全贴底/自定义位置走显式 left/top/right/bottom
    // 配置或独立 IndicatorComponent（真机同款建议，swiper.d.ts:238）。
    wrap.style.position = 'absolute';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'row';
    wrap.style.alignItems = 'center';
    const posCss = (/** @type {any} */ v) => (v == null ? '' : toCssSize(resolveResource(v)));
    const leftV = cfg ? (cfg.leftValue != null ? cfg.leftValue : cfg.startValue) : null;
    const rightV = cfg ? (cfg.rightValue != null ? cfg.rightValue : cfg.endValue) : null;
    if (leftV != null || rightV != null) {
      if (leftV != null) wrap.style.left = posCss(leftV);
      if (rightV != null) wrap.style.right = posCss(rightV);
    } else {
      wrap.style.left = '0';
      wrap.style.right = '0';
      wrap.style.justifyContent = 'center';
    }
    if (cfg && cfg.topValue != null) {
      wrap.style.top = posCss(cfg.topValue);            // d.ts：top 优先级高于 bottom（swiper.d.ts:267）
    } else if (cfg && cfg.bottomValue != null) {
      wrap.style.bottom = posCss(cfg.bottomValue);
    } else {
      wrap.style.bottom = '2px';
    }
    if (!digit) {
      const iw = swiperIndicatorDim(cfg && cfg.itemWidthValue, '6px');
      const ih = swiperIndicatorDim(cfg && cfg.itemHeightValue, '6px');
      const sw = swiperIndicatorDim(cfg && cfg.selectedItemWidthValue, iw);
      const sh = swiperIndicatorDim(cfg && cfg.selectedItemHeightValue, ih);
      const col = colorOf(resolveResource(cfg && cfg.colorValue != null ? cfg.colorValue : '#1A182431'));
      const sel = colorOf(resolveResource(cfg && cfg.selectedColorValue != null ? cfg.selectedColorValue : '#007DFF'));
      wrap.style.gap = swiperIndicatorDim(cfg && cfg.spaceValue, '8px');
      st.dotStyle = { iw, ih, sw, sh, col, sel };
      st.digitEls = null;
      st.dots = st.entries.map((/** @type {any} */ _e, /** @type {number} */ k) => {
        const d = document.createElement('div');
        d.setAttribute('data-arkui-swiper-dot', String(k));
        d.setAttribute('data-arkui-swiper-dot-active', 'false');
        d.style.width = iw;
        d.style.height = ih;
        d.style.borderRadius = '50%';
        d.style.background = col;
        d.style.cursor = 'pointer';
        d.addEventListener('click', () => setActiveSwiper(st, k, true));
        wrap.appendChild(d);
        return d;
      });
    } else {
      // DigitIndicator：current/total 两段独立文本 + '/' 分隔段。非当前段（total/分隔）=
      // fontColor/digitFont；当前段 = selectedFontColor/selectedDigitFont（selected* 命名语义）。
      // d.ts 明说 Font 只有 size/weight 生效，family/style 不读。文本由 setActiveSwiper 随
      // 索引重设（current 从 1 起，swiper_indicator_pattern.cpp:2052-2056）。
      const dc = cfg || new DigitIndicator();
      const fontCss = (/** @type {any} */ f) => {
        const o = f && typeof f === 'object' ? f : {};
        return {
          size: swiperIndicatorDim(o.size, '14px'),
          weight: o.weight == null ? 'normal' : String(resolveResource(o.weight)),
        };
      };
      const nf = fontCss(dc.digitFontValue);
      const sf = fontCss(dc.selectedDigitFontValue);
      const nc = colorOf(resolveResource(dc.fontColorValue != null ? dc.fontColorValue : '#ff182431'));
      const sc = colorOf(resolveResource(dc.selectedFontColorValue != null ? dc.selectedFontColorValue : '#ff182431'));
      const mk = (/** @type {string} */ tag) => {
        const s = document.createElement('span');
        s.setAttribute('data-arkui-swiper-digit', tag);
        return s;
      };
      const cur = mk('current');
      const sep = mk('sep');
      sep.textContent = '/';
      const total = mk('total');
      cur.style.color = sc;
      cur.style.fontSize = sf.size;
      cur.style.fontWeight = sf.weight;
      sep.style.color = nc;
      sep.style.fontSize = nf.size;
      sep.style.fontWeight = nf.weight;
      total.style.color = nc;
      total.style.fontSize = nf.size;
      total.style.fontWeight = nf.weight;
      wrap.style.gap = '2px';
      wrap.appendChild(cur);
      wrap.appendChild(sep);
      wrap.appendChild(total);
      st.dots = [];
      st.dotStyle = null;
      st.digitEls = { current: cur, total: total };
    }
    st.node.appendChild(wrap);
    return wrap;
  }

  // 指示器重建单一出口：finalizeSwiper 首建与 indicator(...) 事后切换/重渲染路径共用
  //（真机重渲染同语义：indicator(false) 摘除、换配置即换形态）
  /** @param {any} st */
  function refreshSwiperIndicator(st) {
    if (st.indicatorEl) {
      st.indicatorEl.remove();
      st.indicatorEl = null;
    }
    st.dots = [];
    st.dotStyle = null;
    st.digitEls = null;
    if (st.indicatorWanted) st.indicatorEl = buildSwiperIndicator(st);
  }

  // Swiper 的语义属性：值要进 state 而不是 DOM
  // R155-B：effectMode/edgeEffect 共用处理器（label 只影响警告文案——effectMode 是
  // swiper.d.ts:1823 的真名，edgeEffect 是任务书面的同名别名）。
  /**
   * @param {any} st @param {any} v @param {string} label
   */
  function applySwiperEdgeEffect(st, v, label) {
    const prev = st.edgeEffect;
    const parsed = parseEdgeEffect(v);
    if (!parsed) {
      layoutWarnings.push(`Swiper.${label} 未实现入参 ${JSON.stringify(v)}`
        + `（本运行时已接 'spring'|'none'|'shadow' 与枚举序数 Spring=0/None=2；`
        + 'Fade 未实现），保持现值');
      return;
    }
    st.edgeEffect = parsed;
    st.node.dataset.edgeEffect = parsed;
    if (parsed === 'shadow') {
      if (prev !== 'shadow') {
        layoutWarnings.push(`Swiper.${label}(shadow)：真机 Shadow=Spring 行为叠加边界阴影`
          + '视觉——阴影无 DOM 对应物，只落 data-shadow="true" 标记（barOverlap 的 '
          + 'backdrop-filter 先例），行为与 Spring 相同（越界冲激回弹）');
      }
      st.node.dataset.shadow = 'true';
    } else if (st.node.dataset.shadow) {
      delete st.node.dataset.shadow;
    }
    // d.ts "only when loop is false"：越界分支本就被 builtin.js 的 outward 判定（!loop &&
    // 边界页）门住，loop=true 时永不触发——结构上满足，无需额外开关。
    // 第二参 options：area.js 通用管道只透传 (st, value) 到 SWIPER_ATTRS，且本 SDK
    // Swiper.effectMode 签名本就单参（swiper.d.ts:1823，无 options）——无功能缺口，不多收。
  }

  /** @type {Record<string, (st: any, v: any, opts?: any) => void>} */
  const SWIPER_ATTRS = {
    index: (st, v) => { st.index = Number(resolveResource(v)) || 0; },
    loop: (st, v) => { st.loop = !!v; },
    autoPlay: (st, v) => { st.autoPlay = !!v; },
    interval: (st, v) => { st.interval = Number(resolveResource(v)) || st.interval; },
    indicator: (st, v) => {
      if (typeof v === 'boolean') {
        st.indicatorWanted = v;
        if (v) st.indicatorCfg = null;        // true=缺省形态圆点（d.ts boolean 缺省即 DotIndicator）
        refreshSwiperIndicator(st);
        return;
      }
      // ── R154-B 真语义（swiper.d.ts:1471/:1495 + C 简报 #3）：DotIndicator/DigitIndicator
      // 是链式 setter 配置载体（new DotIndicator()），不再是"读不到配置的退化对象"——
      // 显式圆点与缺省圆点语义等价，不记退化警告；配置子集取舍见 buildSwiperIndicator 注释。
      if (v instanceof DotIndicator) {
        st.indicatorWanted = true;
        st.indicatorKind = 'dot';
        st.indicatorCfg = v;
        refreshSwiperIndicator(st);
        return;
      }
      if (v instanceof DigitIndicator) {
        st.indicatorWanted = true;
        st.indicatorKind = 'digit';
        st.indicatorCfg = v;
        refreshSwiperIndicator(st);
        return;
      }
      layoutWarnings.push(`Swiper.indicator(${JSON.stringify(v)}) 非法入参：只支持 boolean / `
        + 'DotIndicator / DigitIndicator（swiper.d.ts:1471），已忽略');
    },
    // ── R154-B Swiper.curve（swiper.d.ts:1838-1859，Curve|string|ICurve；此前在
    // SWIPER_UNSUPPORTED）──真机缺省 interpolatingSpring（见 createSwiperState 注释）；设置后
    // 作用于拖拽释放翻页的过渡曲线（本运行时 Swiper 唯一的动画路径——切页是 display 语义、
    // 自动播放同，无过渡可言）。解析器复用 Tabs.animationCurve 的 parseTabsAnimCurve（Curve
    // 枚举序/spring 族名/CSS 曲线串——curve.d.ts 定义、组件无关，名字里的 Tabs 是历史前缀）；
    // ICurve 对象本运行时读不出曲线参数 → 记警告保持现值（与 Tabs.animationCurve 同口径）。
    curve: (st, v) => {
      const parsed = parseTabsAnimCurve(v);
      if (!parsed) {
        layoutWarnings.push(`Swiper.curve(${JSON.stringify(v)}) 不是 Curve 枚举/spring 族名/CSS 曲线串`
          + '（ICurve 对象本运行时读不出参数），保持现值');
        return;
      }
      st.curveKind = parsed.kind;
      st.curveCss = parsed.css;
    },
    // ── R125 内置拖拽六件（此前落 data-*，现真语义；默认值见 createSwiperState 注释）──
    vertical: (st, v) => { st.vertical = !!v; },
    disableSwipe: (st, v) => { st.disableSwipe = !!v; },
    duration: (st, v) => { st.duration = Math.max(0, Number(resolveResource(v)) || 0) || 400; },
    onAnimationStart: (st, v) => { st.animStart.push(v); },
    onAnimationEnd: (st, v) => { st.animEnd.push(v); },
    onGestureSwipe: (st, v) => { st.gestureSwipe.push(v); },
    // ── R155-B：到边行为开关（此前 effectMode 在 SWIPER_UNSUPPORTED）——effectMode 是
    // swiper.d.ts:1823 真名（缺省 EdgeEffect.Spring，仅 loop=false 生效）；edgeEffect 为
    // 任务书面的同名别名。解析器共用 Tabs 的 parseEdgeEffect（枚举序 enums.d.ts:1494，
    // 组件无关）；行为分支在 builtin.js attachPagedDrag 的 edgeEffect 槽位。
    effectMode: (st, v) => { applySwiperEdgeEffect(st, v, 'effectMode'); },
    edgeEffect: (st, v) => { applySwiperEdgeEffect(st, v, 'edgeEffect'); },
  };

  // @include nav

  // @include draw

  // @include area

  // R128：媒体字节预热（resourceManager.getMediaByNameSync 是【同步】API——字节必须
  // 提前取好；双端同源 http（run.sh 起服务），fetch 相对路径即可；失败免疫（file:// 等场景
  // 字节缺席 → getMediaByNameSync 返回空数组 + layoutWarnings，不炸）
  /** @returns {Promise<void>} */
  function resourceBytesWarm() {
    const app = (/** @type {any} */ (global)).__arkui_app_res;
    const bytes = /** @type {Record<string, Uint8Array>} */ ({});
    (/** @type {any} */ (global)).__arkui_app_media_bytes = bytes;
    if (!app || !app.media) return Promise.resolve();
    const base = resBase();
    const jobs = Object.keys(app.media).map(async (name) => {
      try {
        const resp = await fetch(base + app.media[name]);
        bytes[name] = new Uint8Array(await resp.arrayBuffer());
      } catch (e) { /* 字节缺席容忍 */ }
    });
    return Promise.all(jobs).then(() => {});
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
      // W4.1-W4.4 + R152-B + R153-B：语义属性/回调以【组件自有方法】拦截（Proxy get 命中 target 自有
      // 属性后直接返回，不再进 applyAttr）。必须在这里拦的两个原因：
      // ① area.js applyAttrInner 的通用函数分支（≈:586）会把 onXxx(fn) 落成
      //    addEventListener('小写事件名')——永不触发的死监听，且它排在 TABS_UNSUPPORTED
      //    诊断（≈:616）之前，连"未实现"警告都发不出（静默失效，坑 86 同族）；
      // ② .vertical(true) 等布尔/枚举值走通用兜底只会落 data-*，版式静默错。
      // 实参全部转发 applyTabsAttr（第二参留给 barMode 的 ScrollableBarModeOptions 与
      // cachedMaxCount 的 TabsCacheMode）。
      for (const k of ['vertical', 'barMode', 'barWidth', 'barHeight', 'barOverlap',
        'onTabBarClick', 'onSelected', 'onUnselected',
        'animationDuration', 'onAnimationStart', 'onAnimationEnd', 'onGestureSwipe',
        'barGridAlign', 'animationCurve', 'pageFlipMode', 'cachedMaxCount',
        'edgeEffect',
        // R158：animationMode（AnimationMode 三值）/onContentWillChange（切页拦截）/
        // onContentDidScroll（拖拽逐帧）——不走自有拦截的话 applyAttr 会把回调吞成死监听
        //（原因 ① 同上）
        'animationMode', 'onContentWillChange', 'onContentDidScroll']) {
        (/** @type {any} */ (C))[k] = function (/** @type {...any} */ ...args) {
          applyTabsAttr(ViewStackProcessor.top(), k, args[0], args[1]);
        };
      }
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
    if (args && args[0] !== undefined) {
      const s = String(resolveResource(args[0]));
      // R162（v3 第一刀）：同值去重——textContent 重复赋同值照样打脏 DOM（stress10k
      // bulk_update 3300 行实测 rerender 全量重写）；运行时独占这些节点的文本，
      // 旁路写不存在，last 值记在节点上即可
      if (node.__lastText !== s) { node.__lastText = s; node.textContent = s; }
    }
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
  // R167 C1 复盘（全局 content-visibility:auto 已回滚）：首刀实测 layout -73% 收益
  // 真实，但 **CI 否决全局方案**——c-v:auto 改变测量语义（motiondemo 滑块位移
  // NaN、griddemo 到达判定红；本地视口差异恰好掩盖、CI 小视口暴露）。回滚保全矩阵
  // 权威；重做方向=只对不含滚动测量的纯展示列表类容器缩面，或 layout.js 层做
  // 屏外跳过（不动 CSS contains 语义）——见 docs/PROFILE-v3.md C1 复盘节。
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
    () => {
      const el = document.createElement('div');
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.overflow = 'auto';
      el.style.position = 'relative';
      // R125：内置拖拽滚动 + 惯性（Scroll 同款；CAPABILITY 内置手势清单最后一件）
      attachScrollDrag(el);
      el.dataset.builtinScrollDrag = '1';
      return el;
    });
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

  // ────────── 窗口化列表引擎：LazyForEach 与大数组 ForEach 共用（C1-v2）──────────
  //   产物形式（LazyForEach 与 ForEach 不同，view/dataSource 直接传进 create）：
  //   LazyForEach.create("1", this, this.source, itemGen, keyGen); LazyForEach.pop();
  //   只渲染视口内的项 + overscan，用上下 spacer 撑出总高度；滚动/数据变更时重算窗口。
  //   ForEach 走 forEachUpdateFunction 的闸门路径（见该函数：≥500 项 + 真滚动祖先 +
  //   估高超视口；ARKUI_NO_FOREACH_WINDOW 旋钮一票否决）。
  // spacer 是 c-v:auto 否决（R167 复盘）的对照面：占位高把 scrollHeight/锚距口径
  // 撑回"全量"语义，滚动链（ScrollBar/到达判定）不被触碰。
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

  // 窗口项测高：直接子项无盒（display:contents 包裹层/自定义组件容器）时取首个带
  // comp 标记的后代。有盒（offsetParent 非空）⇒ 与直接读 offsetHeight 逐字节同行为。
  /** @param {HTMLElement} el */
  function boxHeightOf(el) {
    if (el.offsetParent) return el.offsetHeight;
    /** @type {HTMLElement|null} */
    const d = el.querySelector('[data-arkui-comp]');
    return d ? d.offsetHeight : 0;
  }
  /** @param {HTMLElement} el */
  function boxTargetOf(el) {
    if (el.offsetParent) return el;
    /** @type {HTMLElement|null} */
    const d = el.querySelector('[data-arkui-comp]');
    return d || el;
  }

  /**
   * 引擎工厂。spec: { total, itemAt(i), itemGen(item, i), gap, scrollEl?, itemQuery?,
   * convergeEst? }。itemQuery 缺省 = 通用模式（holder 直接子项中带 comp 标记的元素），
   * LazyForEach 传 ListItem 选择器保持历史行为不变。
   * 返回 state（offsetOf/totalHOf/indexAt/refresh/flush；spec 可换源，For Each 重入换 snap）。
   * @param {HTMLElement} holder
   * @param {any} spec
   */
  function createWindowEngine(holder, spec) {
    // @type 档位：scrollEl/window/prefix 都是 null↔对象 摆动，onScroll 等后挂 → 整袋 any
    const state = /** @type {any} */ ({
      total: spec.total,
      estItemH: 26,                                  // 未实测项的【估计高度】（不含 gap）
      heights: new Map(),                            // index → 实测高度（不含 gap）
      gap: spec.gap,
      /** @type {any} */ prefix: null,               // 累计偏移（长度 total+1），懒算
      prefixDirty: true,
      window: [-1, -1], scrollEl: spec.scrollEl || null, tid: 0, passes: 0,
      spec: spec,
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

    // 窗口渲染项定位：选择器模式（LazyForEach）按 comp 查；通用模式取直接子项
    // （排除两个 spacer——它们不带 comp 标记，身份排除是双保险）
    function windowItemEls() {
      if (state.spec.itemQuery) {
        return [...holder.querySelectorAll(state.spec.itemQuery)];
      }
      /** @type {HTMLElement[]} */
      const out = [];
      for (const el of holder.children) {
        if (el === state.topSpacer || el === state.bottomSpacer) continue;
        if (el.nodeType === 1 && el.hasAttribute('data-arkui-comp')) {
          out.push(/** @type {HTMLElement} */ (el));
        }
      }
      return out;
    }

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
        for (let i = start; i < end; i++) state.spec.itemGen(state.spec.itemAt(i), i);
        ViewStackProcessor.restore(savedStack);
        currentNodeElmtId = savedElmt;

        // 项间距用 margin-bottom 表达（最后一项不加，否则总高会多一个 gap）
        const freshItems = windowItemEls();
        freshItems.forEach((node, k) => {
          const idx = start + k;
          const target = boxTargetOf(node);
          target.style.marginBottom = (state.gap > 0 && idx < state.total - 1) ? state.gap + 'px' : '0';
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
      const rendered = windowItemEls();
      rendered.forEach((node, k) => {
        const idx = start + k;
        const h = boxHeightOf(node);
        if (h > 0 && state.heights.get(idx) !== h) { state.heights.set(idx, h); changed = true; }
      });
      // 估计值：用【已实测项的均值】逐步收敛，而不是"取第一项"（变高列表里取第一项会错一半，
      // 且随窗口滑动来回翻，导致每次滚动都重算整条前缀）。实测项够多后就不再多算。
      // ForEach 窗口模式带 convergeEst：est 与实测均值差 >5% 就继续收敛——26 的缺省
      // 估计在 48px 行高下会把列表总高错报 43%（LazyForEach 历史口径保持冻结不掺和）。
      if (state.spec.convergeEst || state.heights.size <= 24) {
        let sum = 0;
        for (const h of state.heights.values()) sum += h;
        const avg = sum / state.heights.size;
        const tol = state.spec.convergeEst ? Math.max(0.5, state.estItemH * 0.05) : 0.5;
        if (Math.abs(state.estItemH - avg) > tol) { state.estItemH = avg; changed = true; }
      }
      if (!changed) return;
      // ⚠️ 顺序要紧：必须等【实测高度 + 估计值】**全都写完之后**再取 anchorNew。
      // 第一版先取 anchorNew 再改估计值 → 补偿量少算了估计值那部分，目标会偏出十几像素。
      state.prefixDirty = true;
      const anchorNew = offsetOf(anchor);
      const delta = anchorNew - anchorOld;
      if (delta && se && d < 3) {
        se.scrollTop += delta;                       // 锚定：视口顶部那一项保持不动
        state.passes++;
      }
      if (d < 3) renderWindow(d + 1);                 // 高度变了 → spacer/窗口要按新偏移重排
    }

    // 数据/源刷新：total 可选（缺省保持），itemAt 换闭包（ForEach 重入换 snap 引用）
    state.refresh = (/** @type {number=} */ total, /** @type {any=} */ itemAt) => {
      if (total !== undefined && total !== null) state.total = total;
      if (itemAt) state.spec.itemAt = itemAt;
      state.window = [-1, -1];
      renderWindow();
    };
    state.flush = () => renderWindow(0);          // 供 Scroller 等同步刷新（不等节流）
    renderWindow(0);
    if (state.scrollEl) {
      // 用 setTimeout(0) 合并滚动事件，而【不是】requestAnimationFrame：
      // rAF 在 headless + --virtual-time-budget 下触发时机不稳（实测单独跑过、在 all 里失败）。
      state.onScroll = () => {
        if (state.docScroll) {
          // 文档滚动根（html）常驻跨页——页面拆走后自摘，防窗口监听泄漏
          if (!holder.isConnected) {
            if (state.tid) { clearTimeout(state.tid); state.tid = 0; }
            window.removeEventListener('scroll', state.onScroll);
            lazyMeta.delete(holder);
            return;
          }
        }
        if (state.tid) return;
        state.tid = setTimeout(() => { state.tid = 0; renderWindow(); }, 0);
      };
      // 文档滚动根的 scroll 事件目标是 document/window（不冒泡到祖先元素链）
      if (state.scrollEl === (document.scrollingElement || document.documentElement)) {
        state.docScroll = true;
        window.addEventListener('scroll', state.onScroll);
      } else {
        state.scrollEl.addEventListener('scroll', state.onScroll);
      }
    }
    return state;
  }

  // C1-v2 闸门：≥500 项 + 真滚动祖先（overflow auto/scroll 且有高）或文档滚动根，
  // 且估高总量 > 1.5×视口。保守线把全部既有小表（≤350 项）钉在全量挂载语义上零偏差。
  const FOREACH_WINDOW_MIN = 500;
  /** @param {HTMLElement} node */
  function forEachScrollEl(node) {
    let p = node.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.clientHeight > 0) return p;
      p = p.parentElement;
    }
    const doc = document.scrollingElement || document.documentElement;
    return doc && doc.clientHeight > 0 ? doc : null;
  }
  /** @param {HTMLElement} node @param {any[]} snap */
  function forEachWindowEligible(node, snap) {
    if ((/** @type {any} */ (global)).__arkui_dom_noForEachWindow) return false;
    if (snap.length < FOREACH_WINDOW_MIN) return false;
    const se = forEachScrollEl(node);
    if (!se) return false;
    return snap.length * 26 > se.clientHeight * 1.5;
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

    createWindowEngine(holder, {
      total: typeof source.totalCount === 'function' ? source.totalCount() : 0,
      gap: parentGap,
      itemAt: (/** @type {number} */ i) => source.getData(i),
      itemGen: (/** @type {any} */ it, /** @type {number} */ i) => itemGen(it, i),
      itemQuery: '[data-arkui-comp="ListItem"]',
    });

    if (typeof source.registerDataChangeListener === 'function') {
      const state = lazyMeta.get(holder);
      const listener = {
        onDataReloaded: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataAdd: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataMove: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataDelete: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataChange: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDatasetChange: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataAdded: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataDeleted: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
        onDataChanged: () => state.refresh(typeof source.totalCount === 'function' ? source.totalCount() : undefined),
      };
      try { source.registerDataChangeListener(listener); } catch (_) { /* 数据源可不实现 */ }
    }

    // 注意：logs 由 ohos-shims.js 创建，未加载时不能假设它存在
    if ((/** @type {any} */ (global)).__arkui_dom_logs) {
      const state = lazyMeta.get(holder);
      (/** @type {any} */ (global)).__arkui_dom_logs.push({ t: 'lazyForEach.mounted', id: String(id), total: state.total, estItemH: state.estItemH });
    }
    return holder;
  }

  const LazyForEach = {
    componentName: 'LazyForEach',
    create: createLazyForEach,
    pop() { ViewStackProcessor.pop(); },
  };

  // @include shape

  // @include input

  // @include show

  // @include popup

  // @include canvas

  // @include image

  // @include animator

  // @include refresh

  // @include datepicker

  // @include timepicker

  // @include textpicker

  // @include texttime

  // @include richeditor

  // @include video

  // @include alphabetindexer

  // @include panel

  // @include sidebar

  // @include gridrow

  // @include split

  // @include scroll

  // @include grid

  // @include waterflow

  // @include calendarpicker

  // @include small

  // R66/R67 批量分片（batch-*）：组件注册 + 枚举/效果类常量本体在此定义；
  // global 挂载见下方「安装全局」块（分片只声明，不自行挂 global）
  // @include batch-layout

  // @include batch-input

  // @include batch-media

  // @include batch-nav

  // @include batch-motion

  // @include batch-func

  // @include batch-platform

  // ── 由 tools/gen-components.mjs 生成的 149 个组件骨架 ──
  // 手写实现（上面那些，已被测试覆盖）优先；生成的只补缺口。
  // 骨架保证"能建出正确的 DOM 标签 + 基础样式"，精细化布局语义按需手补（见 docs）。
  let generatedRegistered = false;
  function registerGeneratedComponents() {
    const reg = (/** @type {any} */ (global)).__ARKUI_COMPONENTS;
    if (!reg || generatedRegistered) return 0;
    let n = 0;
    const overwritten = [];
    /** @type {string[]} */
    const filled = [];                               // 手写缺席、由骨架兜底的名册（破坏验证绊网）
    for (const name of Object.keys(reg)) {
      if (components[name]) continue;                // 手写优先
      filled.push(name);
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
    if (filled.length) {
      (/** @type {any} */ (global)).__arkui_dom_generatedFilled = filled;
    }
    if (overwritten.length) {
      (/** @type {any} */ (global)).__arkui_dom_overwrittenGlobals = overwritten;
      if (global.console && console.debug) {
        console.debug('[arkui-dom] 组件骨架覆盖了同名浏览器全局:', overwritten.join(', '));
      }
    }
    return n;
  }

  // @include v2

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

  // @include ability

  // @include relationalstore

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
    // R154-B：indicator 配置载体（产物里 `new DotIndicator()` / `new DigitIndicator()` 是
    // 自由变量引用，不挂 global 直接 ReferenceError；类本体在 Swiper 区段）
    DotIndicator, DigitIndicator,
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
    Piece,
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
    // R128：app 资源装载完成信号（媒体字节预热是异步 fetch——测试页 await 它再断言）
    __arkui_res_ready: resourceBytesWarm(),
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
        // R158：animationMode 三值与两个单槽回调的登记面（自省可观测）
        animationMode: st.animationMode,
        contentWillChange: st.contentWillChange,
        contentDidScroll: st.contentDidScroll,
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
