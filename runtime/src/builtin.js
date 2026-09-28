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
   * Swiper/Tabs 通用翻页拖拽。
   * sign 约定：sign=+1 表示"拖向下一页"（手指左移 raw<0），sign=-1 上一页。
   * @param {HTMLElement} el 容器（事件绑在这里）
   * @param {any} api { axis(): 'x'|'y'; canDrag(): boolean; index(): number; count(): number;
   *   loop(): boolean; size(): number; duration(): number; pageAt(i): any;
   *   commit(i): void; gesture(i, extra): void; animStart(idx, target): void; animEnd(i): void }
   */
  function attachPagedDrag(el, api) {
    /** @type {any} */ let drag = null;
    el.addEventListener('pointerdown', (/** @type {any} */ ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (!api.canDrag() || api.count() < 2) return;
      drag = {
        id: ev.pointerId, x0: ev.clientX, y0: ev.clientY,
        samples: [], moved: false, sign: 0, raw: 0,
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
        shown = raw * calculateBuiltinFriction(Math.abs(raw) / size);
      }
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
      builtinFinishPagedDrag(d, api, idx, target, size, cancelled);
    };
    el.addEventListener('pointerup', (/** @type {any} */ ev) => finish(ev, false));
    el.addEventListener('pointercancel', (/** @type {any} */ ev) => finish(ev, true));
  }

  /** @param {{t:number, v:number}[]} samples 最近 100ms 样本 → px/s（带符号） */
  function builtinSampleVelocity(samples) {
    if (samples.length < 2) return 0;
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.v - a.v) / dt : 0;
  }

  /**
   * 收口：commit 动画到目标页 / 回弹当前页；定时器兜底 + transitionend 见证（坑 ⑧）。
   * @param {any} d @param {any} api @param {number} idx @param {number} target @param {number} size @param {boolean} cancelled
   */
  function builtinFinishPagedDrag(d, api, idx, target, size, cancelled) {
    const axisX = api.axis() !== 'y';
    const curEl = d.cur.el;
    const nbEl = d.neighbor ? d.neighbor.el : null;
    const flip = target !== idx;
    const sign = flip ? (target > idx ? 1 : -1) : d.sign;
    const dur = Math.max(0, api.duration());
    if (flip) api.animStart(idx, target);
    const curTarget = flip ? -sign * size : 0;
    const nbTarget = nbEl ? (flip ? 0 : sign * size) : 0;
    requestAnimationFrame(() => {
      curEl.style.transition = `transform ${dur}ms ease-out`;
      if (nbEl) nbEl.style.transition = `transform ${dur}ms ease-out`;
      curEl.style.transform = axisX ? `translateX(${curTarget}px)` : `translateY(${curTarget}px)`;
      if (nbEl) nbEl.style.transform = axisX ? `translateX(${nbTarget}px)` : `translateY(${nbTarget}px)`;
    });
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
        api.commit(target);
        api.animEnd(target);
      }
    };
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
      if (el.scrollLeft === sl && el.scrollTop === st) { clearInterval(h); return; }   // 到边即停
    }, 16);
    return () => clearInterval(h);
  }
