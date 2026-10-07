  // ══════════ batch-media（R66）：ContainerSpan / ImageSpan / RichText /
  //            SymbolGlyph / SymbolSpan / Web ══════════
  //
  // 产物形态（实测 fixtures/pages/BatchMediaDemo.ts）：
  //   Text() { ContainerSpan() { Span('A'); ImageSpan('…png'); } }
  //     .textBackgroundStyle({ color: '#ffe0b2', radius: 6 });
  //   SymbolGlyph($r('sys.symbol.ohos_wifi')).fontSize(24).fontColor(['#f00'])
  //     .renderingStrategy(SymbolRenderingStrategy.SINGLE)
  //     .effectStrategy(SymbolEffectStrategy.SCALE);
  //   RichText('<p>hi</p>').onStart(cb).onComplete(cb);
  //   Web({ src: '…', controller: new WebController() }).onPageBegin(cb).onPageEnd(cb);
  //
  // 真机语义与 DOM 映射：
  //   · ContainerSpan（container_span.d.ts:52-78）——Text 的内联子段，只支持
  //     textBackgroundStyle（TextBackgroundStyle = { color?, radius? }，span.d.ts:28-45），
  //     统一管理内部多个 Span/ImageSpan 的背景与圆角 → <span>（display:inline）+
  //     background-color/border-radius。子项未自设背景时视觉透出包裹层背景（CSS 天然成立）。
  //   · ImageSpan（image_span.d.ts:66-169）——Text 内联图 → <span>（inline-block，
  //     vertical-align 默认 BOTTOM，JSDoc 原话）内含 <img>；objectFit → CSS object-fit；
  //     colorFilter 的 4x5 矩阵无法用 CSS filter 表达 → data-* + 诊断；onComplete 载荷用
  //     真实解码尺寸（naturalWidth/Height）；onError → img error。坑 ⑧ 收口：load 可能晚于
  //     onComplete 属性挂载——回调经状态袋间接引用 + complete 已成立时补派发。
  //   · RichText（rich_text.d.ts:29-77）——HTML 内容独立渲染上下文 → <iframe srcdoc>；
  //     sandbox="allow-same-origin"（不给 allow-scripts，与真机"独立上下文"一致，
  //     又允许测试读 contentDocument）；onStart 在内容装载开始时派发、onComplete 挂在
  //     iframe load 事件上。内容变化（重渲染）经 contentUpdater diff 更新 srcdoc。
  //   · SymbolGlyph / SymbolSpan（symbolglyph.d.ts:618+ / symbol_span.d.ts:65-187）——
  //     符号图标 → 文本元素，textContent = 符号名（浏览器没有 HM Symbol 字体，
  //     显示名字本身 = 如实降级且可断言）；fontColor 数组按 renderingStrategy 取第一层
  //     （SINGLE 本来就只应用第一色；MULTIPLE_COLOR/MULTIPLE_OPACITY 的分层着色
  //     无法在纯文本上表达 → 记 data-* + 诊断）；effectStrategy=SCALE 给一次性 CSS
  //     缩放动画，HIERARCHICAL 记诊断。SymbolSpan 是 Text 内联子段（<span>），
  //     未设置的字体属性继承父 Text（d.ts NOTE：inherits from its parent Text——CSS 继承天然成立）。
  //   · Web（web.d.ts:3446 WebOptions{src,controller} / 5814+ WebAttribute）——
  //     → <iframe>（无 sandbox：真机 Web 可执行 JS）；src → iframe.src；加载生命周期
  //     桥接：onPageBegin（src 赋值时登记 pending，load 时补派发，保证 begin 先于 end）、
  //     onPageEnd/onLoadFinished（iframe load）、onProgressChange({newProgress:100}
  //     ——DOM 观测不到渐进进度，只在完成时派发终值）、onTitleReceive（同源才读得到
  //     contentDocument.title）、onErrorReceive（iframe error，极少触发）。
  //     布尔开关族（javaScriptAccess/domStorageAccess/…）逐项落 data-*；userAgent/
  //     initialScale/textZoomRatio/javaScriptProxy/javaScriptOnDocument* 无法作用于
  //     原生 iframe → data-* + 诊断。WebController（web.d.ts:3216，deprecated but valid）
  //     loadUrl/refresh/backward/forward/accessBackward/runJavaScript/stop 映射到
  //     iframe 同源 API（try/catch 兜底跨域）；clearHistory/getCookieManager 等无法
  //     实现的显式记诊断，不静默假装成功。

  // ── Resource / 字符串 → 符号名（SymbolGlyph/SymbolSpan 共用）──
  // $r('sys.symbol.x') 的最小形态是 { id, params: ['sys.symbol.x'] }：名字在 params[0]，
  // 必须先于 resolveResource 查表（查表只会把它换成数字 id，名字就丢了）。
  /** @param {any} v */
  const symbolNameOf = (v) => {
    if (v === undefined || v === null) return '';
    // 名字在原始资源的 params[0]，必须【先于】resolveResource 检查——
    // resolveResource 对带 id/type 的对象直接查表，查不到会把整个资源换成 undefined
    if (v && typeof v === 'object' && Array.isArray(v.params) && typeof v.params[0] === 'string') {
      return v.params[0];
    }
    const r = resolveResource(v);
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object') {
      if (r.id !== undefined) return String(r.id);
    }
    return '';
  };
  // 符号缩放动画的 keyframes 只注入一次（同 LoadingProgress 的 keyframes 做法）
  const ensureSymbolKeyframes = () => {
    if (!document.getElementById('arkui-symbol-keyframes')) {
      const st = document.createElement('style');
      st.id = 'arkui-symbol-keyframes';
      st.textContent = '@keyframes arkuiSymScale{0%,100%{transform:scale(1)}50%{transform:scale(0.5)}}';
      document.head.appendChild(st);
    }
  };
  // SymbolEffectStrategy（symbolglyph.d.ts:118-152）：NONE=0 / SCALE=1 / HIERARCHICAL=2
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_STRATEGY = { NONE: 0, SCALE: 1, HIERARCHICAL: 2 };
  // SymbolRenderingStrategy（symbolglyph.d.ts:55-106）：SINGLE=0 / MULTIPLE_COLOR=1 / MULTIPLE_OPACITY=2
  /** @type {Record<string, number>} */
  const SYMBOL_RENDERING_STRATEGY = { SINGLE: 0, MULTIPLE_COLOR: 1, MULTIPLE_OPACITY: 2 };
  // EffectScope / EffectDirection / EffectFillStyle / ReplaceEffectType（symbolglyph.d.ts:163-310）
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_SCOPE = { LAYER: 0, WHOLE: 1 };
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_DIRECTION = { DOWN: 0, UP: 1 };
  /** @type {Record<string, number>} */
  const SYMBOL_EFFECT_FILL_STYLE = { OPACITY: 0, COLOR: 1, GRADIENT: 2 };
  /** @type {Record<string, number>} */
  const SYMBOL_REPLACE_EFFECT_TYPE = { DIRECT: 0, CROSS_FADE: 1 };
  // 符号字体属性族（SymbolGlyph / SymbolSpan 共用实现）
  /** @param {any} n @param {any} v */
  const symFontSize = (n, v) => { n.style.fontSize = `${dimOf(v, 16)}px`; };
  /** @param {any} n @param {any} v */
  const symFontColor = (n, v) => {
    const arr = Array.isArray(v) ? v : [v];
    const w = n.__sym;
    if (w) w.colors = arr;
    if (arr.length > 0) n.style.color = colorOf(arr[0]);    // 单色模式：只应用第一色
    n.dataset.fontColorLayers = String(arr.length);
  };
  /** @param {any} n @param {any} v */
  const symFontWeight = (n, v) => { n.style.fontWeight = String(resolveResource(v)); };
  /** @param {any} n @param {any} v */
  const symEffectStrategy = (n, v) => {
    const k = Number(resolveResource(v));
    n.dataset.effectStrategy = String(k);
    if (k === SYMBOL_EFFECT_STRATEGY.SCALE) {
      ensureSymbolKeyframes();
      n.style.animation = 'arkuiSymScale 0.6s ease-in-out 1';   // 一次性整体缩放
    } else if (k === SYMBOL_EFFECT_STRATEGY.HIERARCHICAL) {
      // 分层透明度动效需要逐层节点，纯文本降级无法表达
      layoutWarnings.push('Symbol 组件 effectStrategy=HIERARCHICAL 的分层动效未实现（记 data-effectStrategy）');
    }
  };
  /** @param {any} n @param {any} v */
  const symRenderingStrategy = (n, v) => {
    const k = Number(resolveResource(v));
    n.dataset.renderingStrategy = String(k);
    const w = n.__sym;
    if (w) w.renderingStrategy = k;
    if (k !== SYMBOL_RENDERING_STRATEGY.SINGLE) {
      // MULTIPLE_COLOR（最多三层配色）/ MULTIPLE_OPACITY（100%/50%/20% 分层透明度）
      // 都要逐层节点着色，纯文本降级只应用第一层
      layoutWarnings.push('Symbol 组件 renderingStrategy 的分层着色未实现，只应用第一层色（记 data-renderingStrategy）');
    }
  };
  /** @param {any} n @param {any} v */
  const symSymbolEffect = (n, v) => {
    const name = v && v.constructor && v.constructor.name ? v.constructor.name : String(v);
    n.dataset.symbolEffect = name;
    layoutWarnings.push(`Symbol 组件 symbolEffect(${name}) 的对象式动效 API 未实现（记 data-symbolEffect）`);
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SYMBOLGLYPH_ATTRS = {
    fontSize: symFontSize,
    fontColor: symFontColor,
    fontWeight: symFontWeight,
    effectStrategy: symEffectStrategy,
    renderingStrategy: symRenderingStrategy,
    symbolEffect: symSymbolEffect,
    // minFontScale/maxFontScale/symbolShadow/shaderStyle 落通用 data-*（无 DOM 对应物）
  };

  // ── ① ContainerSpan（container_span.d.ts）：Text 内联背景/圆角包裹层 ──
  // TextBackgroundStyle.radius 是 Dimension | BorderRadiuses（span.d.ts:40-45）：后者按四角展开
  /** @param {any} n @param {any} v */
  const applyTextBackground = (n, v) => {
    const o = (v && typeof v === 'object' && v) || {};
    if (o.color !== undefined) n.style.backgroundColor = colorOf(o.color);
    const r = o.radius;
    if (r !== undefined && r !== null && typeof r === 'object' && !Array.isArray(r)) {
      n.style.borderRadius = `${dimOf(r.topLeft, 0)}px ${dimOf(r.topRight, 0)}px`
        + ` ${dimOf(r.bottomRight, 0)}px ${dimOf(r.bottomLeft, 0)}px`;
    } else if (r !== undefined && r !== null) {
      n.style.borderRadius = toCssSize(r);
    }
    try { n.dataset.textBackgroundStyle = JSON.stringify(v); }
    catch (e) { n.dataset.textBackgroundStyle = String(v); }
  };
  const ContainerSpan = ensureComponent('ContainerSpan', () => {
    const el = document.createElement('span');
    (/** @type {any} */ (el)).__arkuiContainerSpan = true;
    el.dataset.containerSpan = '';
    el.style.display = 'inline';            // 内联子段：不参与 Text 的行内断行布局
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CONTAINERSPAN_ATTRS = {
    textBackgroundStyle: applyTextBackground,
  };

  // ── ② ImageSpan（image_span.d.ts）：Text 内联图 ──
  // ImageSpanAlignment（enums.d.ts:3635-3686）：BASELINE=0 / BOTTOM=1 / CENTER=2 / TOP=3 /
  // FOLLOW_PARAGRAPH=4（跟随父 Text 的对齐 = 清掉自身设置）
  /** @type {Record<string, number>} */
  const IMAGESPAN_ALIGNMENT = { BASELINE: 0, BOTTOM: 1, CENTER: 2, TOP: 3, FOLLOW_PARAGRAPH: 4 };
  /** @type {Record<string, string>} */
  const IMAGESPAN_VALIGN_CSS = { 0: 'baseline', 1: 'bottom', 2: 'middle', 3: 'top' };
  // ImageFit → CSS（Contain=0/Cover=1/Fill=3/ScaleDown=4/None=5；Auto=2 如实不映射）
  /** @type {Record<string, string>} */
  const IMAGESPAN_FIT_CSS = { 0: 'contain', 1: 'cover', 3: 'fill', 4: 'scale-down', 5: 'none' };
  const ImageSpan = ensureComponent('ImageSpan', (args) => {
    const el = document.createElement('span');
    (/** @type {any} */ (el)).__arkuiImageSpan = true;
    el.dataset.imageSpan = '';
    // inline-block 才能 width/height/object-fit；vertical-align 默认 BOTTOM（JSDoc 原话）
    el.style.display = 'inline-block';
    el.style.verticalAlign = 'bottom';
    el.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.setAttribute('data-arkui-imagespan-img', '');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.display = 'block';
    const src = args && args[0] !== undefined && args[0] !== null ? resolveResource(args[0]) : null;
    if (src != null) img.src = String(src);
    el.appendChild(img);
    const w = /** @type {any} */ (el).__imgs = /** @type {any} */ ({ img, cbs: {}, loaded: false, failed: false, fired: false });
    // 事件收口（坑 ⑧）：回调经 __imgs.cbs 间接引用（覆盖语义）；补派发只跑一次
    w.tryFire = () => {
      if (w.fired) return;
      if (!w.loaded && !w.failed) return;
      w.fired = true;
      if (w.loaded) {
        const cb = w.cbs.complete;
        if (typeof cb === 'function') {
          setTimeout(() => {
            try {
              const cr = img.getBoundingClientRect();
              const er = el.getBoundingClientRect();
              // ImageLoadResult（image_span.d.ts:216-344）：宽高用真实解码尺寸（px），
              // contentOffset 置 0（DOM 的 object-fit 模型下内容从盒子左上角起）
              cb({
                width: img.naturalWidth, height: img.naturalHeight,
                componentWidth: er.width, componentHeight: er.height,
                loadingStatus: 1,                       // 1 = 成功解码（JSDoc 原话）
                contentWidth: cr.width, contentHeight: cr.height,
                contentOffsetX: 0, contentOffsetY: 0,
              });
            } catch (e) { layoutWarnings.push(`ImageSpan.onComplete 回调抛错：${e && e.message}`); }
          }, 0);
        }
      } else {
        const cb = w.cbs.error;
        if (typeof cb === 'function') {
          setTimeout(() => {
            try { cb({ name: 'ImageSpan', message: `load failed: ${img.src}` }); }
            catch (e) { layoutWarnings.push(`ImageSpan.onError 回调抛错：${e && e.message}`); }
          }, 0);
        }
      }
    };
    img.addEventListener('load', () => { w.loaded = true; w.tryFire(); });
    img.addEventListener('error', () => { w.failed = true; w.tryFire(); });
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const IMAGESPAN_ATTRS = {
    verticalAlign: (n, v) => {
      const k = Number(resolveResource(v));
      n.dataset.verticalAlign = String(k);
      const css = IMAGESPAN_VALIGN_CSS[k];
      if (css) n.style.verticalAlign = css;
      else if (k === IMAGESPAN_ALIGNMENT.FOLLOW_PARAGRAPH) n.style.verticalAlign = '';
    },
    objectFit: (n, v) => {
      const fit = Number(resolveResource(v));
      n.dataset.objectFit = String(fit);
      const css = IMAGESPAN_FIT_CSS[fit];
      const w = /** @type {any} */ (n).__imgs;
      if (css && w && w.img) w.img.style.objectFit = css;
    },
    colorFilter: (n, v) => {
      try { n.dataset.colorFilter = JSON.stringify(v); }
      catch (e) { n.dataset.colorFilter = '1'; }
      layoutWarnings.push('ImageSpan.colorFilter 的 4x5 矩阵未映射为 CSS filter（记 data-colorFilter）');
    },
    alt: (n, v) => {
      // 真机 alt 是 PixelMap（image_span.d.ts:168）；DOM 无 PixelMap，只如实记录
      const r = resolveResource(v);
      n.dataset.alt = typeof r === 'string' ? r : String(v);
    },
    supportSvg2: (n, v) => { n.dataset.supportSvg2 = String(v === true); },
    onComplete: (n, v) => {
      const w = /** @type {any} */ (n).__imgs;
      if (!w) return;
      w.cbs.complete = v;
      w.tryFire();                              // 图已在缓存里完成时补派发
    },
    onError: (n, v) => {
      const w = /** @type {any} */ (n).__imgs;
      if (!w) return;
      w.cbs.error = v;
      w.tryFire();
    },
    textBackgroundStyle: applyTextBackground,   // BaseSpan 家族属性（span.d.ts:49-66）
  };

  // ── ③ RichText（rich_text.d.ts）：HTML 内容 → <iframe srcdoc> ──
  /** HTML 内容 → 解析后的纯文本（真机内嵌 Web 的 a11y 文本口径）。DOMParser 文档
   *  不加载资源、不执行脚本，比 innerHTML 副作用干净。 */
  const richTextParsedText = (/** @type {any} */ html) => {
    try { return new DOMParser().parseFromString(html, 'text/html').documentElement.textContent || ''; }
    catch (e) { return ''; }
  };
  /** @param {any} el @param {any} content */
  const applyRichTextContent = (el, content) => {
    const w = /** @type {any} */ (el).__richTxt;
    if (!w) return;
    const s = content === undefined || content === null ? '' : String(resolveResource(content));
    w.lastContent = s;
    w.started = true;
    // onStart 延后一拍派发，且【派发时才读回调】——属性此刻还没挂上，提前捕获必丢（坑 ⑧）
    setTimeout(() => {
      const cbStart = w.cbs.start;
      if (typeof cbStart === 'function') {
        try { cbStart(); }
        catch (e) { layoutWarnings.push(`RichText.onStart 回调抛错：${e && e.message}`); }
      }
    }, 0);
    // 相同内容重赋 srcdoc 会触发整页重载——diff 掉
    if (w.frame.getAttribute('srcdoc') !== s) w.frame.setAttribute('srcdoc', s);
    // a11y 双文本同步（照真机：①原始内容串 ②解析纯文本，顺序同设备流）
    if (w.rawA11y) w.rawA11y.textContent = s;
    if (w.parsedA11y) w.parsedA11y.textContent = richTextParsedText(s);
  };
  const RichText = ensureComponent('RichText', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiRichText = true;
    el.dataset.richText = '';
    el.style.position = 'relative';
    el.style.width = '100%';
    const frame = document.createElement('iframe');
    frame.setAttribute('data-arkui-richtext-frame', '');
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = 'none';
    frame.style.display = 'block';
    // allow-same-origin：让测试能读 contentDocument 断言渲染结果；
    // 不给 allow-scripts——真机 RichText 的 HTML 跑在独立上下文
    frame.setAttribute('sandbox', 'allow-same-origin');
    el.appendChild(frame);
    const w = /** @type {any} */ (el).__richTxt = /** @type {any} */ ({ frame, cbs: {}, lastContent: null, started: false });
    // R166 续（第六端对拍 pages/BatchVerifyDemo，设备 dumpLayout=权威）：真机 a11y
    // 树对 RichText 报两条文本 —— ①原始内容串（HTML 字面量转义形态 '<b>rt</b>'，
    // text/originalText 口径）②内嵌 Web 解析后的纯文本（'rt'）。iframe 跨文档内容
    // 不进宿主文本流，两条 a11y 文本用 sr-only 文本节点承载（clip 隐藏而非
    // display:none —— hm-harness 采集循环只跳 display:none/visibility:hidden；
    // 视觉仍只有 iframe 渲染的富文本）。顺序照设备流：原始串在前、解析文本在后。
    const srOnly = {
      position: 'absolute', width: '1px', height: '1px',
      overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
    };
    const rawA11y = document.createElement('span');
    rawA11y.setAttribute('data-arkui-richtext-raw', '');
    Object.assign(rawA11y.style, srOnly);
    const parsedA11y = document.createElement('span');
    parsedA11y.setAttribute('data-arkui-richtext-text', '');
    Object.assign(parsedA11y.style, srOnly);
    el.appendChild(rawA11y);
    el.appendChild(parsedA11y);
    w.rawA11y = rawA11y;
    w.parsedA11y = parsedA11y;
    applyRichTextContent(el, args && args[0]);
    // load 挂在首份内容装载之后（避免 about:blank 的首次空 load 误派发 onComplete）
    frame.addEventListener('load', () => {
      if (!w.started) return;
      const cbDone = w.cbs.complete;
      if (typeof cbDone === 'function') {
        setTimeout(() => {
          try { cbDone(); }
          catch (e) { layoutWarnings.push(`RichText.onComplete 回调抛错：${e && e.message}`); }
        }, 0);
      }
    });
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    const content = args && args[0];
    const s = content === undefined || content === null ? '' : String(resolveResource(content));
    const w = /** @type {any} */ (node).__richTxt;
    if (w && w.lastContent !== s) applyRichTextContent(node, content);
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const RICHTEXT_ATTRS = {
    onStart: (n, v) => {
      const w = /** @type {any} */ (n).__richTxt;
      if (w) w.cbs.start = v;
    },
    onComplete: (n, v) => {
      const w = /** @type {any} */ (n).__richTxt;
      if (w) w.cbs.complete = v;
    },
  };

  // ── ④ SymbolGlyph（symbolglyph.d.ts）：独立符号图标 ──
  const SymbolGlyph = ensureComponent('SymbolGlyph', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiSymbolGlyph = true;
    el.dataset.symbolGlyph = '';
    /** @type {any} */ (el).__sym = /** @type {any} */ ({ renderingStrategy: 0, colors: null });
    const name = symbolNameOf(args && args[0]);
    if (name) {
      el.dataset.symbol = name;
      // 浏览器没有 HM Symbol 字体：符号名作为可见文本 = 如实降级 + 可断言
      el.textContent = name;
    } else if (args && args[0] !== undefined) {
      el.dataset.symbolSrc = String(args[0]);   // 解析不出名字的资源：记原始引用
    }
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    return el;
  });

  // ── ⑤ SymbolSpan（symbol_span.d.ts）：Text 内联符号子段 ──
  // d.ts NOTE：未设置的属性继承父 Text——DOM 里不设 inline 样式即天然继承
  const SymbolSpan = ensureComponent('SymbolSpan', (args) => {
    const el = document.createElement('span');
    (/** @type {any} */ (el)).__arkuiSymbolSpan = true;
    el.dataset.symbolSpan = '';
    /** @type {any} */ (el).__sym = /** @type {any} */ ({ renderingStrategy: 0, colors: null });
    const name = symbolNameOf(args && args[0]);
    if (name) {
      el.dataset.symbol = name;
      el.textContent = name;                    // 同 SymbolGlyph 的如实降级
    } else if (args && args[0] !== undefined) {
      el.dataset.symbolSrc = String(args[0]);
    }
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SYMBOLSPAN_ATTRS = {
    fontSize: symFontSize,
    fontColor: symFontColor,
    fontWeight: symFontWeight,
    effectStrategy: symEffectStrategy,
    renderingStrategy: symRenderingStrategy,
  };

  // ── ⑥ Web（web.d.ts）：<iframe> 垫片 + WebController ──
  /** @param {string} key */
  const webFlag = (key) => (/** @type {any} */ n, /** @type {any} */ v) => {
    n.dataset[key] = String(!!resolveResource(v));
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const WEB_ATTRS = {
    // 布尔开关族：DOM iframe 无逐项对应物，逐项落 data-*（不静默丢失）
    javaScriptAccess: webFlag('javaScriptAccess'),
    domStorageAccess: webFlag('domStorageAccess'),
    fileAccess: webFlag('fileAccess'),
    onlineImageAccess: webFlag('onlineImageAccess'),
    imageAccess: webFlag('imageAccess'),
    zoomAccess: webFlag('zoomAccess'),
    multiWindowAccess: webFlag('multiWindowAccess'),
    databaseAccess: webFlag('databaseAccess'),
    geolocationAccess: webFlag('geolocationAccess'),
    mediaPlayGestureAccess: webFlag('mediaPlayGestureAccess'),
    overviewModeAccess: webFlag('overviewModeAccess'),
    verticalScrollBarAccess: webFlag('verticalScrollBarAccess'),
    horizontalScrollBarAccess: webFlag('horizontalScrollBarAccess'),
    blockNetwork: webFlag('blockNetwork'),
    wideViewModeAccess: webFlag('wideViewModeAccess'),
    cacheMode: (n, v) => { n.dataset.cacheMode = String(Number(resolveResource(v))); },
    darkMode: (n, v) => {
      n.dataset.darkMode = String(resolveResource(v));
      layoutWarnings.push('Web.darkMode 无法作用于原生 iframe（记 data-darkMode）');
    },
    forceDarkAccess: (n, v) => {
      n.dataset.forceDarkAccess = String(!!v);
      layoutWarnings.push('Web.forceDarkAccess 无法作用于原生 iframe（记 data-forceDarkAccess）');
    },
    userAgent: (n, v) => {
      n.dataset.userAgent = String(resolveResource(v));
      layoutWarnings.push('Web.userAgent 无法作用于原生 iframe（记 data-userAgent）');
    },
    initialScale: (n, v) => {
      n.dataset.initialScale = String(resolveResource(v));
      layoutWarnings.push('Web.initialScale 无法作用于原生 iframe（记 data-initialScale）');
    },
    textZoomRatio: (n, v) => {
      n.dataset.textZoomRatio = String(resolveResource(v));
      layoutWarnings.push('Web.textZoomRatio 无法作用于原生 iframe（记 data-textZoomRatio）');
    },
    javaScriptProxy: (n, v) => {
      try { n.dataset.javaScriptProxy = JSON.stringify(v && v.name ? v.name : v); }
      catch (e) { n.dataset.javaScriptProxy = '1'; }
      layoutWarnings.push('Web.javaScriptProxy 无法注入原生 iframe（记 data-javaScriptProxy）');
    },
    javaScriptOnDocumentStart: (n, v) => {
      n.dataset.javaScriptOnDocumentStart = String(typeof v === 'function' ? 'fn' : v);
      layoutWarnings.push('Web.javaScriptOnDocumentStart 无法注入原生 iframe（记 data-*）');
    },
    javaScriptOnDocumentEnd: (n, v) => {
      n.dataset.javaScriptOnDocumentEnd = String(typeof v === 'function' ? 'fn' : v);
      layoutWarnings.push('Web.javaScriptOnDocumentEnd 无法注入原生 iframe（记 data-*）');
    },
    // ── 加载生命周期（函数值抢在通用 on* 规则之前，坑 86）──
    onPageBegin: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (!w) return;
      w.cbs.pageBegin = v;
      // src 赋值时登记的 pendingBegin：回调挂上后补派发（已由 load 派发过则 pending 为空）
      if (w.pendingBegin) {
        setTimeout(() => {
          if (!w.pendingBegin) return;
          const ev = w.pendingBegin;
          w.pendingBegin = null;
          try { w.cbs.pageBegin(ev); }
          catch (e) { layoutWarnings.push(`Web.onPageBegin 回调抛错：${e && e.message}`); }
        }, 0);
      }
    },
    onPageEnd: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.pageEnd = v;
    },
    onLoadStarted: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.loadStarted = v;
    },
    onLoadFinished: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.loadFinished = v;
    },
    onProgressChange: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.progressChange = v;
    },
    onTitleReceive: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.titleReceive = v;
    },
    onErrorReceive: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (w) w.cbs.errorReceive = v;
    },
    onControllerAttached: (n, v) => {
      const w = /** @type {any} */ (n).__web;
      if (!w) return;
      w.cbs.controllerAttached = v;
      // 真机在 controller 绑定后触发；DOM 里 create 与属性链同一 tick，
      // 延后一拍保证回调已挂上（坑 ⑧）
      setTimeout(() => {
        const cb = w.cbs.controllerAttached;
        if (typeof cb === 'function') {
          try { cb(); }
          catch (e) { layoutWarnings.push(`Web.onControllerAttached 回调抛错：${e && e.message}`); }
        }
      }, 0);
    },
  };
  const Web = ensureComponent('Web', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiWeb = true;
    el.dataset.web = '';
    el.style.position = 'relative';
    const frame = document.createElement('iframe');
    frame.setAttribute('data-arkui-web-frame', '');
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = 'none';
    frame.style.display = 'block';
    el.appendChild(frame);
    const w = /** @type {any} */ (el).__web = /** @type {any} */ ({ frame, cbs: {}, url: '', pendingBegin: null });
    /** @param {any} k @param {any} payload */
    const fire = (k, payload) => {
      const cb = w.cbs[k];
      if (typeof cb !== 'function') return;
      try { cb(payload); }
      catch (e) { layoutWarnings.push(`Web.${k} 回调抛错：${e && e.message}`); }
    };
    /** @param {any} rawUrl */
    const loadTo = (rawUrl) => {
      const url = String(resolveResource(rawUrl));
      w.url = url;
      w.pendingBegin = { url };
      frame.src = url;
      el.dataset.src = url;
      const cbStart = w.cbs.loadStarted;
      if (typeof cbStart === 'function') {
        setTimeout(() => {
          try { cbStart({ url }); }
          catch (e) { layoutWarnings.push(`Web.onLoadStarted 回调抛错：${e && e.message}`); }
        }, 0);
      }
    };
    w.loadTo = loadTo;
    // 加载生命周期桥：iframe load → begin(补) → end → finished → progress(100) → title
    frame.addEventListener('load', () => {
      if (w.pendingBegin) {
        const ev = w.pendingBegin;
        w.pendingBegin = null;
        fire('pageBegin', ev);
      }
      fire('pageEnd', { url: w.url });
      fire('loadFinished', { url: w.url });
      // DOM 观测不到渐进加载进度，只在完成时派发终值 100
      fire('progressChange', { newProgress: 100 });
      let title = null;
      try { title = frame.contentDocument ? frame.contentDocument.title : null; } catch (e) { title = null; }
      if (title) fire('titleReceive', { title, isRealTitle: true });
    });
    frame.addEventListener('error', () => {
      // OnErrorReceiveEvent 的 request/response 形态拿不到，给最小载荷
      fire('errorReceive', { url: w.url });
    });
    if (o.src !== undefined && o.src !== null) loadTo(o.src);
    if (o.controller && typeof o.controller._bind === 'function') {
      o.controller._bind({
        /** @param {any} url */
        loadUrl(url) { loadTo(url); },
        /** @param {any} opts */
        loadData(opts) {
          const data = opts && opts.data !== undefined ? String(opts.data) : '';
          w.url = String((opts && opts.baseUrl) || 'about:blank');
          w.pendingBegin = { url: w.url };
          frame.setAttribute('srcdoc', data);
        },
        refresh() {
          try { w.frame.contentWindow.location.reload(); }
          catch (e) { w.frame.src = w.frame.src; }          // 跨域退化为整页重载
        },
        backward() {
          try { w.frame.contentWindow.history.back(); }
          catch (e) { layoutWarnings.push('WebController.backward: 跨域 iframe 历史不可控'); }
        },
        forward() {
          try { w.frame.contentWindow.history.forward(); }
          catch (e) { layoutWarnings.push('WebController.forward: 跨域 iframe 历史不可控'); }
        },
        /** @returns {boolean} */
        accessBackward() {
          try { return w.frame.contentWindow.history.length > 1; }
          catch (e) { return false; }
        },
        /** @returns {boolean} */
        accessForward() { return false; },                   // 前向历史 DOM 无法探测，保守 false
        /** @param {any} _step */
        accessStep(_step) { layoutWarnings.push('WebController.accessStep 未实现'); },
        clearHistory() { layoutWarnings.push('WebController.clearHistory 无法清除 iframe 历史（已忽略）'); },
        /** @param {any} _name */
        deleteJavaScriptRegister(_name) { /* 登记表随 iframe 重载天然失效 */ },
        /** @param {any} obj @param {any} name @param {any} _methods */
        registerJavaScriptProxy(obj, name, _methods) {
          w.jsProxy = { obj, name };
          layoutWarnings.push('WebController.registerJavaScriptProxy 无法注入沙箱 iframe（已登记）');
        },
        /** @param {any} script @returns {any} */
        runJavaScript(script) {
          try { return w.frame.contentWindow.eval(String(script)); }
          catch (e) {
            layoutWarnings.push(`WebController.runJavaScript 抛错：${e && e.message}`);
            return undefined;
          }
        },
        /** @returns {null} */
        getCookieManager() { layoutWarnings.push('WebController.getCookieManager 未实现'); return null; },
        /** @returns {number} */
        getHitTest() { layoutWarnings.push('WebController.getHitTest 未实现'); return 0; },
        requestFocus() {
          try { w.frame.contentWindow.focus(); }
          catch (e) { w.frame.focus(); }
        },
        onActive() { /* 前后台事件无 DOM 对应物 */ },
        onInactive() { /* 前后台事件无 DOM 对应物 */ },
        stop() {
          try { w.frame.contentWindow.stop(); }
          catch (e) { /* 旧引擎无 stop：静默 */ }
        },
        /** @param {any} _factor */
        zoom(_factor) { layoutWarnings.push('WebController.zoom 未实现（iframe 缩放不可控）'); },
      });
    }
    return el;
  });
  // WebController（web.d.ts:3216，API 8 deprecated，方法面与上面 _bind 的一一对应）
  class WebController {
    constructor() { this._api = null; }
    /** @param {any} api */
    _bind(api) { this._api = api; }
    /** @param {any} url */
    loadUrl(url) { if (this._api) this._api.loadUrl(url); }
    /** @param {any} opts */
    loadData(opts) { if (this._api) this._api.loadData(opts); }
    refresh() { if (this._api) this._api.refresh(); }
    backward() { if (this._api) this._api.backward(); }
    forward() { if (this._api) this._api.forward(); }
    /** @returns {boolean} */
    accessBackward() { return this._api ? !!this._api.accessBackward() : false; }
    /** @returns {boolean} */
    accessForward() { return this._api ? !!this._api.accessForward() : false; }
    /** @param {any} step */
    accessStep(step) { if (this._api) this._api.accessStep(step); }
    clearHistory() { if (this._api) this._api.clearHistory(); }
    /** @param {any} name */
    deleteJavaScriptRegister(name) { if (this._api) this._api.deleteJavaScriptRegister(name); }
    /** @param {any} obj @param {any} name @param {any} methods */
    registerJavaScriptProxy(obj, name, methods) { if (this._api) this._api.registerJavaScriptProxy(obj, name, methods); }
    /** @param {any} script @returns {any} */
    runJavaScript(script) { return this._api ? this._api.runJavaScript(script) : undefined; }
    /** @returns {null} */
    getCookieManager() { return this._api ? this._api.getCookieManager() : null; }
    /** @returns {number} */
    getHitTest() { return this._api ? this._api.getHitTest() : 0; }
    requestFocus() { if (this._api) this._api.requestFocus(); }
    onActive() { if (this._api) this._api.onActive(); }
    onInactive() { if (this._api) this._api.onInactive(); }
    stop() { if (this._api) this._api.stop(); }
    /** @param {any} factor */
    zoom(factor) { if (this._api) this._api.zoom(factor); }
  }
  // 枚举自由变量（产物里 `SymbolGlyph…(SymbolRenderingStrategy.SINGLE)` 这类引用）——
  // 与取值表同值（symbolglyph.d.ts:55-152 / enums.d.ts:3635-3686）
  const SymbolRenderingStrategy = { SINGLE: 0, MULTIPLE_COLOR: 1, MULTIPLE_OPACITY: 2 };
  const SymbolEffectStrategy = { NONE: 0, SCALE: 1, HIERARCHICAL: 2 };
  const EffectScope = { LAYER: 0, WHOLE: 1 };
  const EffectDirection = { DOWN: 0, UP: 1 };
  const EffectFillStyle = { OPACITY: 0, COLOR: 1, GRADIENT: 2 };
  const ReplaceEffectType = { DIRECT: 0, CROSS_FADE: 1 };
  const ImageSpanAlignment = { BASELINE: 0, BOTTOM: 1, CENTER: 2, TOP: 3, FOLLOW_PARAGRAPH: 4 };
  // SymbolEffect 族（symbolglyph.d.ts:312-616）：DOM 降级只记录构造参数，动效不实现
  class SymbolEffect { }
  class ScaleSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] @param {any} [direction] */
    constructor(scope, direction) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
      this.direction = direction === undefined ? EffectDirection.DOWN : direction;
    }
  }
  class HierarchicalSymbolEffect extends SymbolEffect {
    /** @param {any} [fillStyle] */
    constructor(fillStyle) {
      super();
      this.fillStyle = fillStyle === undefined ? EffectFillStyle.OPACITY : fillStyle;
    }
  }
  class AppearSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] */
    constructor(scope) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
    }
  }
  class DisappearSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] */
    constructor(scope) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
    }
  }
  class BounceSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] @param {any} [direction] */
    constructor(scope, direction) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
      this.direction = direction === undefined ? EffectDirection.DOWN : direction;
    }
  }
  class ReplaceSymbolEffect extends SymbolEffect {
    /** @param {any} [scope] @param {any} [replaceType] */
    constructor(scope, replaceType) {
      super();
      this.scope = scope === undefined ? EffectScope.LAYER : scope;
      this.replaceType = replaceType;
    }
  }
  class PulseSymbolEffect extends SymbolEffect { }
