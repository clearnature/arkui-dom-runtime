  // ────────────────── 信息展示类：Badge / Counter / Divider / Marquee（R28）──────────────────
  //
  // 产物形态（实测 fixtures/pages/ShowDemo.ts）：
  //   Badge.create({count: 9, position: BadgePosition.RightTop, style: {...}})
  //      | Badge.create({value: '99', ...})
  //     ⚠️ 数字重载用【count】、字符串重载用【value】（编译期实测：value: 9 编译就红）；
  //     ⚠️ style 在 create 参数里（BadgeParam.style 必填；BadgeAttribute 没有 .style() 方法）
  //   Counter.create();  Counter.onInc(cb);  Counter.onDec(cb);  Counter.enableInc/enableDec(bool)
  //   Divider.create();  Divider.vertical(bool);  Divider.color;  Divider.strokeWidth;  Divider.lineCap
  //   Marquee.create({src, start, loop});  Marquee.fontColor;  Marquee.fontSize;  onStart/onFinish
  //
  // 语义锚点（.d.ts JSDoc 原文）：
  //   BadgeStyle 默认：badgeColor Color.Red、color Color.White、fontSize 10vp、badgeSize 16vp、
  //     borderWidth 1vp；BadgePosition = { RightTop, Right, Left }（声明顺序，JSDoc 有名无数字 ——
  //     数值是本实现的枚举化，产物里只引用名字）
  //   Divider 默认：vertical false、color '#33182431'、strokeWidth 1px、lineCap LineCapStyle.Butt
  //   Marquee 默认：step 6、loop -1、fromStart true；MarqueeOptions 的 start 是必填（编译期实测）
  const BadgePosition = { RightTop: 0, Right: 1, Left: 2 };

  // Badge：容器（子内容照常挂进来）+ 绝对定位的角标。位置映射是 DOM 化选择（.d.ts 只有名字没数字）
  const Badge = ensureComponent('Badge', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const style = (o.style && typeof o.style === 'object' && o.style) || {};
    const root = document.createElement('div');
    root.__arkuiShow = 'Badge';
    root.style.display = 'inline-block';
    root.style.position = 'relative';
    const mark = document.createElement('div');
    mark.setAttribute('data-arkui-badge-mark', '');
    mark.style.position = 'absolute';
    mark.style.zIndex = '1';
    mark.style.display = 'inline-flex';
    mark.style.alignItems = 'center';
    mark.style.justifyContent = 'center';
    mark.style.borderRadius = '8px';
    mark.style.padding = '0 4px';
    mark.style.background = colorOf(style.badgeColor !== undefined ? style.badgeColor : 'red');
    mark.style.color = colorOf(style.color !== undefined ? style.color : '#ffffff');
    mark.style.fontSize = `${style.fontSize !== undefined ? dimOf(style.fontSize, 10) : 10}px`;
    const size = style.badgeSize !== undefined ? dimOf(style.badgeSize, 16) : 16;
    mark.style.minWidth = `${size}px`;
    mark.style.minHeight = `${size}px`;
    mark.style.boxSizing = 'border-box';
    if (style.borderWidth !== undefined) mark.style.borderWidth = `${dimOf(style.borderWidth, 1)}px`;
    if (style.borderColor !== undefined) mark.style.borderColor = colorOf(style.borderColor);
    mark.style.borderStyle = 'solid';
    if (style.fontWeight !== undefined) mark.style.fontWeight = String(resolveResource(style.fontWeight));
    // 位置：RightTop(0)/Right(1)/Left(2)，映射是 DOM 化选择
    const pos = o.position === undefined ? BadgePosition.RightTop : Number(o.position);
    root.dataset.badgePosition = pos === BadgePosition.Right ? 'Right' : pos === BadgePosition.Left ? 'Left' : 'RightTop';
    if (pos === BadgePosition.Right) {
      mark.style.right = '0';
      mark.style.top = '50%';
      mark.style.transform = 'translateY(-50%)';
    } else if (pos === BadgePosition.Left) {
      mark.style.left = '0';
      mark.style.top = '50%';
      mark.style.transform = 'translateY(-50%)';
    } else {
      mark.style.right = '0';
      mark.style.top = '0';
    }
    // 数字重载 count（超 maxCount 折叠成 "N+"）/ 字符串重载 value
    let text = '';
    if (o.count !== undefined && o.count !== null) {
      const max = o.maxCount !== undefined ? Number(o.maxCount) : 99;
      const n = Number(o.count);
      text = Number.isFinite(n) && o.maxCount !== undefined && n > o.maxCount ? `${o.maxCount}+` : String(o.count);
    } else {
      text = String(resolveResource(o.value === undefined ? '' : o.value));
    }
    mark.textContent = text;
    root.appendChild(mark);
    return root;
  });

  // Counter：inline-flex 容器，内置 +/- 两个可点元素（DOM 顺序在内容前后无所谓 ——
  // 用 flex order 摆成 [−, 内容, +]，create 时内容还没挂进来）
  const Counter = ensureComponent('Counter', () => {
    const root = document.createElement('div');
    root.__arkuiShow = 'Counter';
    root.style.display = 'inline-flex';
    root.style.alignItems = 'center';
    root.dataset.counter = '';
    const dec = document.createElement('div');
    dec.setAttribute('data-arkui-counter-dec', '');
    dec.textContent = '-';
    dec.style.cursor = 'pointer';
    dec.style.padding = '0 6px';
    dec.style.order = '-1';
    const inc = document.createElement('div');
    inc.setAttribute('data-arkui-counter-inc', '');
    inc.textContent = '+';
    inc.style.cursor = 'pointer';
    inc.style.padding = '0 6px';
    inc.style.order = '1';
    inc.addEventListener('click', () => {
      if (root.__counterCbs && typeof root.__counterCbs.inc === 'function') {
        try { root.__counterCbs.inc(); }
        catch (e) { layoutWarnings.push(`Counter.onInc 抛错：${e && e.message}`); }
      }
    });
    dec.addEventListener('click', () => {
      if (root.__counterCbs && typeof root.__counterCbs.dec === 'function') {
        try { root.__counterCbs.dec(); }
        catch (e) { layoutWarnings.push(`Counter.onDec 抛错：${e && e.message}`); }
      }
    });
    root.appendChild(dec);
    root.appendChild(inc);
    return root;
  });

  // Divider：div + 背景色画线（hr 的样式可控性差）。横向默认高 = strokeWidth；纵向宽 = strokeWidth
  const Divider = ensureComponent('Divider', () => {
    const el = document.createElement('div');
    el.__arkuiShow = 'Divider';
    el.dataset.divider = '';
    el.style.background = '#33182431';        // .d.ts JSDoc 默认色原文
    el.style.height = '1px';                  // 默认横向、粗细 1px（JSDoc）
    return el;
  });

  // Marquee：overflow 容器 + 内层文本跑 CSS 动画。时长照真机公式（R40，marquee_pattern.cpp
  // PlayMarqueeAnimation）：duration = |end−start| × 85 / step（DEFAULT_MARQUEE_SCROLL_DELAY
  // = 85.0ms，LINEAR；step 默认 6vp（.d.ts @default 6），step > 文本宽时按 6 兜底，step≤0
  // 不除）。LEFT 方向的距离 = 容器宽 + 文本宽（右缘外进场 → 完全滚出）——用 CSS 变量把
  // 每例的真实起止像素喂给 keyframes。真机在布局后才算时长，所以动画在 setTimeout(0)
  // 启动（不变量 18）。事件走 animation 生命周期：animationstart → onStart、
  // animationend → onFinish（loop 次数 = 迭代次数）；fromStart 默认 true（JSDoc）。
  if (!document.getElementById('arkui-marquee-keyframes')) {
    const kf = document.createElement('style');
    kf.id = 'arkui-marquee-keyframes';
    kf.textContent = '@keyframes arkuiMarquee{from{transform:translateX(var(--mq-from,200%))}'
      + 'to{transform:translateX(var(--mq-to,-100%))}}';
    document.head.appendChild(kf);
  }
  const Marquee = ensureComponent('Marquee', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const root = document.createElement('div');
    root.__arkuiShow = 'Marquee';
    root.dataset.marquee = '';
    root.style.display = 'block';            // 真机占满行宽（marqueeSize.Width() = 容器宽，R40）
    root.style.overflow = 'hidden';
    root.style.whiteSpace = 'nowrap';
    const inner = document.createElement('span');
    inner.setAttribute('data-arkui-marquee-text', '');
    inner.style.display = 'inline-block';
    inner.style.whiteSpace = 'nowrap';
    inner.textContent = String(resolveResource(o.src === undefined ? '' : o.src));
    root.appendChild(inner);
    root.dataset.loop = String(o.loop === undefined ? -1 : o.loop);      // JSDoc：默认 -1（无限）
    root.dataset.start = String(o.start === undefined ? true : !!o.start);
    root.dataset.fromStart = String(o.fromStart === undefined ? true : !!o.fromStart);
    root.dataset.step = String(o.step === undefined ? 6 : o.step);       // JSDoc：step 默认 6
    if (root.dataset.start === 'true') {
      // 真机在布局后用真实宽高算时长 → 这里也等挂载后（同步阶段，不变量 18）再启动
      setTimeout(() => {
        const textW = Math.max(1, inner.offsetWidth);
        const rootW = Math.max(0, root.clientWidth);
        const dist = rootW + textW;
        // R44 照真机分支（marquee_pattern.cpp）：step>文本宽 → 按默认 6 兜底；
        // step≤0 → 【不除】（duration = 距离×85，一圈会非常慢——真机如此，不替它"修正"）
        let stepPx = Number(root.dataset.step);
        const divide = Number.isFinite(stepPx) && stepPx > 0;
        if (divide && stepPx > textW) stepPx = 6;
        const ms = Math.max(1, divide ? Math.round(dist * 85 / stepPx) : Math.round(dist * 85));
        inner.style.setProperty('--mq-from', `${rootW}px`);   // 起点右缘外
        inner.style.setProperty('--mq-to', `${-textW}px`);    // 终点完全滚出
        const loops = root.dataset.loop === '-1' ? Infinity : Number(root.dataset.loop);
        root.style.animation = `arkuiMarquee ${ms}ms linear ${loops === Infinity ? 'infinite' : loops}`;
        // 收口与 animation.js 同约定（坑 ⑧）：headless 里 CSS 动画事件不可靠（不可见页面被节流，
        // animationend 实测会丢）—— MS 用短定时器兜底、MF 用"时长×圈数"定时器兜底，
        // 动画事件只当见证，once 守卫保证只发一次
        let startFired = false;
        const fireStart = () => {
          if (startFired) return;
          startFired = true;
          if (root.__marqueeCbs && typeof root.__marqueeCbs.start === 'function') {
            try { root.__marqueeCbs.start(); }
            catch (e) { layoutWarnings.push(`Marquee.onStart 抛错：${e && e.message}`); }
          }
        };
        root.addEventListener('animationstart', fireStart, { once: true });
        setTimeout(fireStart, 60);
        if (loops !== Infinity) {
          let finishFired = false;
          const fireFinish = () => {
            if (finishFired) return;
            finishFired = true;
            if (root.__marqueeCbs && typeof root.__marqueeCbs.finish === 'function') {
              try { root.__marqueeCbs.finish(); }
              catch (e) { layoutWarnings.push(`Marquee.onFinish 抛错：${e && e.message}`); }
            }
          };
          root.addEventListener('animationend', fireFinish, { once: true });
          setTimeout(fireFinish, ms * loops + 80);
        }
      }, 0);
    }
    return root;
  });

  // 语义属性分派（applyAttr 里抢在通用落点之前）：Divider 三件 + Marquee 字体 +
  // Counter 的 onInc/onDec/enable（函数值，必须拦在通用 on* 规则之前）
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const SHOW_ATTRS = {
    onInc: (n, v) => { (/** @type {any} */ (n.__counterCbs = n.__counterCbs || {})).inc = v; },
    onDec: (n, v) => { (/** @type {any} */ (n.__counterCbs = n.__counterCbs || {})).dec = v; },
    enableInc: (n, v) => {
      const b = n.querySelector('[data-arkui-counter-inc]');
      if (b) { b.style.opacity = v === false ? '0.4' : ''; b.style.pointerEvents = v === false ? 'none' : ''; }
    },
    enableDec: (n, v) => {
      const b = n.querySelector('[data-arkui-counter-dec]');
      if (b) { b.style.cursor = v === false ? 'default' : 'pointer'; b.style.opacity = v === false ? '0.4' : ''; }
    },
    vertical: (n, v) => {
      const on = !!v;
      n.dataset.vertical = String(on);
      n.dataset.direction = on ? 'v' : 'h';
    },
    color: (n, v) => {
      if (n.__arkuiShow === 'Divider') n.style.background = colorOf(v);
      else n.style.color = colorOf(v);            // Marquee.fontColor
    },
    fontColor: (n, v) => { n.querySelector('[data-arkui-marquee-text]').style.color = colorOf(v); },
    fontSize: (n, v) => { n.querySelector('[data-arkui-marquee-text]').style.fontSize = `${dimOf(v, 16)}px`; },
    strokeWidth: (n, v) => {
      if (n.dataset.direction === 'v') n.style.width = `${dimOf(v, 1)}px`;
      else n.style.height = `${dimOf(v, 1)}px`;
    },
    lineCap: (n, v) => { n.dataset.lineCap = String(resolveResource(v)); },
    allowScale: (n, v) => { n.dataset.allowScale = String(v); },
    marqueeUpdateStrategy: (n, v) => { n.dataset.updateStrategy = String(resolveResource(v)); },
    onStart: (n, v) => { (/** @type {any} */ (n.__marqueeCbs = n.__marqueeCbs || {})).start = v; },
    onBounce: (n, v) => { (/** @type {any} */ (n.__marqueeCbs = n.__marqueeCbs || {})).bounce = v; },
    onFinish: (n, v) => { (/** @type {any} */ (n.__marqueeCbs = n.__marqueeCbs || {})).finish = v; },
  };

  // ────────────────── 信息展示收官：QRCode（R33）──────────────────
  //
  // 产物形态（实测 fixtures/pages/QrDemo.ts）：
  //   QRCode.create('…');        ← create 单参（最多 512 字符，超出取前 512，JSDoc 原文）
  //   QRCode.color(...); QRCode.backgroundColor(...); QRCode.contentOpacity(...)
  //
  // 语义锚点（qrcode.d.ts JSDoc 原文）：color 默认 '#ff000000'、backgroundColor 默认
  // '#ffffffff'（API 11+）、contentOpacity 默认 1 范围 [0,1]；空串 → 无效 QR。
  //
  // 编码器是**真机源码直接复用**（R41：global.ArkuiQrcodegen = OHOS arkui_qrcodegen 的
  // C++ 源码 → WASM 单文件加载器，src/ 逐字复制零修改 + securec 兼容 glue，见
  // THIRD-PARTY-NOTICES §3b 与 vendor 内 build.sh）。ECC 照真机组件硬编码 MEDIUM
  //（qrcode_modifier.cpp:44，枚举仅 MEDIUM=0/HIGH=1）。未加载 vendor 时记警告并降级
  // 为不渲染（不静默、不假画）。
  // 渲染走渲染后同步阶段（redrawQr，由 syncDrawings 调用——绘制要等尺寸生效，不变量 18）：
  // canvas 内容尺寸 = 组件尺寸（1:1），模块边长 = floor(尺寸/总模块数)。quiet zone 保留
  // 4 模块（QR 规范 + jsQR 解码依赖）——已知渲染差异：真机组件 API12+ 满幅绘制无 quiet。
  // 颜色变化 → 整幅重画。
  // ArkUI 的 8 位颜色字面量是【ARGB】（'#ff000000' = 不透明黑，JSDoc 原文默认），CSS 是 RRGGBBAA
  // ——位数歧义必须归一，否则默认前景画成全透明（首跑当场抓住：解码 null）。
  /** @param {any} c */
  const qrColor = (c) => {
    const s = colorOf(c);
    return s[0] === '#' && s.length === 9 ? '#' + s.slice(3) + s.slice(1, 3) : s;
  };
  /** @param {any} el */
  function redrawQr(el) {
    if (!(/** @type {any} */ (global)).ArkuiQrcodegen || typeof (/** @type {any} */ (global)).ArkuiQrcodegen.encode !== 'function') {
      layoutWarnings.push('QRCode 编码器 vendor 未加载（runtime/vendor/arkui-qrcodegen.js）——降级为不渲染');
      delete el.__arkuiQrPending;
      return;
    }
    el.__arkuiQrPending = false;
    try {
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      if (w > 0) el.width = w;
      if (h > 0) el.height = h;
      const value = el.__arkuiQrValue.slice(0, 512);           // JSDoc：取前 512
      if (!value) return;                                     // 空串 → 无效 QR（JSDoc 原文）
      const native = el.getContext('2d');
      // 真机编码器：arkui_qrcodegen 的 QrcodeImageEncodeString，ECC 恒 MEDIUM(0)
      //（qrcode_modifier.cpp:44 硬编码）。返回 {version,width,data}，data[i]&1 = 暗格。
      const matrix = (/** @type {any} */ (global)).ArkuiQrcodegen.encode(value, 0);
      if (!matrix) return;                                    // 编码失败（内容非法）
      // R44 照真机守卫（qrcode_modifier.cpp:55）：组件尺寸小于矩阵模块数 → 拒绝绘制
      //（真机：LessNotEqual(qrCodeSize, qrWidth) 即记错误返回；我们含 quiet zone，
      // 需要的空间 = 矩阵宽 + 8，故按 total 比较——真机无 quiet，其 total 即 qrWidth）
      const quiet = 4;                                        // quiet zone 4 模块（渲染差异已记录）
      const total = matrix.size + quiet * 2;
      if (Math.min(w, h) < total) {
        layoutWarnings.push(`QRCode 组件尺寸 ${Math.min(w, h)}px 小于矩阵所需 ${total}px`
          + `（矩阵 ${matrix.size}+quiet 8）——照真机拒绝绘制`);
        delete el.__arkuiQrPending;   // 只尝试一次（与成功路径一致；颜色变化会显式重画）
        return;
      }
      const cell = Math.max(1, Math.floor(Math.min(w, h) / total));
      const offX = Math.floor((w - cell * total) / 2);
      const offY = Math.floor((h - cell * total) / 2);
      native.fillStyle = qrColor(el.__arkuiQrBg);
      native.fillRect(0, 0, w, h);
      native.globalAlpha = el.__arkuiQrOpacity;
      native.fillStyle = qrColor(el.__arkuiQrFg);
      for (let y = 0; y < matrix.size; y++) {
        for (let x = 0; x < matrix.size; x++) {
          if (matrix.data[y * matrix.size + x]) {
            native.fillRect(offX + (x + quiet) * cell, offY + (y + quiet) * cell, cell, cell);
          }
        }
      }
      native.globalAlpha = 1;
      el.dataset.qrRendered = String(total);
    } catch (e) {
      layoutWarnings.push(`QRCode 渲染抛错：${e && e.message}`);
    }
  }
  const QRCode = ensureComponent('QRCode', (args) => {
    const el = document.createElement('canvas');
    el.__arkuiQrValue = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    el.__arkuiQrFg = '#ff000000';              // JSDoc 默认
    el.__arkuiQrBg = '#ffffffff';              // JSDoc 默认（API 11+）
    el.__arkuiQrOpacity = 1;
    el.__arkuiQrPending = true;                // 等渲染后同步阶段画（不变量 18）
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const QR_ATTRS = {
    color: (n, v) => { n.__arkuiQrFg = colorOf(v); redrawQr(n); },
    backgroundColor: (n, v) => { n.__arkuiQrBg = colorOf(v); redrawQr(n); },
    contentOpacity: (n, v) => {
      const o = Number(resolveResource(v));
      n.__arkuiQrOpacity = Number.isFinite(o) && o >= 0 && o <= 1 ? o : 1;   // JSDoc：出界取默认 1
      redrawQr(n);
    },
  };
