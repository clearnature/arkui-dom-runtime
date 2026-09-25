  // ────────────────── SVG 形状族（R26）──────────────────
  //
  // 产物形态（实测 fixtures/pages/ShapeDemo.ts）：
  //   Circle.create({width, height});  Circle.fill(Color.Red);  Circle.stroke(...);  Circle.strokeWidth(3);
  //   Rect.create({width, height, radiusWidth, radiusHeight});
  //   Ellipse.create({width, height});
  //   Line.create({width, height});    Line.startPoint([x,y]);  Line.endPoint([x,y]);
  //     ⚠️ LineOptions 里【没有】startPoint/endPoint（第一版编译就红了）—— 它们是属性方法（line.d.ts:
  //        `startPoint(value: Array<any>): LineAttribute`）
  //   Path.create({width, height, commands});
  //   Polygon/Polyline.create({width, height});  .points([[x,y],…]);
  //   Shape.create();  Shape.viewPort({x,y,width,height});  容器自身的 fill/stroke 会"罩住"子形状。
  //
  // 语义锚点（shape 族 .d.ts 的 JSDoc 原文）：
  //   fill 默认 **Color.Black**；stroke 默认 **Color.Transparent**（"the default stroke opacity is 0，
  //   meaning no stroke is displayed"）；CircleOptions 的 width/height 默认 0。
  //
  // DOM 映射（实现选择）：组件根 = `<svg>`（吃通用 .width()/.height() 与 create 尺寸，vp→px 1:1），
  // 真正的形状元素挂在 node.__shapeEl；fill/stroke/… 落成 SVG 表现属性。默认值不写属性——
  // SVG 原生默认就是"黑填充、无描边"，与 .d.ts 的默认值恰好一致，而且这样 Shape 容器的
  // fill 表现属性能通过 CSS 继承进【没显式 fill】的子形状（子形状自己的属性永远赢过继承）。
  // 生成的骨架只有裸 `<circle>` 之类（零属性语义），本节在生成注册之前手写登记，手写优先。
  // SVG_NS 复用 draw.js 里的同名常量（同一 IIFE，draw 分片在本节之前）
  /** @param {any} v */
  const shapeDim = (v) => {
    const n = dimOf(v, 0);
    return Number.isFinite(n) && n > 0 ? n : 0;   // .d.ts：无效值（undefined/null/NaN/Infinity）按默认 0
  };

  /** @param {string} tag @param {number} w @param {number} h */
  function shapeRoot(tag, w, h) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const el = document.createElementNS(SVG_NS, tag);
    svg.__shapeEl = el;
    svg.style.display = 'block';
    svg.appendChild(el);
    if (w > 0) svg.style.width = w + 'px';
    if (h > 0) svg.style.height = h + 'px';
    if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    return svg;
  }

  /** @param {any} v */
  const pointsAttr = (v) => (Array.isArray(v) ? v : [])
    .map((p) => `${Number(resolveResource(p[0]))},${Number(resolveResource(p[1]))}`)
    .join(' ');

  // 属性分派表：applyAttr 里 `node.__shapeEl && SHAPE_ATTRS[prop]` 一分支全收
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SHAPE_ATTRS = {
    fill: (n, v) => n.__shapeEl.setAttribute('fill', colorOf(v)),
    fillOpacity: (n, v) => n.__shapeEl.setAttribute('fill-opacity', String(v)),
    stroke: (n, v) => n.__shapeEl.setAttribute('stroke', colorOf(v)),
    strokeOpacity: (n, v) => n.__shapeEl.setAttribute('stroke-opacity', String(v)),
    strokeWidth: (n, v) => n.__shapeEl.setAttribute('stroke-width', String(dimOf(v, 0))),
    strokeLineCap: (n, v) => n.__shapeEl.setAttribute('stroke-linecap', String(resolveResource(v))),
    strokeLineJoin: (n, v) => n.__shapeEl.setAttribute('stroke-linejoin', String(resolveResource(v))),
    strokeDashArray: (n, v) => n.__shapeEl.setAttribute('stroke-dasharray',
      Array.isArray(v) ? v.map((d) => String(dimOf(d, 0))).join(' ') : String(dimOf(v, 0))),
    strokeDashOffset: (n, v) => n.__shapeEl.setAttribute('stroke-dashoffset', String(dimOf(v, 0))),
    antialias: (n, v) => n.__shapeEl.setAttribute('shape-rendering', v === false ? 'crispEdges' : 'auto'),
    // 形状特有
    points: (n, v) => n.__shapeEl.setAttribute('points', pointsAttr(v)),
    startPoint: (n, v) => {
      n.__shapeEl.setAttribute('x1', String(Number(resolveResource(v[0]))));
      n.__shapeEl.setAttribute('y1', String(Number(resolveResource(v[1]))));
    },
    endPoint: (n, v) => {
      n.__shapeEl.setAttribute('x2', String(Number(resolveResource(v[0]))));
      n.__shapeEl.setAttribute('y2', String(Number(resolveResource(v[1]))));
    },
    commands: (n, v) => n.__shapeEl.setAttribute('d', String(resolveResource(v))),
    viewPort: (n, v) => {
      const vp = v && typeof v === 'object' ? v : {};
      n.setAttribute('viewBox',
        `${dimOf(vp.x, 0)} ${dimOf(vp.y, 0)} ${dimOf(vp.width, 0)} ${dimOf(vp.height, 0)}`);
    },
  };

  // 形状组件工厂：create 参数里做几何（后续 .width()/.height() 只改 svg 的视口，不再反推几何 —— 已知限制）
  /** @param {string} name @param {{tag: string, geometry: (el: any, o: any, w: number, h: number) => void, [k: string]: any}} build */
  function shapeComponent(name, build) {
    return ensureComponent(name, (args) => {
      const o = args && typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
      const w = shapeDim(o.width);
      const h = shapeDim(o.height);
      const svg = shapeRoot(build.tag, w, h);
      build.geometry(svg.__shapeEl, o, w, h);
      return svg;
    });
  }

  const Circle = shapeComponent('Circle', {
    tag: 'circle',
    geometry(el, o, w, h) {
      el.setAttribute('cx', String(w / 2));
      el.setAttribute('cy', String(h / 2));
      el.setAttribute('r', String(Math.min(w, h) / 2));   // 内切：r = min(w,h)/2（实现选择，非 .d.ts 数字）
    },
  });
  const Ellipse = shapeComponent('Ellipse', {
    tag: 'ellipse',
    geometry(el, o, w, h) {
      el.setAttribute('cx', String(w / 2));
      el.setAttribute('cy', String(h / 2));
      el.setAttribute('rx', String(w / 2));
      el.setAttribute('ry', String(h / 2));
    },
  });
  const Rect = shapeComponent('Rect', {
    tag: 'rect',
    geometry(el, o, w, h) {
      el.setAttribute('x', '0');
      el.setAttribute('y', '0');
      // 没给尺寸 → 100%（Shape 容器里 `Rect().width('100%').height('100%')` 是官方示例写法）
      el.setAttribute('width', w > 0 ? String(w) : '100%');
      el.setAttribute('height', h > 0 ? String(h) : '100%');
      const rw = shapeDim(o.radiusWidth);
      const rh = shapeDim(o.radiusHeight);
      if (rw > 0) el.setAttribute('rx', String(rw));
      if (rh > 0) el.setAttribute('ry', String(rh));
    },
  });
  const Line = shapeComponent('Line', {
    tag: 'line',
    geometry(el) {
      el.setAttribute('x1', '0');
      el.setAttribute('y1', '0');
      el.setAttribute('x2', '0');
      el.setAttribute('y2', '0');
    },
  });
  const Path = shapeComponent('Path', {
    tag: 'path',
    geometry(el, o) {
      if (o.commands !== undefined && o.commands !== null) {
        el.setAttribute('d', String(resolveResource(o.commands)));
      }
    },
  });
  const Polygon = shapeComponent('Polygon', { tag: 'polygon', geometry() {} });
  const Polyline = shapeComponent('Polyline', { tag: 'polyline', geometry() {} });

  // Shape 容器：自己就是 <svg>；fill/stroke 落在容器上靠 SVG 继承罩住没显式设置的子形状
  const Shape = ensureComponent('Shape', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.__shapeEl = svg;                    // 容器自身也吃 SHAPE_ATTRS（fill/stroke/viewPort/…）
    svg.style.display = 'block';
    return svg;
  });
