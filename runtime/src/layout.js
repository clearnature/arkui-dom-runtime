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
    // R136（E1-6）：组件语义 → ARIA role 一次性落点（a11y.js 映射表；显式 role 优先）。
    // typeof 守卫：layout.js 在 a11y.js 之前拼接（@include 顺序），函数声明提升可用。
    if (typeof a11yApplyRole === 'function') a11yApplyRole(node);
    if (rec) { rec.node = node; rec.parentNode = parentEl; }
    parentEl.appendChild(node);
    if (parentEl.__arkuiComp === 'Stack') node.style.gridArea = '1 / 1';
    // R22 收口：标"刚挂上"。【出现过渡不能在这里跑】—— 实测产物顺序是
    // `Text.create('A') → Text.id('a') → Text.transition({…})`，规格要等挂载之后才到，
    // 所以真正的触发点是 registerTransition（它看到这个标记就跑出现动画并清标记）。
    node.__arkuiFreshMount = true;
    return node;
  }
