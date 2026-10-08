  // ────────────────── TextPicker 文本选择器（R56/R58）──────────────────
  //
  // 产物形态（实测 fixtures/pages/TextPickerDemo.ts）：
  //   TextPicker.create({ range, selected });   ← range: string[] / TextPickerRangeContent[]
  //                                              / string[][]（多列）/ 级联（children 联动）
  //   TextPicker.defaultPickerItemHeight(40); TextPicker.selectedIndex(2);
  //   TextPicker.onChange((value: string|string[], index: number|number[]) => …);
  //   TextPickerDialog.show({ range, selected, onAccept: (r: TextPickerResult)=>…, onCancel });
  //
  // 真机语义（text_picker.d.ts / textpicker_pattern.cpp）：滚轮选中变化即
  // FireChangeEvent(value, index)（:803-822）；selected 缺省 0；selectedIndex 属性是
  // create 之后的覆盖（.d.ts:842，重定位不发 onChange）；defaultPickerItemHeight 行高
  // （缺省 40vp→px 1:1）；级联父变 → 子列选项联动重置。wheel 同步单步（R51/R52 同族）。
  // DOM：N 列滚轮（视觉同 DatePicker：5 行、中行高亮、translateY 定位）；静态 Dialog 为
  //   fixed 居中面板 + OK/Cancel（DOM 无 OverlayManager 动画，标注）。
  const TPX_ROWS = 5;
  const TPX_ROW_H_DEFAULT = 40;
  const TPX_COLOR_SEL = 'rgb(0, 125, 255)';
  const TPX_COLOR_DIS = 'rgb(24, 36, 49)';
  const tpxTextOf = (/** @type {any} */ item) => (item && typeof item === 'object') ? String(item.text) : String(item);
  // range 归一化：{kind, cols}。single/multi 的 cols 是静态 string[][]；cascade 的 cols
  // 动态生成（沿 sel 链下钻，父变 → 子列重置为 0）
  /** @param {any} range */
  const tpxNormalize = (range) => {
    const arr = Array.isArray(range) ? range : [];
    if (!arr.length) return { kind: 'single', cols: [['']], cascade: null };
    if (Array.isArray(arr[0])) {
      return { kind: 'multi', cols: arr.map((/** @type {any[]} */ col) => col.map(tpxTextOf)), cascade: null };
    }
    if (arr[0] && typeof arr[0] === 'object' && Array.isArray(arr[0].children)) {
      return { kind: 'cascade', cols: [], cascade: arr };
    }
    return { kind: 'single', cols: [arr.map(tpxTextOf)], cascade: null };
  };
  /** @param {any} selected */
  const tpxNormSel = (selected) => Array.isArray(selected) ? selected.map((/** @type {any} */ n) => Number(n) || 0) : [Number(selected) || 0];
  // 级联第 c 列的选项与子树：沿 sel[0..c-1] 下钻
  /** @param {any[]} nodes @param {number[]} sel @param {number} c */
  const tpxCascadeLevel = (nodes, sel, c) => {
    let level = nodes;
    for (let i = 0; i < c; i++) {
      const node = level[sel[i]] || level[0];
      if (!node || !Array.isArray(node.children)) return null;
      level = node.children;
    }
    return level;
  };
  /**
   * 滚轮引擎：在 hostEl 里建 colCount 列，sel 每次变更后调 rebuild 重排（级联列数可变）。
   * @param {HTMLElement} hostEl
   * @param {{kind: string, cols: string[][], cascade: any[]}} norm
   * @param {number[]} sel0
   * @param {number} rowH
   * @param {(values: any, indexes: any) => void} fire
   * @param {boolean=} [canLoop0] 缺省 true（text_picker.d.ts:487 canLoop "Default value: **true**"）
   */
  /** @param {any} hostEl @param {any} norm @param {number[]} sel0 @param {number} rowH @param {any} fire @param {boolean=} [canLoop0] */
  const tpxEngine = (hostEl, norm, sel0, rowH, fire, canLoop0) => {
    const st = /** @type {any} */ ({
      kind: norm.kind, cascade: norm.cascade, cols: norm.cols, sel: sel0.slice(),
      rowH, colEls: [], cbs: {}, onChange: fire,
      canLoop: canLoop0 !== false,                 // R168：循环滚轮缺省开（真机截图裁定 + d.ts 缺省）
    });
    /** @returns {string[]} */
    /** @param {number} c */
    const optionsOf = (c) => {
      if (st.kind === 'cascade') {
        const level = tpxCascadeLevel(st.cascade, st.sel, c);
        return level ? level.map(tpxTextOf) : [];
      }
      return st.cols[c] || [];
    };
    /** @returns {number} */
    const colCount = () => {
      if (st.kind !== 'cascade') return st.cols.length;
      let c = 1;
      let level = st.cascade;
      while (true) {
        const node = level[st.sel[c - 1] || 0] || level[0];
        if (!node || !Array.isArray(node.children) || !node.children.length) return c;
        level = node.children;
        c += 1;
      }
    };
    const clamp = () => {
      for (let c = 0; c < colCount(); c++) {
        const n = optionsOf(c).length;
        st.sel[c] = Math.max(0, Math.min(n - 1, st.sel[c] || 0));
      }
    };
    /** @param {number} c @param {number} dir */
    const step = (c, dir) => {
      const opts = optionsOf(c);
      const n = opts.length;
      if (!n) return;
      let next = (st.sel[c] || 0) + dir;
      // R168：canLoop（缺省 true）→ 越界环绕（模 n）并发 onChange；canLoop(false) →
      // 边界钳位不动不发（原语义）
      if (st.canLoop) next = ((next % n) + n) % n;
      else next = Math.max(0, Math.min(n - 1, next));
      if (next === (st.sel[c] || 0)) return;          // 边界/单选项：不动不发
      st.sel[c] = next;
      if (st.kind === 'cascade') {
        // 父变 → 子列选项联动重置（截断 sel 到当前深度，下游从 0 重新计）
        st.sel = st.sel.slice(0, c + 1);
        for (let d = c + 1; d < colCount(); d++) st.sel[d] = 0;
        build();
      } else {
        renderCol(c);
      }
      const values = st.sel.map((/** @type {number} */ s, /** @type {number} */ cc) => optionsOf(cc)[s] || '');
      const indexes = st.sel.slice();
      hostEl.dataset.selectedIndex = JSON.stringify(indexes);   // 步进后同步（断言/自省读这里）
      fire(st.kind === 'single' ? values[0] : values, st.kind === 'single' ? indexes[0] : indexes);
    };
    /** @param {number} c */
    const renderCol = (c) => {
      const ce = st.colEls[c];
      const opts = optionsOf(c);
      const n = opts.length;
      const idx = st.sel[c] || 0;
      for (let r = 0; r < TPX_ROWS; r++) {
        const oi = idx - 2 + r;
        // R168：canLoop（缺省 true）→ 行文本按模 n 环绕（真机截图裁定：全高展开循环
        // 滚轮、邻项 wrap-around）；canLoop(false) → 自然序越界留空
        let text = '';
        if (n) {
          if (st.canLoop) text = opts[((oi % n) + n) % n];
          else if (oi >= 0 && oi < n) text = opts[oi];
        }
        ce.rows[r].textContent = text;
      }
      // transform 固定 0：rows[2] 的文本窗已按 idx 居中（rows[2]=选中项、蓝色），
      // 原 (2-idx)*rowH 是"整列全项滑动"旧设计的残留补偿——与文本窗模型双重补偿
      // 导致 idx≠2 时蓝行滑到 4-idx 槽（活体探针实测：sel=1 蓝行落槽 3、末项被裁）
      ce.inner.style.transform = 'none';
    };
    const build = () => {
      hostEl.textContent = '';
      st.colEls = [];
      for (let c = 0; c < colCount(); c++) {
        const wrap = document.createElement('div');
        wrap.setAttribute('data-tpx-col', String(c));
        wrap.style.flex = '1';
        wrap.style.overflow = 'hidden';
        wrap.style.position = 'relative';
        wrap.style.height = TPX_ROWS * st.rowH + 'px';
        const inner = document.createElement('div');
        inner.style.position = 'absolute';
        inner.style.left = '0';
        inner.style.right = '0';
        inner.style.willChange = 'transform';
        const rows = [];
        for (let r = 0; r < TPX_ROWS; r++) {
          const row = document.createElement('div');
          row.className = 'tpx-row';
          row.style.height = st.rowH + 'px';
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'center';
          row.style.fontSize = '16px';
          row.style.color = TPX_COLOR_DIS;
          if (r === 2) { row.style.color = TPX_COLOR_SEL; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
          inner.appendChild(row);
          rows.push(row);
        }
        wrap.appendChild(inner);
        hostEl.appendChild(wrap);
        wrap.addEventListener('wheel', (e) => {
          e.preventDefault();
          step(c, e.deltaY > 0 ? 1 : -1);
        }, { passive: false });
        st.colEls.push({ wrap, inner, rows });
        renderCol(c);
      }
    };
    clamp();
    build();
    /** @param {number} dir */
    const stepFirst = (dir) => { step(0, dir); };
    return {
      st,
      cbs: st.cbs,
      get colEls() { return st.colEls; },
      /** @param {number} h */
      relayout(h) {
        st.rowH = h;
        hostEl.style.height = TPX_ROWS * h + 'px';
        build();
      },
      /** @param {number[]} sel */
      setSel(sel) {
        st.sel = sel.slice();
        clamp();
        build();
        hostEl.dataset.selectedIndex = JSON.stringify(st.sel);
      },
      /** 重渲染全部列（不重建 DOM——selectedTextStyle 等后挂样式保留） */
      rerender() {
        for (let c = 0; c < st.colEls.length; c++) renderCol(c);
      },
      /** @param {number} c @param {number} dir */
      stepCol(c, dir) { step(c, dir); },
      stepFirst,
      /** @returns {string[]} */
      texts() { return st.sel.map((/** @type {number} */ _s, /** @type {number} */ c) => optionsOf(c)[st.sel[c]] || ''); },
      /** @returns {number[]} */
      indexes() { return st.sel.map((/** @type {number} */ s) => s || 0); },
    };
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTPICKER_ATTRS = {
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__txp;
      if (w) w.cbs.change = v;
    },
    canLoop: (n, v) => {
      const w = /** @type {any} */ (n).__txp;
      if (!w) return;
      w.st.canLoop = resolveResource(v) !== false;    // 缺省 true（.d.ts:487）
      w.rerender();
    },
    selectedIndex: (n, v) => {
      const w = /** @type {any} */ (n).__txp;
      if (!w) return;
      const sel = Array.isArray(v)
        ? v.map((/** @type {any} */ x) => Number(resolveResource(x)) || 0)
        : [Number(resolveResource(v)) || 0];
      w.setSel(sel);                                  // 重定位不发 onChange（.d.ts:842 覆盖语义）
      n.dataset.selectedIndex = JSON.stringify(w.indexes());
    },
    defaultPickerItemHeight: (n, v) => {
      const h = Math.max(1, Number(resolveResource(v)) || TPX_ROW_H_DEFAULT);
      n.dataset.rowHeight = String(h);
      (/** @type {any} */ (n).__txp).relayout(h);
    },
    selectedTextStyle: (n, v) => {
      const o = v || {};
      n.dataset.selectedTextStyle = 'set';
      const w = /** @type {any} */ (n).__txp;
      if (!w) return;
      w.colEls.forEach((/** @type {any} */ ce) => {
        const sel = ce.rows[2];
        if (o.color !== undefined) sel.style.color = colorOf(o.color);
        if (o.font && o.font.size !== undefined) sel.style.fontSize = toCssSize(o.font.size);
        if (o.font && o.font.weight !== undefined) sel.style.fontWeight = String(resolveResource(o.font.weight));
      });
    },
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
    const norm = tpxNormalize(o.range);
    const sel0 = tpxNormSel(o.selected);
    while (sel0.length < (norm.kind === 'cascade' ? 1 : norm.cols.length)) sel0.push(0);
    const engine = tpxEngine(el, norm, sel0, TPX_ROW_H_DEFAULT, (/** @type {any} */ values, /** @type {any} */ indexes) => {
      const w = /** @type {any} */ (el).__txp;
      const cb = w.cbs.change;
      if (typeof cb !== 'function') return;
      try { cb(values, indexes); }                    // FireChangeEvent(value, index)（真机 :803-822）
      catch (e) { layoutWarnings.push(`TextPicker.onChange 回调抛错：${e && e.message}`); }
    }, o.canLoop);
    /** @type {any} */ (el).__txp = engine;
    el.style.height = TPX_ROWS * TPX_ROW_H_DEFAULT + 'px';
    el.dataset.txRange = JSON.stringify(
      norm.kind === 'multi' ? norm.cols : (norm.kind === 'cascade' ? (/** @type {any} */ (norm.cascade)).map(tpxTextOf) : norm.cols[0]));
    el.dataset.selectedIndex = JSON.stringify(engine.indexes());
    el.dataset.rowHeight = String(TPX_ROW_H_DEFAULT);
    el.__txpStep = (/** @param {number} dir */ dir) => engine.stepFirst(dir);   // R56 单列兼容
    el.__txpStepCol = (/** @param {number} c @param {number} dir */ c, dir) => engine.stepCol(c, dir);
    return el;
  });
  // TextPickerDialog.show（静态弹层）：OK/Cancel（onAccept/onCancel，.d.ts TextPickerDialogOptions）。
  // TextPickerResult = { value, index }（value/index 保持官方联合类型形态）。
  const TextPickerDialog = {
    /** @param {any=} [options] */
    show(options) {
      const o = options || {};
      const host = document.createElement('div');
      host.setAttribute('data-arkui-tpx-static', '');
      host.setAttribute('data-open', 'true');
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.top = '50%';
      host.style.transform = 'translate(-50%, -50%)';
      host.style.zIndex = '9999';
      host.style.background = '#fff';
      host.style.border = '1px solid #bbb';
      host.style.padding = '12px';
      let last = null;
      const norm = tpxNormalize(o.range);
      const sel0 = tpxNormSel(o.selected);
      while (sel0.length < (norm.kind === 'cascade' ? 1 : norm.cols.length)) sel0.push(0);
      const body = document.createElement('div');
      body.style.display = 'flex';
      host.appendChild(body);
      const eng = tpxEngine(body, norm, sel0, TPX_ROW_H_DEFAULT, (/** @type {any} */ values, /** @type {any} */ indexes) => {
        last = { value: values, index: indexes };
        if (typeof o.onChange === 'function') {
          try { o.onChange({ value: values, index: indexes }); }
          catch (e) { layoutWarnings.push(`TextPickerDialog.onChange 抛错：${e && e.message}`); }
        }
      }, o.canLoop);
      const ok = document.createElement('button');
      ok.setAttribute('data-tpx-ok', '');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        close();
        if (typeof o.onAccept === 'function') {
          const value = norm.kind === 'single' ? eng.texts()[0] : eng.texts();
          const index = norm.kind === 'single' ? eng.indexes()[0] : eng.indexes();
          try { o.onAccept({ value, index }); }
          catch (e) { layoutWarnings.push(`TextPickerDialog.onAccept 抛错：${e && e.message}`); }
        }
      });
      const cancel = document.createElement('button');
      cancel.setAttribute('data-tpx-cancel', '');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        close();
        if (typeof o.onCancel === 'function') {
          try { o.onCancel(); }
          catch (e) { layoutWarnings.push(`TextPickerDialog.onCancel 抛错：${e && e.message}`); }
        }
      });
      host.appendChild(ok);
      host.appendChild(cancel);
      const close = () => { if (host.parentNode) host.parentNode.removeChild(host); };
      document.body.appendChild(host);
    },
  };
