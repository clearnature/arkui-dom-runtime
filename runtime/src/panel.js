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
  /** @param {any} n */
  function fireHeight(n) {
    // onHeightChange(height)（px）——真机初始/模式切换即派发（第六端对拍实测
    // 设备 h=1137=真机 half 实高；我们此前零派发=PanelDemo h=0 缺陷）。
    // setTimeout(0) 延后读取：mode 应用发生在构建期（元素 detached、offsetHeight=0），
    // 挂载后才有尺寸；setTimeout 在虚拟时钟下被快进（rAF 不派发——B0 坑③同源），
    // 真实时钟 0ms 即触发，两侧通吃
    const w = /** @type {any} */ (n).__panel;
    // 检查必须在 setTimeout 内：fixture 声明顺序 .mode() 先于 .onHeightChange()
    // （真机同序），同步检查时回调尚未登记、派发永远丢失（第三层根因）
    setTimeout(() => {
      if (!w || typeof w.cbs.heightChange !== 'function') return;
      try { w.cbs.heightChange(n.offsetHeight || 0); }
      catch (e) { layoutWarnings.push(`Panel.onHeightChange 回调抛错：${e && e.message}`); }
    }, 50);
  }
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
      // R166：高度档位实际生效（此前 class 无对应 CSS、面板恒 0 高——h=0 实锤）。
      // vh 相对窗口=真机 Panel 相对屏幕语义（half=50% 屏高，PanelDemo 设备 1137）
      n.style.height = { 0: '48px', 1: '50vh', 2: '100vh' }[m] || '50vh';
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(m); }                                  // onChange(mode: PanelMode)
        catch (e) { layoutWarnings.push(`Panel.onChange 回调抛错：${e && e.message}`); }
      }
      fireHeight(n);                                    // R166：模式切换伴随高度变化（真机 onHeightChange 初始即派发——PanelDemo h=1137 实测）
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
      fireHeight(n);
    },
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (w) w.cbs.change = v;
    },
    onHeightChange: (n, v) => {
      const w = /** @type {any} */ (n).__panel;
      if (w) {
        w.cbs.heightChange = v;
        // 注册即派发当前高度（R165：mode(Half) 与 factory 缺省同值走早退、
        // fireHeight 被跳过——真机注册后报告当前高度，PanelDemo h=1137 实证）
        fireHeight(n);
      }
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
    el.dataset.mode = '1';                              // 缺省标记（mode 同值早退不经过分支）
    el.style.height = '50vh';                           // 缺省高度（R166 同上）
    return el;
  });
