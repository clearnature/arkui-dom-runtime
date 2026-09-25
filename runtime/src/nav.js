  // ────────────────── Navigation / NavDestination（栈导航）──────────────────
  //
  // 产物形式（实测 fixtures/pages/NavDemo.ts）：
  //   Navigation.create(this.stack, { moduleName, pagePath, isUserCreateStack: true });
  //   Navigation.title('Home');
  //   Navigation.navDestination({ builder: this.PageMap.bind(this) });   ← 包一层对象取 .builder
  //   Navigation.mode(NavigationMode.Stack); Navigation.width('…'); Navigation.id('…');
  //   { 根内容子组件 }                     ← 直接挂进 Navigation 元素
  //   Navigation.pop();
  //
  // builder 由【运行时】在压栈时调用（不在 initialRender 里）：
  //   builder(name, param, parent?)
  //     → NavDestination.create(deepFn, extraInfo);   ← 子构建器同样是构造参数
  //       NavDestination.title(name);
  //       NavDestination.onWillAppear/…/onWillDisappear(cb);
  //       NavDestination.pop();
  //
  // DOM 结构：
  //   <div data-arkui-comp="Navigation">        position:relative; overflow:hidden
  //     …根内容…                                 （被覆盖但不销毁 —— "状态保留"就靠这条）
  //     <div data-arkui-nav-destinations>        绝对定位覆盖层，空栈时 display:none
  //       <div data-arkui-comp="NavDestination"> 只有栈顶那个可见
  const NavigationMode = { Stack: 'stack', Split: 'split', Auto: 'auto' };
  // 标题栏相关枚举：产物里都是【自由变量】引用（`NavigationTitleMode.Full` 这样），必须挂 global
  // NavigationTitleMode 的取值照 .d.ts 声明顺序：Free = 0, Full, Mini
  const NavigationTitleMode = { Free: 0, Full: 1, Mini: 2 };
  const NavBarPosition = { Start: 0, End: 1 };
  const TitleHeight = { MainOnly: 0, MainWithSub: 1 };

  // 标题栏高度（vp→px 1:1，本项目一贯近似）。数字直接来自 navigation.d.ts 里 NavigationTitleMode
  // 的 JSDoc 原文：
  //   Full：「If there is only a main title, the title bar height is 112 vp; if there is both a main
  //          title and a subtitle, the title bar height is 138 vp」
  //   Mini：「Since API version 12, the title bar height is 56 vp」
  //   Free（默认 = 0）：「In the non-scrolling state, the height of the title bar is the same as in
  //          Full mode」—— 本实现不做滚动收缩，所以 Free 恒等于 Full。
  // TitleHeight 的数值 .d.ts 没给；按它自己的 JSDoc 措辞（"only main title" / "main title and
  // subtitle are both available"）对应到 Full 那两个已文档化的数字（112 / 138）。**这是推断**，
  // 已写进 docs 的已知限制。
  const NAV_TITLE_H = { main: 112, mainSub: 138, mini: 56 };
  const TITLE_HEIGHT_VALUE = { 0: NAV_TITLE_H.main, 1: NAV_TITLE_H.mainSub };
  const NAV_DIVIDER_PX = 1;               // 分栏时的分割线宽度
  const NAV_DEFAULT_BAR_W = 240;          // navBarWidth 默认 240vp（.d.ts JSDoc 原文）
  // push/pop 的系统转场（R25，R40 照真机源码纠偏）。权威出处：ace_engine
  // navigation_group_node.cpp——push/pop 动画 = InterpolatingSpring(0,1,342,37)、
  // 时长上界 DEFAULT_ANIMATION_DURATION=450ms；入页起点 +50%（navdestination_node_base.cpp
  // CalcTranslateForTransitionPushStart: width×HALF）；被盖页视差滑到 -20%
  //（CONTENT_OFFSET_PERCENT=0.2，其标题栏再 -2%：TITLE_OFFSET_PERCENT）；pop 弹出页滑到
  // +50%、露出页从 -20% 回 0。CSS transition 没有弹簧曲线——cubic-bezier(0.2,0,0,1) 是
  // 该弹簧（damping 37 ≈ 临界阻尼，无过冲）的近似，时长取 450ms 上界。
  const NAV_TRANS_MS = 450;
  const NAV_TRANS_CURVE = 'cubic-bezier(0.2, 0.0, 0.0, 1.0)';
  const NAV_PUSH_FROM = 50;             // 入页起点%（width×HALF）
  const NAV_POP_TO = 50;                // 弹出页终点%（width×HALF）
  const NAV_PARALLAX = 20;              // 被盖/露出页的视差%（CONTENT_OFFSET_PERCENT×100）
  // 转场运行记录（测试轮询"挂着的转场"用，与 animation.js 的 transitionRuns 同思想）
  const navTransRuns = [];
  let navTransRunSeq = 0;
  function navTransDescribe() {
    let pending = 0;
    navTransRuns.forEach((r) => { if (!r.done) pending++; });
    return { runs: navTransRuns.map((r) => ({ ...r })), pending };
  }
  function navWitness(el, run) {          // transitionend 只当"见证"，不当收口依据（坑 ⑧ 同源）
    const fn = () => { run.sawTransitionEnd = true; };
    el.addEventListener('transitionend', fn, { once: true });
    return () => el.removeEventListener('transitionend', fn);
  }
  function navEndTransStyle(el) {
    el.style.transitionProperty = '';
    el.style.transitionDuration = '';
    el.style.transitionTimingFunction = '';
    delete el.dataset.arkuiNavTrans;
  }

  // NavDestination 的生命周期回调：属性名 → state 键
  const NAVDEST_LIFECYCLE = {
    onWillAppear: 'willAppear', onWillShow: 'willShow', onShown: 'shown', onReady: 'ready',
    onWillHide: 'willHide', onHidden: 'hidden', onWillDisappear: 'willDisappear',
    onBackPressed: 'backPressed',
  };
  // Navigation/NavDestination 上【仍未】覆盖的语义项（只列 .d.ts 里真实存在、而本实现没做的）。
  // 标题栏/工具栏/分栏已于 R12 收口实现（见下面的 navSyncChrome）—— 未实现的仍然不能静默。
  const NAV_UNSUPPORTED = new Set([
    // onTitleModeChange 已于 R25 实现（Free 滚动联动，见 navOnContentScroll）
    'onNavBarStateChange',      // 长按隐藏导航栏
    'navBarWidthRange', 'minNavBarWidth', 'hideNavBar', 'enableDragBar',
    'ignoreLayoutSafeArea', 'systemBarStyle', 'onNavigationModeChange',
    'customNavContentTransition', 'recoverable', 'enableModeChangeAnimation',
    'enableToolBarAdaptation', 'splitPlaceholder',
  ]);

  const animOf = (v) => (typeof v === 'boolean' ? v : !!(v && typeof v === 'object' && v.animated));

  class NavPathStack {
    constructor() {
      /** @type {any} */ this._nav = null;
      /** @type {any[]} */ this._paths = [];
      /** @type {boolean} */ this._noAnim = false;
    }

    // ── 查询 ──
    size() { return this._paths.length; }
    getAllPathName() { return this._paths.map((p) => p.name); }
    /** @param {number} i */
    getParamByIndex(i) { const p = this._paths[i]; return p ? p.param : undefined; }
    /** @param {string} name */
    getParamByName(name) { return this._paths.filter((p) => p.name === name).map((p) => p.param); }
    /** @param {string} name */
    getIndexByName(name) {
      const out = [];
      this._paths.forEach((p, i) => { if (p.name === name) out.push(i); });
      return out;
    }
    getPathStack() { return this._paths.map((p) => ({ name: p.name, param: p.param, onPop: p.onPop })); }
    getParent() {
      layoutWarnings.push('NavPathStack.getParent 未实现（嵌套 Navigation 的父栈未建模）');
      return undefined;
    }
    setInterception() { layoutWarnings.push('NavPathStack.setInterception 未实现（路由拦截未建模）'); }
    /** @param {any=} [paths] */
    setPathStack(paths) {
      navClearAll(this);
      (paths || []).forEach((/** @type {any} */ p) => navPushRec(this, { name: p.name, param: p.param, onPop: p.onPop }, false));
      navSyncVisibility(this._nav);
    }

    // ── 压栈 ──（animated 一律透传原值，默认 true 的解释在 navWantAnim）
    /** @param {any} info @param {any=} [options] */
    pushPath(info, options) {
      navPushRec(this, info || {}, options && typeof options === 'object' ? options.animated : options);
    }
    /** @param {string} name @param {any} param @param {any=} [a3] @param {any=} [a4] */
    pushPathByName(name, param, a3, a4) {
      // .d.ts 重载：(name, param, animated?) / (name, param, onPop, animated?)。
      // a3 是函数 → a4 才是 animated；a3 是布尔 → a3 就是 animated（三参形态）；
      // a3=undefined（如 (name, param, undefined, false)）→ 看 a4。
      const onPop = typeof a3 === 'function' ? a3 : undefined;
      const animated = typeof a3 === 'function' ? a4 : (typeof a3 === 'boolean' ? a3 : a4);
      navPushRec(this, { name, param, onPop }, animated);
    }
    /** @param {any} info */
    pushDestination(info) {
      navPushRec(this, info || {}, info && typeof info === 'object' ? info.animated : undefined);
      return Promise.resolve();
    }
    /** @param {string} name @param {any} param */
    pushDestinationByName(name, param) {
      navPushRec(this, { name, param }, arguments[2]);
      return Promise.resolve();
    }

    // ── 弹栈 ──
    // .d.ts 重载：pop(animated?) / pop(result, animated?)；popToName/Index(name, result?, animated?)
    // 都有 "Whether to enable the transition animation ... Default value: true"
    /** @param {any=} [a1] @param {any=} [a2] */
    pop(a1, a2) {
      if (!this._paths.length) return undefined;
      const result = a1 !== undefined && typeof a1 !== 'boolean' ? a1 : undefined;
      const animated = typeof a1 === 'boolean' ? a1 : a2;
      const rec = this._paths[this._paths.length - 1];
      navPopRange(this, this._paths.length - 1, 1, result, animated);
      return { name: rec.name, param: rec.param };
    }
    /** @param {string} name @param {any=} [a2] @param {any=} [a3] */
    popToName(name, a2, a3) {
      const idx = this.getIndexByName(name);
      if (!idx.length) {
        layoutWarnings.push(`NavPathStack.popToName('${name}')：栈里没有该 name（约定返回 -1）`);
        return -1;
      }
      const target = idx[idx.length - 1];
      const result = a2 !== undefined && typeof a2 !== 'boolean' ? a2 : undefined;
      const animated = typeof a2 === 'boolean' ? a2 : a3;
      navPopRange(this, target + 1, this._paths.length - target - 1, result, animated);
      return target;
    }
    /** @param {number} index @param {any=} [a2] @param {any=} [a3] */
    popToIndex(index, a2, a3) {
      const n = this._paths.length;
      if (!Number.isInteger(index) || index < 0 || index >= n) {
        layoutWarnings.push(`NavPathStack.popToIndex(${index})：越界（共 ${n} 项）`);
        return;
      }
      const result = a2 !== undefined && typeof a2 !== 'boolean' ? a2 : undefined;
      const animated = typeof a2 === 'boolean' ? a2 : a3;
      navPopRange(this, index + 1, n - index - 1, result, animated);
    }

    // ── 改写 ──
    /** @param {any} info @param {any=} [options] */
    replacePath(info, options) { navReplaceTop(this, info || {}, animOf(options)); }
    /** @param {string} name @param {any} param */
    replacePathByName(name, param) { navReplaceTop(this, { name, param }, animOf(arguments[2])); }
    /** @param {any} info */
    replaceDestination(info) { navReplaceTop(this, info || {}, animOf(arguments[1])); return Promise.resolve(); }
    /** @param {string} name */
    removeByName(name) {
      const idx = [];
      this._paths.forEach((p, i) => { if (p.name === name) idx.push(i); });
      if (!idx.length) return 0;
      idx.slice().reverse().forEach((i) => navPopRange(this, i, 1, undefined));
      return idx.length;
    }
    /** @param {any=} [indexes] */
    removeByIndexes(indexes) {
      const valid = (indexes || []).filter((/** @type {number} */ i) => Number.isInteger(i) && i >= 0 && i < this._paths.length);
      valid.slice().sort((a, b) => b - a).forEach((i) => navPopRange(this, i, 1, undefined));
      return valid.length;
    }
    removeByNavDestinationId() {
      layoutWarnings.push('NavPathStack.removeByNavDestinationId 未实现（本实现没有 NavDestination id 概念）');
      return 0;
    }
    /** @param {string} name */
    moveToTop(name) {
      const idx = this.getIndexByName(name);
      if (!idx.length) {
        layoutWarnings.push(`NavPathStack.moveToTop('${name}')：栈里没有该 name`);
        return -1;
      }
      const rec = this._paths.splice(idx[idx.length - 1], 1)[0];
      this._paths.push(rec);
      // 复用原实例（与真机一致）：只调 DOM 顺序，不重建、不销毁
      if (rec.el && rec.el.parentNode) rec.el.parentNode.appendChild(rec.el);
      navSyncVisibility(this._nav);
      return this._paths.length - 1;
    }
    /** @param {number} index */
    moveIndexToTop(index) {
      const rec = this._paths[index];
      if (!rec) { layoutWarnings.push(`NavPathStack.moveIndexToTop(${index})：越界`); return; }
      this.moveToTop(rec.name);
    }
    clear() { navClearAll(this); navSyncVisibility(this._nav); }
    /** @param {any} value */
    disableAnimation(value) { this._noAnim = !!value; }
  }

  // ── 标题栏 / 工具栏 / 分栏（R12 收口）──
  //
  // 产物形态（实测 fixtures/pages/NavBarDemo.ts）：
  //   Navigation.title('T1');                                              ← string
  //   Navigation.title({ main: 'M2', sub: 'S2' });                        ← NavigationCommonTitle
  //   Navigation.title({ builder: this.TB.bind(this) }, { backgroundColor: '#eeeeee' });
  //   Navigation.title({ builder: this.TB.bind(this), height: TitleHeight.MainWithSub });
  //   Navigation.titleMode(NavigationTitleMode.Full);                     ← 自由变量枚举
  //   Navigation.hideTitleBar(true); Navigation.hideBackButton(true);
  //   Navigation.mode(NavigationMode.Split); Navigation.navBarWidth(200);
  //   Navigation.navBarPosition(NavBarPosition.Start);
  //   NavDestination.title('DT1'); NavDestination.menus([{ value, action }]);
  //   NavDestination.toolbarConfiguration([{ value, action }]); NavDestination.hideBackButton(true);
  // ⚠️ CustomBuilder 也是以 **{ builder } 对象** 传进来的（loader 会把 CustomBuilder 归一化成对象），
  //    所以"是不是自定义标题"看的是【有没有 builder 字段】，不是实参类型。

  /** @param {any} v */
  function navParseTitle(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object' && typeof v.builder === 'function') {
      return { kind: 'builder', builder: v.builder, height: v.height };
    }
    if (typeof v === 'object' && (v.main !== undefined || v.sub !== undefined)) {
      return { kind: 'common', main: resolveResource(v.main), sub: resolveResource(v.sub) };
    }
    return { kind: 'text', text: String(resolveResource(v)) };
  }

  // 标题栏高度（px）。NavigationCustomTitle.height 优先 —— .d.ts 原文：
  // "When the NavigationCustomTitle type is used to set the height, titleMode does not take effect."
  /** @param {any} spec @param {any} titleMode */
  function navTitleBarH(spec, titleMode) {
    if (spec && spec.height !== undefined && spec.height !== null) {
      if (typeof spec.height === 'number' && TITLE_HEIGHT_VALUE[spec.height] !== undefined) {
        return TITLE_HEIGHT_VALUE[spec.height];        // TitleHeight 枚举（数值推断，见常量注释）
      }
      const n = dimOf(spec.height, 0);
      if (n > 0) return n;                             // 显式 Length
    }
    if (titleMode === NavigationTitleMode.Mini) return NAV_TITLE_H.mini;
    const hasSub = !!(spec && spec.kind === 'common' && spec.sub !== undefined && spec.sub !== null
      && String(spec.sub) !== '');
    return hasSub ? NAV_TITLE_H.mainSub : NAV_TITLE_H.main;   // Full；Free 非滚动态等同 Full
  }

  // 滚动联动的生效条件（三条都来自 .d.ts 原文）：
  //   ① titleMode 必须 Free —— onTitleModeChange 的 JSDoc："Triggered when titleMode is set to
  //      NavigationTitleMode.Free and the title bar mode changes as content scrolls."
  //   ② NavigationCustomTitle.height 显式给过就不联动 —— "When the NavigationCustomTitle type
  //      is used to set the height, titleMode does not take effect."
  //   ③ 标题栏整个藏了（hideTitleBar）自然没有联动。
  /** @param {any} st */
  function navCollapseAllowed(st) {
    return st.titleMode === NavigationTitleMode.Free && !st.hideTitleBar
      && !(st.titleSpec && st.titleSpec.height !== undefined && st.titleSpec.height !== null);
  }

  // 内容滚动 → 标题栏收缩（capture 监听挂在 Navigation 上，见 createNavState）。
  // 进度 p∈[0,1]：0 = 全高（Free 非滚动态等同 Full），1 = 收到 Mini；
  // 滚动距离与收缩进度线性，滚满 (Full−Mini) px 收到底 —— 该换算是本实现的选择
  //（.d.ts 只说 "the main title shrinks as the content scrolls down ... and restores
  // as the content scrolls up to the top"，没给阈值）。
  /** @param {any} st @param {Event} e */
  function navOnContentScroll(st, e) {
    const t = /** @type {any} */ (e.target);
    if (!t || t === st.node) return;
    if (st.areaEl && (t === st.areaEl || st.areaEl.contains(t))) return;   // 目的地自己滚不算
    if (!navCollapseAllowed(st)) return;
    const fullH = navTitleBarH(st.titleSpec, NavigationTitleMode.Full);
    if (fullH <= NAV_TITLE_H.mini) return;
    const p = Math.max(0, Math.min(1, (t.scrollTop || 0) / (fullH - NAV_TITLE_H.mini)));
    if (p === st.collapseP) return;
    st.collapseP = p;
    // 模式切换只发生在两个端点（阈值点 .d.ts 没写，端点判定是本实现的选择）：
    // 收到底 → Mini；滚回顶 → Full（"restores as the content scrolls up to the top"）。
    const s = p >= 1 ? 'mini' : (p <= 0 ? 'full' : st.tmcState);
    if (s !== st.tmcState) {
      st.tmcState = s;
      if (typeof st.tmc === 'function') {
        try {
          st.tmc(s === 'mini' ? NavigationTitleMode.Mini : NavigationTitleMode.Full);
        } catch (err) { layoutWarnings.push(`onTitleModeChange 回调抛错：${err && err.message}`); }
      }
    }
    syncOneNav(st.node);     // 高度/内边距/标题内部视觉统一走 syncOneNav，不维护两份几何
  }

  // 把 builder 建出来的节点收进 host（复用 NavDestination 深渲染那套：压栈 + 保存/还原 elmtId）
  /** @param {HTMLElement} host @param {any} builder @param {string} what */
  function runBuilderInto(host, builder, what) {
    const saved = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    ViewStackProcessor.push(host);
    try { builder(); } catch (e) {
      layoutWarnings.push(`${what} 的 builder 抛错：${e && e.message}`);
    }
    ViewStackProcessor.restore(saved);
    currentNodeElmtId = savedElmt;
  }

  /** @param {any=} [items] */
  function navMenuBar(items) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-arkui-nav-menus', '');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    (items || []).forEach((/** @type {any} */ m, /** @type {number} */ i) => {
      const el = document.createElement('div');
      el.setAttribute('data-arkui-nav-menu', String(i));
      el.style.cursor = 'pointer';
      el.style.padding = '0 4px';
      el.textContent = String(resolveResource(m.value === undefined ? m.icon : m.value));
      el.addEventListener('click', () => {
        if (typeof m.action === 'function') {
          try { m.action(); } catch (e) { layoutWarnings.push(`菜单 action 抛错：${e && e.message}`); }
        }
      });
      wrap.appendChild(el);
    });
    return wrap;
  }

  function navBackButton(onBack, icon) {
    const btn = document.createElement('div');
    btn.setAttribute('data-arkui-nav-back', '');
    btn.style.cursor = 'pointer';
    btn.style.padding = '0 8px 0 0';
    btn.style.flexShrink = '0';
    if (icon) { btn.setAttribute('data-arkui-nav-back-icon', String(icon)); }
    btn.textContent = icon ? '‹' : '←';
    btn.addEventListener('click', onBack);
    return btn;
  }

  // 往 host 里画一条标题栏（Navigation 的导航栏 / NavDestination 的标题栏共用）
  function drawTitleBar(host, spec, opts) {
    const o = opts || {};
    host.textContent = '';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.boxSizing = 'border-box';
    if (o.backgroundColor !== undefined && o.backgroundColor !== null) {
      host.style.backgroundColor = String(colorOf(o.backgroundColor));
    }
    if (o.showBack) host.appendChild(navBackButton(o.onBack, o.backIcon));
    if (!spec) return;
    if (spec.kind === 'builder') {
      const holder = document.createElement('div');
      holder.setAttribute('data-arkui-nav-title-slot', '');
      holder.style.flex = '1';
      holder.style.minWidth = '0';
      host.appendChild(holder);
      runBuilderInto(holder, spec.builder, 'Navigation.title');
    } else if (spec.kind === 'common') {
      const box = document.createElement('div');
      box.setAttribute('data-arkui-nav-title-slot', '');
      box.style.flex = '1';
      box.style.minWidth = '0';
      const main = document.createElement('div');
      main.setAttribute('data-arkui-nav-title-main', '');
      main.style.fontSize = '16px';
      main.textContent = String(spec.main === undefined || spec.main === null ? '' : spec.main);
      box.appendChild(main);
      const sub = document.createElement('div');
      sub.setAttribute('data-arkui-nav-title-sub', '');
      sub.style.fontSize = '12px';
      sub.style.opacity = '0.7';
      sub.textContent = String(spec.sub === undefined || spec.sub === null ? '' : spec.sub);
      box.appendChild(sub);
      host.appendChild(box);
    } else {
      const t = document.createElement('div');
      t.setAttribute('data-arkui-nav-title-text', '');
      t.style.flex = '1';
      t.style.minWidth = '0';
      t.style.overflow = 'hidden';
      t.textContent = spec.text;
      host.appendChild(t);
    }
    if (o.menus && o.menus.length) host.appendChild(navMenuBar(o.menus));
  }

  // 工具栏（NavDestination 底部）：ToolbarItem[] → 一行可点项
  function drawToolbar(host, items) {
    host.textContent = '';
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    host.style.boxSizing = 'border-box';
    host.style.gap = '16px';
    (items || []).forEach((it, i) => {
      const el = document.createElement('div');
      el.setAttribute('data-arkui-nav-toolbar-item', String(i));
      el.setAttribute('data-arkui-nav-toolbar-status', String(it.status === undefined ? 0 : it.status));
      el.style.cursor = 'pointer';
      el.textContent = String(resolveResource(it.value));
      el.addEventListener('click', () => {
        if (typeof it.action === 'function') {
          try { it.action(); } catch (e) { layoutWarnings.push(`工具栏 action 抛错：${e && e.message}`); }
        }
      });
      host.appendChild(el);
    });
  }

  function createNavState(node, stack) {
    // @type 档位：整袋 any —— barEl/titleEl/dividerEl/tmc 等十来个字段都是 null↔对象 摆动，
    // 后渲染才赋值；属性级 @type 只能管到紧随其后的一个属性，这里必须整袋收
    const st = /** @type {any} */ ({
      node, stack: null, builder: null, areaEl: null, mode: 'stack', visible: null, paths: null,
      // 标题栏 / 工具栏 / 分栏（R12 收口）
      titleSpec: null, titleOptions: null, titleMode: NavigationTitleMode.Free,
      hideTitleBar: false, hideBackButton: false, menus: null,
      navBarWidth: null, navBarPosition: NavBarPosition.Start, minContentWidth: null,
      barEl: null, titleEl: null, dividerEl: null, titleDrawn: null, effectiveMode: 'stack',
      // R25：Free 滚动联动 + 转场
      tmc: null,              // onTitleModeChange 回调
      collapseP: 0,           // 收缩进度 0(=Full)…1(=Mini)，随内容滚动更新
      tmcState: 'full',       // 已通知的模式端点：'full' | 'mini'
    });
    node.__navState = st;
    node.style.position = 'relative';
    node.style.overflow = 'hidden';
    // 导航栏（含标题栏）必须是【第一个子节点】：根内容是直接子节点、在其后挂载，
    // 目标区最后创建。三者的定位关系由 syncOneNav 按模式统一摆（绝对定位，不参与文档流）。
    const bar = document.createElement('div');
    bar.setAttribute('data-arkui-nav-bar', '');
    bar.style.position = 'absolute';
    bar.style.zIndex = '2';
    bar.style.boxSizing = 'border-box';
    const title = document.createElement('div');
    title.setAttribute('data-arkui-nav-titlebar', '');
    title.style.position = 'absolute';
    title.style.left = '0';
    title.style.right = '0';
    title.style.top = '0';
    title.style.padding = '0 8px';
    title.style.fontSize = '16px';
    title.style.overflow = 'hidden';      // Free 收缩时内容随高度裁剪
    bar.appendChild(title);
    st.barEl = bar;
    st.titleEl = title;
    node.insertBefore(bar, node.firstChild);
    const divider = document.createElement('div');
    divider.setAttribute('data-arkui-nav-divider', '');
    divider.style.position = 'absolute';
    divider.style.display = 'none';
    divider.style.background = '#e5e5e5';
    st.dividerEl = divider;
    node.insertBefore(divider, bar.nextSibling);
    // Free 滚动联动：scroll 不冒泡，用 capture 在 Navigation 子树里接（List/Scroll 的滚动
    // 容器都在里面）。目的地自己滚不该动 Navigation 的标题栏 —— navOnContentScroll 里排除。
    node.addEventListener('scroll', (e) => navOnContentScroll(st, e), true);
    bindNavStack(st, stack);
    return st;
  }

  // 本轮该按哪种模式布局：Auto 用【真实宽度】判（.d.ts：宽度 ≥ 600vp 走 Split，
  // 600 = minNavBarWidth 240 + minContentWidth 360）。用元素自身宽度而不是 window：
  // 同一页可以有多个 Navigation（本项目的测量页正是这样），窗口宽度无法区分它们。
  function navEffectiveMode(st) {
    const m = String(st.mode || 'stack');
    if (m === 'split') return 'split';
    if (m === 'stack') return 'stack';
    const w = st.node ? st.node.offsetWidth : 0;             // auto
    return w >= 600 ? 'split' : 'stack';
  }

  // 标题栏 / 工具栏 / 分栏的布局同步：与 syncAlignRules 同一时机（首渲染后 + 每次重渲染后）。
  // 为什么必须晚一步（不变量 18）：分栏宽度与 Auto 的模式判定都要用【真实尺寸】。
  // builder 的场景用【身份】比内容比靠谱：JSON.stringify 会把函数丢掉，两个不同的 builder
  // 会退化成同一个签名（于是标题栏再也不重建）。
  const builderIds = new WeakMap();
  let builderIdSeq = 0;
  const builderIdOf = (fn) => {
    if (!builderIds.has(fn)) builderIds.set(fn, ++builderIdSeq);
    return builderIds.get(fn);
  };

  /** @param {HTMLElement} node */
  function syncOneNav(node) {
    const st = node.__navState;
    if (!st || !st.barEl || !st.barEl.isConnected) return;
    const sel = !!st.stack && st.paths && st.paths.length > 0;
    st.navStackNonEmpty = sel;
    // ① 标题栏内容（只在规格变了才重建：builder 重建会遗留旧的 elmtId 记录）
    const specSig = !st.titleSpec ? 'none'
      : (st.titleSpec.kind === 'builder'
        ? `b#${builderIdOf(st.titleSpec.builder)}#${st.titleSpec.height}`
        : JSON.stringify(st.titleSpec));
    const sig = `${specSig}|${JSON.stringify(st.titleOptions)}|${st.hideBackButton}|${st.hideTitleBar}|${sel}`;
    if (st.titleDrawn !== sig) {
      st.titleDrawn = sig;
      drawTitleBar(st.titleEl, st.titleSpec, {
        // 没有可回退的栈（或显式 hideBackButton）就不渲染返回键 —— 与"无处可回就没有返回键"一致
        showBack: !st.hideBackButton && sel,
        onBack: () => { if (st.stack) st.stack.pop(); },
        backIcon: st.backButtonIcon,
        menus: st.menus,
        backgroundColor: st.titleOptions && st.titleOptions.backgroundColor,
      });
    }
    st.titleEl.style.display = st.hideTitleBar ? 'none' : 'flex';
    // ② 高度与分栏几何。Free 联动时高度在 Full 与 Mini 之间随收缩进度插值（R25）
    const H0 = st.hideTitleBar ? 0 : navTitleBarH(st.titleSpec, st.titleMode);
    const col = !st.hideTitleBar && navCollapseAllowed(st) && H0 > NAV_TITLE_H.mini ? st.collapseP : 0;
    const H = H0 - (H0 - NAV_TITLE_H.mini) * col;
    st.barHeight = H;
    st.effectiveMode = navEffectiveMode(st);
    const split = st.effectiveMode === 'split';
    node.setAttribute('data-arkui-nav-mode', st.effectiveMode);
    node.setAttribute('data-arkui-nav-mode-declared', String(st.mode));
    const W = st.navBarWidth === null ? NAV_DEFAULT_BAR_W : dimOf(st.navBarWidth, node.offsetWidth);
    const end = st.navBarPosition === NavBarPosition.End;
    st.navBarWidthPx = W;
    // 用 paddingTop/Left/Right 单边赋值，不写 padding 简写 —— 免得把用户自己设的 padding 抹掉
    if (split) {
      st.barEl.style.top = '0';
      st.barEl.style.bottom = '0';
      st.barEl.style.height = '';
      st.barEl.style.width = `${W + NAV_DIVIDER_PX}px`;
      st.barEl.style.left = end ? '' : '0';
      st.barEl.style.right = end ? '0' : '';
      st.titleEl.style.height = `${H}px`;
      node.style.paddingTop = `${H}px`;
      node.style.paddingLeft = end ? '0' : `${W + NAV_DIVIDER_PX}px`;
      node.style.paddingRight = end ? `${W + NAV_DIVIDER_PX}px` : '0';
      st.dividerEl.style.display = 'block';
      st.dividerEl.style.top = '0';
      st.dividerEl.style.bottom = '0';
      st.dividerEl.style.width = `${NAV_DIVIDER_PX}px`;
      st.dividerEl.style.left = `${W}px`;
    } else {
      st.barEl.style.top = '0';
      st.barEl.style.bottom = '';
      st.barEl.style.height = `${H}px`;
      st.barEl.style.width = '';
      st.barEl.style.left = '0';
      st.barEl.style.right = '0';
      st.titleEl.style.height = `${H}px`;
      node.style.paddingTop = `${H}px`;
      node.style.paddingLeft = '0';
      node.style.paddingRight = '0';
      st.dividerEl.style.display = 'none';
    }
    // Free 收缩的标题内部视觉（Free JSDoc）：主标题随滚动缩小、副标题淡出但尺寸不变 ——
    // 只对 text/common 形态生效（"effective only when title is set to ResourceStr or
    // NavigationCommonTitle"）；builder 等其他形态只随高度变小（"changes in mere location"）。
    // R43 照真机公式（title_bar_pattern.cpp GetSubtitleOpacity/GetFontSize + 
    // navigation_bar_theme.cpp 字号默认 title_primary=30fp / title_secondary=26fp）：
    // · 副标题透明度 = (H − 56) / (max − 56)，随收缩从 1 线性到 0
    // · 主标题 = 字号插值（L=30fp ↔ M=26fp），映射经 Curves::SHARP（cubic-bezier(0.4,0,0.6,1)，
    //   GetMappedOffset）；DOM 侧等价实现为 transform scale = (26 + SHARP(p)×4) / 30
    const sharp = (p) => {                       // Curves::SHARP = cubic-bezier(0.4, 0, 0.6, 1)
      let lo = 0, hi = 1, t = p;
      for (let i = 0; i < 24; i++) {             // 解 x(t)=p 的 t（x(t) 单调），再取 y(t)
        const x = 3 * (1 - t) * (1 - t) * t * 0.4 + 3 * (1 - t) * t * t * 0.6 + t * t * t;
        if (x < p) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return 3 * (1 - t) * t * t + t * t * t;    // y(t)：P1y=0、P2y=1
    };
    const p = col;
    const shrinkEl = st.titleEl.querySelector('[data-arkui-nav-title-main],[data-arkui-nav-title-text]');
    if (shrinkEl) {
      const k = H0 > 0 ? (26 + sharp(p) * (30 - 26)) / 30 : 1;   // 字号比（真机 L=30fp / M=26fp）
      shrinkEl.style.transformOrigin = 'left center';
      shrinkEl.style.transform = col > 0 && k < 1 ? `scale(${k})` : '';
    }
    const subEl = st.titleEl.querySelector('[data-arkui-nav-title-sub]');
    if (subEl) subEl.style.opacity = col > 0 ? String(1 - col) : '';
    // ③ 目标区：Split 时只占内容列（右侧/左侧），Stack 时铺满整个 Navigation
    if (st.areaEl) {
      if (split) {
        st.areaEl.style.top = '0';
        st.areaEl.style.bottom = '0';
        st.areaEl.style.left = end ? '0' : `${W + NAV_DIVIDER_PX}px`;
        st.areaEl.style.right = end ? `${W + NAV_DIVIDER_PX}px` : '0';
      } else {
        st.areaEl.style.inset = '0';
      }
    }
  }

  // NavDestination 的标题栏 / 工具栏（同一时机同步）。它没有 titleMode，高度恒为紧凑 56vp（推断）。
  function syncOneDest(node) {
    const d = node.__navDest;
    if (!d || !d.barEl || !d.barEl.isConnected) return;
    const own = navStateOfDest(node);    // 目的地自己没有 navState：返回键要走【所属 Navigation 的栈】
    const hasBack = !!own && own.paths && own.paths.length > 0;
    const sig = `${d.titleSpec ? (d.titleSpec.kind === 'builder'
      ? `b#${builderIdOf(d.titleSpec.builder)}#${d.titleSpec.height}` : JSON.stringify(d.titleSpec)) : 'none'}`
      + `|${JSON.stringify(d.menus)}|${d.hideBackButton}|${d.hideTitleBar}|${hasBack}`;
    if (d.titleDrawn !== sig) {
      d.titleDrawn = sig;
      d.barEl.style.display = d.hideTitleBar ? 'none' : 'flex';
      drawTitleBar(d.barEl, d.titleSpec, {
        showBack: hasBack && !d.hideBackButton,
        onBack: () => { if (own) own.stack.pop(); },
        backIcon: d.backButtonIcon,
        menus: d.menus,
      });
    }
    node.style.paddingTop = d.hideTitleBar ? '0' : `${NAV_TITLE_H.mini}px`;
    // 工具栏：hideToolBar 或没有条目时不显示
    const items = Array.isArray(d.toolbar) ? d.toolbar : [];
    const showTb = !d.hideToolBar && items.length > 0;
    d.toolbarEl.style.display = showTb ? 'flex' : 'none';
    node.style.paddingBottom = showTb ? '56px' : '0';
    const tbSig = `${items.length}|${items.map((i) => String(i.value)).join(',')}|${d.hideToolBar}`;
    if (d.toolbarDrawn !== tbSig) {
      d.toolbarDrawn = tbSig;
      drawToolbar(d.toolbarEl, items);
    }
    node.setAttribute('data-arkui-dest-title', d.titleSpec && d.titleSpec.text ? d.titleSpec.text : '');
  }

  // 目的地所属的 Navigation 状态（目标区 → Navigation 元素）
  function navStateOfDest(node) {
    let p = node.parentElement;
    while (p) {
      if (p.__navState) return p.__navState;
      p = p.parentElement;
    }
    return null;
  }

  /** @param {any=} [rootEl] */
  function syncNavChrome(rootEl) {
    const scope = rootEl || document;
    if (scope.__navState) syncOneNav(scope);
    if (scope.__navDest) syncOneDest(scope);
    if (scope.querySelectorAll) {
      scope.querySelectorAll('[data-arkui-comp="Navigation"]').forEach(syncOneNav);
      scope.querySelectorAll('[data-arkui-comp="NavDestination"]').forEach(syncOneDest);
    }
  }


  /** @param {any} st @param {any} stack */
  function bindNavStack(st, stack) {
    if (!stack || typeof stack.pushPathByName !== 'function') {
      layoutWarnings.push('Navigation.create 的第一个参数不是 NavPathStack');
      return;
    }
    if (stack._nav && stack._nav !== st) {
      layoutWarnings.push('同一个 NavPathStack 被绑定到多个 Navigation（后绑定的生效）');
    }
    stack._nav = st;
    st.stack = stack;
    st.paths = stack._paths;          // 与栈对象共用同一个数组，避免两份状态漂移
  }

  // 目标区：Navigation.pop() 时创建（空栈时内容为空且隐藏）
  function ensureNavArea(st) {
    if (st.areaEl && st.areaEl.isConnected) return st.areaEl;
    const area = document.createElement('div');
    area.setAttribute('data-arkui-nav-destinations', '');
    area.style.position = 'absolute';
    area.style.left = '0';
    area.style.top = '0';
    area.style.right = '0';
    area.style.bottom = '0';
    area.style.background = '#fff';
    area.style.display = 'none';
    st.areaEl = area;
    st.node.appendChild(area);
    return area;
  }

  function ensureBuilder(st) {
    if (!st.builder) {
      layoutWarnings.push('Navigation 没有 navDestination builder：无法创建 NavDestination。'
        + '请加 .navDestination(this.PageMap)，且 builder 里的 if/else 要覆盖该 name');
      return false;
    }
    return true;
  }

  // animated：boolean | {animated} | undefined。.d.ts（pop 的 JSDoc，push 同）：
  // "Whether to enable the transition animation ... Default value: true" —— 未给就默认开。
  function navWantAnim(stack, animated) {
    if (stack._noAnim) return false;                       // disableAnimation(true)
    if (animated === undefined || animated === null) return true;
    return animOf(animated);
  }

  // push 转场（R25）：新栈顶从右滑入、盖在上一个栈顶上；上一个栈顶在滑入期间保持可见，
  // 结束才藏。样式收口与 animation.js 同一约定：先提交起始值（强制重排，坑 ⑧），
  // transitionend 只当见证，真正收口靠定时器。
  function navSlidePush(st, rec, prev) {
    const el = rec.el;
    if (!el) return;
    const showPrev = !!(prev && prev.el && prev !== rec);
    if (showPrev) prev.el.style.display = 'block';         // navSyncVisibility 刚把它藏掉
    // @type 档位：endedBy null↔string 摆动
    const run = /** @type {any} */ ({ seq: ++navTransRunSeq, kind: 'push', name: rec.name, done: false, sawTransitionEnd: false, endedBy: null });
    navTransRuns.push(run);
    if (navTransRuns.length > 50) navTransRuns.shift();
    el.dataset.arkuiNavTrans = 'push';
    // 入页 +50% → 0；被盖页同一段弹簧里视差 0 → -20%（真机 push 编舞）
    el.style.transform = `translateX(${NAV_PUSH_FROM}%)`;
    if (showPrev) {
      prev.el.style.transform = 'translateX(0%)';
      void prev.el.offsetHeight;
      prev.el.style.transitionProperty = 'transform';
      prev.el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
      prev.el.style.transitionTimingFunction = NAV_TRANS_CURVE;
      prev.el.style.transform = `translateX(-${NAV_PARALLAX}%)`;
    }
    void el.offsetHeight;
    const stopWitness = navWitness(el, run);
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
    el.style.transitionTimingFunction = NAV_TRANS_CURVE;
    el.style.transform = '';
    const timer = setTimeout(() => {
      run.endedBy = 'timer';
      navEndTransStyle(el);
      stopWitness();
      run.done = true;
      // 被盖页收口：清视差 transform 后藏掉（期间若有新栈操作，可见性已由那次的 sync 接管：
      // 只藏"现在仍然不是栈顶"的前任）
      if (showPrev) {
        navEndTransStyle(prev.el);
        prev.el.style.transform = '';
        if (prev !== st.visible) prev.el.style.display = 'none';
      }
    }, NAV_TRANS_MS + 30);
  }

  /** @param {any} stack @param {any} info @param {any} animated */
  function navPushRec(stack, info, animated) {
    const st = stack._nav;
    if (!st) { layoutWarnings.push('NavPathStack 尚未绑定到任何 Navigation'); return false; }
    if (!info || !info.name) { layoutWarnings.push('NavPathStack 压栈缺少 name'); return false; }
    if (!ensureBuilder(st)) return false;
    const prev = st.paths.length ? st.paths[st.paths.length - 1] : null;   // push 前的栈顶
    const rec = { name: info.name, param: info.param, onPop: info.onPop, el: null, cbs: {}, everShown: false };
    // 先入栈再建树：builder 里若读 size()/getAllPathName() 应看到新状态
    stack._paths.push(rec);
    if (!navBuildDest(st, rec)) { stack._paths.pop(); return false; }   // 建不出来不留幽灵路径项
    navSyncVisibility(st);
    // 转场（R25）：栈空 → 首个目的地也滑（真机如此）；disableAnimation / animated:false 不滑
    if (navWantAnim(stack, animated)) navSlidePush(st, rec, prev);
    return true;
  }

  function navBuildDest(st, rec) {
    const area = ensureNavArea(st);
    const savedStack = ViewStackProcessor.snapshot();
    const savedElmt = currentNodeElmtId;
    // 目的地未必是目标区的【直接子节点】：builder 里的 if/else 会生成 `If` 包装层
    // （display:contents），目的地是"孙子辈"。所以不能只看 lastElementChild ——
    // 旧实现就这么写的，遇到带 if 分支的 PageMap 会误判成"没建出来"并把栈项弹掉
    // （R12 收口的新页面正是这种 builder，断言当场抓住）。改成按"本次新建的节点"认领。
    area.querySelectorAll('[data-arkui-comp="NavDestination"]')
      .forEach((n) => { n.__arkuiNavNew = false; });
    ViewStackProcessor.push(area);          // 让 NavDestination 挂进目标区
    try {
      st.builder(rec.name, rec.param, undefined);
    } catch (e) {
      layoutWarnings.push(`Navigation 的 builder 抛错（name=${rec.name}）：${e && e.message}`);
    }
    ViewStackProcessor.restore(savedStack);
    currentNodeElmtId = savedElmt;
    const el = Array.from(area.querySelectorAll('[data-arkui-comp="NavDestination"]'))
      .find((n) => n.__arkuiNavNew);
    if (!el) {
      layoutWarnings.push(`Navigation 的 builder 没有为 name='${rec.name}' 创建 NavDestination：`
        + '检查 builder 里的 if/else 是否覆盖了该 name');
      return false;
    }
    rec.el = el;
    rec.cbs = el.__navDestCbs || {};
    return true;
  }

  function navDestroyDest(rec) {
    if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    rec.el = null;
  }

  function navFire(rec, kind) {
    const cb = rec.cbs && rec.cbs[kind];
    if (typeof cb !== 'function') return;
    try { cb(); } catch (e) { layoutWarnings.push(`NavDestination.${kind} 回调抛错：${e && e.message}`); }
  }

  // 隐藏：willHide → hidden（JSDoc：前者"即将隐藏"，后者"已隐藏"）
  function navHideDest(rec) {
    if (!rec || !rec.el) return;
    navFire(rec, 'willHide');
    rec.el.style.display = 'none';
    navFire(rec, 'hidden');
  }

  // 显示：首次挂载 willAppear → willShow → shown → ready；再次显示只走 willShow → shown
  function navShowDest(rec) {
    if (!rec || !rec.el) return;
    if (!rec.everShown) { navFire(rec, 'willAppear'); rec.everShown = true; }
    navFire(rec, 'willShow');
    rec.el.style.display = 'block';
    navFire(rec, 'shown');
    if (rec.cbs.ready && !rec.readyFired) { rec.readyFired = true; navFire(rec, 'ready'); }
  }

  // 把可见性与生命周期对齐到"只有栈顶可见"
  function navSyncVisibility(st) {
    if (!st) return;
    const top = st.paths.length ? st.paths[st.paths.length - 1] : null;
    if (st.visible && st.visible !== top) navHideDest(st.visible);
    st.paths.forEach((p) => { if (p.el && p !== top) p.el.style.display = 'none'; });
    if (top && top !== st.visible) navShowDest(top);
    st.visible = top;
    if (st.areaEl) st.areaEl.style.display = st.paths.length ? 'block' : 'none';
    // push/pop 不一定伴随重渲染（纯栈操作时没有状态变更），所以这里必须主动同步一次
    // 标题栏/工具栏 —— 否则目的地画出来却没有标题栏（首版就是这样，断言当场抓住）。
    if (typeof syncNavChrome === 'function') syncNavChrome(st.node);
  }

  // pop 转场（R25）：栈顶向右滑出、露出新栈顶（或空栈时的根内容）。状态层回调照旧立刻发
  //（willHide → hidden → willDisappear，顺序与立即版一致），DOM 摘除推迟到滑出结束 ——
  // 这是"动画期间目的地还在"与"生命周期语义不变"的唯一交点，已写进 docs。
  function navPopAnimated(stack, rec, result) {
    const st = stack._nav;
    const el = rec.el;
    navFire(rec, 'willHide');
    navFire(rec, 'hidden');
    navFire(rec, 'willDisappear');
    if (typeof rec.onPop === 'function') {
      try { rec.onPop({ info: { name: rec.name, param: rec.param }, result }); }
      catch (e) { layoutWarnings.push(`NavPathStack 的 onPop 回调抛错：${e && e.message}`); }
    }
    const idx = st.paths.indexOf(rec);
    if (idx >= 0) st.paths.splice(idx, 1);
    purgeDetachedRecords();
    navSyncVisibility(st);                 // 露出新栈顶 / 根内容（在滑出层的下面）
    if (!el) return;
    if (st.areaEl) st.areaEl.style.display = 'block';   // 空栈时 sync 会藏目标区——滑出期间撑住
    const run = /** @type {any} */ ({ seq: ++navTransRunSeq, kind: 'pop', name: rec.name, done: false, sawTransitionEnd: false, endedBy: null });
    navTransRuns.push(run);
    if (navTransRuns.length > 50) navTransRuns.shift();
    el.dataset.arkuiNavTrans = 'pop';
    el.style.display = 'block';
    el.style.zIndex = '3';                 // DOM 顺序上新栈顶在后面（盖住它），滑出期间要反超
    // 露出页从视差位 -20% 回 0（真机 pop 编舞：PopStart(true) = -20% → PopEnd(true) = 0）
    const shown = st.paths.length ? st.paths[st.paths.length - 1] : null;
    const shownEl = (shown && shown.el) ? shown.el : null;
    if (shownEl) {
      shownEl.style.transform = `translateX(-${NAV_PARALLAX}%)`;
      void shownEl.offsetHeight;
      shownEl.style.transitionProperty = 'transform';
      shownEl.style.transitionDuration = `${NAV_TRANS_MS}ms`;
      shownEl.style.transitionTimingFunction = NAV_TRANS_CURVE;
      shownEl.style.transform = '';
    }
    el.style.transform = '';
    void el.offsetHeight;
    const stopWitness = navWitness(el, run);
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = `${NAV_TRANS_MS}ms`;
    el.style.transitionTimingFunction = NAV_TRANS_CURVE;
    el.style.transform = `translateX(${NAV_POP_TO}%)`;
    const timer = setTimeout(() => {
      run.endedBy = 'timer';
      navEndTransStyle(el);
      stopWitness();
      run.done = true;
      el.style.zIndex = '';
      el.style.transform = '';
      if (shownEl) {
        navEndTransStyle(shownEl);
        shownEl.style.transform = '';
      }
      navDestroyDest(rec);
      purgeDetachedRecords();
      // 目标区的显隐以【当下】的栈为准（滑出期间可能有新 push）
      if (st.areaEl && !st.paths.length) st.areaEl.style.display = 'none';
    }, NAV_TRANS_MS + 30);
  }

  // 弹出 [from, from+count)：从【栈顶向下】处理，保证生命周期顺序
  /** @param {any} stack @param {number} from @param {number} count @param {any} result @param {any=} [animated] */
  function navPopRange(stack, from, count, result, animated) {
    const st = stack._nav;
    if (count <= 0) return;
    // 转场只给"从可见栈顶弹出 1 项"的典型 pop（pop(animated) 的语义）；范围弹栈（popToName/
    // popToIndex/clear/setPathStack）照旧立即销毁 —— 真机对范围弹栈也只动画栈顶。
    const topIdx = from + count - 1;
    const rec = st.paths[topIdx];
    if (count === 1 && rec && rec.el && st.visible === rec && navWantAnim(stack, animated)) {
      navPopAnimated(stack, rec, result);
      return;
    }
    for (let i = from + count - 1; i >= from; i--) {
      const rec = st.paths[i];
      if (!rec) continue;
      if (st.visible === rec) navHideDest(rec);
      navFire(rec, 'willDisappear');
      navDestroyDest(rec);
      if (typeof rec.onPop === 'function') {
        try { rec.onPop({ info: { name: rec.name, param: rec.param }, result }); }
        catch (e) { layoutWarnings.push(`NavPathStack 的 onPop 回调抛错：${e && e.message}`); }
      }
    }
    st.paths.splice(from, count);
    purgeDetachedRecords();          // 回收被销毁目标占用的 elmtId 记录
    navSyncVisibility(st);
  }

  function navClearAll(stack) {
    const st = stack._nav;
    if (!st) { stack._paths.length = 0; return; }
    navPopRange(stack, 0, st.paths.length, undefined);
  }

  function navReplaceTop(stack, info, _animated) {
    const st = stack._nav;
    if (!st) { layoutWarnings.push('NavPathStack 尚未绑定到任何 Navigation'); return; }
    if (!st.paths.length) { layoutWarnings.push('NavPathStack.replacePath：栈为空，无可替换项'); return; }
    if (!info || !info.name) { layoutWarnings.push('NavPathStack.replacePath 缺少 name'); return; }
    if (!ensureBuilder(st)) return;
    const topIdx = st.paths.length - 1;
    const old = st.paths[topIdx];
    // "替换"不是"弹出"：不派发 onPop，但旧实例要销毁
    if (st.visible === old) { navHideDest(old); st.visible = null; }
    navFire(old, 'willDisappear');
    navDestroyDest(old);
    const rec = { name: info.name, param: info.param, onPop: info.onPop, el: null, cbs: {}, everShown: false };
    st.paths[topIdx] = rec;
    if (!navBuildDest(st, rec)) {
      st.paths.splice(topIdx, 1);
      purgeDetachedRecords();
    }
    navSyncVisibility(st);
  }

  function updateNavStack(st, v) { bindNavStack(st, v); }

  // NavDestination 挂载：认领目标区（先按 none 挂上，可见性交给 navSyncVisibility）
  function mountNavDestination(rec, deepFn, elmtId) {
    let node = rec && rec.node && rec.node.__arkuiComp === 'NavDestination' ? rec.node : null;
    if (!node) {
      node = document.createElement('div');
      node.__arkuiComp = 'NavDestination';
      node.setAttribute('data-arkui-comp', 'NavDestination');   // mountNode 会打，这里绕过了它
      node.__navDestCbs = {};
      node.__arkuiNavNew = true;      // navBuildDest 靠这个标记认领"本次新建的目的地"
      // NavDestination 自己的标题栏 / 工具栏（R12 收口）。它没有 titleMode（.d.ts 里不存在），
      // 标题栏恒为紧凑高度 56vp（= Mini 高度）。**这一条是推断** —— .d.ts 没写 NavDestination
      // 标题栏的高度，取 Mini 的依据是"目标页用紧凑标题栏"这一可见事实，已写进 docs 已知限制。
      // @type 档位：barEl/toolbarEl null↔HTMLElement 摆动 → 整袋 any
      node.__navDest = /** @type {any} */ ({
        titleSpec: null, menus: null, toolbar: null,
        hideBackButton: false, hideTitleBar: false, hideToolBar: false,
        backButtonIcon: null, titleDrawn: null, barEl: null, toolbarEl: null,
      });
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.overflow = 'auto';
      node.style.display = 'none';
      node.style.position = 'relative';
      const dbar = document.createElement('div');
      dbar.setAttribute('data-arkui-dest-titlebar', '');
      dbar.style.position = 'absolute';
      dbar.style.left = '0';
      dbar.style.right = '0';
      dbar.style.top = '0';
      dbar.style.height = `${NAV_TITLE_H.mini}px`;
      dbar.style.zIndex = '2';
      dbar.style.padding = '0 8px';
      dbar.style.boxSizing = 'border-box';
      dbar.style.fontSize = '16px';
      dbar.style.background = '#fff';
      node.appendChild(dbar);
      const dtb = document.createElement('div');
      dtb.setAttribute('data-arkui-dest-toolbar', '');
      dtb.style.position = 'absolute';
      dtb.style.left = '0';
      dtb.style.right = '0';
      dtb.style.bottom = '0';
      dtb.style.height = '56px';
      dtb.style.zIndex = '2';
      dtb.style.display = 'none';
      dtb.style.background = '#fff';
      node.appendChild(dtb);
      node.__navDest.barEl = dbar;
      node.__navDest.toolbarEl = dtb;
      const parent = parentOfTop();
      // "在目标区内"要向上找祖先，不能只看直接父节点 —— builder 的 if/else 会插一层 `If` 包装，
      // 目的地的直接父节点就是那个包装层，不是目标区本身。
      let inArea = false;
      for (let p = parent; p; p = p.parentElement) {
        if (p.hasAttribute && p.hasAttribute('data-arkui-nav-destinations')) { inArea = true; break; }
      }
      if (!inArea) {
        layoutWarnings.push('NavDestination 不在 Navigation 的目标区内'
          + '（本组件只能由 Navigation 的 navDestination builder 创建）');
      }
      if (rec) { rec.node = node; rec.parentNode = parent; }
      parent.appendChild(node);
      if (typeof deepFn === 'function' && !deepRendering.has(elmtId)) {
        deepRendering.add(elmtId);
        const saved = ViewStackProcessor.snapshot();
        const savedElmt = currentNodeElmtId;
        ViewStackProcessor.push(node);
        currentNodeElmtId = elmtId;
        deepFn(elmtId, true);
        ViewStackProcessor.restore(saved);
        currentNodeElmtId = savedElmt;
        deepRendering.delete(elmtId);
      }
    }
    return node;
  }

  // Navigation 的语义属性
  /** @type {Record<string, (st: any, v: any, opts?: any) => void>} */
  const NAV_ATTRS = {
    navDestination: (st, v) => {
      const b = v && typeof v === 'object' ? v.builder : v;
      if (typeof b !== 'function') {
        layoutWarnings.push('Navigation.navDestination 的参数里没有 builder 函数');
        return;
      }
      st.builder = b;
    },
    // mode：Stack / Split / Auto 都实现了；Auto 的判定在 navEffectiveMode（要用真实宽度）
    mode: (st, v) => { st.mode = String(v); },
    title: (st, v, opts) => {
      st.titleSpec = navParseTitle(v);
      st.titleOptions = opts && typeof opts === 'object' ? opts : null;
    },
    titleMode: (st, v) => { st.titleMode = Number(v); },
    // R25：Free 滚动联动的事件（.d.ts：titleMode=Free 且内容滚动导致标题栏模式变化时触发）。
    // ⚠️ 属性分发必须在通用 on* 规则之前把它拦下 —— 否则 fn 会被当成 DOM 事件监听挂到
    // 'titlemodechange' 上，永远没人派发（R25 测量时撞上的分发陷阱）。
    onTitleModeChange: (st, v, extra) => { st.tmc = typeof v === 'function' ? v : null; },
    hideTitleBar: (st, v) => { st.hideTitleBar = !!v; },
    hideBackButton: (st, v) => { st.hideBackButton = !!v; },
    backButtonIcon: (st, v) => { st.backButtonIcon = resolveResource(v); },
    menus: (st, v) => {
      if (typeof v === 'function') {
        layoutWarnings.push('Navigation.menus 的自定义 builder 形态未实现（数组形态已支持）');
        return;
      }
      st.menus = Array.isArray(v) ? v : null;
    },
    navBarWidth: (st, v) => { st.navBarWidth = v; },
    navBarPosition: (st, v) => { st.navBarPosition = Number(v); },
    minContentWidth: (st, v) => { st.minContentWidth = v; },
  };

  // NavDestination 的标题栏 / 工具栏属性
  /** @type {Record<string, (node: any, v: any, opts?: any) => void>} */
  const NAVDEST_ATTRS = {
    title: (node, v, opts) => {
      node.__navDest.titleSpec = navParseTitle(v);
      node.__navDest.titleOptions = opts && typeof opts === 'object' ? opts : null;
    },
    hideTitleBar: (node, v) => { node.__navDest.hideTitleBar = !!v; },
    hideBackButton: (node, v) => { node.__navDest.hideBackButton = !!v; },
    backButtonIcon: (node, v) => { node.__navDest.backButtonIcon = resolveResource(v); },
    menus: (node, v) => {
      if (typeof v === 'function') {
        layoutWarnings.push('NavDestination.menus 的自定义 builder 形态未实现（数组形态已支持）');
        return;
      }
      node.__navDest.menus = Array.isArray(v) ? v : null;
    },
    toolbarConfiguration: (node, v) => {
      if (typeof v === 'function') {
        layoutWarnings.push('NavDestination.toolbarConfiguration 的自定义 builder 形态未实现'
          + '（Array<ToolbarItem> 形态已支持）');
        return;
      }
      node.__navDest.toolbar = Array.isArray(v) ? v : null;
    },
    hideToolBar: (node, v) => { node.__navDest.hideToolBar = !!v; },
  };
