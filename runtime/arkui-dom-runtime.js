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
    columnsTemplate: 'gridTemplateColumns', rowsTemplate: 'gridTemplateRows',
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
    if (a.columnsTemplate !== undefined) el.style.gridTemplateColumns = String(a.columnsTemplate);
    if (a.rowsTemplate !== undefined) el.style.gridTemplateRows = String(a.rowsTemplate);
  }

  // ────────────────────── 布局：alignRules / 文本截断 / 叠放 / Scroller ──────────────────────
  // ArkUI 的 measure/layout 规则在 DOM 上无法 1:1 复刻；这里实现"容器锚点 + 兄弟锚点"两类
  // 相对定位、文本截断与叠放对齐，并保留 warnings 以便暴露未支持项（而不是静默忽略）。
  const layoutWarnings = (global.__arkui_dom_layout_warnings = []);

  // 注意：ArkUI 有两套对齐词汇 —— 水平是 start/end，垂直是 top/bottom。
  // 两者都映射到 0/0.5/1 的分数，同时 dx/dy 的判定也要认这两种写法（踩过的坑）。
  const ALIGN_FRAC = { start: 0, top: 0, center: 0.5, end: 1, bottom: 1 };
  const isStart = (a) => a === 'start' || a === 'top';
  const isEnd = (a) => a === 'end' || a === 'bottom';
  const edgeAt = (base, size, align) => base + size * (ALIGN_FRAC[align] !== undefined ? ALIGN_FRAC[align] : 0);

  function applyAlignRules(el) {
    const rules = el.__alignRules;
    const parent = el.parentElement;
    if (!rules || !parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    el.style.position = 'absolute';
    const pw = parent.offsetWidth, ph = parent.offsetHeight;
    const boxOf = (anchor) => {
      if (!anchor || anchor === '__container__') return { x: 0, y: 0, w: pw, h: ph };
      const sel = (global.CSS && CSS.escape) ? CSS.escape(anchor) : anchor;
      const sib = parent.querySelector('#' + sel);
      if (!sib) return null;
      return { x: sib.offsetLeft, y: sib.offsetTop, w: sib.offsetWidth, h: sib.offsetHeight };
    };
    let dx = 0, dy = 0;                          // 百分比位移：把自身对应边贴到锚点上
    // ArkUI 的 6 个键分两组（这点极易记错）：
    //   水平: left(左边缘) / middle(水平中心) / right(右边缘)
    //   垂直: top(上边缘)  / center(垂直中心) / bottom(下边缘)
    for (const key of Object.keys(rules)) {
      const rule = rules[key];
      if (!rule) continue;
      const box = boxOf(rule.anchor);
      if (!box) { layoutWarnings.push(`alignRules.${key}: 找不到锚点 '${rule.anchor}'`); continue; }
      const a = rule.align;
      if (key === 'left') { el.style.left = edgeAt(box.x, box.w, a) + 'px'; if (a === 'center') dx = -50; else if (isEnd(a)) dx = -100; }
      else if (key === 'middle') { el.style.left = edgeAt(box.x, box.w, a) + 'px'; dx = -50; }
      else if (key === 'right') { el.style.right = (pw - edgeAt(box.x, box.w, a)) + 'px'; if (a === 'center') dx = 50; else if (isStart(a)) dx = 100; }
      else if (key === 'top') { el.style.top = edgeAt(box.y, box.h, a) + 'px'; if (a === 'center') dy = -50; else if (isEnd(a)) dy = -100; }
      else if (key === 'center') { el.style.top = edgeAt(box.y, box.h, a) + 'px'; dy = -50; }
      else if (key === 'bottom') { el.style.bottom = (ph - edgeAt(box.y, box.h, a)) + 'px'; if (a === 'center') dy = 50; else if (isStart(a)) dy = 100; }
      else layoutWarnings.push(`alignRules.${key}: 暂不支持该轴`);
    }
    if (dx || dy) el.style.transform = `translate(${dx}%, ${dy}%)`;
  }

  // 首渲染与每次重渲染后同步一遍：兄弟锚点需要等兄弟节点有几何信息才能算
  function syncAlignRules(rootEl) {
    const r = rootEl || rootNode;
    if (!r || !r.querySelectorAll) return;
    for (const el of r.querySelectorAll('*')) {
      if (el.__alignRules) applyAlignRules(el);
    }
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

  function applyAttr(node, prop, value) {
    if (!node) return;
    if (typeof value === 'function') {          // 事件类（onClick/onChange…）
      const ev = prop.replace(/^on/, '').toLowerCase() || 'click';
      node.addEventListener(ev, value);
      return;
    }
    if (prop === 'id') { node.id = String(resolveResource(value)); return; }
    // 注意：这些必须在 cssPropEnum 之前拦掉 —— 例如 ArkUI 的 alignContent 语义
    // 是"叠放子项的对齐"，与 CSS 的 align-content（内容分布）不是一回事。
    if (prop === 'alignRules') { node.__alignRules = value; applyAlignRules(node); return; }
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
    SubscriberManager, registerNamedRoute, ViewStackProcessor,
    Text, Button, Column, Row, Stack, List, ListItem, If, ForEach, LazyForEach, RelativeContainer,
    FontWeight, VerticalAlign, HorizontalAlign, FlexAlign, TextAlign, ItemAlign, Color,
    TextOverflow, Alignment, Scroller,
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
  });

  // 若 generated-components.js 已在前面加载，这里就把 149 个骨架装上
  registerGeneratedComponents();

  // 页面栈对外只暴露路径数组（内部存 {path, view} 是为了保留页面实例）
  Object.defineProperty(global, '__arkui_dom_pageStack', {
    get: () => pageStack.map((e) => e.path),
    configurable: true,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
