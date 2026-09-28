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
      // R125：内置惯性有了（builtinFlingScroll）——fling(velocity) 从"记 data-*"升级为
      // 真惯性滚动（velocity px/s，方向取号；rAF 衰减到 <20px/s 或到边）
      const vel = Number(resolveResource(v)) || 0;
      n.dataset.fling = String(vel);
      builtinFlingScroll(n, 0, -vel);
    },
  };
  /** @param {any[]} args */
  const Scroll = ensureComponent('Scroll', (args) => {
    const el = document.createElement('div');
    el.__arkuiScroll = true;
    el.dataset.scroll = '';
    // 默认档：Vertical + scrollBar(Auto) + edgeEffect(Spring)（.d.ts 各自的 @default）
    el.style.overflowY = 'auto';
    // R125：内置拖拽滚动 + 惯性（触摸/手写笔/鼠标按住拖）
    attachScrollDrag(el);
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
