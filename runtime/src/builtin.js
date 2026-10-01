  // ────────────────── 组件内置手势（R125）──────────────────
  //
  // CAPABILITY 已知限制清单里点名的"组件内置手势"（List 滚动、Swiper 滑动翻页、Scroll 拖动、
  // Tabs 滑动切换）。显式绑定手势在 R23 已完整（gesture.js）；本分片是【内置】行为——
  // 不需要用户写 Gesture 代码，容器自己就该有的拖拽语义。
  //
  // 真机参数（逐个对源码，不凭手感）：
  //   翻页距离阈值 = 半页：swiperProportion_ = 2.0（swiper_pattern.h:971，
  //     dragDistance > firstItemLength / swiperProportion_ → 翻页）
  //   翻页速度阈值 = 780vp/s：NEW_STYLE_MIN_TURN_PAGE_VELOCITY（swiper_pattern.h:62，
  //     API 11+ 生效值 newMinTurnPageVelocity_）
  //   边界摩擦（loop=false 拖出边界）：swiper_helper.cpp:566-578 CalculateFriction 原文——
  //     γ=越界量/视口，scrollRatio=0.72，coefficient=e/(1−e)，
  //     fx=(γ+coefficient)·(ln(e−(e−1)γ)−1)，返回 0.72·fx/γ
  //   翻页动画时长：duration 属性默认 400ms（swiper.d.ts JSDoc "Default value: 400"）
  //   Tabs 内容区滑动开关：scrollable 默认 true（tabs.d.ts JSDoc "**true** (default)"）
  //
  // DOM 模型：Swiper/Tabs 的页面是 display 切换式（onlyOneVisible 同款）——拖拽期间把当前页
  //   与邻页临时摆成 absolute + transform 跟手（邻页在拖拽方向前方 sign·size 处），松手按
  //   阈值/速度 commit 或回弹；动画收口"定时器兜底 + transitionend 见证"（坑 ⑧：headless
  //   动画事件不可靠）。List/Scroll 是 overflow 滚动容器——拖拽换算 scrollTop/scrollLeft，
  //   松手惯性衰减。真机边界回弹曲线（overDrag spring）属"确证扫尾"候选，本片不做只记 dataset。

  /** @param {number} gamma 越界量/视口比（swiper_helper.cpp:566-578 原文） */
  function calculateBuiltinFriction(gamma) {
    if (gamma <= 0) return 1;
    if (gamma >= 1) gamma = 1;
    const scrollRatio = 0.72;
    const coefficient = Math.E / (1 - Math.E);
    const fx = (gamma + coefficient) * (Math.log(Math.E - (Math.E - 1) * gamma) - 1);
    return (scrollRatio * fx) / gamma;
  }
  const BUILTIN_TURN_VELOCITY = 780;      // px/s（vp 1:1），swiper_pattern.h:62
  const BUILTIN_DRAG_PROPORTION = 2.0;    // 半页阈值，swiper_pattern.h:971

  /**
   * 边界回弹弹簧（R126；ScrollSpringMotion 语义，scroll_motion.h:67-70）。
   * 默认弹簧 scrollable.cpp:27-29：mass=1 / stiffness=228 / damping=30 →
   * cmk = 900-912 = -12 < 0 **恒欠阻尼**（spring_model.cpp:79-90 的 Build 判分歧，默认参数只落
   * UNDER_DAMPED 一支）——解析解逐式照抄 spring_model.cpp:150-174 UnderdampedModel。
   * 坐标系无关：start/end/v0 同一坐标即可（Swiper 用拖拽偏移、Scroll 用内容 translate）。
   * impulse 技巧：start=end 时 c1=0、c2=v0/w —— 即"边界处受速度冲激"的回弹（Scroll 越界用）。
   * @param {(p: number) => void} apply @param {number} start @param {number} end @param {number} v0 @param {() => void} done
   * @returns {() => void} 停止函数
   */
  function builtinSpringRebound(apply, start, end, v0, done) {
    const m = 1, k = 228, c = 30;              // scrollable.cpp:27-29 原文
    const w = Math.sqrt(4 * m * k - c * c) / (2 * m);
    const r = -c / (2 * m);
    const c1 = start - end;                    // SpringMotion：distance = start - end
    const c2 = (v0 - r * c1) / w;
    const t0 = performance.now();
    const h = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const p = Math.exp(r * t) * (c1 * Math.cos(w * t) + c2 * Math.sin(w * t));
      apply(end + p);
      if (Math.abs(p) < 0.5) {                 // ScrollSpringMotion::IsCompleted（NearZero 精度内）
        clearInterval(h);
        apply(end);
        done();
      }
    }, 16);
    return () => clearInterval(h);
  }

  /**
   * EdgeEffect api 槽位读取（R155-B）。返回 'spring'|'none'|'shadow'；钩子未声明（R125-154
   * 的旧调用方）→ 缺省 'spring'，与既有"越界摩擦 + 冲激回弹"行为一致（向后兼容）。
   * 真机语义（swiper_pattern.cpp）：:302 SetCanOverScroll(effect==SPRING)——只有 Spring 允许
   * 越界；:3341-3345 非 SPRING 越界拖拽钳到边界值；:4137-4166 CheckDragOutOfBoundary 的
   * NONE 分支不 PlaySpringAnimation（位置停在边界）。Shadow 在本 SDK 的 EdgeEffect 枚举里
   * 没有成员（enums.d.ts:1494 = Spring/Fade/None），按任务书收作前向扩展值=Spring 行为
   * + 视觉标记（视觉 DOM 无对应，由调用方记 dataset/警告）。
   * @param {any} api @returns {string} 'spring'|'none'|'shadow'
   */
  function builtinEdgeEffect(api) {
    if (typeof api.edgeEffect !== 'function') return 'spring';
    const v = api.edgeEffect();
    return v === 'none' || v === 'shadow' ? v : 'spring';
  }

  /**
   * Swiper/Tabs 通用翻页拖拽。
   * sign 约定：sign=+1 表示"拖向下一页"（手指左移 raw<0），sign=-1 上一页。
   * @param {HTMLElement} el 容器（事件绑在这里）
   * @param {any} api { axis(): 'x'|'y'; canDrag(): boolean; index(): number; count(): number;
   *   loop(): boolean; size(): number; duration(): number;
   *   finishCurve(): any（R154-B 曲线槽位，可选——返回 {kind:'css'|'spring', css} 或空=缺省
   *     ease-out；spring 族走 R126 弹簧解算器、不 respect duration，见 builtinFinishPagedDrag）;
   *   edgeEffect(): string（R155-B 到边行为开关，可选——'spring'|'none'|'shadow'，缺省
   *     'spring'。None=越界拖拽硬停（不摩擦跟手）+ 松手直接落位（无冲激弹簧，见
   *     builtinFinishPagedDrag）；Spring/Shadow=现状摩擦跟手 + 冲激回弹）;
   *   pageAt(i): any; commit(i): void; gesture(i, extra): void; animStart(idx, target): void;
   *   animEnd(i): void;
   *   onMoveThrough(i): void（R156-A 可选槽位——拖拽进行中每越过一次"中线"派发一次越过目标页
   *     索引 i，真机 IsNeedMove 中线口径 list_item_drag_manager.cpp:337-356、API 20 同名细粒度
   *     事件 common.d.ts:25788；未声明不派发——Tabs/Swiper 既有调用方零感知，向后兼容） }
   */
  function attachPagedDrag(el, api) {
    /** @type {any} */ let drag = null;
    el.addEventListener('pointerdown', (/** @type {any} */ ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (!api.canDrag() || api.count() < 2) return;
      drag = {
        id: ev.pointerId, x0: ev.clientX, y0: ev.clientY,
        samples: [], moved: false, sign: 0, raw: 0, shown: 0,
        cur: null, neighbor: null, nIdx: -1,
      };
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* 已释放等 */ }
    });
    el.addEventListener('pointermove', (/** @type {any} */ ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const axisX = api.axis() !== 'y';
      const raw = axisX ? ev.clientX - drag.x0 : ev.clientY - drag.y0;
      const now = performance.now();
      drag.samples.push({ t: now, v: raw });
      while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
      if (!drag.moved && Math.abs(raw) < 5) return;
      const size = api.size();
      if (size <= 0) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.sign = raw < 0 ? 1 : -1;           // 手指左拖=下一页(+1)
        el.addEventListener('click', builtinSuppressClick, { capture: true, once: true });
        const idx = api.index();
        let nIdx = idx + drag.sign;
        if (nIdx < 0 || nIdx >= api.count()) {
          nIdx = api.loop() ? (nIdx + api.count()) % api.count() : -1;   // 边界外无邻页
        }
        drag.nIdx = nIdx;
        const curEl = api.pageAt(idx);
        if (!curEl) { drag = null; return; }
        drag.cur = { el: curEl, prevPos: curEl.style.position, prevT: curEl.style.transform };
        curEl.style.position = 'absolute';
        curEl.style.left = '0';
        curEl.style.top = '0';
        curEl.style.transition = 'none';
        if (nIdx >= 0) {
          const nbEl = api.pageAt(nIdx);
          if (nbEl) {
            drag.neighbor = { el: nbEl, prevPos: nbEl.style.position, prevT: nbEl.style.transform, prevDisplay: nbEl.style.display };
            nbEl.style.position = 'absolute';
            nbEl.style.left = '0';
            nbEl.style.top = '0';
            nbEl.style.display = 'block';
            nbEl.style.transition = 'none';
          }
        }
      }
      drag.raw = raw;
      const sign = drag.sign;
      // 显示偏移：拖向界外（非 loop：第 0 页往右拖 / 末页往左拖）时乘摩擦
      //（真机 delta *= friction(|over|/size)，swiper_pattern.cpp:515 同式）
      const idxNow = api.index();
      const outward = !api.loop()
        && ((sign === -1 && idxNow === 0) || (sign === 1 && idxNow === api.count() - 1));
      let shown = raw;
      if (outward) {
        // R155-B：EdgeEffect.None = 到边硬停——真机只有 SPRING 允许越界
        //（swiper_pattern.cpp:302 SetCanOverScroll(effect==SPRING)；:3341-3345 非 SPRING
        // 越界位移钳到边界值）→ 位移恒 0、不乘摩擦跟手。Spring/Shadow（缺省）保持 R126
        // 边界摩擦跟手（swiper_helper.cpp:566-578 原式）。
        shown = builtinEdgeEffect(api) === 'none'
          ? 0
          : raw * calculateBuiltinFriction(Math.abs(raw) / size);
      }
      drag.shown = shown;
      // R156-A 槽位：onMoveThrough(越过目标索引)——拖拽进行中每越过一次中线派发一次（真机
      // IsNeedMove 中线口径 list_item_drag_manager.cpp:337-356；API 20 onMoveThrough 同名事件
      // common.d.ts:25788）。未声明不派发（Tabs/Swiper 既有调用方零感知，向后兼容）。
      if (typeof api.onMoveThrough === 'function' && drag.nIdx >= 0
        && Math.abs(shown) * BUILTIN_DRAG_PROPORTION > size) api.onMoveThrough(drag.nIdx);
      const curEl = drag.cur.el;
      curEl.style.transform = axisX ? `translateX(${shown}px)` : `translateY(${shown}px)`;
      const nbEl = drag.neighbor ? drag.neighbor.el : null;
      if (nbEl) {
        const nbOff = shown + sign * size;      // 邻页贴在拖拽方向前方
        nbEl.style.transform = axisX ? `translateX(${nbOff}px)` : `translateY(${nbOff}px)`;
      }
      api.gesture(api.index(), {
        currentOffset: raw,             // SwiperAnimationEvent 三字段（swiper.d.ts:1086-1145）
        targetOffset: 0,
        velocity: builtinSampleVelocity(drag.samples),
      });
    });
    const finish = (/** @type {any} */ ev, /** @type {boolean} */ cancelled) => {
      if (!drag || (ev && ev.pointerId !== drag.id)) return;
      const d = drag;
      drag = null;
      if (!d.moved || !d.cur) return;           // 原地点按：不进拖拽生命周期
      const size = api.size();
      const raw = d.raw;
      const v = builtinSampleVelocity(d.samples);
      const sign = d.sign;
      // 判定（ComputeNextIndexByVelocity，swiper_pattern.cpp:4034）：
      //   距离过半页（raw·sign < -size/2）或同向快扫（v·sign < -780）→ 翻页；否则回弹
      const byDist = raw * sign < -size / BUILTIN_DRAG_PROPORTION;
      const byVel = v * sign < -BUILTIN_TURN_VELOCITY;
      const idx = api.index();
      let target = idx;
      if (!cancelled && (byDist || byVel)) {
        let nIdx = idx + sign;
        if (nIdx < 0 || nIdx >= api.count()) {
          nIdx = api.loop() ? (nIdx + api.count()) % api.count() : idx;
        }
        target = nIdx;
      }
      builtinFinishPagedDrag(d, api, idx, target, size, v, cancelled);
    };
    el.addEventListener('pointerup', (/** @type {any} */ ev) => finish(ev, false));
    el.addEventListener('pointercancel', (/** @type {any} */ ev) => finish(ev, true));
  }

  /** @param {{t:number, v:number}[]} samples 最近 100ms 样本 → px/s（带符号） */
  function builtinSampleVelocity(samples) {
    if (samples.length < 2) return 0;
    const a = samples[0];
    const b = samples[samples.length - 1];
    // R154：dt 下限 8ms（一帧）——真实指针事件按帧合并不会产生 0/亚毫秒 dt；合成事件
    //（测试页同拍 dispatch）才会，无下限时 v0 达 10 万 px/s 量级、弹簧飞出数万 px 不收敛
    //（Android WebView 实测 R154）。
    const dt = Math.max(0.008, (b.t - a.t) / 1000);
    return dt > 0 ? (b.v - a.v) / dt : 0;
  }

  /**
   * 收口：commit 走 duration + 曲线槽位（R154-B：api.finishCurve() 未声明时 ease-out——
   * R125 以来缺省/d.ts 契约）；**回弹走真机弹簧**（R126：ScrollSpringMotion 欠阻尼解析解，
   * scrollable.cpp:27-29 参数）。定时器兜底 + transitionend 见证（坑 ⑧）。
   * @param {any} d @param {any} api @param {number} idx @param {number} target @param {number} size @param {number} v0 @param {boolean} cancelled
   */
  function builtinFinishPagedDrag(d, api, idx, target, size, v0, cancelled) {
    const axisX = api.axis() !== 'y';
    const curEl = d.cur.el;
    const nbEl = d.neighbor ? d.neighbor.el : null;
    const flip = target !== idx;
    const sign = flip ? (target > idx ? 1 : -1) : d.sign;
    const dur = Math.max(0, api.duration());
    if (flip) api.animStart(idx, target);
    // ── R154-B 曲线槽位（R152 记档待接的槽位）──
    // api.finishCurve() 可选：返回 {kind:'css'|'spring', css}（main.js parseTabsAnimCurve 同形，
    // Tabs.animationCurve 的解析产物）；调用方未声明（api 上没有这个钩子）/返回空 → null →
    // ease-out，向后兼容（调用方先例：Tabs 已在用 api.duration() 供时长，曲线同理由它声明）。
    const fc = typeof api.finishCurve === 'function' ? api.finishCurve() : null;
    const curve = fc && fc.css ? fc : null;
    const curTarget = flip ? -sign * size : 0;
    const nbTarget = nbEl ? (flip ? 0 : sign * size) : 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // 还原拖拽舞台：清临时样式，交回 display 切换语义
      curEl.style.transition = 'none';
      curEl.style.transform = d.cur.prevT || '';
      curEl.style.position = d.cur.prevPos || '';
      curEl.style.left = '';
      curEl.style.top = '';
      if (nbEl) {
        nbEl.style.transition = 'none';
        nbEl.style.transform = d.neighbor.prevT || '';
        nbEl.style.position = d.neighbor.prevPos || '';
        nbEl.style.left = '';
        nbEl.style.top = '';
        nbEl.style.display = d.neighbor.prevDisplay || '';
      }
      if (flip) {
        // R154 探针：临时诊断包装（确认后移除）
        try {
          api.commit(target);
        } catch (e) {
          layoutWarnings.push(`R154 探针 commit 抛错：${e && e.message}`);
        }
        api.animEnd(target);
      }
    };
    // 弹簧位移 apply（回弹/弹簧翻页共用）：p=当前页位移，邻页恒贴 sign·size 前方
    const springApply = (/** @type {number} */ p) => {
      curEl.style.transform = axisX ? `translateX(${p}px)` : `translateY(${p}px)`;
      if (nbEl) {
        const np = p + sign * size;
        nbEl.style.transform = axisX ? `translateX(${np}px)` : `translateY(${np}px)`;
      }
    };
    if (curve && curve.kind === 'spring') {
      // spring 族（interpolatingSpring/springMotion…）不 respect duration——swiper.d.ts:1540-1541
      // JSDoc 原文 "the duration of the animation is determined solely by the parameters of the
      // curve itself and is no longer governed by the duration setting"。真机拖拽释放翻页 =
      // interpolatingSpring(-1,1,228,30)（tabs_bar_pattern.cpp:76 同款；Swiper 自身 d.ts 缺省
      // interpolatingSpring(-1,1,328,34)，swiper.d.ts:1858——同族不同参，解算器统一用 R126 的
      // 228/30 家族，偏差已记录）。弹簧在 CSS 里表达不了（只能曲线近似），这里直接用
      // builtinSpringRebound 的欠阻尼解析解（scrollable.cpp:27-29 参数）从松手位移解到目标页、
      // 初速=拖拽采样速度——比近似曲线更真。收口=解算器精度触发 settle；不挂 transitionend/
      // 兜底定时器（transform 未挂 transition，二者无意义且会提前收口——回弹分支同款互斥）。
      builtinSpringRebound(springApply, d.shown, curTarget, v0, settle);
      return;
    }
    requestAnimationFrame(() => {
      const css = curve ? String(curve.css) : 'ease-out';   // 未声明槽位=ease-out（R125 契约）
      curEl.style.transition = `transform ${dur}ms ${css}`;
      if (nbEl) nbEl.style.transition = `transform ${dur}ms ${css}`;
      curEl.style.transform = axisX ? `translateX(${curTarget}px)` : `translateY(${curTarget}px)`;
      if (nbEl) nbEl.style.transform = axisX ? `translateX(${nbTarget}px)` : `translateY(${nbTarget}px)`;
    });
    if (!flip) {
      if (builtinEdgeEffect(api) === 'none') {
        // R155-B：EdgeEffect.None 回弹 = 直接落位（无冲激弹簧）。真机 CheckDragOutOfBoundary
        // 的 NONE 分支不 PlaySpringAnimation（swiper_pattern.cpp:4137-4166），位置钳在边界——
        // transform 同步写边界值（0 位移）并立即收口，无弹簧帧/兜底定时器在途。
        // Spring/Shadow（缺省）= 弹簧（R126：真机 StartSpringMotion 同一物理，欠阻尼解析解）
        // ——弹簧无固定时长，transitionend/duration 兜底对它无意义（transform 没挂
        // transition），二者并存会提前收口、弹簧收尾再写 transform → 互斥，收口由解算器
        // 精度触发 settle。
        springApply(0);
        settle();
        return;
      }
      builtinSpringRebound(springApply, d.shown, 0, v0, settle);
      return;
    }
    curEl.addEventListener('transitionend', settle, { once: true });
    setTimeout(settle, dur + 80);               // 兜底（headless transitionend 会丢）
  }

  /**
   * List/Scroll 内置拖拽滚动（触摸/手写笔；鼠标按住拖动同样生效）。
   * 惯性：松手后速度衰减 rAF（0.95^帧，<20px/s 或到边即停）。边界回弹（overDrag spring）
   * 留"确证扫尾"，这里 native clamp。
   * @param {HTMLElement} el overflow 容器
   */
  function attachScrollDrag(el) {
    /** @type {any} */ let drag = null;
    /** @type {() => void} */ let stopMomentumFn = () => {};
    const stopMomentum = () => stopMomentumFn();
    el.addEventListener('pointerdown', (/** @type {any} */ ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      stopMomentum();
      drag = {
        id: ev.pointerId, x0: ev.clientX, y0: ev.clientY,
        sl0: el.scrollLeft, st0: el.scrollTop, moved: false, samples: [],
      };
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* 已释放等 */ }
    });
    el.addEventListener('pointermove', (/** @type {any} */ ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x0;
      const dy = ev.clientY - drag.y0;
      const now = performance.now();
      drag.samples.push({ t: now, x: ev.clientX, y: ev.clientY });
      while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
      if (!drag.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        el.addEventListener('click', builtinSuppressClick, { capture: true, once: true });
      }
      el.scrollLeft = drag.sl0 - dx;
      el.scrollTop = drag.st0 - dy;
    });
    const finish = (/** @type {any} */ ev) => {
      if (!drag || (ev && ev.pointerId !== drag.id)) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      const s = d.samples;
      if (s.length < 2) return;
      const a = s[0];
      const b = s[s.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) return;
      stopMomentumFn = builtinFlingScroll(el, (b.x - a.x) / dt, (b.y - a.y) / dt);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  /** @param {any} ev 拖过的指针的后续 click 不下放（真机滚动取消子项点击） */
  function builtinSuppressClick(ev) {
    ev.stopPropagation();
    ev.preventDefault();
  }

  /**
   * 惯性滚动（拖拽松手 / Scroll.fling(velocity) 共用）：定时器衰减（坑 ⑧：headless 里
   * rAF 被节流不可靠——短定时器是既有兜底先例），到边或 <20px/s 停。
   * @param {HTMLElement} el @param {number} vx @param {number} vy
   * @returns {() => void} 停止函数
   */
  function builtinFlingScroll(el, vx, vy) {
    const h = setInterval(() => {
      vx *= 0.95;
      vy *= 0.95;
      if (Math.abs(vx) < 20 && Math.abs(vy) < 20) { clearInterval(h); return; }
      const sl = el.scrollLeft;
      const st = el.scrollTop;
      el.scrollLeft = sl - vx / 60;
      el.scrollTop = st - vy / 60;
      if (el.scrollLeft === sl && el.scrollTop === st) {
        // 到边：真机 edgeEffect=Spring 不是停而是越界冲激回弹（ProcessScrollOver →
        // StartSpringMotion，scroll_spring_effect.cpp:37-53）——残余速度交给内容 translate
        // 弹簧（DOM 的 scrollTop 无法为负，用内容变换呈现越界量）
        clearInterval(h);
        builtinFlingOverScrollSpring(el, vx, vy);
      }
    }, 16);
    return () => clearInterval(h);
  }

  /**
   * 越界冲激回弹：内容 firstElementChild 临时 translate，弹簧收口后清干净。
   * 方向取残余速度的主轴分量（真机 EdgeEffect.Spring 的视觉等价）。
   * @param {HTMLElement} el @param {number} vx @param {number} vy
   */
  function builtinFlingOverScrollSpring(el, vx, vy) {
    const content = /** @type {HTMLElement} */ (el.firstElementChild);
    if (!content) return;
    const vertical = el.scrollHeight > el.clientHeight + 1;
    const v0 = vertical ? vy : vx;
    if (Math.abs(v0) < 20) return;
    content.style.willChange = 'transform';
    const axisCss = vertical ? 'translateY' : 'translateX';
    builtinSpringRebound(
      (/** @type {number} */ p) => { content.style.transform = `${axisCss}(${p}px)`; },
      0, 0, v0,
      () => { content.style.transform = ''; content.style.willChange = ''; });
  }
