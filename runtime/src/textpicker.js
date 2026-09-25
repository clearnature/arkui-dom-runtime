  // ────────────────── TextPicker 文本选择器（R56）：选择器三部曲收官 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/TextPickerDemo.ts）：
  //   TextPicker.create({ range: ['春','夏','秋','冬'], selected: 1 });
  //   TextPicker.defaultPickerItemHeight(40); TextPicker.selectedIndex(2);
  //   TextPicker.onChange((value: string|string[], index: number|number[]) => …);
  //
  // 真机语义（text_picker.d.ts / textpicker_pattern.cpp）：单列滚轮；滚轮选中变化即
  // FireChangeEvent(value, index)（:803-822，value=选中项文本、index=选中下标）；
  // selected 缺省 0；selectedIndex 属性是 create 之后的 selected 覆盖（.d.ts:842，
  // 重定位不发 onChange）；defaultPickerItemHeight 行高（.d.ts:464，缺省 40vp→px 1:1）。
  // range 支持 string[] / TextPickerRangeContent[]（取 .text）/ string[][]（多列，本实现
  // 只取第一列并记警告）/ 级联（同前）。wheel 同步单步（R51/R52 滚轮同族已确证时序）。
  const TPX_ROWS = 5;
  const TPX_ROW_H_DEFAULT = 40;
  const TPX_COLOR_SEL = 'rgb(0, 125, 255)';
  const TPX_COLOR_DIS = 'rgb(24, 36, 49)';
  const tpxTextOf = (/** @type {any} */ item) => (item && typeof item === 'object') ? String(item.text) : String(item);
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTPICKER_ATTRS = {
    onChange: (n, v) => {
      (/** @type {any} */ (n).__txp).cbs.change = v;
    },
    selectedIndex: (n, v) => {
      const w = /** @type {any} */ (n).__txp;
      w.selected = Math.max(0, Math.min(w.texts.length - 1, Number(resolveResource(v)) || 0));
      n.dataset.selectedIndex = String(w.selected);
      w.renderAll();
    },
    defaultPickerItemHeight: (n, v) => {
      const h = Math.max(1, Number(resolveResource(v)) || TPX_ROW_H_DEFAULT);
      n.dataset.rowHeight = String(h);
      tpxRelayout(n, h);
    },
    selectedTextStyle: (n, v) => {
      const o = v || {};
      n.dataset.selectedTextStyle = 'set';
      const st = /** @type {any} */ (n).__txp;
      const sel = st && st.rows ? st.rows[2] : null;
      if (sel) {
        if (o.color !== undefined) sel.style.color = colorOf(o.color);
        if (o.font && o.font.size !== undefined) sel.style.fontSize = toCssSize(o.font.size);
        if (o.font && o.font.weight !== undefined) sel.style.fontWeight = String(resolveResource(o.font.weight));
      }
    },
  };
  /** @param {HTMLElement} n @param {number} h */
  const tpxRelayout = (n, h) => {
    const w = /** @type {any} */ (n).__txp;
    if (!w) return;
    w.rowH = h;
    n.style.height = TPX_ROWS * h + 'px';
    const wrap = n.querySelector('[data-tpx-col]');
    if (!wrap) return;
    (/** @type {HTMLElement} */ (wrap)).style.height = TPX_ROWS * h + 'px';
    wrap.querySelectorAll('.tpx-row').forEach((/** @type {HTMLElement} */ row) => { row.style.height = h + 'px'; });
    w.renderAll();
  };
  /** @param {any[]} args */
  const TextPicker = ensureComponent('TextPicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiTextPick = true;
    el.dataset.txp = '';
    el.style.display = 'flex';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    let rawRange = Array.isArray(o.range) ? o.range : [];
    if (rawRange.length && Array.isArray(rawRange[0])) {
      layoutWarnings.push('TextPicker 多列/级联 range 本实现只取第一列（记 data-*）');
      rawRange = /** @type {any[]} */ (rawRange[0]);
    }
    const texts = rawRange.map(tpxTextOf);
    const rowH0 = TPX_ROW_H_DEFAULT;
    const st = /** @type {any} */ (el).__txp = /** @type {any} */ ({
      texts, selected: 0, rowH: rowH0, renderAll: null, rows: null, cbs: {},
    });
    st.selected = Math.max(0, Math.min(texts.length - 1, Number(o.selected) || 0));
    el.dataset.txRange = JSON.stringify(texts);
    el.dataset.selectedIndex = String(st.selected);
    el.dataset.rowHeight = String(rowH0);
    // 单列滚轮（视觉同 DatePicker：5 行、中行高亮、translateY 定位）
    const wrap = document.createElement('div');
    wrap.setAttribute('data-tpx-col', '');
    wrap.style.flex = '1';
    wrap.style.overflow = 'hidden';
    wrap.style.position = 'relative';
    wrap.style.height = TPX_ROWS * rowH0 + 'px';
    const inner = document.createElement('div');
    inner.style.position = 'absolute';
    inner.style.left = '0';
    inner.style.right = '0';
    inner.style.willChange = 'transform';
    for (let r = 0; r < TPX_ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'tpx-row';
      row.style.height = rowH0 + 'px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'center';
      row.style.fontSize = '16px';
      row.style.color = TPX_COLOR_DIS;
      if (r === 2) { row.style.color = TPX_COLOR_SEL; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
      inner.appendChild(row);
    }
    wrap.appendChild(inner);
    el.appendChild(wrap);
    /** @type {HTMLElement[]} */
    const rows = /** @type {HTMLElement[]} */ ([...inner.children]);
    st.rows = rows;
    /** @param {number} idx */
    const renderAt = (idx) => {
      for (let r = 0; r < TPX_ROWS; r++) {
        const oi = idx - 2 + r;
        rows[r].textContent = (oi >= 0 && oi < texts.length) ? texts[oi] : '';
      }
      inner.style.transform = `translateY(${(2 - idx) * st.rowH}px)`;
      el.dataset.selectedIndex = String(idx);
    };
    st.renderAll = () => renderAt(st.selected);
    st.renderAll();
    /** @param {number} dir */
    const step = (dir) => {
      const next = Math.max(0, Math.min(texts.length - 1, st.selected + dir));
      if (next === st.selected) return;                 // 边界：不动不发
      st.selected = next;
      renderAt(next);
      const cb = st.cbs.change;
      if (typeof cb === 'function') {
        try { cb(texts[next], next); }                  // FireChangeEvent(value, index)
        catch (e) { layoutWarnings.push(`TextPicker.onChange 回调抛错：${e && e.message}`); }
      }
    };
    el.__txpStep = step;
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    return el;
  });
