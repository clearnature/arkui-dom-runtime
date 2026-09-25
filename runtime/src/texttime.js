  // ────────────────── TextClock / TextTimer（R59）：时间文本双件 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/TextTimeDemo.ts）：
  //   TextClock.create({ controller }); TextClock.format('HH:mm:ss');
  //   TextTimer.create({ controller, startTime: 5000, isCountDown: true });
  //   TextTimer.format('HH:mm:ss.SS'); TextTimer.onTimer((utc, elapsedTime) => …);
  //   timerCtrl.start() / pause() / reset();
  //
  // 真机语义（text_clock.d.ts / text_timer.d.ts）：TextClock 每秒随系统时间刷新，
  //   TextClockController start/pause/stop 控刷新；TextTimer 从 startTime 走表，
  //   isCountDown=true 倒数（到 endTime 缺省 0 停），format 含 .SS 时步进 10ms 否则
  //   按最小 token 粒度；onTimer(utc, elapsedTime) 每 tick 触发；controller
  //   start/pause/reset（reset 停表回 startTime）。
  // DOM：textContent + setInterval（虚拟时间 headless 下确定性最好，坑 ⑧）；
  //   TextClock 走真实系统时间（结构性断言，不锁墙钟值）；TextTimer 走 tick 累积。
  /** @param {number} n */
  const pad2t = (n) => String(n).padStart(2, '0');
  // format 令牌子集：HH/mm/ss（共同）+ SS（百分秒）。其余字符原样保留。
  /** @param {string} fmt @param {Record<string, number>} bag */
  const tmtApply = (fmt, bag) => String(fmt)
    .replace(/HH/g, pad2t(bag.HH)).replace(/mm/g, pad2t(bag.mm))
    .replace(/ss/g, pad2t(bag.ss)).replace(/SS/g, pad2t(bag.SS));
  /** @param {string} fmt */
  const tmtTickMs = (fmt) => (/SS/.test(String(fmt)) ? 10 : 100);
  class TextClockController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    start() { if (this._api) this._api.start(); }
    pause() { if (this._api) this._api.pause(); }
    stop() { if (this._api) this._api.pause(); }
  }
  class TextTimerController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    start() { if (this._api) this._api.start(); }
    pause() { if (this._api) this._api.pause(); }
    reset() { if (this._api) this._api.reset(); }
  }
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTCLOCK_ATTRS = {
    format: (n, v) => {
      const w = /** @type {any} */ (n).__tclock;
      if (!w) return;
      w.fmt = String(resolveResource(v));
      w.render();
    },
    onClockChange: (n, v) => {
      const w = /** @type {any} */ (n).__tclock;
      if (w) w.cbs.change = v;
    },
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TEXTTIMER_ATTRS = {
    format: (n, v) => {
      const w = /** @type {any} */ (n).__ttimer;
      if (!w) return;
      w.fmt = String(resolveResource(v));
      w.relayout();                                     // 步进粒度随 format 变（.SS → 10ms）
      w.render();
    },
    onTimer: (n, v) => {
      const w = /** @type {any} */ (n).__ttimer;
      if (w) w.cbs.timer = v;
    },
  };
  /** @param {any[]} args */
  const TextClock = ensureComponent('TextClock', (args) => {
    const el = document.createElement('div');
    el.__arkuiTextClock = true;
    el.dataset.textClock = '';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    /** @type {any} */ const w = /** @type {any} */ (el).__tclock = { fmt: String(o.format || 'HH:mm:ss'), cbs: {}, timer: null, running: true };
    const render = () => {
      const d = new Date();
      el.textContent = tmtApply(w.fmt, {
        HH: d.getHours(), mm: d.getMinutes(), ss: d.getSeconds(), SS: Math.floor(d.getMilliseconds() / 10),
      });
      const cb = w.cbs.change;
      if (typeof cb === 'function') {
        try { cb(el.textContent, 0); }
        catch (e) { layoutWarnings.push(`TextClock.onClockChange 回调抛错：${e && e.message}`); }
      }
    };
    w.render = render;
    w.api = {
      start() { if (!w.timer) { render(); w.timer = setInterval(render, 1000); } },
      pause() { if (w.timer) { clearInterval(w.timer); w.timer = null; } },
    };
    w.api.start();                                      // 缺省自动走时（真机同）
    if (o.controller && typeof o.controller._bind === 'function') o.controller._bind(w.api);
    render();
    return el;
  });
  /** @param {any[]} args */
  const TextTimer = ensureComponent('TextTimer', (args) => {
    const el = document.createElement('div');
    el.__arkuiTextTimer = true;
    el.dataset.textTimer = '';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const startTime = Number(o.startTime) || 0;
    const endTime = o.endTime === undefined ? 0 : Number(o.endTime);
    const countDown = o.isCountDown === true;
    /** @type {any} */ const w = /** @type {any} */ (el).__ttimer = {
      fmt: String(o.format || 'HH:mm:ss.SS'), cbs: {}, timer: null,
      elapsed: 0, running: false, startTime, endTime, countDown,
    };
    // 步进粒度：format 含 .SS → 10ms；否则按最小 token（秒级 format → 100ms 平滑）
    w.render = () => {
      const shown = w.countDown ? Math.max(w.endTime, w.startTime - w.elapsed) : Math.min(w.endTime || Infinity, w.startTime + w.elapsed);
      el.textContent = tmtApply(w.fmt, {
        HH: Math.floor(shown / 3600000),
        mm: Math.floor(shown / 60000) % 60,
        ss: Math.floor(shown / 1000) % 60,
        SS: Math.floor(shown / 10) % 100,
      });
    };
    w.relayout = () => {
      const wasRunning = w.running;
      if (w.timer) { clearInterval(w.timer); w.timer = null; }
      if (wasRunning) w.start();
    };
    const fireTimer = () => {
      const cb = w.cbs.timer;
      if (typeof cb !== 'function') return;
      try { cb(Date.now(), w.elapsed); }
      catch (e) { layoutWarnings.push(`TextTimer.onTimer 回调抛错：${e && e.message}`); }
    };
    w.start = () => {
      if (w.timer) return;                              // 重复 start 幂等（真机同）
      const done = () => (w.countDown ? w.elapsed >= w.startTime - w.endTime : w.endTime !== undefined && w.endTime !== null && w.elapsed >= w.endTime - w.startTime && w.endTime > 0);
      w.timer = setInterval(() => {
        w.elapsed += tmtTickMs(w.fmt);
        if (done()) {
          w.elapsed = w.countDown ? w.startTime - w.endTime : (w.endTime || 0) - w.startTime;
          w.render();
          fireTimer();
          if (w.timer) { clearInterval(w.timer); w.timer = null; }
          return;
        }
        w.render();
        fireTimer();
      }, tmtTickMs(w.fmt));
    };
    w.pause = () => { if (w.timer) { clearInterval(w.timer); w.timer = null; } };
    w.reset = () => {
      w.pause();
      w.elapsed = 0;
      w.render();
    };
    if (o.controller && typeof o.controller._bind === 'function') o.controller._bind(w);
    w.render();
    return el;
  });
