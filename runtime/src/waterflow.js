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
    (c) => { const w = c.closest('[data-arkui-comp="WaterFlow"]'); return !w || w === root; }));
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
    constructor() { this._secs = []; }
    /** @param {any} s */
    _valid(s) { return !!s && typeof s.itemsCount === 'number' && s.itemsCount >= 0; }
    /** @param {any} section */
    push(section) { if (!this._valid(section)) return false; this._secs.push(Object.assign({}, section)); return true; }
    /** @returns {boolean} */
    splice(start, deleteCount) {
      const add = Array.prototype.slice.call(arguments, 2);
      for (let i = 0; i < add.length; i++) { if (!this._valid(add[i])) return false; }
      this._secs.splice.apply(this._secs, [start, deleteCount].concat(add.map((s) => Object.assign({}, s))));
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
