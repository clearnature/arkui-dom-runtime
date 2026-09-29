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
    const P = (/** @type {any} */ (global)).__arkui_dom_perf;
    if (P) { P.flushMs += performance.now() - pf0; P.n++; }
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
    syncAlignRules(rootNode);          // 重渲染后几何可能变，重新同步
    const pf1 = performance.now();
    syncDrawings(rootNode);            // 弧形要用真实尺寸重画
    const pf2 = performance.now();
    syncAreas(rootNode);               // onAreaChange 要按真实几何派发
    const pf3 = performance.now();
    syncNavChrome(rootNode);           // 标题栏高度/分栏宽度/Auto 模式判定都要真实尺寸
    const pf4 = performance.now();
    const P = (/** @type {any} */ (global)).__arkui_dom_perf;
    if (P) {
      P.updateMs += pf1 - pf0;
      P.drawMs += pf2 - pf1;
      P.areasMs += pf3 - pf2;
      P.navMs += pf4 - pf3;
    }
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

  // @include animation
  // @include gesture
  // @include builtin
  // @include errorboundary
  // @include focus
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

    // ForEach：数组变化才整体重建（键级 diff 留待后续优化）
    /** @param {number} elmtId @param {any[]} arr @param {any} itemGenFunc @param {any} keyGenFunc */
    forEachUpdateFunction(elmtId, arr, itemGenFunc, keyGenFunc) {
      const rec = elmtRecords.get(elmtId);
      if (!rec || !rec.node) return;
      const snap = (arr || []).slice();
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
  // R125：scrollable 移出本表（内置拖拽翻页真语义，默认 true，tabs.d.ts JSDoc 原文）。
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
      scrollable: true,               // tabs.d.ts JSDoc："**true** (default)"——内容区可滑动翻页
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
    // R125 内置拖拽：内容区横扫翻 TabContent（scrollable 开关控制；恒横向、无 loop）
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
      duration: () => 0,              // Tabs 无 duration 属性——切页即显（display 语义）
      /** @param {number} i */
      pageAt: (i) => (st.contents[i] ? st.contents[i].el : null),
      /** @param {number} i */
      commit: (i) => { setActiveTab(st, i, true); },
      gesture: () => {},              // Tabs.onGestureSwipe 在 UNSUPPORTED 表（本片不接）
      animStart: () => {},
      animEnd: () => {},
    });
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
    'displayArrow', 'displayMode', 'displayCount', 'effectMode', 'nextMargin', 'prevMargin',
    'itemSpace', 'cachedCount', 'curve', 'customContentTransition',
    'pageFlipMode', 'nestedScroll', 'maintainVisibleContentPosition', 'indicatorStyle', 'indicatorInteractive',
    'onContentDidScroll', 'onContentWillScroll',
    'onSelected', 'onUnselected', 'onScrollStateChanged',
  ]);
  // R125 起真语义：vertical/disableSwipe/duration/onAnimationStart/onAnimationEnd/onGestureSwipe
  // （内置拖拽，attachPagedDrag）；此前它们与上述一并落 data-*。

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
      // R125 内置拖拽
      vertical: false,                 // swiper.d.ts JSDoc：vertical 默认 false（横向）
      disableSwipe: false,
      duration: 400,                   // JSDoc "Default value: 400"
      animStart: [], animEnd: [], gestureSwipe: [],
    });
    node.__swiperState = st;
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
    // ── R125 内置拖拽六件（此前落 data-*，现真语义；默认值见 createSwiperState 注释）──
    vertical: (st, v) => { st.vertical = !!v; },
    disableSwipe: (st, v) => { st.disableSwipe = !!v; },
    duration: (st, v) => { st.duration = Math.max(0, Number(resolveResource(v)) || 0) || 400; },
    onAnimationStart: (st, v) => { st.animStart.push(v); },
    onAnimationEnd: (st, v) => { st.animEnd.push(v); },
    onGestureSwipe: (st, v) => { st.gestureSwipe.push(v); },
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
