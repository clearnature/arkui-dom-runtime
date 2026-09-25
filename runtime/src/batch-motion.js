  // ────────────────── R66 动效族 + 滚动条（7 件：Animator / ScrollBar / FrictionMotion /
  // ────────────────── ScrollMotion / SpringMotion / SpringProp / GeometryView）──────────
  //
  // SDK 依据（本机 26.0.0.821 SDK）：
  //   - build-tools/ets-loader/components/{animator,friction_motion,scroll_motion,
  //     spring_motion,spring_prop,geometryView,scroll_bar}.json —— 组件存在性与属性清单。
  //     前六者是 atomic 原子件（框架内部件）；ScrollBar 非 atomic（single:true），有公开 d.ts。
  //   - component/scroll_bar.d.ts —— ScrollBarInterface{ scroller: Scroller（必填）,
  //     direction?: ScrollBarDirection（默认 Vertical）, state?: BarState（默认 Auto）}；
  //     属性 enableNestedScroll(boolean)（API14）/ scrollBarColor(ColorMetrics)（API20，
  //     默认 ColorMetrics.numeric(0x66182431)=rgba(24,36,49,0.4)，仅无子组件时生效）；
  //     "child nodes define the behavior style of the scrollbar"（有子组件则子组件即滑块）；
  //     API12+ 无子组件时显示默认样式；与被绑容器方向一致才能滚动；一比一绑定。
  //   - api/@ohos.animator.d.ts —— AnimatorOptions{ duration/easing/delay/fill/direction/
  //     iterations/begin(默认0)/end(默认1) } + AnimatorResult{ play/pause/finish/cancel/
  //     reverse + onFrame(progress)/onFinish/onCancel/onRepeat/onPause/onStart }。
  //     ScrollBarDirection/PlayMode/FillMode 取值均按 .d.ts 声明顺序（Vertical=0/Horizontal=1；
  //     Normal=0..AlternateReverse=3——PlayMode 全局已有；None=0/Forwards=1/Backwards=2/Both=3）。
  //   - FrictionMotion / ScrollMotion / SpringMotion / SpringProp：atomic 且 attrs 为空，
  //     无公开 d.ts（滚动惯性的物理模型内部件）；GeometryView：atomic（几何转场载体）。
  //     DOM 侧没有可实现的公开语义——做惰性标记件，create 参数记 bag + data-*，
  //     供 Animator.motion 引用与测试探针。
  //
  // DOM 映射：
  //   Animator     → 不可见 div + setTimeout 逐帧引擎。R47 教训：不用 rAF（headless 虚拟时间
  //                  下不确定）；生命周期回调延时派发（state 属性先于 onStart 应用，同步发会丢）；
  //                  同值守卫防重渲染重置帧序（坑 88 同族）。state 取 AnimationStatus 口径
  //                  （Initial=0/Running=1/Paused=2/Stopped=3，与 R47 ImageAnimator 同空间；
  //                  atomic Animator 无公开 state 枚举，此处沿用运行时家族口径并注明）。
  //   ScrollBar    → 覆盖层 div（Stack 里 gridArea 1/1 自动叠放）+ 绝对定位滑块。
  //                  双向绑定 Scroller：观察目标容器 'scroll' 算滑块尺寸/位移；拖滑块反写
  //                  scrollTop（并同步派发 'scroll'，与 Scroller.scrollBy 同口径）。
  //                  防 _bind 抢绑：main.js:1045 的通用 create 绑定会把 scroller._el 抢成
  //                  滚动条自身——包装 _bind，滚动条绑定改记 __sbEl，不覆盖容器 _el。
  //   motion ×4 /  → display:none / display:contents 标记件（见上）。
  //   GeometryView
  //
  // ⚠️ 命名：ANIMATOR_ATTRS / __arkuiAnimator 已被 R47 ImageAnimator 占用（animator.js:18,52；
  //    area.js:281）——本片的 Animator 用 ANIM_COMP_ATTRS / __arkuiAnimComp，勿混。

  // ── Animator 逐帧引擎 ──────────────────────────────────────────────
  /** @type {number} */ const ANIM_FRAME_MS = 16;               // 帧步长（~60fps；setTimeout 确定性）
  /** @type {Record<string, (number[]|null)>} */
  const ANIM_EASE_PRESETS = {
    linear: null,
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  /** @type {Record<string, string>} */
  const ANIM_FILL_MODE_CSS = { 0: 'none', 1: 'forwards', 2: 'backwards', 3: 'both' };  // FillMode 声明序

  /** @param {number[]} b @param {number} x */
  const animBezierAt = (b, x) => {
    // 三次贝塞尔 y(x)：x 由 [x1,x2] 段二分解 t（24 轮收敛，确定性，无浮点库）
    /** @param {number} t @param {number} p1 @param {number} p2 */
    const axis = (t, p1, p2) => 3 * p1 * t * (1 - t) * (1 - t) + 3 * p2 * t * t * (1 - t) + t * t * t;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (axis(mid, b[0], b[2]) < x) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    return axis(t, b[1], b[3]);
  };

  /**
   * curve → 贝塞尔参数（null=线性）。输入可为 CSS 关键字 / cubic-bezier(...) 串 /
   * Curve 枚举数值（复用 R22 animCurveCss 归一，ICurve 对象在那里面已警告退化）。
   * @param {any} curve
   */
  const animParseEase = (curve) => {
    const css = animCurveCss(curve);
    if (css === 'linear') return null;
    if (ANIM_EASE_PRESETS[css] !== undefined) return ANIM_EASE_PRESETS[css];
    const m = css.match(/cubic-bezier\(([^)]*)\)/);
    if (m) {
      const nums = m[1].split(',').map((/** @type {string} */ s) => Number(s.trim()));
      if (nums.length === 4 && nums.every((/** @type {number} */ n) => !isNaN(n))) return nums;
    }
    return ANIM_EASE_PRESETS['ease'];                            // 未知关键字按 CSS 语义回落 ease
  };

  /** @param {any} w */
  const animForwardOf = (w) => {
    // PlayMode: Normal=0 Reverse=1 Alternate=2 AlternateReverse=3（animation.js:30）
    if (w.playMode === 1) return false;
    if (w.playMode === 2) return w.cycle % 2 === 0;
    if (w.playMode === 3) return w.cycle % 2 === 1;
    return true;
  };

  /** @param {any} w */
  const animStopTimer = (w) => { if (w.timer) { clearTimeout(w.timer); w.timer = null; } };

  /** @param {any} w @param {any} el @param {number} p */
  const animEmit = (w, el, p) => {
    w.last = p;
    el.dataset.animProgress = String(p);
    const cb = w.cbs.frame;
    if (typeof cb === 'function') {
      try { cb(p); }
      catch (e) { layoutWarnings.push(`Animator.onFrame 回调抛错：${e && e.message}`); }
    }
  };

  /** @param {any} w @param {any} el @param {string} name */
  const animFire = (w, el, name) => {
    // 延时派发：state 属性先于 onStart/onFinish 应用（产物顺序实测，R47 同坑），同步发会丢
    setTimeout(() => {
      const cb = w.cbs[name];
      if (typeof cb === 'function') {
        try { cb(); }
        catch (e) { layoutWarnings.push(`Animator.${name} 回调抛错：${e && e.message}`); }
      }
    }, 0);
  };

  /** @param {any} w @param {any} el */
  const animSchedule = (w, el) => {
    animStopTimer(w);
    if (w.state !== 1) return;
    w.timer = setTimeout(() => animTick(w, el), ANIM_FRAME_MS);
  };

  /** @param {any} w @param {any} el */
  const animTick = (w, el) => {
    w.timer = null;
    if (w.state !== 1) return;
    const now = Date.now();
    const total = now - w.t0 - w.delay;
    if (total < 0) {                                             // delay 期：不派发 onFrame（fill 由
      animSchedule(w, el); return;                               // fillMode 语义描述，无视觉载体）
    }
    const iter = Math.floor(total / w.duration);
    if (w.iterations !== Infinity && iter >= w.iterations) {     // 播完：落 Stopped，保持末值
      const lastIter = Math.max(0, w.iterations - 1);
      const fwdLast = w.playMode === 1 ? false
        : w.playMode === 2 ? lastIter % 2 === 0
          : w.playMode === 3 ? lastIter % 2 === 1 : true;
      w.cycle = lastIter;
      animEmit(w, el, fwdLast ? w.end : w.begin);
      w.state = 3;
      el.dataset.animState = '3';
      animFire(w, el, 'finish');
      return;
    }
    if (iter > w.cycle) { w.cycle = iter; animFire(w, el, 'repeat'); }
    const local = (total - iter * w.duration) / w.duration;
    const t = animForwardOf(w) ? local : 1 - local;
    const eased = w.ease ? animBezierAt(w.ease, t) : t;
    animEmit(w, el, w.begin + (w.end - w.begin) * eased);
    animSchedule(w, el);
  };

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const ANIM_COMP_ATTRS = {
    state: (n, v) => { const w = n.__anim; if (w && n.__animApplyState) n.__animApplyState(v); },
    duration: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const d = Number(resolveResource(v));
      if (d > 0) w.duration = d;          // ≤0 不落（@ohos 默认 0 会让引擎除零；沿用 R47 的 1000 兜底）
      n.dataset.duration = String(w.duration);
    },
    curve: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const css = animCurveCss(resolveResource(v));
      w.ease = animParseEase(css);
      n.dataset.curve = css;
    },
    delay: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      w.delay = Math.max(0, Number(resolveResource(v)) || 0);
      n.dataset.delay = String(w.delay);
    },
    fillMode: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const r = resolveResource(v);
      w.fill = typeof r === 'string' ? r : (ANIM_FILL_MODE_CSS[Number(r)] || 'forwards');
      n.dataset.fillMode = w.fill;
    },
    iterations: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      const i = Number(resolveResource(v));
      w.iterations = i === -1 ? Infinity : (i >= 1 ? i : 1);
      n.dataset.iterations = i === -1 ? '-1' : String(w.iterations);
    },
    playMode: (n, v) => {
      const w = n.__anim;
      if (!w) return;
      w.playMode = Number(resolveResource(v)) || 0;
      n.dataset.playMode = String(w.playMode);
    },
    motion: (n, v) => {
      // motion 接动效参数（物理模型件实例/参数对象）：只记录——DOM 无物理惯性引擎
      const w = n.__anim;
      if (!w) return;
      w.motion = v && v.__motionParams ? v.__motionParams : v;
      try { n.dataset.motion = JSON.stringify(w.motion); }
      catch { n.dataset.motion = String(w.motion); }
      layoutWarnings.push('Animator.motion 的物理惯性插值无 DOM 对应（参数记 data-*，不模拟）');
    },
    onStart: (n, v) => { const w = n.__anim; if (w) w.cbs.start = v; },
    onPause: (n, v) => { const w = n.__anim; if (w) w.cbs.pause = v; },
    onRepeat: (n, v) => { const w = n.__anim; if (w) w.cbs.repeat = v; },
    onCancel: (n, v) => { const w = n.__anim; if (w) w.cbs.cancel = v; },
    onFinish: (n, v) => { const w = n.__anim; if (w) w.cbs.finish = v; },
    onFrame: (n, v) => { const w = n.__anim; if (w) w.cbs.frame = v; },
  };

  const Animator = ensureComponent('Animator', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiAnimComp = 'Animator';
    el.dataset.animator = '';
    el.dataset.animState = '0';
    el.dataset.animProgress = '0';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__anim = /** @type {any} */ ({
      duration: o.duration > 0 ? Number(o.duration) : 1000,      // @ohos 默认 0；引擎兜底 1000（见上）
      delay: Math.max(0, Number(o.delay) || 0),
      ease: animParseEase(o.easing !== undefined ? o.easing : 'ease'),
      fill: ANIM_FILL_MODE_CSS[Number(o.fill)] || (typeof o.fill === 'string' ? o.fill : 'forwards'),
      playMode: Number(o.direction) || 0,                        // AnimatorOptions.direction ↔ PlayMode
      iterations: o.iterations === -1 ? Infinity : (Number(o.iterations) >= 1 ? Number(o.iterations) : 1),
      begin: o.begin != null ? Number(o.begin) : 0,              // @ohos.animator.d.ts:129 默认 0
      end: o.end != null ? Number(o.end) : 1,                    // 同上 :143 默认 1
      state: 0, started: false, cycle: 0, elapsed: 0, last: 0, t0: 0,
      timer: /** @type {any} */ null, motion: null,
      cbs: /** @type {any} */ ({}),
    });
    // state 属性可能先于回调注册应用（R47 同款包装），暴露 bag 供测试/复位直调
    (/** @type {any} */ (el)).__animApplyState = (/** @type {any} */ nv) => {
      nv = Number(resolveResource(nv));
      if (nv === w.state) return;                                // 重渲染同值 → 无操作（坑 88 同族）
      const prev = w.state;
      w.state = nv;
      el.dataset.animState = String(nv);
      if (nv === 1) {                                            // → Running
        if (!w.started) { w.started = true; animFire(w, el, 'start'); }
        w.t0 = Date.now() - w.elapsed;                           // Paused 恢复：从已走时间续播
        animSchedule(w, el);
      } else if (nv === 2) {                                     // → Paused：停表保持当前值
        if (prev === 1) {
          w.elapsed = Date.now() - w.t0;
          animStopTimer(w);
          animFire(w, el, 'pause');
        }
      } else if (nv === 3) {                                     // → Stopped：停表回初值
        animStopTimer(w);
        if (prev === 1) animFire(w, el, 'cancel');
        w.elapsed = 0; w.cycle = 0;
        el.dataset.animProgress = String(w.begin);
      } else {                                                   // → Initial：整体复位（重启再发 start）
        animStopTimer(w);
        w.elapsed = 0; w.cycle = 0; w.started = false; w.last = w.begin;
        el.dataset.animProgress = String(w.begin);
      }
    };
    return el;
  });

  // ── ScrollBar（scroll_bar.d.ts：唯一有公开 d.ts 的一件）────────────────
  const ScrollBarDirection = { Vertical: 0, Horizontal: 1 };     // 声明顺序（scroll_bar.d.ts:38,48）

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SCROLLBAR_ATTRS = {
    enableNestedScroll: (n, v) => {
      const w = n.__sbar;
      const on = !!resolveResource(v);
      if (w) w.nested = on;
      n.dataset.enableNestedScroll = String(on);                 // 默认 false（scroll_bar.d.ts:173）
    },
    scrollBarColor: (n, v) => {
      const c = colorOf(v);
      n.dataset.scrollBarColor = c;
      const th = n.__sbar && n.__sbar.thumb;
      if (th) th.style.background = c;                           // 仅无子组件时生效（d.ts:183）
    },
  };

  /** @param {any} w */
  const sbScheduleSync = (w) => {
    if (w.syncScheduled) return;
    w.syncScheduled = true;
    setTimeout(() => { w.syncScheduled = false; sbSync(w); }, 0);
  };

  /** @param {any} w */
  const sbEnsureDefaultThumb = (w) => {
    // API12+ 无子组件时的默认滑块样式（scroll_bar.d.ts:62；默认色 0x66182431 = :186）
    const el = w.el;
    const th = document.createElement('div');
    th.setAttribute('data-sb-thumb', 'default');
    th.style.position = 'absolute';
    th.style.pointerEvents = 'auto';                             // 只有滑块可拖（根覆盖层不收事件）
    th.style.borderRadius = '2px';
    th.style.background = 'rgba(24, 36, 49, 0.4)';
    if (w.dir !== ScrollBarDirection.Horizontal) {
      th.style.width = '4px'; th.style.right = '0'; th.style.top = '0';
    } else {
      th.style.height = '4px'; th.style.bottom = '0'; th.style.left = '0';
    }
    el.appendChild(th);
    return th;
  };

  /** @param {any} w */
  const sbSync = (w) => {
    const el = w.el;
    if (!el || !el.isConnected) return;
    const vert = w.dir !== ScrollBarDirection.Horizontal;
    // 子组件滑块模式：排除我方默认滑块后的首个元素子节点（d.ts："single child component"）
    const kids = /** @type {any[]} */ (Array.prototype.filter.call(
      el.children, (/** @type {any} */ c) => c.getAttribute && c.getAttribute('data-sb-thumb') === null));
    const userThumb = kids.length ? /** @type {any} */ (kids[0]) : null;
    let thumb = userThumb;
    if (!thumb) {
      thumb = /** @type {any} */ (el.querySelector('[data-sb-thumb="default"]') || sbEnsureDefaultThumb(w));
    }
    if (userThumb) {
      if (!w.userPrepared) {                                     // 子组件即滑块：绝对定位 + 沿轴位移
        w.userPrepared = true;
        userThumb.style.position = 'absolute';
        userThumb.style.pointerEvents = 'auto';
        if (vert) { userThumb.style.right = '0'; userThumb.style.top = '0'; }
        else { userThumb.style.left = '0'; userThumb.style.bottom = '0'; }
      }
    } else if (w.thumb !== thumb) {
      w.thumb = thumb;                                           // 记住默认滑块（scrollBarColor 生效对象）
    }
    const target = w.scroller ? w.scroller._el : null;
    if (!target) {                                               // 未绑到可滚容器：滑块停在起点
      el.dataset.sbTarget = 'none';
      el.style.opacity = w.state === 0 ? '0' : '1';
      thumb.style.transform = vert ? 'translateY(0px)' : 'translateX(0px)';
      return;
    }
    // 'scroll' 观察只挂一次（换绑才重挂——Scroller._el 理论上不换，防御性）
    if (w.listened !== target) {
      if (w.listened && w.onScrollEv) w.listened.removeEventListener('scroll', w.onScrollEv);
      w.listened = target;
      w.onScrollEv = () => sbScheduleSync(w);
      target.addEventListener('scroll', w.onScrollEv);
    }
    const cs = getComputedStyle(target);
    const canV = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    const canH = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    if (!w.warned && ((vert && !canV && canH) || (!vert && !canH && canV))) {
      w.warned = true;                                           // 方向不一致：真机不可滚动（d.ts:57）
      layoutWarnings.push('ScrollBar.direction 与被绑容器滚动轴不一致：真机语义下无法滚动该容器');
    }
    const scrollSize = vert ? target.scrollHeight : target.scrollWidth;
    const clientSize = vert ? target.clientHeight : target.clientWidth;
    const pos = vert ? target.scrollTop : target.scrollLeft;
    el.dataset.sbTarget = vert ? 'v' : 'h';
    // 轨道长 = 自身主轴长；未布局（clientHeight 还没量出来）时回落到被绑视口长——
    // ScrollBar 常与 Scroll 同尺寸叠放（Stack gridArea 1/1），两者口径一致
    const trackLen = vert
      ? (el.clientHeight || target.clientHeight)
      : (el.clientWidth || target.clientWidth);
    if (!(scrollSize > clientSize) || trackLen <= 0) {           // 无可滚内容：真机不显示滚动条
      el.style.opacity = '0';
      el.dataset.sbOverflow = '0';
      return;
    }
    el.dataset.sbOverflow = '1';
    // 可见性：Off=0 常隐；On=2 常显；Auto=1 滚动时显、静默 600ms 淡出（d.ts:64 BarState 口径）
    if (w.state === 0) el.style.opacity = '0';
    else if (w.state === 2) el.style.opacity = '1';
    else {
      el.style.opacity = '1';
      if (w.hideTimer) clearTimeout(w.hideTimer);
      w.hideTimer = setTimeout(() => { if (w.state === 1) el.style.opacity = '0'; }, 600);
    }
    const maxScroll = scrollSize - clientSize;
    const ratio = maxScroll > 0 ? pos / maxScroll : 0;
    let thumbLen = vert ? thumb.offsetHeight : thumb.offsetWidth;
    if (!thumbLen) thumbLen = Math.max(24, Math.round(trackLen * clientSize / scrollSize));
    const offset = Math.round(ratio * Math.max(0, trackLen - thumbLen));
    thumb.style.transform = vert ? `translateY(${offset}px)` : `translateX(${offset}px)`;
    el.dataset.sbOffset = String(offset);
  };

  /** @param {any} w */
  const sbBindDrag = (w) => {
    const el = w.el;
    // 拖滑块反写容器滚动（真机 ScrollBar 可交互；事件口径与 Scroller.scrollBy 一致：改完即派发）
    el.addEventListener('pointerdown', (/** @type {any} */ ev) => {
      const th = /** @type {any} */ (ev.target);
      if (!th || th.parentNode !== el) return;                   // 只有滑块可拖（默认或用户子组件）
      const target = w.scroller ? w.scroller._el : null;
      if (!target) return;
      const vert = w.dir !== ScrollBarDirection.Horizontal;
      const scrollSize = vert ? target.scrollHeight : target.scrollWidth;
      const clientSize = vert ? target.clientHeight : target.clientWidth;
      const trackLen = vert ? el.clientHeight : el.clientWidth;
      const thumbLen = vert ? th.offsetHeight : th.offsetWidth;
      const maxScroll = Math.max(0, scrollSize - clientSize);
      const travel = Math.max(1, trackLen - thumbLen);
      const startPos = vert ? target.scrollTop : target.scrollLeft;
      const startPt = vert ? ev.clientY : ev.clientX;
      ev.preventDefault();
      /** @param {any} mv */
      const onMove = (mv) => {
        const delta = (vert ? mv.clientY : mv.clientX) - startPt;
        const val = startPos + (delta * maxScroll / travel);
        if (vert) target.scrollTop = val; else target.scrollLeft = val;
        target.dispatchEvent(new Event('scroll'));
      };
      /** @return {void} */
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  };

  const ScrollBar = ensureComponent('ScrollBar', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiScrollBar = true;
    el.dataset.scrollBar = '';
    el.style.position = 'relative';
    el.style.pointerEvents = 'none';                             // 覆盖层不挡内容；滑块单独放开
    el.style.transition = 'opacity 0.2s';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const w = /** @type {any} */ (el).__sbar = /** @type {any} */ ({
      el,
      scroller: o.scroller && typeof o.scroller._bind === 'function' ? o.scroller : null,
      dir: Number(resolveResource(o.direction != null ? o.direction : 0)) || 0,   // 默认 Vertical
      state: o.state != null ? Number(resolveResource(o.state)) : 1,              // 默认 BarState.Auto
      nested: false, warned: false, userPrepared: false, syncScheduled: false,
      thumb: /** @type {any} */ null, hideTimer: /** @type {any} */ null,
      listened: /** @type {any} */ null, onScrollEv: /** @type {any} */ null,
    });
    // _bind 抢绑防护：main.js:1045 对 {scroller} 选项的通用绑定会把 scroller._el 覆盖成
    // 滚动条自身——滚动条要"观察"容器而不是"成为"容器。包装后：滚动条绑定记 __sbEl，
    // 容器绑定照旧走原型方法（晚建 Scroll 也能补首同步）。
    if (w.scroller && !w.scroller.__sbBindWrapped) {
      w.scroller.__sbBindWrapped = true;
      const protoBind = /** @type {any} */ (Object.getPrototypeOf(w.scroller))._bind;
      /** @param {any} target */
      w.scroller._bind = (target) => {
        if (target && target.__arkuiScrollBar) {
          w.scroller.__sbEl = target;
          sbScheduleSync(w);
          return;
        }
        protoBind.call(w.scroller, target);
        sbScheduleSync(w);
      };
    }
    sbBindDrag(w);
    // 首同步延后一拍：等 builder 子组件/容器尺寸就绪（headless 下 setTimeout 确定性）
    sbScheduleSync(w);
    return el;
  });

  // ── 物理动效四件 + GeometryView（atomic 原子件：无公开 d.ts/attrs）──────
  /**
   * 惰性标记件：create 参数记 bag（__motionParams，供 Animator.motion 取用）+ data-*。
   * @param {string} kind @param {any[]} args
   */
  const buildMotionEl = (kind, args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiMotion = kind;
    el.dataset[kind] = '';
    el.style.display = 'none';                                   // 内部件：不参与布局、不可见
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : null;
    const params = o ? Object.assign({}, o)
      : (args || []).filter((/** @type {any} */ a) => a !== undefined).map((/** @type {any} */ a) => Number(a));
    (/** @type {any} */ (el)).__motionParams = params;
    try { el.dataset.motionParams = JSON.stringify(params); }
    catch { el.dataset.motionParams = String(params); }
    return el;
  };

  const FrictionMotion = ensureComponent('FrictionMotion', (args) => buildMotionEl('frictionMotion', args));
  const ScrollMotion = ensureComponent('ScrollMotion', (args) => buildMotionEl('scrollMotion', args));
  const SpringMotion = ensureComponent('SpringMotion', (args) => buildMotionEl('springMotion', args));
  const SpringProp = ensureComponent('SpringProp', (args) => buildMotionEl('springProp', args));

  const GeometryView = ensureComponent('GeometryView', () => {
    // 几何转场载体：display:contents —— 自身零布局参与，转场作用在其包裹的内容上
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiGeometryView = true;
    el.dataset.geometryView = '';
    el.style.display = 'contents';
    return el;
  });
