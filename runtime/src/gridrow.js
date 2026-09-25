  // ────────────────── GridRow / GridCol 响应式网格（R64）──────────────────
  //
  // 产物形态（实测 fixtures/pages/GridRowDemo.ts）：
  //   GridRow.create({ columns: 12, gutter: 8 });
  //   GridCol.create({ span: 6 }); GridCol.create({ span: 12 });
  //
  // 语义（grid_row.d.ts / grid_col.d.ts）：12 列响应式网格；GridCol span 决定占几列；
  //   gutter 列间距。DOM 天然同构：display:grid + grid-template-columns:repeat(12,1fr)
  //   + gap:8px；GridCol span → grid-column: span N。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDROW_ATTRS = {
    columns: (n, v) => {
      const cols = Number(resolveResource(v)) || 12;
      n.dataset.columns = String(cols);
      n.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    },
    gutter: (n, v) => {
      const g = Number(resolveResource(v)) || 0;
      n.dataset.gutter = String(g);
      n.style.gap = g + 'px';
    },
    onBreakpointChange: (n, v) => {
      const w = /** @type {any} */ (n).__gridrow;
      if (w) w.cbs.breakpoint = v;
    },
  };
  /** @param {any[]} args */
  const GridRow = ensureComponent('GridRow', (args) => {
    const el = document.createElement('div');
    el.__arkuiGridRow = true;
    el.dataset.gridRow = '';
    el.style.display = 'grid';
    el.style.gridTemplateColumns = 'repeat(12, 1fr)'; // 缺省 12 列
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__gridrow = { cbs: {} };
    if (o.columns !== undefined) {
      const cols = Number(resolveResource(o.columns)) || 12;
      el.dataset.columns = String(cols);
      el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }
    if (o.gutter !== undefined) {
      const g = Number(resolveResource(o.gutter)) || 0;
      el.dataset.gutter = String(g);
      el.style.gap = g + 'px';
    }
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDCOL_ATTRS = {
    span: (n, v) => {
      const s = Number(resolveResource(v)) || 1;
      n.dataset.span = String(s);
      n.style.gridColumn = `span ${s}`;
    },
    offset: (n, v) => {
      const off = Number(resolveResource(v)) || 0;
      n.dataset.offset = String(off);
      if (off > 0) n.style.gridColumnStart = `${off + 1}`;
    },
    order: (n, v) => {
      n.dataset.order = String(Number(resolveResource(v)) || 0);
      n.style.order = String(Number(resolveResource(v)) || 0);
    },
  };
  /** @param {any[]} args */
  const GridCol = ensureComponent('GridCol', (args) => {
    const el = document.createElement('div');
    el.__arkuiGridCol = true;
    el.dataset.gridCol = '';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.span !== undefined) {
      GRIDCOL_ATTRS.span(el, o.span);
    }
    if (o.offset !== undefined) {
      GRIDCOL_ATTRS.offset(el, o.offset);
    }
    if (o.order !== undefined) {
      GRIDCOL_ATTRS.order(el, o.order);
    }
    return el;
  });
