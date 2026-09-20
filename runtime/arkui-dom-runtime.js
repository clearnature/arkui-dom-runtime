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
    syncAlignRules(rootNode);          // 重渲染后几何可能变，重新同步
    syncDrawings(rootNode);            // 弧形要用真实尺寸重画
    syncAreas(rootNode);               // onAreaChange 要按真实几何派发
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
        rec.node.textContent = '';            // 拆掉旧分支
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
        rec.node.textContent = '';
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
    return node;
  }

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

  // NavDestination 的生命周期回调：属性名 → state 键
  const NAVDEST_LIFECYCLE = {
    onWillAppear: 'willAppear', onWillShow: 'willShow', onShown: 'shown', onReady: 'ready',
    onWillHide: 'willHide', onHidden: 'hidden', onWillDisappear: 'willDisappear',
    onBackPressed: 'backPressed',
  };
  // Navigation/NavDestination 上本实现未覆盖的语义项。标题栏/工具栏是【可见差异】，不能静默。
  const NAV_UNSUPPORTED = new Set([
    'title', 'subTitle', 'hideTitleBar', 'hideBackButton', 'titleMode', 'menus', 'menuCount',
    'toolBar', 'hideToolBar', 'onTitleModeChange', 'onNavBarStateChange', 'navBarWidth', 'navBarPosition',
    'backButtonIcon', 'hideNavBar', 'minContentWidth', 'ignoreLayoutSafeArea', 'navBarWidthRange',
    'systemBarStyle', 'toolbarConfiguration', 'onNavigationModeChange', 'customNavContentTransition',
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

    // ── 压栈 ──
    pushPath(info, options) { navPushRec(this, info || {}, animOf(options)); }
    pushPathByName(name, param, a3, a4) {
      const onPop = typeof a3 === 'function' ? a3 : undefined;
      navPushRec(this, { name, param, onPop }, animOf(typeof a3 === 'function' ? a4 : a3));
    }
    pushDestination(info) { navPushRec(this, info || {}, animOf(arguments[1])); return Promise.resolve(); }
    pushDestinationByName(name, param) { navPushRec(this, { name, param }, animOf(arguments[2])); return Promise.resolve(); }

    // ── 弹栈 ──
    pop(a1) {
      if (!this._paths.length) return undefined;
      const result = a1 !== undefined && typeof a1 !== 'boolean' ? a1 : undefined;
      const rec = this._paths[this._paths.length - 1];
      navPopRange(this, this._paths.length - 1, 1, result);
      return { name: rec.name, param: rec.param };
    }
    popToName(name, a2) {
      const idx = this.getIndexByName(name);
      if (!idx.length) {
        layoutWarnings.push(`NavPathStack.popToName('${name}')：栈里没有该 name（约定返回 -1）`);
        return -1;
      }
      const target = idx[idx.length - 1];
      const result = a2 !== undefined && typeof a2 !== 'boolean' ? a2 : undefined;
      navPopRange(this, target + 1, this._paths.length - target - 1, result);
      return target;
    }
    popToIndex(index, a2) {
      const n = this._paths.length;
      if (!Number.isInteger(index) || index < 0 || index >= n) {
        layoutWarnings.push(`NavPathStack.popToIndex(${index})：越界（共 ${n} 项）`);
        return;
      }
      const result = a2 !== undefined && typeof a2 !== 'boolean' ? a2 : undefined;
      navPopRange(this, index + 1, n - index - 1, result);
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

  function createNavState(node, stack) {
    const st = { node, stack: null, builder: null, areaEl: null, mode: 'stack', visible: null, paths: null };
    node.__navState = st;
    node.style.position = 'relative';
    node.style.overflow = 'hidden';
    bindNavStack(st, stack);
    return st;
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

  function navPushRec(stack, info, _animated) {
    const st = stack._nav;
    if (!st) { layoutWarnings.push('NavPathStack 尚未绑定到任何 Navigation'); return false; }
    if (!info || !info.name) { layoutWarnings.push('NavPathStack 压栈缺少 name'); return false; }
    if (!ensureBuilder(st)) return false;
    const rec = { name: info.name, param: info.param, onPop: info.onPop, el: null, cbs: {}, everShown: false };
    // 先入栈再建树：builder 里若读 size()/getAllPathName() 应看到新状态
    stack._paths.push(rec);
    if (!navBuildDest(st, rec)) { stack._paths.pop(); return false; }   // 建不出来不留幽灵路径项
    navSyncVisibility(st);
    return true;
  }

  function navBuildDest(st, rec) {
    const area = ensureNavArea(st);
    const savedStack = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    ViewStackProcessor.push(area);          // 让 NavDestination 挂进目标区
    try {
      st.builder(rec.name, rec.param, undefined);
    } catch (e) {
      layoutWarnings.push(`Navigation 的 builder 抛错（name=${rec.name}）：${e && e.message}`);
    }
    ViewStackProcessor.restore(savedStack);
    currentNodeElmtId = savedElmt;
    const el = area.lastElementChild;
    if (!el || el.__arkuiComp !== 'NavDestination') {
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
  }

  // 弹出 [from, from+count)：从【栈顶向下】处理，保证生命周期顺序
  function navPopRange(stack, from, count, result) {
    const st = stack._nav;
    if (count <= 0) return;
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
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.overflow = 'auto';
      node.style.display = 'none';
      const parent = parentOfTop();
      if (!parent || !parent.hasAttribute || !parent.hasAttribute('data-arkui-nav-destinations')) {
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
    mode: (st, v) => {
      st.mode = String(v);
      if (st.mode !== 'stack') {
        layoutWarnings.push(`Navigation.mode('${st.mode}') 未实现：本实现只有 Stack 语义（Split/Auto 的分栏布局不做）`);
      }
    },
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

  function applyAttr(node, prop, value) {
    if (!node) return;
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
    if (typeof value === 'function') {          // 事件类（onClick/onChange…）
      const ev = prop.replace(/^on/, '').toLowerCase() || 'click';
      node.addEventListener(ev, value);
      return;
    }
    if (prop === 'id') { node.id = String(resolveResource(value)); return; }
    if (prop === 'tabBar') { applyTabBar(node, value); return; }
    if (node.__swiperState && SWIPER_ATTRS[prop]) { SWIPER_ATTRS[prop](node.__swiperState, value); return; }
    if (node.__navState && NAV_ATTRS[prop]) { NAV_ATTRS[prop](node.__navState, value); return; }
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
          methods[key] = function (v) { applyAttr(ViewStackProcessor.top(), key, v); };
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
    Progress, Gauge, DataPanel, Rating, ProgressStyle, ProgressType, DataPanelType,
    __Common__: _CommonWrapper,
    FontWeight, VerticalAlign, HorizontalAlign, FlexAlign, TextAlign, ItemAlign, Color,
    TextOverflow, Alignment, Scroller, Axis,
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
