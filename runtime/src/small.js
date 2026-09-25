  // ────────────────── 小件收官（R36）：Flex / Span / LoadingProgress / Blank ──────────────────
  //
  // 产物形态（实测 fixtures/pages/SmallDemo.ts）：
  //   Flex.create({direction, wrap, justifyContent, alignItems});   ← 与 CSS 同名对齐（style 透传）
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
  const Span = ensureComponent('Span', (args) => {
    const el = document.createElement('span');
    el.__arkuiSpan = true;
    el.textContent = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
  const Blank = ensureComponent('Blank', () => {
    const el = document.createElement('div');
    el.__arkuiBlank = true;
    el.__arkuiBlankMin = 0;
    // Row/Column 内：flex:1 占满剩余空间；无父 flex 时按 min 呈现
    el.style.flex = '1 1 auto';
    return el;
  });

  // ────────────────── 分步器（R37）：Stepper / StepperItem ──────────────────
  //
  // 产物形态（实测 fixtures/pages/StepDemo.ts）：
  //   Stepper.create({index: 0}); Stepper.onChange((prevIndex, index) => …);
  //     Stepper.onNext/onPrevious/onSkip/onFinish
  //   StepperItem.create(); StepperItem.prevLabel/nextLabel; StepperItem.status(ItemState.Skip)
  //
  // 语义锚点（stepper.d.ts / stepper_item.d.ts 原文）：
  //   onFinish —— 最后一页（ItemState=Normal）点 nextLabel 触发；
  //   onSkip —— 当前页 status=ItemState.Skip 时点 nextLabel 触发；
  //   onNext/onPrevious —— Normal 页点 nextLabel/prevLabel 触发（参数 (index, pendingIndex)）；
  //   onChange —— 切换完成派发 (prevIndex, index)。ItemState = { Normal, Skip, Waiting }。
  //
  // DOM 映射：Stepper = 竖排容器（页区 + 内置导航条 prev/pages/next）；StepperItem 挂进 pages；
  // 汇入 label/status 后接通导航条点击 → 按 .d.ts 原文派发事件（Skip 页点 next → onSkip；
  // 最后一页 Normal 点 next → onFinish；其余 → onNext；prev → onPrevious），完成切换再派发
  // onChange(prev, index)。StepperItem.status → data-status（Skip 语义）。
  // ItemState 枚举值必须按 .d.ts 声明顺序（Normal/Disabled/Waiting/Skip），产物把
  // ItemState.Skip 原样留给运行时求值，值错了 onSkip 永远不触发（同坑 83 的枚举两套来源）
  const ItemState = { Normal: 0, Disabled: 1, Waiting: 2, Skip: 3 };
  const StepperItem = ensureComponent('StepperItem', () => {
    const el = document.createElement('div');
    el.__arkuiStepperItem = true;
    el.dataset.stepperItem = '';
    el.style.display = 'none';          // 挂进 Stepper 的 pages 区（由导航逻辑控制显隐）
    return el;
  });
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const XC_ITEM_ATTRS = {
    prevLabel: (n, v) => {
      n.dataset.prevLabel = String(resolveResource(v));
      const sp = n.closest('[data-arkui-stepper]');
      if (sp && sp.__arkuiStepperSync) sp.__arkuiStepperSync();
    },
    nextLabel: (n, v) => {
      n.dataset.nextLabel = String(resolveResource(v));
      const sp = n.closest('[data-arkui-stepper]');
      if (sp && sp.__arkuiStepperSync) sp.__arkuiStepperSync();
    },
    status: (n, v) => { n.dataset.status = String(Number(resolveResource(v))); },   // ItemState
  };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const STEP_ATTRS = {
    onChange: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).change = v; },
    onNext: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).next = v; },
    onPrevious: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).prev = v; },
    onSkip: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).skip = v; },
    onFinish: (n, v) => { (/** @type {any} */ (n.__stepCbs = n.__stepCbs || {})).finish = v; },
  };
  const Stepper = ensureComponent('Stepper', () => {
    const el = document.createElement('div');
    el.__arkuiStepper = true;
    el.dataset.stepper = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.__arkuiStepperIndex = 0;
    // 内置导航条（prev/pages/next 三段）；StepperItem 挂进 pages 段，label 汇入导航条
    const prev = document.createElement('div');
    prev.setAttribute('data-arkui-stepper-prev', '');
    prev.style.cursor = 'pointer';
    prev.style.padding = '4px 8px';
    prev.textContent = '‹';
    const pages = document.createElement('div');
    pages.setAttribute('data-arkui-stepper-pages', '');
    pages.style.flex = '1';
    const next = document.createElement('div');
    next.setAttribute('data-arkui-stepper-next', '');
    next.style.cursor = 'pointer';
    next.style.padding = '4px 8px';
    next.textContent = '›';
    el.appendChild(prev);
    el.appendChild(pages);
    el.appendChild(next);
    // 派发（R39 照真机源码 ace_engine stepper_pattern.cpp 的 HandlingRight/LeftButtonClickEvent）：
    // · 右键：当前页 skip → 只发 onSkip，【不切页、不发 onChange】（去向由 app 决定）；
    //   normal 末页 → 只发 onFinish，同样不切页；normal 非末页 → 先 onChange(index, index+1)
    //   【再】onNext(index, index+1)，然后才切页；waiting/disabled/未知 → 点击整体忽略
    // · 左键：先 onChange(index, clamp(index-1)) 再 onPrevious(index, clamp(index-1))，然后切页
    //   （clamp 下界 0：真机在第 0 页点 prev 也会发 change(0,0)+prev(0,0)，此处照抄）
    // · 编程改 index（swiper 桥）只切页，不发 Stepper 事件 —— goTo 是纯切页
    // 回调走 wrapper 闭包引用 __stepCbs（覆盖语义，重渲染重挂安全）；.d.ts 只给了签名，
    // 时序与切页行为以真机源码为准（坑 94）
    // @type 档位：querySelectorAll 返回 NodeListOf<Element>，而 style/dataset 在 HTMLElement 上
    const fireNext = () => {
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      const idx = /** @type {number} */ (el.__arkuiStepperIndex);
      const cur = items[idx];
      const curStatus = cur ? Number(cur.dataset.status || 0) : 0;
      const cbs = el.__stepCbs;
      if (curStatus === ItemState.Skip) {
        if (cbs && typeof cbs.skip === 'function') { try { cbs.skip(); } catch (e) { layoutWarnings.push(`onSkip 抛错：${e && e.message}`); } }
        return;
      }
      if (curStatus !== ItemState.Normal) return;
      if (idx >= items.length - 1) {
        if (cbs && typeof cbs.finish === 'function') { try { cbs.finish(); } catch (e) { layoutWarnings.push(`onFinish 抛错：${e && e.message}`); } }
        return;
      }
      if (cbs && typeof cbs.change === 'function') { try { cbs.change(idx, idx + 1); } catch (e) { layoutWarnings.push(`Stepper.onChange 抛错：${e && e.message}`); } }
      if (cbs && typeof cbs.next === 'function') { try { cbs.next(idx, idx + 1); } catch (e) { layoutWarnings.push(`onNext 抛错：${e && e.message}`); } }
      goTo(idx + 1);
    };
    const firePrev = () => {
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      const idx = /** @type {number} */ (el.__arkuiStepperIndex);
      const p2 = Math.max(0, idx - 1);
      const cbs = el.__stepCbs;
      if (cbs && typeof cbs.change === 'function') { try { cbs.change(idx, p2); } catch (e) { layoutWarnings.push(`Stepper.onChange 抛错：${e && e.message}`); } }
      if (cbs && typeof cbs.prev === 'function') { try { cbs.prev(idx, p2); } catch (e) { layoutWarnings.push(`onPrevious 抛错：${e && e.message}`); } }
      goTo(p2);
    };
    // 纯切页：显隐 + label 汇入 + index 更新，不发任何事件（与真机 swiper 桥一致）
    /** @param {number} i */
    const goTo = (i) => {
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      if (i < 0 || i >= items.length) return;
      items.forEach((m, k) => { m.style.display = k === i ? 'block' : 'none'; });
      el.__arkuiStepperIndex = i;
      // 导航条文案随子项 label 汇入
      prev.textContent = (items[i] && items[i].dataset.prevLabel) || '‹';
      next.textContent = (items[i] && items[i].dataset.nextLabel) || '›';
    };
    el.__arkuiStepperGo = goTo;
    // 初始显隐 + label 汇入：StepperItem 挂在根上（与 prev/pages/next 并列）——汇入时
    // 移进 pages 段（不变量 18：等渲染后同步阶段）
    const syncStepper = () => {
      const strays = el.querySelectorAll(':scope > [data-stepper-item]');
      strays.forEach((m) => pages.appendChild(m));
      const items = /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[data-stepper-item]'));
      items.forEach((m, k) => { m.style.display = k === /** @type {number} */ (el.__arkuiStepperIndex) ? 'block' : 'none'; });
      if (items.length) goTo(/** @type {number} */ (el.__arkuiStepperIndex));
    };
    setTimeout(syncStepper, 0);
    // 导航条点击 → 派发语义（.d.ts 原文）
    prev.addEventListener('click', () => firePrev());
    next.addEventListener('click', () => fireNext());
    el.__arkuiStepperSync = syncStepper;
    return el;
  });
