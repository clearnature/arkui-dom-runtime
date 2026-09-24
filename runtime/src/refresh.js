  // ────────────────── Refresh 下拉刷新（R50）：pointer 驱动状态机 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/RefreshDemo.ts）：
  //   Refresh.create({ refreshing: bool });      ← refreshing 支持 $ 双向（真机回写）
  //   Refresh.onStateChange((s)=>…); Refresh.onRefreshing(…); Refresh.onOffsetChange((vp)=>…);
  //   Refresh.refreshOffset(50); .maxPullDownDistance(80); .pullDownRatio(1);
  //   .pullToRefresh(false);
  //
  // 状态机（refresh.d.ts:28-86，真机 refresh_constant.h 同序）：Inactive=0 → Drag=1
  // （下拉 < refreshOffset）→ OverDrag=2（≥ refreshOffset）→ 松手：OverDrag 且
  // pullToRefresh → Refresh=3（回弹到 refreshOffset 并保持）→ refreshing=false → Done=4
  // （回初始位，内部归 Idle 不再发 0）。事件顺序照真机（refresh_pattern.cpp:704-710）：
  // 回写 → onRefreshing → onStateChange；同值不重复发。
  //
  // DOM 映射：根 = div（overflow hidden），唯一子组件整体 translateY 跟手（Refresh 无
  // builder/refreshingContent 时真机也是"调整子组件 translate"，refresh.d.ts:90-113）；
  // Refresh 态回弹到 refreshOffset 并保持（内容下移让出指示区——默认指示器未绘制，
  // 见 CAPABILITY 限制）。指针只收 pointerType='touch'（真机 SetIsAllowMouse(false)，
  // refresh_pattern.cpp:215 / refresh.d.ts:248）。松手回弹/Done 复位用 setTimeout
  // （350ms，坑 ⑧：不用 rAF）。
  const REFRESH_ATTRS = {
    refreshing: (n, v) => { n.__rfApplyRefreshing(!!resolveResource(v)); },
    refreshOffset: (n, v) => {
      const d = Number(resolveResource(v));
      n.__rf.offset = d > 0 ? d : 64;          // 0/负 → 默认 64（.d.ts 原文）
      n.dataset.refreshOffset = String(n.__rf.offset);
    },
    pullToRefresh: (n, v) => {
      n.__rf.pullToRefresh = !!resolveResource(v);
      n.dataset.pullToRefresh = String(n.__rf.pullToRefresh);
    },
    pullDownRatio: (n, v) => {
      const r = Number(resolveResource(v));
      n.__rf.ratio = Math.min(1, Math.max(0, r));
      n.dataset.pullDownRatio = String(n.__rf.ratio);
    },
    maxPullDownDistance: (n, v) => {
      const d = Number(resolveResource(v));
      n.__rf.maxPull = d < 0 ? 0 : d;          // undefined/null 不设限（保持 null）
      n.dataset.maxPullDownDistance = String(n.__rf.maxPull);
    },
    onStateChange: (n, v) => { (/** @type {any} */ (n.__rfCbs = n.__rfCbs || {})).state = v; },
    onRefreshing: (n, v) => { (/** @type {any} */ (n.__rfCbs = n.__rfCbs || {})).refreshing = v; },
    onOffsetChange: (n, v) => { (/** @type {any} */ (n.__rfCbs = n.__rfCbs || {})).offset = v; },
  };
  const Refresh = ensureComponent('Refresh', (args) => {
    const el = document.createElement('div');
    el.__arkuiRefresh = true;
    el.dataset.refresh = '';
    el.dataset.refreshState = '0';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    el.__rf = {
      offset: 64,                                // .d.ts：promptText 未设默认 64
      ratio: null,                               // 未设 → 动态阻尼；实现取线性 1（近似，标注）
      maxPull: null, pullToRefresh: true,
      state: 0,                                  // 内部状态（与 dataset 的"最后派发值"分离）
      pulling: false, startY: 0, pull: 0,
      refreshing: false, lastOffset: -1,
    };
    const childOf = () => (/** @type {HTMLElement} */ (el.firstElementChild));
    const setTranslate = (y) => {
      const c = childOf();
      if (c) c.style.transform = y ? `translateY(${y}px)` : '';
    };
    const fire = (kind, a) => {
      const cb = el.__rfCbs && el.__rfCbs[kind];
      if (typeof cb !== 'function') return;
      try { cb(a); }
      catch (e) { layoutWarnings.push(`Refresh.on${kind[0].toUpperCase() + kind.slice(1)} 回调抛错：${e && e.message}`); }
    };
    const setState = (s) => {
      if (el.__rf.state === s) return;           // 同值不重复发（真机 NearEqual 守卫同族）
      el.__rf.state = s;
      el.dataset.refreshState = String(s);
      fire('state', s);
    };
    el.__rfApplyRefreshing = (on) => {
      if (el.__rf.refreshing === on) return;     // 同值守卫（真机 UpdateRefreshStatus :694-696）
      el.__rf.refreshing = on;
      if (on) {
        (/** @type {() => void} */ (el.__rfEnterRefresh))();
      } else if (el.__rf.state === 3) {
        // 停止刷新：Done=4 → 回初始位 → 内部归 Idle（不再发 0）
        setState(4);
        setTranslate(0);
        el.__rf.state = 0;
        el.__rf.pulling = false;
      }
    };
    el.__rfEnterRefresh = () => {
      el.__rf.refreshing = true;
      fire('refreshing');                        // 真机顺序：onRefreshing 先于 onStateChange
      setState(3);
      // 回弹到 refreshOffset 并保持（真机"rebounds to the minimum length"）
      const c = childOf();
      if (c) {
        c.style.transition = 'transform 350ms ease-out';
        setTimeout(() => {
          setTranslate(el.__rf.offset);
          if (c) c.style.transition = '';
        }, 20);
      }
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;     // 真机禁鼠标拖拽（refresh.d.ts:248）
      if (el.__rf.refreshing) return;            // Refresh 态拖拽走 RECYCLE（不响应）
      el.__rf.pulling = true;
      el.__rf.startY = e.clientY;
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.__rf.pulling) return;
      let pull = Math.max(0, e.clientY - el.__rf.startY) * (el.__rf.ratio == null ? 1 : el.__rf.ratio);
      if (el.__rf.maxPull != null) pull = Math.min(pull, el.__rf.maxPull);
      el.__rf.pull = pull;
      setTranslate(pull);
      const vp = Math.round(pull);
      if (vp !== el.__rf.lastOffset) {
        el.__rf.lastOffset = vp;
        fire('offset', vp);                      // 单位 vp、值变化才发（真机 NearEqual 守卫）
      }
      setState(pull >= el.__rf.offset ? 2 : 1);  // OverDrag / Drag
    });
    const finishDrag = () => {
      if (!el.__rf.pulling) return;
      el.__rf.pulling = false;
      if (el.__rf.state === 2 && el.__rf.pullToRefresh) {
        (/** @type {() => void} */ (el.__rfEnterRefresh))();   // 回写（不实现，见下）→ onRefreshing → state 3
      } else {
        // 松手不足阈值 / pullToRefresh=false → 回弹归零，回 Inactive
        const c = childOf();
        if (c) {
          c.style.transition = 'transform 350ms ease-out';
          setTimeout(() => {
            setTranslate(0);
            if (c) c.style.transition = '';
          }, 20);
        }
        setState(0);
      }
    };
    el.addEventListener('pointerup', finishDrag);
    el.addEventListener('pointercancel', finishDrag);
    // refreshing 双向回写：DOM 侧无应用 @State 的写回通道（loader 产物不提供 setter），
    // "回写"一步如实不实现——onRefreshing/onStateChange 顺序照真机保留。应用侧经
    // this.rf1On = false 显式停止（与真机用法一致）。
    if (o.refreshing !== undefined) {
      el.__rfApplyRefreshing(!!resolveResource(o.refreshing));
    }
    return el;
  });
  // 重渲染时处理 refreshing 选项变化（应用设置 refreshing=false 是结束刷新的唯一通道）
  {
    const prevCreate = Refresh.create;
    Refresh.create = function (...args) {
      const node = prevCreate.apply(null, args);
      const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
      if (o.refreshing !== undefined && node.__rfApplyRefreshing) {
        (/** @type {(on: boolean) => void} */ (node.__rfApplyRefreshing))(!!resolveResource(o.refreshing));
      }
      return node;
    };
  }
