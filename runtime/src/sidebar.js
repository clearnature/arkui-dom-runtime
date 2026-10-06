  // ────────────────── SideBarContainer 侧边栏容器（R61）──────────────────
  //
  // 产物形态（实测 fixtures/pages/SideBarDemo.ts）：
  //   SideBarContainer.create(SideBarContainerType.Embed);
  //   SideBarContainer.showSideBar(this.show); sideBarWidth(200);
  //   SideBarContainer.controlButton({left, top, icons:{shown, hidden}});
  //   SideBarContainer.showControlButton(true); SideBarContainer.onChange((v: boolean) => …);
  //   { 侧栏子组件 } { 内容子组件 }            ← 前 1 个子组件 = 侧栏，其余 = 内容
  //
  // 真机语义（sidebar.d.ts）：Embed 类型侧栏与内容并排，显隐压缩/扩展内容区（容器总宽不变）；
  //   showSideBar(false) → 隐藏侧栏 + onChange(false)；showSideBar(true) → 显示 + onChange(true)；
  //   sideBarWidth 侧栏宽（缺省 240vp）；controlButton 的 icons.shown/hidden 切换图标；
  //   showControlButton 缺省 true（:419）。autoHide/minContentWidth 记 data-*。
  // DOM：display:flex 横排；侧栏 = 第 1 个子元素（width = sideBarWidth，隐藏时 width 0 +
  //   display none）；内容 = 其余子元素（flex 1 自动扩展）；控制按钮 absolute 定位（left/top）。
  const SBC_TYPE_NAME = { 0: 'Embed', 1: 'Overlay' };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SIDEBAR_ATTRS = {
    showSideBar: (n, v) => {
      const w = /** @type {any} */ (n).__sbc;
      if (!w) return;
      const show = v === true || v === 'true';
      if (show === w.shown) return;                   // 同值不重复发 onChange
      w.shown = show;
      n.dataset.showSideBar = String(show);
      w.apply();
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(show); }                             // onChange(value: boolean)
        catch (e) { layoutWarnings.push(`SideBarContainer.onChange 回调抛错：${e && e.message}`); }
      }
    },
    sideBarWidth: (n, v) => {
      const w = /** @type {any} */ (n).__sbc;
      if (!w) return;
      w.barWidth = Number(resolveResource(v)) || 240;
      n.dataset.sideBarWidth = String(w.barWidth);
      w.apply();
    },
    controlButton: (n, v) => {
      const btn = n.querySelector('[data-sbc-btn]');
      if (!btn || !v || typeof v !== 'object') return;
      if (v.left !== undefined) btn.style.left = Number(resolveResource(v.left)) + 'px';
      if (v.top !== undefined) btn.style.top = Number(resolveResource(v.top)) + 'px';
      if (v.icons && v.icons.shown !== undefined) {
        btn.dataset.arrow = String(v.icons.shown);      // 字形走 ::after（见 factory）
        btn.setAttribute('aria-label', 'menutoggle');
      }
    },
    showControlButton: (n, v) => {
      const btn = n.querySelector('[data-sbc-btn]');
      if (btn) btn.style.display = (v === true || v === undefined) ? '' : 'none';
      n.dataset.showControlButton = String(v !== false);
    },
    autoHide: (n, v) => { n.dataset.autoHide = String(Number(resolveResource(v)) || 0); },
    minContentWidth: (n, v) => { n.dataset.minContentWidth = String(Number(resolveResource(v)) || 0); },
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__sbc;
      if (w) w.cbs.change = v;
    },
  };
  /** @param {any[]} args */
  const SideBarContainer = ensureComponent('SideBarContainer', (args) => {
    const el = document.createElement('div');
    el.__arkuiSideBar = true;
    el.dataset.sideBarContainer = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const type = args && args[0] !== undefined ? Number(resolveResource(args[0])) : 0;
    el.dataset.type = String(type);                   // Embed=0 Overlay=1（声明顺序）
    const w = /** @type {any} */ (el).__sbc = /** @type {any} */ ({
      shown: true, barWidth: 240, cbs: {}, apply: null,
    });
    // 控制按钮：absolute 定位在容器左上（真机 controlButton 位置语义）
    const btn = document.createElement('button');
    btn.setAttribute('data-sbc-btn', '');
    // R166 续（真机口径）：控制按钮箭头是图标资源——'→'/'←' 不进 a11y 文本
    //（设备流无字形、a11y 名为系统 menutoggle）。字形走 ::after attr(data-arrow)
    //（视觉保留、textContent 空、读屏读 aria-label）
    if (!document.getElementById('arkui-sbc-arrow')) {
      const kf = document.createElement('style');
      kf.id = 'arkui-sbc-arrow';
      kf.textContent = '[data-sbc-btn]::after{content:attr(data-arrow)}';
      document.head.appendChild(kf);
    }
    btn.dataset.arrow = '←';
    btn.setAttribute('aria-label', 'menutoggle');
    btn.style.position = 'absolute';
    btn.style.zIndex = '10';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      SIDEBAR_ATTRS.showSideBar(el, !w.shown);
    });
    el.appendChild(btn);
    // apply：显隐副作用（侧栏 width/display + data-*），mount 后子组件已就位
    w.apply = () => {
      const sidebar = /** @type {HTMLElement} */ (el.children[1] || null);
      if (sidebar) {
        sidebar.style.display = w.shown ? '' : 'none';
        sidebar.style.width = w.shown ? w.barWidth + 'px' : '0px';
        sidebar.style.minWidth = w.shown ? w.barWidth + 'px' : '0px';
        sidebar.style.maxWidth = w.shown ? w.barWidth + 'px' : '0px';
      }
      const content = /** @type {HTMLElement} */ (el.children[2] || null);
      if (content) {
        content.style.flex = '1';
        content.style.overflow = 'hidden';
      }
    };
    el.__sbcApply = w.apply;
    setTimeout(() => w.apply(), 0);                   // 子组件挂载后应用显隐（同 next frame）
    return el;
  });
