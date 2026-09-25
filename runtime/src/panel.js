  // ────────────────── Panel 底部滑出面板（R63）──────────────────
  //
  // 产物形态（实测 fixtures/pages/PanelDemo.ts）：
  //   Panel.create(true);              ← 参数 show?: boolean（初始显示，缺省 true）
  //   Panel.mode(PanelMode.Half);      ← Mini=0 Half=1 Full=2（声明顺序）
  //   Panel.dragBar(true);
  //   Panel.onChange((mode: PanelMode) => …); onHeightChange((h: number) => …);
  //
  // 真机语义（panel.d.ts）：底部滑出面板；mode 控制面板高度档位（Mini/半屏/全屏）；
  //   dragBar 显示顶部拖拽条；onChange(mode) 面板模式切换；onHeightChange(height) 面板
  //   高度变化（px）。builder 子组件挂载在面板体内。
  // DOM：div 定位在父容器底部、width 100%；dragBar 顶部居中横条；mode 切换 CSS class。
  //   面板高度：mini=48px，half=50%，full=100%（.d.ts PanelHeight 枚举顺序，CSS 近似）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const PANEL_ATTRS = {
    mode: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (!w) return;
      const m = Number(resolveResource(v)) || 1;
      if (m === w.mode) return;                         // 同值不重复发
      w.mode = m;
      n.dataset.mode = String(m);
      n.classList.remove('panel-mode-mini', 'panel-mode-half', 'panel-mode-full');
      n.classList.add(`panel-mode-${{ 0: 'mini', 1: 'half', 2: 'full' }[m] || 'half'}`);
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(m); }                                  // onChange(mode: PanelMode)
        catch (e) { layoutWarnings.push(`Panel.onChange 回调抛错：${e && e.message}`); }
      }
    },
    dragBar: (n, v) => {
      const bar = n.querySelector('[data-panel-dragbar]');
      if (bar) bar.style.display = (v === true) ? '' : 'none';
      n.dataset.dragBar = String(v === true);
    },
    backgroundMask: (n, v) => {
      n.dataset.backgroundMask = colorOf(v);
      n.style.backgroundColor = colorOf(v);
    },
    customHeight: (n, v) => {
      const h = Number(resolveResource(v)) || 0;
      n.style.height = h + 'px';
      n.dataset.customHeight = String(h);
    },
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (w) w.cbs.change = v;
    },
    onHeightChange: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (w) w.cbs.heightChange = v;
    },
  };
  /** @param {any[]} args */
  const Panel = ensureComponent('Panel', (args) => {
    const el = document.createElement('div');
    el.__arkuiPanel = true;
    el.dataset.panel = '';
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.overflow = 'hidden';
    // dragBar：顶部居中横条
    const dragbar = document.createElement('div');
    dragbar.setAttribute('data-panel-dragbar', '');
    dragbar.style.width = '24px';
    dragbar.style.height = '4px';
    dragbar.style.borderRadius = '2px';
    dragbar.style.background = 'rgba(0,0,0,0.15)';
    dragbar.style.margin = '4px auto';
    el.appendChild(dragbar);
    const w = /** @type {any} */ (el).__panel = { mode: 1, cbs: {} };
    el.classList.add('panel-mode-half');                // 缺省 Half
    return el;
  });
