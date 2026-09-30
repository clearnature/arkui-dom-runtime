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
      // R149：高 DPI 设备 scrollTop 带小数（89.9/90），ceil 对齐 scroll.js 同款惯例——
      // 精确 >= 在移动 Blink 上会因浮点 shortfall 漏发 onReachEnd
      const atBottom = el.scrollHeight > el.clientHeight && Math.ceil(st) >= el.scrollHeight - el.clientHeight;
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
