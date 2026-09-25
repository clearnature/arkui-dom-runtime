  // ────────────────── RichEditor 富文本编辑器（R65）──────────────────
  //
  // 产物形态（实测 fixtures/pages/RichVideoDemo.ts）：
  //   RichEditor.create({controller}); RichEditor.placeholder('edit here');
  //   RichEditor.onReady(() => …);
  //
  // 真机语义（rich_editor.d.ts）：基于 contenteditable 的富文本编辑器；onReady 在组件
  //   通用部分构建完成后触发；placeholder 占位文本（无内容时显示）。
  // DOM：div[contenteditable=true] 原生编辑器。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const RICHEDITOR_ATTRS = {
    placeholder: (n, v) => {
      n.dataset.placeholder = String(resolveResource(v));
    },
    onReady: (n, v) => {
      const w = /** @type {any} */ (n).__rich;
      if (w) w.cbs.ready = v;
    },
    onSelect: (n, v) => {
      const w = /** @type {any} */ (n).__rich;
      if (w) w.cbs.select = v;
    },
  };
  /** @param {any[]} args */
  const RichEditor = ensureComponent('RichEditor', (args) => {
    const el = document.createElement('div');
    el.__arkuiRichEditor = true;
    el.dataset.richEditor = '';
    el.setAttribute('contenteditable', 'true');
    el.style.minHeight = '40px';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__rich = /** @type {any} */ ({ cbs: {} });
    // onReady 在下一帧触发（真机：通用部分构建完成后）
    setTimeout(() => {
      const cb = w.cbs.ready;
      if (typeof cb === 'function') {
        try { cb(); }
        catch (e) { layoutWarnings.push(`RichEditor.onReady 回调抛错：${e && e.message}`); }
      }
    }, 0);
    return el;
  });
  const RichEditorController = class {
    constructor() { this._el = null; }
    /** @param {any} el */
    _bind(el) { this._el = el; }
  };
