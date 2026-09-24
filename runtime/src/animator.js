  // ────────────────── ImageAnimator 帧动画（R47）：真实 <img> 基座 + 逐帧定时器 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/AnimatorDemo.ts）：
  //   ImageAnimator.create();
  //   ImageAnimator.images([{src,…},…]);  ← ImageFrameInfo：src 必填，单帧可带 duration(ms)
  //   ImageAnimator.duration(200);        ← 每帧 ms（.d.ts Default 1000；单帧 duration 优先）
  //   ImageAnimator.iterations(2);        ← 迭代次数（Default 1；-1 无限）
  //   ImageAnimator.state(this.st);       ← AnimationStatus（Initial=0/Running=1/Paused=2/Stopped=3）
  //   ImageAnimator.onStart/onPause/onRepeat/onCancel/onFinish
  //   （本 SDK 的 d.ts **没有 onFrame 属性**——不要照旧文档实现）
  //
  // DOM 映射：根 = div + 主 <img>；引擎 = 逐帧 setTimeout（headless 虚拟时间下确定，坑 ⑧ 同族
  // 不会踩：不用 rAF）。Running→逐帧推进+迭代计数；Paused→停表保持当前帧；Stopped→停表回
  // 第一帧；播完 iterations → 状态落 Stopped、发 onFinish（保持末帧）。回调**延时派发**：
  // state 属性先于 onStart 应用，同步发会丢（实测）；重渲染重复应用 images/state 需深 diff/
  // 同值守卫（坑 88 同族）。reverse 反向播放未实现（记警告）。
  const ANIMATOR_ATTRS = {
    images: (n, v) => {
      const an = n.__an;
      const frames = Array.isArray(v) ? v : [];
      const key = frames.map((f) => String((f && f.src != null) ? resolveResource(f.src) : '')).join('|');
      if (an.framesKey === key) return;          // 重渲染同帧序列 → 无操作（防重置帧序）
      an.framesKey = key;
      an.frames = frames;
      an.idx = 0; an.cycle = 0;
      an.show(0);
      if (an.state === 1) an.schedule();         // images 晚于 state 应用时补启动
    },
    duration: (n, v) => {
      const d = Number(resolveResource(v));
      n.__an.duration = d > 0 ? d : 1000;        // 负值/0 用默认（.d.ts："negative → default"）
    },
    iterations: (n, v) => {
      const i = Number(resolveResource(v));
      n.__an.iterations = i === -1 ? Infinity : (i >= 1 ? i : 1);
    },
    state: (n, v) => { n.__anApplyState(v); },
    reverse: (n, v) => {
      n.dataset.reverse = String(!!resolveResource(v));
      if (resolveResource(v)) layoutWarnings.push('ImageAnimator.reverse 反向播放未实现（记 data-*）');
    },
    fixedSize: (n, v) => { n.dataset.fixedSize = String(!!resolveResource(v)); },
    onStart: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).start = v; },
    onPause: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).pause = v; },
    onRepeat: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).repeat = v; },
    onCancel: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).cancel = v; },
    onFinish: (n, v) => { (/** @type {any} */ (n.__anCbs = n.__anCbs || {})).finish = v; },
  };
  const ImageAnimator = ensureComponent('ImageAnimator', (args) => {
    const el = document.createElement('div');
    el.__arkuiAnimator = true;
    el.dataset.animator = '';
    el.dataset.state = '0';
    el.dataset.frame = '0';
    el.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.setAttribute('data-arkui-animator-main', '');
    img.style.display = 'block';
    img.style.width = '100%';
    img.style.height = '100%';
    el.appendChild(img);
    el.__anCbs = {};
    el.__an = {
      frames: [], framesKey: '', duration: 1000, iterations: 1, reverse: false, fixedSize: true,
      state: 0, idx: 0, cycle: 0, timer: null, started: false,
      show: (i) => {
        el.__an.idx = i;
        const f = el.__an.frames[i];
        if (f && f.src != null) img.src = String(resolveResource(f.src));
        el.dataset.frame = String(i);
      },
    };
    const an = el.__an;
    const fire = (name) => {
      // 延时派发：state 属性先于 onStart/onFinish 应用（产物顺序实测），同步发会丢
      setTimeout(() => {
        const cb = el.__anCbs && el.__anCbs[name];
        if (typeof cb === 'function') {
          try { cb(); }
          catch (e) { layoutWarnings.push(`ImageAnimator.${name} 回调抛错：${e && e.message}`); }
        }
      }, 0);
    };
    const stopTimer = () => { if (an.timer) { clearTimeout(an.timer); an.timer = null; } };
    const schedule = () => {
      stopTimer();
      if (an.state !== 1 || !an.frames.length) return;
      const f = an.frames[an.idx];
      const d = (f && f.duration) || an.duration;   // 单帧 duration 优先（.d.ts 原文）
      an.timer = setTimeout(() => {
        let ni = an.idx + 1;
        if (ni >= an.frames.length) {
          an.cycle += 1;
          if (an.cycle >= an.iterations) {
            an.state = 3;                              // 播完：状态落 Stopped（保持末帧）
            el.dataset.state = '3';
            fire('finish');
            return;
          }
          fire('repeat');
          ni = 0;
        }
        an.show(ni);
        schedule();
      }, d);
    };
    el.__anApplyState = (nv) => {
      nv = Number(nv);
      if (nv === an.state) return;                 // 重渲染重复应用同值 → 无操作
      const prev = an.state;
      an.state = nv;
      el.dataset.state = String(nv);
      if (nv === 1) {                              // → Running
        if (!an.started) { an.started = true; fire('start'); }
        schedule();
      } else if (nv === 2) {                       // → Paused：停表保持当前帧
        stopTimer();
        if (prev === 1) fire('pause');
      } else if (nv === 3) {                       // → Stopped：停表回第一帧
        stopTimer();
        an.idx = 0; an.cycle = 0; an.show(0);
        if (prev === 1) fire('cancel');
      } else {                                     // → Initial：复位（含 started，重启会再发 start）
        stopTimer(); an.idx = 0; an.cycle = 0; an.started = false; an.show(0);
      }
    };
    return el;
  });
