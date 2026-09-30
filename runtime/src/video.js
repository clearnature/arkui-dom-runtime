  // ────────────────── Video 视频播放器（R65）：HTML <video> 原生垫片 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/RichVideoDemo.ts）：
  //   Video.create({src: 'video-test.mp4', controller});
  //   Video.controls(false); Video.autoPlay(false); Video.muted(true);
  //
  // 真机语义（video.d.ts）：src 视频源；controls 显示原生控制条（缺省 true）；
  //   autoPlay 自动播放（缺省 false）；muted 静音（缺省 false）；loop 循环（缺省 false）。
  //   onPrepared/onStart/onPause/onFinish/onUpdate 生命周期回调。
  //   VideoController start/pause/stop/requestFullscreen/exitFullscreen。
  // DOM：<video> 原生元素（controls/autoPlay/muted/loop CSS 属性直通）；src → src 属性。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const VIDEO_ATTRS = {
    controls: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.controls = v === true;
      n.dataset.controls = String(v === true);
    },
    muted: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.muted = v === true;
      n.dataset.muted = String(v === true);
    },
    autoPlay: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.autoplay = v === true;
      n.dataset.autoPlay = String(v === true);
    },
    loop: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      const native = w && w.native;
      if (native) native.loop = v === true;
      n.dataset.loop = String(v === true);
    },
    onStart: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.start = v;
    },
    onPause: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.pause = v;
    },
    onFinish: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.finish = v;
    },
    onPrepared: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.prepared = v;
    },
    onUpdate: (n, v) => {
      const w = /** @type {any} */ (n).__video;
      if (w) w.cbs.update = v;
    },
  };
  /** @param {any[]} args */
  const Video = ensureComponent('Video', (args) => {
    const el = document.createElement('div');
    el.__arkuiVideo = true;
    el.dataset.video = '';
    el.style.position = 'relative';
    // 原生 <video> 元素垫片
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const native = document.createElement('video');
    native.style.width = '100%';
    native.style.height = '100%';
    native.style.display = 'block';
    if (o.src) native.src = String(o.src);
    el.appendChild(native);
    const w = /** @type {any} */ (el).__video = /** @type {any} */ ({ native, cbs: {}, controller: null });
    // 生命周期桥接：原生 <video> 事件 → ArkUI 回调
    native.addEventListener('play', () => {
      const cb = w.cbs.start;
      if (typeof cb === 'function') { try { cb(); } catch (e) { /* 容错 */ } }
    });
    native.addEventListener('pause', () => {
      const cb = w.cbs.pause;
      if (typeof cb === 'function') { try { cb(); } catch (e) { /* 容错 */ } }
    });
    native.addEventListener('ended', () => {
      const cb = w.cbs.finish;
      if (typeof cb === 'function') { try { cb(); } catch (e) { /* 容错 */ } }
    });
    // R152-A：onPrepared/onUpdate 此前只收回调不派发（空 face）。补真实事件桥——
    // loadedmetadata → PreparedInfo.duration、timeupdate → PlaybackInfo.time，单位秒
    // （video.d.ts:226-237 PreparedInfo "Unit: second"、:254-266 PlaybackInfo 同），
    // 与 <video> 元素的 duration/currentTime 同单位直通。未设置回调时零开销
    // （richvideodemo 现有断言不消费这两个回调，行为不受影响）；不解码则不派发（同真机）。
    native.addEventListener('loadedmetadata', () => {
      const cb = w.cbs.prepared;
      if (typeof cb === 'function') { try { cb({ duration: native.duration }); } catch (e) { /* 容错 */ } }
    });
    native.addEventListener('timeupdate', () => {
      const cb = w.cbs.update;
      if (typeof cb === 'function') { try { cb({ time: native.currentTime }); } catch (e) { /* 容错 */ } }
    });
    // VideoController 绑定
    if (o.controller && typeof o.controller._bind === 'function') {
      o.controller._bind({
        play() { try { native.play(); } catch (e) { /* 容错 */ } },
        pause() { try { native.pause(); } catch (e) { /* 容错 */ } },
        stop() { try { native.pause(); native.currentTime = 0; } catch (e) { /* 容错 */ } },
      });
    }
    return el;
  });
  class VideoController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    start() { if (this._api) this._api.play(); }
    pause() { if (this._api) this._api.pause(); }
    stop() { if (this._api) this._api.stop(); }
    requestFullscreen() { layoutWarnings.push('VideoController.requestFullscreen 未实现'); }
    exitFullscreen() { layoutWarnings.push('VideoController.exitFullscreen 未实现'); }
  }
