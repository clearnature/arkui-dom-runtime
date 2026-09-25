  // ────────────────── AlphabetIndexer 字母索引条（R60）──────────────────
  //
  // 产物形态（实测 fixtures/pages/AlphabetIndexerDemo.ts）：
  //   AlphabetIndexer.create({ arrayValue: [...], selected: 0 });
  //   AlphabetIndexer.itemSize(24); AlphabetIndexer.selectedBackgroundColor('#0a59f7');
  //   AlphabetIndexer.selected(this.idx);          ← 属性式程序化选中（rerender 重放）
  //   AlphabetIndexer.onSelect((index) => …);      ← 点击项触发（真机 onIndexSelect 同族）
  //
  // 真机语义（alphabet_indexer.d.ts）：点击索引项 → onSelect(index)（:427）；
  //   selected(index) 属性 = 程序化选中（:473，重放不发 onSelect）；itemSize 方格边长
  //   （缺省 24vp→px 1:1）；selectedColor/selectedBackgroundColor 选中态配色。
  // DOM：纵向 flex 条，每项一格 button；选中项 data-selected + 配色；点击发 onSelect。
  const AIX_COLOR_SEL = 'rgb(0, 125, 255)';
  const AIX_BG_SEL = 'rgb(10, 89, 247)';
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const AIX_ATTRS = {
    selected: (n, v) => {
      const w = /** @type {any} */ (n).__aix;
      if (!w) return;
      const idx = Math.max(0, Math.min(w.items.length - 1, Number(resolveResource(v)) || 0));
      w.select(idx, false);                         // 属性重定位不发 onSelect（同真机 onSelect 走点击）
    },
    itemSize: (n, v) => {
      const w = /** @type {any} */ (n).__aix;
      const s = Number(resolveResource(v)) || 24;
      n.dataset.itemSize = String(s);
      if (!w) return;
      w.items.forEach((/** @type {HTMLElement} */ it) => {
        it.style.width = s + 'px';
        it.style.height = s + 'px';
      });
    },
    selectedColor: (n, v) => {
      n.dataset.selectedColor = colorOf(v);
      const w = /** @type {any} */ (n).__aix;
      if (w) w.selColor = colorOf(v);
      const w2 = /** @type {any} */ (n).__aix;
      if (w2 && w2.selected >= 0 && w2.items[w2.selected]) w2.items[w2.selected].style.color = colorOf(v);
    },
    selectedBackgroundColor: (n, v) => {
      n.dataset.selectedBackgroundColor = colorOf(v);
      const w = /** @type {any} */ (n).__aix;
      if (w) w.selBg = colorOf(v);
      const w2 = /** @type {any} */ (n).__aix;
      if (w2 && w2.selected >= 0 && w2.items[w2.selected]) w2.items[w2.selected].style.background = colorOf(v);
    },
    autoCollapse: (n, v) => { n.dataset.autoCollapse = String(v === true); },
    usingPopup: (n, v) => {
      n.dataset.usingPopup = String(v === true);
      layoutWarnings.push('AlphabetIndexer.usingPopup 弹出气泡未实现（记 data-*）');
    },
    onSelect: (n, v) => {
      const w = /** @type {any} */ (n).__aix;
      if (w) w.cbs.select = v;
    },
  };
  /** @param {any[]} args */
  const AlphabetIndexer = ensureComponent('AlphabetIndexer', (args) => {
    const el = document.createElement('div');
    el.__arkuiAlphabetIndexer = true;
    el.dataset.alphabetIndexer = '';
    el.__arkuiLeaf = true;                            // 编译产物无 .pop()：视作叶组件自动弹出（坑 97）
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.position = 'relative';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const texts = (Array.isArray(o.arrayValue) ? o.arrayValue : []).map(tpxTextOf);
    const w = /** @type {any} */ (el).__aix = /** @type {any} */ ({
      items: [], texts, selected: 0, selColor: AIX_COLOR_SEL, selBg: AIX_BG_SEL, cbs: {},
      /** @param {number} idx @param {boolean} fireEvent */
      select(idx, fireEvent) {
        w.selected = idx;
        w.items.forEach((/** @type {HTMLElement} */ it, /** @type {number} */ i) => {
          const on = i === idx;
          if (on) it.setAttribute('data-selected', 'true');
          else it.removeAttribute('data-selected');
          it.style.color = on ? w.selColor : '';
          it.style.background = on ? w.selBg : '';
        });
        if (fireEvent) {
          const cb = w.cbs.select;
          if (typeof cb === 'function') {
            try { cb(idx); }                        // onSelect(index)（真机 :427）
            catch (e) { layoutWarnings.push(`AlphabetIndexer.onSelect 回调抛错：${e && e.message}`); }
          }
        }
      },
    });
    const itemSize = 24;
    texts.forEach((/** @type {string} */ text, /** @type {number} */ i) => {
      const it = document.createElement('button');
      it.style.width = itemSize + 'px';
      it.style.height = itemSize + 'px';
      it.style.fontSize = '12px';
      it.style.display = 'flex';
      it.style.alignItems = 'center';
      it.style.justifyContent = 'center';
      it.style.color = TPX_COLOR_DIS;
      it.textContent = text;
      it.addEventListener('click', () => w.select(i, true));
      el.appendChild(it);
      w.items.push(it);
    });
    el.dataset.itemSize = String(itemSize);
    w.select(Math.max(0, Math.min(texts.length - 1, Number(o.selected) || 0)), false);
    return el;
  });
