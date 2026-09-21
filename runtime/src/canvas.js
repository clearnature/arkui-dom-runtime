  // ────────────────── 表层类：Canvas（R31）──────────────────
  //
  // 产物形态（实测 fixtures/pages/CanvasDemo.ts）：
  //   Canvas.create(this.context);           ← create 参数是 CanvasRenderingContext2D 对象
  //   Canvas.width/height; Canvas.onReady(cb);   ← 绘制必须等 onReady（JSDoc："perform any
  //     drawing after this event is triggered, not the onAttach event"）
  //   const ctx = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  //   ctx.fillStyle/fillRect/getImageData/toDataURL —— CanvasRenderer 通用 2D 面（fillRect/
  //     fillText/strokeRect/clearRect/arc… 全是标准 Canvas 2D 方法，.d.ts 原文同 Web）
  //
  // DOM 映射：手写 Canvas → 原生 <canvas>；ctx 对象**转发**到原生 2D context——
  // fillRect/像素/toDataURL 都是浏览器真画，getImageData 像素断言天然有牙齿。
  // ctx 先于 Canvas 创建（用户字段初始化），Canvas.create 时"交接"原生 context；
  // onReady 的派发时机：create → .width/.height 应用完 → setTimeout(0)（坑 ⑧：不用 rAF），
  // 因为 onReady 同步派发时画布还没有尺寸。
  const CanvasRenderingContext2D = class {
    constructor(settings) {
      this.__arkuiSettings = settings;       // antialias/alpha 在浏览器 2D 里无对应开关（取舍已记录）
      this.__arkuiCanvas = null;
      this.__arkuiNative = null;
    }
    // Canvas 组件绑定时调用：把原生 2D context 借给它
    __arkuiAttach(canvasEl) {
      this.__arkuiCanvas = canvasEl;
      this.__arkuiNative = canvasEl.getContext('2d');
      return this.__arkuiNative;
    }
    get fillStyle() { return this.__arkuiNative ? this.__arkuiNative.fillStyle : undefined; }
    set fillStyle(v) { if (this.__arkuiNative) this.__arkuiNative.fillStyle = String(v); }
    get strokeStyle() { return this.__arkuiNative ? this.__arkuiNative.strokeStyle : undefined; }
    set strokeStyle(v) { if (this.__arkuiNative) this.__arkuiNative.strokeStyle = String(v); }
    get font() { return this.__arkuiNative ? this.__arkuiNative.font : undefined; }
    set font(v) { if (this.__arkuiNative) this.__arkuiNative.font = String(v); }
    get lineWidth() { return this.__arkuiNative ? this.__arkuiNative.lineWidth : undefined; }
    set lineWidth(v) { if (this.__arkuiNative) this.__arkuiNative.lineWidth = Number(v); }
    get globalAlpha() { return this.__arkuiNative ? this.__arkuiNative.globalAlpha : undefined; }
    set globalAlpha(v) { if (this.__arkuiNative) this.__arkuiNative.globalAlpha = Number(v); }
    fillRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.fillRect(x, y, w, h); }
    strokeRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.strokeRect(x, y, w, h); }
    clearRect(x, y, w, h) { if (this.__arkuiNative) this.__arkuiNative.clearRect(x, y, w, h); }
    fillText(t, x, y, w) { if (this.__arkuiNative) this.__arkuiNative.fillText(String(t), x, y, w); }
    strokeText(t, x, y, w) { if (this.__arkuiNative) this.__arkuiNative.strokeText(String(t), x, y, w); }
    beginPath() { if (this.__arkuiNative) this.__arkuiNative.beginPath(); }
    closePath() { if (this.__arkuiNative) this.__arkuiNative.closePath(); }
    moveTo(x, y) { if (this.__arkuiNative) this.__arkuiNative.moveTo(x, y); }
    lineTo(x, y) { if (this.__arkuiNative) this.__arkuiNative.lineTo(x, y); }
    arc(x, y, r, a0, a1) { if (this.__arkuiNative) this.__arkuiNative.arc(x, y, r, a0, a1); }
    fill() { if (this.__arkuiNative) this.__arkuiNative.fill(); }
    stroke() { if (this.__arkuiNative) this.__arkuiNative.stroke(); }
    getImageData(sx, sy, sw, sh) { return this.__arkuiNative ? this.__arkuiNative.getImageData(sx, sy, sw, sh) : null; }
    putImageData(img, x, y) { if (this.__arkuiNative) this.__arkuiNative.putImageData(img, x, y); }
    toDataURL(type, quality) {
      return this.__arkuiCanvas ? this.__arkuiCanvas.toDataURL(type, quality) : '';
    }
  };
  const RenderingContextSettings = class RenderingContextSettings {
    constructor(antialias, alpha) {
      this.antialias = !!antialias;
      this.alpha = alpha === undefined ? true : !!alpha;   // .d.ts 默认 true
    }
  };

  // Canvas：create 时拿 ctx 对象绑定；尺寸由通用 .width/.height 应用后，同步到 canvas 的
  // 内容尺寸（width/height 属性 = CSS 尺寸 1:1，vp→px 本项目一贯近似）；onReady 在
  // 属性应用完之后派发（setTimeout(0)）——绘制必须等它（.d.ts 原文）
  const Canvas = ensureComponent('Canvas', (args) => {
    const el = document.createElement('canvas');
    el.__arkuiCanvasFlag = true;
    el.__arkuiCanvasCtx = args && args[0] && args[0].__arkuiAttach ? args[0] : null;
    el.__arkuiOnReadyCbs = [];
    if (el.__arkuiCanvasCtx) el.__arkuiCanvasCtx.__arkuiAttach(el);   // 原生 2D context 在此交接
    return el;
  });
  // Canvas 的属性分派：onReady 是函数值（拦在通用 on* 规则之前，否则变成 'ready' DOM 监听——
  // 原生 canvas 不会自发派发 ready），create-args 无需处理
  const CANVAS_ATTRS = {
    onReady: (n, v) => {
      n.__arkuiCanvasOnReady = v;
      if (n.__arkuiReadyScheduled) return;   // 覆盖语义：cb 替换，调度只排一次
      n.__arkuiReadyScheduled = true;
      // 派发时机：.width/.height 应用完之后（setTimeout(0)，坑 ⑧）——同步派发时画布还没有尺寸；
      // 尺寸同步（CSS 尺寸 → canvas 内容尺寸，1:1）必须在绘制开始前完成
      setTimeout(() => {
        const w = n.offsetWidth;
        const h = n.offsetHeight;
        if (w > 0) n.width = w;
        if (h > 0) n.height = h;
        if (typeof n.__arkuiCanvasOnReady === 'function') {
          try { n.__arkuiCanvasOnReady(); }
          catch (e) { layoutWarnings.push(`Canvas.onReady 抛错：${e && e.message}`); }
        }
      }, 0);
    },
    enableAnalyzer: (n, v) => { n.dataset.enableAnalyzer = String(v); },
  };
