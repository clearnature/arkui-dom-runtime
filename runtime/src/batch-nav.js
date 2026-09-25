  // ────────────────── 批次 D：导航 / 页面转场 / 工具栏项 / 选择器（R66）──────────────────
  //
  // 六组件（权威出处：nav_router.d.ts / navigator.d.ts / page_transition.d.ts / toolbar.d.ts
  // / ui_picker_component.d.ts）：
  //
  //   NavRouter(value?: RouteInfo)   —— deprecated since 13（useinstead NavPathStack）。
  //     .onStateChange((isActivated: boolean) => …) / .mode(NavRouteMode)
  //     真机语义：点击后自动把 RouteInfo 压入所属 Navigation 的路由栈（"default processing
  //     logic for responding to clicks"）。本垫片：click → 向上找带 __navState.stack 的
  //     Navigation，调 NavPathStack.pushPathByName /（REPLACE 时）replacePathByName；
  //     push 同步建出目的地（navBuildDest），返回即"已激活"→ onStateChange(true)；
  //     pop 包装（实例级补丁，不动 nav.js）→ 被弹出的是自己时 onStateChange(false)。
  //     ⚠️ 真机旧 API 的目的地是 NavRouter 的【第二个子组件】按结构注册；本运行时的目的地
  //     只能由 PageMap builder 建出（navBuildDest 按 builder 找 name）——所以 NavRouter 里
  //     内联的那个 NavDestination 子组件会被 mountNavDestination 挂成 display:none 并记
  //     layoutWarning（"不在目标区内"），实际显示的是 PageMap 建的那份。结构性差异，非缺陷。
  //
  //   Navigator(value?: { target, type }) —— deprecated since 13。
  //     .active(bool) / .type(NavigationType) / .target(string) / .params(object)
  //     真机语义：点击整块区域按 type 跳转；active=false 时不生效（默认激活）。
  //     Push=0/Back=1/Replace=2（.d.ts 声明顺序）。Back → __arkui_dom_back()；
  //     Push/Replace → __arkui_dom_navigate(target)（本运行时 router 的既定模型：清根重建、
  //     页面实例留在 pageStack —— 与 router.pushUrl 垫片一致）。Replace 的"销毁当前页"
  //     未建模，点一次记一条 layoutWarning。params 存 global.__arkui_dom_navigatorParams。
  //
  //   PageTransitionEnter / PageTransitionExit(options) —— 页面级声明（真机在 pageTransition()
  //     钩子里，不在 build 里）。CommonTransition 五属性：slide/translate/scale/opacity +
  //     onEnter/onExit 逐帧回调（(type: RouteType, progress: 0..1)）。options：type/duration
  //     (默认 1000ms)/curve(默认 linear)/delay(默认 0)。RouteType：None=0（任意方向生效）/
  //     Push=1/Pop=2；SlideEffect：Left=0/Right=1/Top=2/Bottom=3/START=5/END=6（LTR 下
  //     START≡Left、END≡Right）。本垫片：元素 display:none 只做【规格登记】
  //     （__arkui_dom_pageTransitionSpecs），驱动入口 __arkui_dom_playPageTransition(kind, rt)
  //     —— 对页面根做 Web Animations + rAF 逐帧回调。路由变更不自动触发（运行时 router 无
  //     pageTransition 钩子，需主会话接线或测试显式驱动）。
  //
  //   ToolBarItem(options?: { placement }) —— API 20。ToolBarItemAttribute 是【空类】
  //     （明确不支持通用属性），唯一参数 placement：TOP_BAR_LEADING=0/TOP_BAR_TRAILING=1。
  //     真机与 toolbar 通用属性（标题栏列）配合；本垫片只落语义标记（dataset.placement），
  //     标题栏列分配未接线（toolbar 通用属性属于另一批）。
  //
  //   UIPickerComponent(options?: { selectedIndex }) —— API 22。子组件即选项（Text/Image/
  //     Row，Row 整体算一项）。滚轮：itemHeight 默认 40vp、displayedItemCount 默认 7、选中项
  //     指示器 BACKGROUND(0,默认)/DIVIDER(1)。事件 onChange/onScrollStop 回调签名是
  //     (selectedIndex: number)。canLoop/enableHapticFeedback 落 dataset（循环滚动与震动
  //     未实现，≥8 项且 canLoop 时记一条 layoutWarning）。子项在 pop 时收割（Tabs 模式）：
  //     节点挪进隐藏 stash 保留复用，标签取 textContent 重建滚轮。
  //
  // DOM 概览：
  //   NavRouter   <div data-arkui-comp="NavRouter">            display:block，整块可点
  //   Navigator   <div data-arkui-comp="Navigator">            display:block，整块可点
  //   PageTrans*  <div data-arkui-comp="PageTransitionEnter">  display:none（纯规格）
  //   ToolBarItem <div data-arkui-comp="ToolBarItem">          inline-flex
  //   UIPicker    <div data-arkui-comp="UIPickerComponent">    flex；[data-upx-indicator] +
  //               [data-upx-wheel]（滚轮，translateY 定位，中行高亮）+ 隐藏 stash

  // ── 枚举：值照 .d.ts 声明顺序（显式数值照原文）。产物里都是自由变量引用，主会话挂 global ──
  const NavRouteMode = { PUSH_WITH_RECREATE: 0, PUSH: 1, REPLACE: 2 };
  const NavigationType = { Push: 0, Back: 1, Replace: 2 };
  const RouteType = { None: 0, Push: 1, Pop: 2 };
  const SlideEffect = { Left: 0, Right: 1, Top: 2, Bottom: 3, START: 5, END: 6 };
  const ToolBarItemPlacement = { TOP_BAR_LEADING: 0, TOP_BAR_TRAILING: 1 };
  const PickerIndicatorType = { BACKGROUND: 0, DIVIDER: 1 };

  // ── NavRouter ──
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const NAVROUTER_ATTRS = {
    onStateChange: (n, v) => {
      const w = /** @type {any} */ (n).__navRouter;
      if (w) w.cbs.stateChange = v;
    },
    mode: (n, v) => {
      const w = /** @type {any} */ (n).__navRouter;
      if (!w) return;
      w.mode = Number(resolveResource(v)) || 0;
      n.dataset.mode = String(w.mode);
    },
  };
  /** @param {HTMLElement} el */
  const navRouterStackOf = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const st = /** @type {any} */ (p).__navState;
      if (st && st.stack) return /** @type {any} */ (st.stack);
    }
    return null;
  };
  /** @param {any} el @param {boolean} on */
  const navRouterSetState = (el, on) => {
    const w = /** @type {any} */ (el).__navRouter;
    if (!w || w.state === on) return;
    w.state = on;
    el.dataset.state = String(on);
    const cb = w.cbs.stateChange;
    if (typeof cb === 'function') {
      try { cb(on); }
      catch (e) { layoutWarnings.push(`NavRouter.onStateChange 回调抛错：${e && e.message}`); }
    }
  };
  /** @param {any[]} args */
  const NavRouter = ensureComponent('NavRouter', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiNavRouter = true;
    el.style.display = 'block';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    // RouteInfo：{ name: string, param?: unknown }
    const w = /** @type {any} */ (el).__navRouter = /** @type {any} */ ({
      route: {
        name: o.name === undefined ? '' : String(resolveResource(o.name)),
        param: o.param,
      },
      mode: 0,                       // 默认 NavRouteMode.PUSH_WITH_RECREATE（.d.ts JSDoc）
      state: false,
      popPatched: false,
      cbs: {},
    });
    el.dataset.routeName = w.route.name;
    el.dataset.mode = String(w.mode);
    el.dataset.state = 'false';
    el.addEventListener('click', () => {
      const stack = navRouterStackOf(el);
      if (!stack) {
        layoutWarnings.push('NavRouter 点击：向上找不到绑定了 NavPathStack 的 Navigation，路由跳过');
        return;
      }
      if (!w.route.name) { layoutWarnings.push('NavRouter 缺少 RouteInfo.name，无法路由'); return; }
      if (w.mode === NavRouteMode.REPLACE) {
        stack.replacePathByName(w.route.name, w.route.param);
      } else {
        // PUSH_WITH_RECREATE 与 PUSH 都走 pushPathByName —— "当前页是否重建"未建模
        stack.pushPathByName(w.route.name, w.route.param);
      }
      // push 同步建出目的地（navBuildDest），返回即视为"已激活 + NavDestination 已加载"
      navRouterSetState(el, true);
      // 实例级 pop 包装（不动 nav.js）：被弹出的栈顶是自己时回落 onStateChange(false)
      if (!w.popPatched && typeof stack.pop === 'function') {
        w.popPatched = true;
        const prevPop = stack.pop;
        /** @param {any=} [a1] @param {any=} [a2] */
        stack.pop = function (a1, a2) {
          const paths = /** @type {any} */ (stack)._paths;
          const top = paths && paths.length ? paths[paths.length - 1] : null;
          const r = prevPop.call(stack, a1, a2);
          if (top && top.name === w.route.name) navRouterSetState(el, false);
          return r;
        };
      }
    });
    return el;
  });

  // ── Navigator ──
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const NAVIGATOR_ATTRS = {
    active: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.active = v === true;
      n.dataset.active = String(w.active);
    },
    type: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.type = Number(resolveResource(v)) || 0;
      n.dataset.type = String(w.type);
    },
    target: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.target = String(resolveResource(v));
      n.dataset.target = w.target;
    },
    params: (n, v) => {
      const w = /** @type {any} */ (n).__navigator;
      if (!w) return;
      w.params = v;
      try { n.dataset.params = JSON.stringify(v); }
      catch (e) { n.dataset.params = '[unserializable]'; }
    },
  };
  /** @param {any[]} args */
  const Navigator = ensureComponent('Navigator', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiNavigator = true;
    el.style.display = 'block';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    // active 的默认值 .d.ts 未写；取 true 依据是"组件缺省即可用"（点一下就该跳），**这是推断**
    const w = /** @type {any} */ (el).__navigator = /** @type {any} */ ({
      active: true,
      type: o.type === undefined ? 0 : Number(resolveResource(o.type)),   // 默认 NavigationType.Push
      target: o.target === undefined ? '' : String(resolveResource(o.target)),
      params: undefined,
      warnedReplace: false,
    });
    el.dataset.active = String(w.active);
    el.dataset.type = String(w.type);
    el.dataset.target = w.target;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (!w.active) return;
      if (!w.target) { layoutWarnings.push(`Navigator 点击：target 未设置（type=${w.type}）`); return; }
      if (w.type === NavigationType.Back) {
        (/** @type {any} */ (global)).__arkui_dom_back();
        return;
      }
      (/** @type {any} */ (global)).__arkui_dom_navigatorParams = { target: w.target, params: w.params };
      if (w.type === NavigationType.Replace) {
        // "替换并销毁当前页"未建模：走同一清根重建通道，差异记诊断（每实例只记一次）
        if (!w.warnedReplace) {
          layoutWarnings.push('Navigator type=Replace：当前页销毁语义未建模，按 Push 通道处理');
          w.warnedReplace = true;
        }
      }
      (/** @type {any} */ (global)).__arkui_dom_navigate(w.target);
    });
    return el;
  });

  // ── PageTransitionEnter / PageTransitionExit ──
  /** @type {any[]} */
  const pageTransitionSpecs = [];
  /**
   * slide/translate 的起止偏移（enter 的"从哪来"、exit 的"到哪去"），单位 px。
   * slide 优先（.d.ts：与 translate 同设时 slide 生效）；START/END 按 LTR 折算。
   * @param {any} spec
   * @param {HTMLElement} root
   * @returns {{x: number, y: number}}
   */
  const pageTransOffset = (spec, root) => {
    const r = root.getBoundingClientRect();
    if (spec.slide !== null && spec.slide !== undefined) {
      const s = Number(spec.slide);
      if (s === SlideEffect.Right || s === SlideEffect.END) return { x: r.width, y: 0 };
      if (s === SlideEffect.Top) return { x: 0, y: -r.height };
      if (s === SlideEffect.Bottom) return { x: 0, y: r.height };
      return { x: -r.width, y: 0 };                     // Left 与 START（LTR）都从左来
    }
    const t = spec.translate && typeof spec.translate === 'object' ? spec.translate : {};
    return { x: Number(t.x) || 0, y: Number(t.y) || 0 };
  };
  /** @param {any} cb @param {number} rt @param {number} p */
  const pageTransFrame = (cb, rt, p) => {
    if (typeof cb !== 'function') return;
    try { cb(rt, p); }
    catch (e) { layoutWarnings.push(`PageTransition onEnter/onExit 回调抛错：${e && e.message}`); }
  };
  /**
   * 页面转场驱动：对当前页面根按已登记规格播一次 enter/exit 动画，逐帧派发 onEnter/onExit。
   * 返回 Web Animations 句柄（无匹配规格或无根时返回 null）。
   * @param {string} kind 'enter' | 'exit'
   * @param {any=} [routeType] RouteType（缺省 None=0：任意方向规格都命中）
   */
  const playPageTransition = (kind, routeType) => {
    const rt = routeType === undefined ? RouteType.None : Number(routeType);
    const spec = pageTransitionSpecs.find((s) => s.kind === kind && (s.type === RouteType.None || s.type === rt));
    const root = currentRoot();
    if (!spec || !root || !root.animate) return null;
    const dur = Math.max(0, Number(spec.duration) || 0);
    const delay = Math.max(0, Number(spec.delay) || 0);
    // curve：字符串（Curve 枚举值与 CSS 关键字对齐）直接透传；ICurve 对象未实现 → linear
    const easing = typeof spec.curve === 'string' && spec.curve ? spec.curve : 'linear';
    const off = pageTransOffset(spec, root);
    const op = spec.opacity === null || spec.opacity === undefined ? 1 : Number(spec.opacity);
    const sc = spec.scale && typeof spec.scale === 'object' ? spec.scale : null;
    const tf = (/** @type {number} */ sx, /** @type {number} */ sy) =>
      `translate(${off.x * sx}px, ${off.y * sy}px)` + (sc ? ` scale(${Number(sc.x) || 1}, ${Number(sc.y) || 1})` : '');
    const frames = kind === 'enter'
      ? [{ transform: tf(1, 1), opacity: op }, { transform: 'none', opacity: 1 }]
      : [{ transform: 'none', opacity: 1 }, { transform: tf(1, 1), opacity: op }];
    const anim = root.animate(frames, { duration: dur, delay, easing, fill: 'none' });
    // 逐帧回调：progress 0→1（含 delay；总时长为 0 时直接派发 1）
    const total = delay + dur;
    const t0 = performance.now();
    const tick = (/** @type {number} */ now) => {
      const p = total <= 0 ? 1 : Math.min(1, (now - t0) / total);
      pageTransFrame(spec.cbs.frame, rt, p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return anim;
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const PAGE_TRANSITION_ATTRS = {
    slide: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      w.slide = Number(resolveResource(v));
      n.dataset.slide = String(w.slide);
    },
    translate: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (w) w.translate = v;
    },
    scale: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (w) w.scale = v;
    },
    opacity: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      w.opacity = Number(v);
      n.dataset.opacity = String(w.opacity);
    },
    onEnter: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      if (w.kind !== 'enter') { layoutWarnings.push('onEnter 只属于 PageTransitionEnter，已在 Exit 上忽略'); return; }
      w.cbs.frame = v;
    },
    onExit: (n, v) => {
      const w = /** @type {any} */ (n).__pageTransition;
      if (!w) return;
      if (w.kind !== 'exit') { layoutWarnings.push('onExit 只属于 PageTransitionExit，已在 Enter 上忽略'); return; }
      w.cbs.frame = v;
    },
  };
  /** @param {string} kind */
  const pageTransitionDom = (kind) => (/** @type {any[]} */ args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiPageTransition = kind;
    el.style.display = 'none';                 // 非可视声明组件：只做规格载体
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__pageTransition = /** @type {any} */ ({
      kind,
      type: o.type === undefined ? RouteType.None : Number(resolveResource(o.type)),
      duration: o.duration === undefined ? 1000 : Number(o.duration),   // 默认 1000（.d.ts JSDoc）
      curve: o.curve === undefined ? 'linear' : o.curve,                 // 默认 Curve.Linear
      delay: o.delay === undefined ? 0 : Number(o.delay),
      slide: null, translate: null, scale: null, opacity: null,
      cbs: {},
    });
    el.dataset.pageTransition = kind;
    el.dataset.type = String(w.type);
    el.dataset.duration = String(w.duration);
    pageTransitionSpecs.push(w);
    return el;
  };
  const PageTransitionEnter = ensureComponent('PageTransitionEnter', pageTransitionDom('enter'));
  const PageTransitionExit = ensureComponent('PageTransitionExit', pageTransitionDom('exit'));
  // 自省/驱动入口走 defineProperty —— 不进 main.js 的 Object.assign 块（stats.mjs 按第一个
  // assign 块统计 global 面，分片里再开一个 assign 块会污染统计口径）
  Object.defineProperty(global, '__arkui_dom_pageTransitionSpecs', {
    get: () => pageTransitionSpecs.slice(), configurable: true,
  });
  Object.defineProperty(global, '__arkui_dom_playPageTransition', {
    get: () => playPageTransition, configurable: true,
  });

  // ── ToolBarItem（API 20；属性类为空 → 无 ATTRS 表，唯一参数是 create 的 options.placement）──
  /** @param {any[]} args */
  const ToolBarItem = ensureComponent('ToolBarItem', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiToolBarItem = true;
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const placement = o.placement === undefined ? 0 : Number(resolveResource(o.placement));
    el.dataset.placement = String(placement);   // 0=TOP_BAR_LEADING（默认）1=TOP_BAR_TRAILING
    return el;
  });

  // ── UIPickerComponent ──
  const UPX_DEFAULT_ROW_H = 40;      // .d.ts NOTE：选项高度固定 40vp（vp→px 1:1 近似）
  const UPX_DEFAULT_ROWS = 7;        // .d.ts NOTE：最多显示 7 项
  const UPX_IND_BG = '#f1f3f5';      // comp_background_tertiary 的近似色（拿不到资源表）
  const UPX_IND_DIVIDER = '#e5e5e5'; // comp_divider 的近似色
  /** LengthMetrics/Length → px 数值（vp/fp/lpx/px 一律 1:1 近似，本项目一贯做法） */
  /** @param {any} v */
  const upxLengthPx = (v) => {
    const r = resolveResource(v);
    if (typeof r === 'number') return r;
    if (r && typeof r === 'object' && typeof r.value === 'number') return r.value;
    const n = parseFloat(String(r));
    return Number.isFinite(n) ? n : 0;
  };
  /** @param {any} el */
  const upxApplyIndicator = (el) => {
    const w = /** @type {any} */ (el).__picker;
    const ind = w && w.indEl;
    if (!w || !ind) return;
    const mid = Math.floor(w.displayed / 2);
    const rowH = w.itemHeight;
    ind.style.top = mid * rowH + 'px';
    ind.style.height = rowH + 'px';
    ind.style.left = (w.indicator.startMargin || 0) + 'px';
    ind.style.right = (w.indicator.endMargin || 0) + 'px';
    if (w.indicator.type === PickerIndicatorType.DIVIDER) {
      const sw = w.indicator.strokeWidth === undefined ? 2 : w.indicator.strokeWidth;
      ind.style.background = 'transparent';
      ind.style.borderTop = sw + 'px solid ' + colorOf(w.indicator.dividerColor === undefined || w.indicator.dividerColor === null ? UPX_IND_DIVIDER : w.indicator.dividerColor);
      ind.style.borderBottom = ind.style.borderTop;
      ind.style.borderRadius = '0';
    } else {
      ind.style.background = colorOf(w.indicator.backgroundColor === undefined || w.indicator.backgroundColor === null ? UPX_IND_BG : w.indicator.backgroundColor);
      ind.style.borderTop = 'none';
      ind.style.borderBottom = 'none';
      ind.style.borderRadius = (w.indicator.borderRadius === undefined || w.indicator.borderRadius === null ? 12 : upxLengthPx(w.indicator.borderRadius)) + 'px';
    }
    ind.style.boxSizing = 'border-box';
  };
  /**
   * 滚轮：在 wheelEl 里建 displayed 行（中行高亮、translateY 定位），步进后派发回调。
   * 视觉与 TextPicker 的 tpxEngine 同族（R56），但行数/行高可配且回调签名是 (index: number)。
   * @param {any} el
   */
  const upxBuildWheel = (el) => {
    const w = /** @type {any} */ (el).__picker;
    if (!w) return;
    const wheel = document.createElement('div');
    wheel.setAttribute('data-upx-wheel', '');
    wheel.style.flex = '1';
    wheel.style.position = 'relative';
    wheel.style.overflow = 'hidden';
    wheel.style.height = w.displayed * w.itemHeight + 'px';
    const inner = document.createElement('div');
    inner.style.position = 'absolute';
    inner.style.left = '0';
    inner.style.right = '0';
    inner.style.willChange = 'transform';
    const rows = /** @type {any[]} */ ([]);
    const mid = Math.floor(w.displayed / 2);
    for (let r = 0; r < w.displayed; r++) {
      const row = document.createElement('div');
      row.setAttribute('data-upx-row', String(r));
      row.style.height = w.itemHeight + 'px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'center';
      row.style.fontSize = r === mid ? '20px' : '16px';
      row.style.fontWeight = r === mid ? '500' : 'normal';
      row.style.color = r === mid ? 'rgb(0, 125, 255)' : 'rgb(24, 36, 49)';
      inner.appendChild(row);
      rows.push(row);
    }
    wheel.appendChild(inner);
    /** @param {number} dir */
    const step = (dir) => {
      const n = w.items.length;
      const next = Math.max(0, Math.min(n - 1, w.sel + dir));
      if (next === w.sel) return;                     // 边界：不动不发（canLoop 未实现）
      w.sel = next;
      render();
      el.dataset.selectedIndex = JSON.stringify([w.sel]);
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(w.sel); }
        catch (e) { layoutWarnings.push(`UIPickerComponent.onChange 回调抛错：${e && e.message}`); }
      }
      // onScrollStop：步进即"一小段滚动结束"，用短去抖近似（连续滚只发最后一次）
      if (w.stopTimer) clearTimeout(w.stopTimer);
      w.stopTimer = setTimeout(() => {
        const cb2 = w.cbs.stop;
        if (typeof cb2 === 'function') {
          try { cb2(w.sel); }
          catch (e) { layoutWarnings.push(`UIPickerComponent.onScrollStop 回调抛错：${e && e.message}`); }
        }
      }, 60);
    };
    const render = () => {
      for (let r = 0; r < w.displayed; r++) {
        const oi = w.sel - mid + r;
        rows[r].textContent = (oi >= 0 && oi < w.items.length) ? w.items[oi] : '';
      }
      inner.style.transform = `translateY(${(mid - w.sel) * w.itemHeight}px)`;
    };
    wheel.addEventListener('wheel', (e) => {
      e.preventDefault();
      step(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    wheel.addEventListener('click', (e) => {
      const box = wheel.getBoundingClientRect();
      step(e.clientY < box.top + box.height / 2 ? -1 : 1);
    });
    w.render = render;
    w.step = step;
    return wheel;
  };
  /** pop 时收割子项（Tabs 模式）：节点挪进隐藏 stash 保留复用，标签取 textContent 重建滚轮 */
  /** @param {any} el */
  const upxFinalize = (el) => {
    const w = /** @type {any} */ (el).__picker;
    if (!w) return;
    // 收割：跳过指示器/滚轮/stash，其余直接子节点都是选项（Row 容器整体算一项）
    for (const kid of Array.from(el.children)) {
      const k = /** @type {any} */ (kid);
      if (k === w.indEl || k === w.stash || k.hasAttribute('data-upx-wheel')) continue;
      w.stash.appendChild(k);
      k.style.display = 'none';
    }
    w.items = Array.from(w.stash.children).map((/** @type {any} */ k) => k.textContent || '');
    if (!w.items.length) layoutWarnings.push('UIPickerComponent 内没有任何子组件，滚轮为空');
    if (w.canLoop && w.items.length >= 8) {
      layoutWarnings.push('UIPickerComponent canLoop=true：循环滚动未实现（当前按有界滚动处理）');
    }
    w.sel = Math.max(0, Math.min(w.items.length - 1, w.sel));
    let wheel = /** @type {any} */ (el.querySelector('[data-upx-wheel]'));
    if (wheel) wheel.remove();
    wheel = upxBuildWheel(el);
    if (wheel) el.insertBefore(wheel, w.stash);      // 滚轮在 stash（display:contents 不可见）之前
    w.render();
    upxApplyIndicator(el);
    el.dataset.selectedIndex = JSON.stringify([w.sel]);
    el.dataset.itemCount = String(w.items.length);
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const UIPICKER_ATTRS = {
    onChange: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (w) w.cbs.change = v;
    },
    onScrollStop: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (w) w.cbs.stop = v;
    },
    canLoop: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      w.canLoop = v !== false;                       // undefined 按缺省 true（.d.ts JSDoc）
      n.dataset.canLoop = String(w.canLoop);
    },
    enableHapticFeedback: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      w.haptic = v !== false;
      n.dataset.hapticFeedback = String(w.haptic);   // 震动依赖硬件，DOM 侧只落语义标记
    },
    selectionIndicator: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      const s = v && typeof v === 'object' ? v : {};
      if (s.type !== undefined) w.indicator.type = Number(resolveResource(s.type));
      if (s.strokeWidth !== undefined) w.indicator.strokeWidth = upxLengthPx(s.strokeWidth);
      if (s.dividerColor !== undefined) w.indicator.dividerColor = s.dividerColor;
      if (s.startMargin !== undefined) w.indicator.startMargin = upxLengthPx(s.startMargin);
      if (s.endMargin !== undefined) w.indicator.endMargin = upxLengthPx(s.endMargin);
      if (s.backgroundColor !== undefined) w.indicator.backgroundColor = s.backgroundColor;
      if (s.borderRadius !== undefined) w.indicator.borderRadius = s.borderRadius;
      n.dataset.indicatorType = String(w.indicator.type);
      upxApplyIndicator(n);
    },
    itemHeight: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      const h = upxLengthPx(v);
      if (h > 0) w.itemHeight = h;
      n.dataset.itemHeight = String(w.itemHeight);
      upxApplyIndicator(n);
    },
    displayedItemCount: (n, v) => {
      const w = /** @type {any} */ (n).__picker;
      if (!w) return;
      const c = Math.floor(Number(resolveResource(v)));
      if (Number.isFinite(c) && c >= 1) w.displayed = c;
      n.dataset.displayedItemCount = String(w.displayed);
      upxApplyIndicator(n);
    },
  };
  /** @param {any[]} args */
  const UIPickerComponent = ensureComponent('UIPickerComponent', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiPicker = true;
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__picker = /** @type {any} */ ({
      // selectedIndex 缺省 0；小数向下取整（.d.ts JSDoc 原文）
      sel: o.selectedIndex === undefined ? 0 : Math.max(0, Math.floor(Number(o.selectedIndex) || 0)),
      itemHeight: UPX_DEFAULT_ROW_H,
      displayed: UPX_DEFAULT_ROWS,
      canLoop: true,
      haptic: true,
      indicator: { type: PickerIndicatorType.BACKGROUND, strokeWidth: 2, dividerColor: undefined,
        startMargin: 0, endMargin: 0, backgroundColor: undefined, borderRadius: undefined },
      items: [], cbs: {}, stopTimer: null,
    });
    el.dataset.itemHeight = String(w.itemHeight);
    el.dataset.displayedItemCount = String(w.displayed);
    el.dataset.indicatorType = String(w.indicator.type);
    // 选中项指示器：绝对定位横带，滚轮建好后按 itemHeight/displayed 定位
    const ind = document.createElement('div');
    ind.setAttribute('data-upx-indicator', '');
    ind.style.position = 'absolute';
    ind.style.pointerEvents = 'none';
    el.appendChild(ind);
    w.indEl = ind;
    // 子项 stash：收割后的选项节点藏在这里（复用靠它——节点永不销毁）
    const stash = document.createElement('div');
    stash.setAttribute('data-upx-stash', '');
    stash.style.display = 'none';
    el.appendChild(stash);
    w.stash = stash;
    return el;
  }, (/** @type {any} */ node, /** @type {any[]} */ args) => {
    // 重渲染：create 选项里的 selectedIndex 变化 → 重定位（不发 onChange，与 TextPicker 同语义）
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : null;
    const w2 = node && node.__picker;
    if (!o || !w2 || o.selectedIndex === undefined) return;
    w2.sel = Math.max(0, Math.floor(Number(o.selectedIndex) || 0));
    if (w2.render) w2.render();
    node.dataset.selectedIndex = JSON.stringify([w2.sel]);
  });
  // pop 收尾：子组件此时才齐（Tabs 同款）。覆写实例 pop —— Proxy 无 set 陷阱，落到 target 上
  {
    const prevPop = UIPickerComponent.pop;
    /** @param {...any} args */
    UIPickerComponent.pop = function (...args) {
      const top = ViewStackProcessor.top();
      prevPop.apply(null, args);
      if (top && /** @type {any} */ (top).__arkuiPicker) upxFinalize(top);
    };
  }
