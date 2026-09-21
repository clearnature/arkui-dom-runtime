  // ────────────────── 小件收官（R36）：Flex / Span / LoadingProgress / Blank ──────────────────
  //
  // 产物形态（实测 fixtures/pages/SmallDemo.ts）：
  //   Flex.create({direction, justifyContent, alignItems});   ← 与 CSS 同名对齐（style 透传）
  //   Span.create('…'); Span.fontColor/fontSize/decoration;   ← Text 的【内联子段】（Text 栈内挂）
  //   LoadingProgress.create(); LoadingProgress.color(...);   ← spinner
  //   Blank.create(); Blank.color(...);                       ← Row/Column 里的 flex 占位
  //
  // 语义锚点：Flex 的 create 参数与 CSS flex 同名同义（对齐值已由取值层对齐 CSS 关键字，
  // style 透传即可）；Blank 在 Row/Column 内 = flex:1 自动填充；color = 空白背景色。
  // Span 的语义 = Text 内联子段：字体属性落在自身 span 元素上（与 Text 手写实现的
  // 内联文本模型一致——见 §4.1 Text 的 node 结构）。
  const Flex = ensureComponent('Flex', defaultDom('div', {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
  }));
  // Flex.create 的 create 参数：direction/wrap/justifyContent/alignItems → style（CSS 同名）
  function applyFlexOptions(el, o) {
    if (o.direction !== undefined) el.style.flexDirection = String(resolveResource(o.direction));
    if (o.wrap !== undefined) el.style.flexWrap = String(resolveResource(o.wrap));
    if (o.justifyContent !== undefined) el.style.justifyContent = String(resolveResource(o.justifyContent));
    if (o.alignItems !== undefined) el.style.alignItems = String(resolveResource(o.alignItems));
  }
  const Span = ensureComponent('Span', (args) => {
    const el = document.createElement('span');
    el.__arkuiSpan = true;
    el.textContent = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    return el;
  });
  const SPAN_ATTRS = {
    fontColor: (n, v) => { n.style.color = colorOf(v); },
    fontSize: (n, v) => { n.style.fontSize = `${dimOf(v, 16)}px`; },
    fontStyle: (n, v) => { n.style.fontStyle = String(resolveResource(v)); },
    fontWeight: (n, v) => { n.style.fontWeight = String(resolveResource(v)); },
    decoration: (n, v) => {
      const o = (v && typeof v === 'object' && v) || {};
      // TextDecorationType 的枚举值就是 CSS 关键字（挂 global 时已对齐），t 直接可用
      const t = String(resolveResource(o.type === undefined ? 'none' : o.type));
      n.style.textDecorationLine = t === 'line-through' ? 'line-through' : t;
      if (t !== 'none' && o.color !== undefined) n.style.textDecorationColor = colorOf(o.color);
    },
    textCase: (n, v) => { n.dataset.textCase = String(resolveResource(v)); },
    textShadow: (n, v) => { n.dataset.textShadow = '1'; },
  };
  const LoadingProgress = ensureComponent('LoadingProgress', () => {
    const el = document.createElement('div');
    el.__arkuiLoading = true;
    el.dataset.loadingProgress = '';
    if (!document.getElementById('arkui-loading-keyframes')) {
      const kf = document.createElement('style');
      kf.id = 'arkui-loading-keyframes';
      kf.textContent = '@keyframes arkuiLoading{to{transform:rotate(360deg)}}';
      document.head.appendChild(kf);
    }
    el.style.border = '3px solid currentColor';
    el.style.borderTopColor = 'transparent';
    el.style.borderRadius = '50%';
    el.style.boxSizing = 'border-box';
    el.style.animation = 'arkuiLoading 1s linear infinite';
    return el;
  });
  const Blank = ensureComponent('Blank', (args) => {
    const el = document.createElement('div');
    el.__arkuiBlank = true;
    el.__arkuiBlankMin = 0;
    // Row/Column 内：flex:1 占满剩余空间；无父 flex 时按 min 呈现
    el.style.flex = '1 1 auto';
    return el;
  });
