  // ────────────────── 纯绘制类：Progress / Gauge / DataPanel / Rating（R13）──────────────────
  //
 // 产物形式（实测 fixtures/pages/DrawDemo.ts）：四个都是【create 选项】传数据 + 属性设样式。
 //   Progress.create({ value, total, style: ProgressStyle.Linear });  Progress.width/height/id
 //   Gauge.create({ value, min, max });  Gauge.startAngle/endAngle/strokeWidth/colors
 //     R157-B：indicator（指针：线段+三角头，icon 无资源管线记警告）、description（环底 builder/
 //     文本，未设时 min/max 默认标注）、trackShadow（SVG drop-shadow）也已实现
 //   DataPanel.create({ values, max, type: DataPanelType.Circle })
 //     R157-B：strokeWidth（内孔径向蒙版，缺省 24）、trackShadow（CSS drop-shadow）、
 //     closeEffect（阴影兜底开关）、trackBackgroundColor（轨道段色）也已实现
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
    incRegDraw(node);   // R139 增量登记
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
    /** @type {any} */                                             // 挂运行时状态字段（词汇表之外的自有字段）
    const node = document.createElement('div');
    node.__arkuiComp = 'Gauge';
    node.__drawKind = 'Gauge';
    incRegDraw(node);   // R139 增量登记
    node.__drawOpts = o;
    node.__min = o.min === undefined ? 0 : Number(o.min);
    node.__max = o.max === undefined ? 100 : Number(o.max);
    // R157-B：d.ts——description 未设置时，若 min/max 有设置则在环底部显示 min/max 文本
    node.__hasMinMax = o.min !== undefined || o.max !== undefined;
    node.__startAngle = 0;                      // .d.ts：默认 0
    node.__endAngle = 360;                      // .d.ts：默认 360
    node.__strokeW = 4;
    node.__colors = null;
    // R157-B：indicator（.d.ts 默认显示系统三角指针）/ description / trackShadow 初始未设置
    node.__indicator = undefined;
    node.__description = undefined;
    node.__trackShadow = undefined;
    node.style.position = 'relative';           // description / min-max 标注相对环底定位
    node.__svg = svgEl('svg', {});
    (/** @type {SVGElement} */ (node.__svg)).style.width = '100%';
    (/** @type {SVGElement} */ (node.__svg)).style.height = '100%';
    node.appendChild(/** @type {SVGElement} */ (node.__svg));
    renderGaugeDescription(node);
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

  /** 环色：第一段色（d.ts：trackShadow 的阴影色与环色一致），无色段时退默认蓝 */
  /** @param {any} node */
  function gaugeRingColor(node) {
    const s = gaugeSegments(node)[0];
    return s && s.color !== null && s.color !== undefined ? colorOf(s.color) : '#007dff';
  }

  // MultiShadowOptions（common.d.ts）：radius 缺省 20（API11 起，≤0 回落）、offsetX/offsetY 缺省 5。
  // DOM 近似：CSS drop-shadow(offsetX offsetY radius color)。
  /** @param {any} opts @param {string} color @param {number} defRadius */
  function dropShadowOf(opts, color, defRadius) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const radius = Number(o.radius) > 0 ? Number(o.radius) : defRadius;
    const ox = o.offsetX === undefined ? 5 : Number(o.offsetX) || 0;
    const oy = o.offsetY === undefined ? 5 : Number(o.offsetY) || 0;
    return `drop-shadow(${r2(ox)}px ${r2(oy)}px ${r2(radius)}px ${color})`;
  }

  /** 6 位 hex 才追加 88 透明度（颜色名/函数色原样透传） */
  /** @param {string} c */
  const withShadowAlpha = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? `${c}88` : c);

  // R157-B：Gauge.trackShadow → SVG 上的 CSS drop-shadow（阴影色=环色，d.ts 原话）。
  // null=显式关闭；未设置=不加阴影（Gauge 的阴影只随 trackShadow 出现，没有 DataPanel 那种默认阴影）。
  /** @param {any} node */
  function applyGaugeShadow(node) {
    const v = node.__trackShadow;
    if (v === undefined) {
      (/** @type {any} */ (node.__svg)).style.filter = '';
      node.removeAttribute('data-arkui-gauge-track-shadow');
      return;
    }
    if (v === null) {
      (/** @type {any} */ (node.__svg)).style.filter = 'none';
      node.setAttribute('data-arkui-gauge-track-shadow', 'off');
      return;
    }
    (/** @type {any} */ (node.__svg)).style.filter = dropShadowOf(v, withShadowAlpha(gaugeRingColor(node)), 20);
    node.setAttribute('data-arkui-gauge-track-shadow', 'drop-shadow');
  }

  // R157-B：Gauge description（CustomBuilder）+ 未设置时的 min/max 默认标注。
  //   设了 description → 环底渲染 builder 产物（DOM 子集：绝对定位在环底、水平居中，d.ts
  //   "0 vp away from the bottom of the ring and centered horizontally"）；
  //   未设 description → min/max 有设置时在环底显示 min/max 文本（builder 函数返回值同理）；
  //   显式 description(null) → 什么都不显示（d.ts：null 时不显示 description）。
  /** @param {any} node */
  function renderGaugeDescription(node) {
    for (const sel of ['[data-arkui-gauge-description]', '[data-arkui-gauge-minmax]']) {
      const old = node.querySelector(`:scope > ${sel}`);
      if (old) old.remove();
    }
    const d = node.__description;
    if (d === null) return;
    if (d !== undefined) {
      const box = document.createElement('div');
      box.setAttribute('data-arkui-gauge-description', '');
      box.style.position = 'absolute';
      box.style.left = '0';
      box.style.right = '0';
      box.style.bottom = '0';
      box.style.textAlign = 'center';
      box.style.pointerEvents = 'none';
      if (typeof d === 'function') {
        // builder：推进视图栈再调用，里面的 Text.create 才挂进这个槽（同 ListItemGroup header 的展开方式）
        ViewStackProcessor.push(box);
        try { d(); } catch (e) { warnOnce(`Gauge.description builder 抛错：${e && e.message}`); }
        ViewStackProcessor.pop();
        if (!box.childNodes.length) {
          warnOnce('Gauge.description builder 未产出内容（builder 需用 DSL 建子组件或返回文本）');
        }
      } else {
        box.textContent = String(d);
      }
      node.appendChild(box);
      return;
    }
    if (node.__hasMinMax) {
      const row = document.createElement('div');
      row.setAttribute('data-arkui-gauge-minmax', '');
      row.style.position = 'absolute';
      row.style.left = '0';
      row.style.right = '0';
      row.style.bottom = '2px';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.padding = '0 12%';
      row.style.pointerEvents = 'none';
      row.style.fontSize = '12px';
      row.style.color = '#182431';
      const lo = document.createElement('span');
      lo.setAttribute('data-arkui-gauge-min', '');
      lo.textContent = String(node.__min);
      const hi = document.createElement('span');
      hi.setAttribute('data-arkui-gauge-max', '');
      hi.textContent = String(node.__max);
      row.appendChild(lo);
      row.appendChild(hi);
      node.appendChild(row);
    }
  }

  // R157-B：指针（indicator）。.d.ts 默认显示系统三角指针；icon 无图标资源管线 →
  // 退化为「中心线段 + 三角头」近似（icon 警告在 DRAW_ATTRS 里记）。角度约定与弧一致：
  // angle = startAngle + (value-min)/(max-min) × (endAngle-startAngle)，比值夹 [0,1]。
  /** @param {any} node @param {number} ratio @param {number} cx @param {number} cy @param {number} r */
  function drawGaugeIndicator(node, ratio, cx, cy, r) {
    const svg = node.__svg;
    const o = node.__indicator && typeof node.__indicator === 'object' ? node.__indicator : {};
    // d.ts：space（指针尖端离环外缘的距离）缺省 8，<0 或 >半径 → 回落默认 8
    let space = o.space === undefined ? 8 : Number(o.space);
    if (!(space >= 0) || space > r) space = 8;
    const lineW = Number(o.width) > 0 ? Number(o.width) : 2;
    const tipR = Math.max(1, r - space);
    const ang = node.__startAngle + ratio * (node.__endAngle - node.__startAngle);
    const tip = polar(cx, cy, tipR, ang);
    const shaft = svgEl('line', {
      x1: r2(cx), y1: r2(cy), x2: r2(tip.x), y2: r2(tip.y),
      stroke: '#182431', 'stroke-width': lineW, 'stroke-linecap': 'butt',
    });
    shaft.setAttribute('data-arkui-gauge-indicator', '');
    shaft.setAttribute('data-arkui-gauge-indicator-angle', String(r2(ang)));
    svg.appendChild(shaft);
    // 三角头：近似真机默认的系统三角指针（尖端即指针端点）
    const headLen = Math.min(10, tipR);
    const headW = Math.min(8, tipR);
    const base = polar(cx, cy, tipR - headLen, ang);
    const rad = (ang * Math.PI) / 180;
    const head = svgEl('polygon', {
      points: `${r2(tip.x)},${r2(tip.y)} ${r2(base.x + (headW / 2) * Math.cos(rad))},${r2(base.y + (headW / 2) * Math.sin(rad))}`
        + ` ${r2(base.x - (headW / 2) * Math.cos(rad))},${r2(base.y - (headW / 2) * Math.sin(rad))}`,
      fill: '#182431',
    });
    head.setAttribute('data-arkui-gauge-indicator-head', '');
    svg.appendChild(head);
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
    // R157-B：指针压在轨道之上（indicator(null) 时隐藏；其余形态都画，含默认三角指针）
    if (node.__indicator !== null) drawGaugeIndicator(node, ratio, cx, cy, r);
  }

  // ── DataPanel ──
  const PANEL_PALETTE = ['#007dff', '#00c48c', '#ffb400', '#ff5c5c', '#9b59b6', '#00b3c7'];
  /** @param {any} opts */
  function buildDataPanelNode(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    /** @type {any} */                                             // 挂运行时状态字段（词汇表之外的自有字段）
    const node = document.createElement('div');
    node.__arkuiComp = 'DataPanel';
    node.__drawKind = 'DataPanel';
    incRegDraw(node);   // R139 增量登记
    node.__drawOpts = o;
    node.__values = Array.isArray(o.values) ? o.values.map(Number) : [];
    node.__panelMax = Number(o.max) || 100;
    node.__panelType = isCirclePanel(o.type) ? 'circle' : 'line';
    node.__panelColors = null;
    // R157-B：strokeWidth（.d.ts 缺省 24，仅 Circle 生效）/ trackShadow / closeEffect（缺省 false=阴影开）/
    // trackBackgroundColor（缺省 '#08182431'，本实现近似为渐变里的轨道段色）
    node.__strokeW = null;
    node.__trackShadow = undefined;
    node.__closeEffect = false;
    node.__trackBg = null;
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

  // R157-B：DataPanel 环的描边宽度。.d.ts：缺省 24；≤0 回落默认；超过半径 → 自动调成
  // 半径的 12%（"thickness will automatically be adjusted to 12% of the ring's radius"）。
  /** @param {any} node */
  function panelStroke(node) {
    const w = node.offsetWidth || 100, h = node.offsetHeight || 100;
    const radius = Math.max(1, Math.min(w, h) / 2);
    const raw = Number(node.__strokeW);
    let stroke = raw > 0 ? raw : 24;
    if (stroke > radius) stroke = r2(radius * 0.12);
    return stroke;
  }

  // R157-B：环阴影。.d.ts 优先级：trackShadow 显式设置 → 以它为准（即使 closeEffect=true）；
  // trackShadow=null → 阴影关；未设 trackShadow → closeEffect 兜底（缺省 false=开默认阴影，
  // true=关闭旋转+阴影）。DOM 近似：CSS drop-shadow（多段阴影色取第一段，单色近似）。
  /** @param {any} node */
  function applyPanelShadow(node) {
    const v = node.__trackShadow;
    const firstColor = () => (node.__panelColors && node.__panelColors.length
      ? node.__panelColors[0] : PANEL_PALETTE[0]);
    let mode;
    if (v === null) {
      node.style.filter = 'none';
      mode = 'off';
    } else if (v !== undefined) {
      const o = v && typeof v === 'object' ? v : {};
      if (Array.isArray(o.colors) && o.colors.length > 1) {
        warnOnce('DataPanel.trackShadow 的多段阴影色取第一段（CSS drop-shadow 单色近似）');
      }
      node.style.filter = dropShadowOf(o, withShadowAlpha(
        Array.isArray(o.colors) && o.colors.length ? colorOf(o.colors[0]) : firstColor()), 20);
      mode = 'options';
    } else if (node.__closeEffect === true) {
      node.style.filter = 'none';
      mode = 'off';
    } else {
      node.style.filter = dropShadowOf({}, withShadowAlpha(firstColor()), 20);
      mode = 'default';
    }
    node.setAttribute('data-arkui-datapanel-track-shadow', mode);
    node.setAttribute('data-arkui-datapanel-close-effect', node.__closeEffect ? 'true' : 'false');
  }

  /** @param {any} node */
  function redrawDataPanel(node) {
    const { segs } = panelGeometry(node);
    const colors = node.__panelColors || PANEL_PALETTE;
    const trackBg = node.__trackBg || '#e5e5e5';
    if (node.__panelType === 'circle') {
      const parts = [];
      let from = 0;
      segs.forEach((/** @type {any} */ s, /** @type {any} */ i) => {
        if (s <= 0) return;
        const to = Math.min(1, from + s);
        parts.push(`${colors[i % colors.length]} ${r2(from * 100)}% ${r2(to * 100)}%`);
        from = to;
      });
      if (from < 1) parts.push(`${trackBg} ${r2(from * 100)}% 100%`);   // 余量走轨道色
      node.style.borderRadius = '50%';
      node.style.backgroundImage = `conic-gradient(${parts.join(', ')})`;
      // R157-B：strokeWidth → 内孔径向蒙版（conic-gradient 是满圆盘，环厚由蒙版抠出）
      const stroke = panelStroke(node);
      node.setAttribute('data-arkui-datapanel-stroke', String(stroke));
      const hole = `radial-gradient(closest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`;
      node.style.setProperty('-webkit-mask-image', hole);
      node.style.setProperty('mask-image', hole);
    } else {
      // .d.ts：strokeWidth 在 Line 型不生效（不落蒙版、不落 dataset）
      node.style.removeProperty('-webkit-mask-image');
      node.style.removeProperty('mask-image');
      node.removeAttribute('data-arkui-datapanel-stroke');
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
        rest.style.background = trackBg;
        node.appendChild(rest);
      }
    }
    applyPanelShadow(node);
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
    incRegDraw(node);   // R139 增量登记
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
    // R139：登记集驱动（原全树 querySelectorAll → 只遍历 draw 登记元素）。
    // 显式传 rootEl（非全量路径）时保留旧遍历，语义不变。
    if (rootEl && rootEl !== rootNode) {
      const r0 = rootEl;
      if (!r0 || !r0.querySelectorAll) return;
      for (const el of r0.querySelectorAll('*')) {
        if (el.__drawKind === 'Gauge') redrawGauge(el);
        else if (el.__drawKind === 'Progress' && el.__svg) drawProgressRing(el, el.__ratio || 0);
        else if (el.__drawKind === 'DataPanel') redrawDataPanel(el);   // R157-B：strokeWidth 蒙版要真实尺寸
        else if (el.__arkuiQrPending) redrawQr(el);
      }
      return;
    }
    for (const el of incSweep(drawReg)) {
      if (el.__drawKind === 'Gauge') redrawGauge(el);
      else if (el.__drawKind === 'Progress' && el.__svg) drawProgressRing(el, el.__ratio || 0);
      else if (el.__drawKind === 'DataPanel') redrawDataPanel(el);     // R157-B：同上
      else if (el.__arkuiQrPending) redrawQr(el);
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
      // R157-B：trackShadow → SVG 的 CSS drop-shadow（阴影色=环色；null=显式关闭）
      trackShadow: (node, v) => { node.__trackShadow = v; applyGaugeShadow(node); },
      // R157-B：indicator → 指针（icon 无资源管线记警告、退化为线段+三角头；null=隐藏指针）
      indicator: (node, v) => {
        node.__indicator = v;
        const icon = typeof v === 'string' ? v : (v && typeof v === 'object' ? v.icon : null);
        if (icon) {
          warnOnce('Gauge.indicator 的 icon 无图标资源管线，已退化为默认三角指针（中心线段近似）');
        }
        redrawGauge(node);
      },
      // R157-B：description → 环底渲染 builder/文本；未设置时 min/max 有设置则显示 min/max
      description: (node, v) => { node.__description = v; renderGaugeDescription(node); },
    },
    DataPanel: {
      valueColors: (node, v) => {
        const list = Array.isArray(v) ? v : [v];
        node.__panelColors = list.map(colorOf);
        redrawDataPanel(node);
      },
      // R157-B：trackBackgroundColor 接入绘制（渐变余量段 / Line 型的轨道段）
      trackBackgroundColor: (node, v) => { node.__trackBg = colorOf(v); redrawDataPanel(node); },
      // R157-B：strokeWidth → 环厚（内孔径向蒙版；缺省 24；仅 Circle 生效，Line 只记值）
      strokeWidth: (node, v) => { node.__strokeW = resolveResource(v); redrawDataPanel(node); },
      // R157-B：trackShadow → CSS drop-shadow（多段阴影色取第一段；null=关闭）
      trackShadow: (node, v) => { node.__trackShadow = v; redrawDataPanel(node); },
      // R157-B：closeEffect → 兜底阴影开关（缺省 false=默认阴影开；true=关；trackShadow 优先）
      closeEffect: (node, v) => { node.__closeEffect = v === true || v === 'true'; redrawDataPanel(node); },
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
