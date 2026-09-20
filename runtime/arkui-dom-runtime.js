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
      const target = items[i] || el.children[i];
      if (target) {
        el.scrollTop = target.offsetTop;
      } else {
        // 虚拟列表：第 i 项可能根本没渲染 → 用 estimate 行高换算，再触发一次窗口更新
        const holder = el.querySelector('[data-arkui-lazyforeach]');
        const meta = holder && lazyMeta.get(holder);
        if (!meta) { layoutWarnings.push(`Scroller.scrollToIndex(${i}): 目标不存在且非虚拟列表`); return; }
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(meta.estItemH * i, max);
        if (typeof meta.flush === 'function') meta.flush();      // 同步刷新窗口（确定性）
        el.dispatchEvent(new Event('scroll'));
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

  function applyAttr(node, prop, value) {
    if (!node) return;
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
    // 用 flex 列并继承容器的 space，否则 List 的 gap 在"单子项"下失效
    holder.style.display = 'flex';
    holder.style.flexDirection = 'column';
    if (pcs && pcs.gap) holder.style.gap = pcs.gap;
    mountNode(holder, elmtRecords.get(currentNodeElmtId));
    ViewStackProcessor.push(holder);              // create 入栈，pop 出栈（与 ForEach 一致）

    const state = {
      total: typeof source.totalCount === 'function' ? source.totalCount() : 0,
      estItemH: 26, window: [-1, -1], scrollEl: null, raf: 0,
    };
    lazyMeta.set(holder, state);

    function renderWindow() {
      if (!state.scrollEl) state.scrollEl = nearestScrollable(holder);
      const se = state.scrollEl;
      const viewport = se ? se.clientHeight : 120;
      const overscan = 3;
      const start = Math.max(0, Math.floor((se ? se.scrollTop : 0) / state.estItemH) - overscan);
      const count = Math.max(1, Math.ceil(viewport / state.estItemH)) + overscan * 2;
      const end = Math.min(state.total, start + count);
      if (state.window[0] === start && state.window[1] === end) return;   // 窗口没变就不动 DOM
      state.window = [start, end];

      holder.textContent = '';                     // 清旧窗口（含 spacer）
      purgeDetachedRecords();
      const topSpacer = document.createElement('div');
      topSpacer.style.height = (start * state.estItemH) + 'px';
      holder.appendChild(topSpacer);

      const savedStack = ViewStackProcessor.snapshot();
      const savedElmt = currentNodeElmtId;
      ViewStackProcessor.restore([]);
      ViewStackProcessor.push(holder);
      for (let i = start; i < end; i++) itemGen(source.getData(i), i);
      ViewStackProcessor.restore(savedStack);
      currentNodeElmtId = savedElmt;

      const bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = ((state.total - end) * state.estItemH) + 'px';
      holder.appendChild(bottomSpacer);

      // 用真实渲染出的第一项高度校正估计值（首帧后估计会收敛）
      const firstItem = holder.querySelector('[data-arkui-comp="ListItem"]');
      if (firstItem && firstItem.offsetHeight > 0) state.estItemH = firstItem.offsetHeight;
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

    state.flush = renderWindow;                   // 供 Scroller 等同步刷新（不等节流）
    renderWindow();
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

  // 扮演"框架"启动 ability：onCreate → onWindowStageCreate(loadContent 真的渲染页面)
  function startAbility(AbilityClass, opts) {
    const { pagePath = 'pages/Index', rootEl, want = {} } = opts || {};
    const logs = (global.__arkui_dom_logs = global.__arkui_dom_logs || []);

    const appContext = {
      setColorMode(mode) { logs.push({ t: 'setColorMode', mode }); },
      getApplicationContext() { return appContext; },
    };
    const context = {
      getApplicationContext: () => appContext,
      resourceManager: {
        getStringSync: (k) => k,
        getStringByNameSync: (k) => k,
      },
    };

    const ability = new AbilityClass(context);
    logs.push({ t: 'ability', name: AbilityClass.name });

    const windowStage = {
      loadContent(page, cb) {
        logs.push({ t: 'loadContent', page });
        let err = null;
        try {
          loadRoute(page, rootEl);
        } catch (e) {
          err = { code: 1, message: e.message };
          logs.push({ t: 'loadContentError', message: e.message });
        }
        // 注意：生成代码是 `if (err.code) …`，【没有 null 检查】——说明官方 API 成功时
        // 也必须传一个 BusinessError 形状的对象（code=0）。传 null 会直接 TypeError。
        if (typeof cb === 'function') cb(err || { code: 0, message: '' });
        return err ? undefined : true;
      },
    };

    ability.onCreate(want, { launchReason: 1 });
    ability.onWindowStageCreate(windowStage);
    ability.onForeground();
    return { ability, logs, context };
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
    FontWeight, VerticalAlign, HorizontalAlign, FlexAlign, TextAlign, ItemAlign, Color,
    TextOverflow, Alignment, Scroller, Axis,
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
