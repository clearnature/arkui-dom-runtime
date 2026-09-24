  // ────────────── R17：onAreaChange（真实面积） + 自定义布局协议 ──────────────
  //
  // 权威来源（common.d.ts）：
  //   onAreaChange(event: (oldValue: Area, newValue: Area) => void)
  //     JSDoc：newValue 是"变化后"的宽高 + 相对父元素的坐标 + 相对页面左上角的坐标
  //   onMeasureSize?(selfLayoutInfo: GeometryInfo, children: Array<Measurable>, constraint: ConstraintSizeOptions): SizeResult
  //   onPlaceChildren?(selfLayoutInfo: GeometryInfo, children: Array<Layoutable>, constraint: ConstraintSizeOptions): void
  //     ⚠️ 这两条【不是链式属性】，而是【组件结构体上的方法】= 自定义布局协议：
  //        必须成对实现；返回值 SizeResult 的优先级【高于】组件自身声明的 width/height；
  //        Measurable.measure(constraint) 要回【真实测量】的尺寸，Layoutable.layout(position) 负责摆放。
  //     实测：@Entry 的 build 只能有一个【容器】根节点，所以"多子项 builder 模式"只适用于
  //     【非 @Entry 的嵌套 @Component】；带链式属性的自定义组件会被编译器包一层 `__Common__`。
  const areaMeta = new WeakMap();     // 元素 → 上次派发的面积（用于 old/new 与"只在变化时触发"）

  const edgesOf = (el, kind) => {
    const cs = getComputedStyle(el);
    const pick = (side) => parseFloat(cs[kind + side]) || 0;
    return { top: pick('Top'), right: pick('Right'), bottom: pick('Bottom'), left: pick('Left') };
  };
  const areaOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      position: { x: el.offsetLeft, y: el.offsetTop },                 // 相对父元素
      globalPosition: { x: r.left + (global.scrollX || 0), y: r.top + (global.scrollY || 0) },
    };
  };
  // 渲染后按【真实几何】派发 onAreaChange：只在面积真的变了（或首次）时触发
  function syncAreas(rootEl) {
    const r = rootEl || rootNode;
    if (!r || !r.querySelectorAll) return;
    for (const el of r.querySelectorAll('*')) {
      if (!el.__areaCbs || !el.__areaCbs.length) continue;
      const now = areaOf(el);
      const prev = areaMeta.get(el);
      const changed = !prev
        || Math.abs(prev.width - now.width) > 0.01 || Math.abs(prev.height - now.height) > 0.01
        || Math.abs((prev.position.x || 0) - now.position.x) > 0.01
        || Math.abs((prev.position.y || 0) - now.position.y) > 0.01;
      if (!changed) continue;
      // 首次布局也派发一次（oldValue 全 0）—— 这是实践中依赖的行为（拿初值），
      // 但真机 JSDoc 只说"面积变化时触发"，此点未在真机核对
      const old0 = prev || { width: 0, height: 0, position: { x: 0, y: 0 }, globalPosition: { x: 0, y: 0 } };
      areaMeta.set(el, now);
      for (const cb of el.__areaCbs) {
        try { cb(old0, now); } catch (e) { layoutWarnings.push(`onAreaChange 回调抛错：${e && e.message}`); }
      }
    }
  }

  const customLayoutMeta = new WeakMap();
  function measureChild(el, con, log) {
    const c = con || {};
    const set = (prop, v) => {
      el.style[prop] = (v === undefined || v === null) ? '' : (typeof v === 'number' ? v + 'px' : String(v));
    };
    set('minWidth', c.minWidth); set('maxWidth', c.maxWidth);
    set('minHeight', c.minHeight); set('maxHeight', c.maxHeight);
    const r = el.getBoundingClientRect();            // ← 真实测量，不做任何估算
    const out = { width: r.width, height: r.height };
    el.__lastMeasure = out;
    log.measures.push({ width: out.width, height: out.height });
    return out;
  }
  // 自定义布局：组件的"子节点" = 该组件 builder 直接产出的元素（在 container 里）。
  // 返回的尺寸施加在 host（= 带 .id() 的那一层，可能是编译器合成的 __Common__ 包装器）上，
  // 因为 ArkUI 里 onMeasureSize 回的就是"组件自身"的尺寸，二者必须是同一个盒子。
  function runCustomLayout(view, container, host) {
    const kids = [...container.children];
    const hostEl = host || container;
    if (!kids.length) { layoutWarnings.push('自定义布局：组件没有子节点，无法测量/摆放'); return; }
    const parentEl = hostEl.parentElement || hostEl;
    const pcs = getComputedStyle(parentEl);
    const pw = parentEl.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    const ph = parentEl.clientHeight - (parseFloat(pcs.paddingTop) || 0) - (parseFloat(pcs.paddingBottom) || 0);
    const constraint = { minWidth: 0, maxWidth: Math.max(0, pw), minHeight: 0, maxHeight: Math.max(0, ph) };
    const log = { measures: [], layoutCalls: 0, passes: 0 };
    const measurables = kids.map((el, i) => ({
      uniqueId: i,
      measure: (c) => measureChild(el, c, log),
      getMargin: () => edgesOf(el, 'margin'),
      getPadding: () => edgesOf(el, 'padding'),
      getBorderWidth: () => edgesOf(el, 'borderWidth'),
    }));
    const before = hostEl.getBoundingClientRect();
    const selfSize = {
      width: before.width, height: before.height,
      borderWidth: edgesOf(hostEl, 'borderWidth'),
      margin: edgesOf(hostEl, 'margin'), padding: edgesOf(hostEl, 'padding'),
    };
    let returned = null;
    for (let p = 0; p < 3; p++) {
      log.passes = p + 1;
      returned = view.onMeasureSize(selfSize, measurables, constraint) || {};
      const w = returned.width === undefined ? before.width : parseFloat(String(returned.width));
      const h = returned.height === undefined ? before.height : parseFloat(String(returned.height));
      if (!Number.isFinite(w) || !Number.isFinite(h)) break;
      if (Math.abs(hostEl.offsetWidth - w) < 0.5 && Math.abs(hostEl.offsetHeight - h) < 0.5) break;
      // 返回值优先于声明尺寸（JSDoc 明确）
      if (getComputedStyle(hostEl).display === 'contents') hostEl.style.display = 'block';
      if (getComputedStyle(hostEl).position === 'static') hostEl.style.position = 'relative';
      hostEl.style.width = w + 'px';
      hostEl.style.height = h + 'px';
    }
    if (typeof view.onPlaceChildren === 'function') {
      const layoutables = kids.map((el, i) => ({
        uniqueId: i,
        measureResult: el.__lastMeasure || { width: el.offsetWidth, height: el.offsetHeight },
        layout: (position) => {
          const x = Number((position && position.x) || 0);
          const y = Number((position && position.y) || 0);
          el.style.position = 'absolute';
          el.style.left = x + 'px';
          el.style.top = y + 'px';
          log.layoutCalls++;
        },
        getMargin: () => edgesOf(el, 'margin'),
        getPadding: () => edgesOf(el, 'padding'),
        getBorderWidth: () => edgesOf(el, 'borderWidth'),
      }));
      try {
        view.onPlaceChildren(selfSize, layoutables, constraint);
      } catch (e) {
        layoutWarnings.push(`onPlaceChildren 抛错：${e && e.message}`);
      }
    } else {
      layoutWarnings.push('实现了 onMeasureSize 但没有 onPlaceChildren：按 ArkUI 要求二者必须同时实现（未摆放子项）');
    }
    customLayoutMeta.set(hostEl, {
      measured: true, children: kids.length,
      selfSize: { width: selfSize.width, height: selfSize.height },
      constraint,
      returned: { width: returned && returned.width, height: returned && returned.height },
      measures: log.measures, layoutCalls: log.layoutCalls, passes: log.passes,
    });
  }

  function applyAttr(node, prop, value, extra) {
    if (!node) return;
    // R22 收口：`.transition(options|effect[, onFinish])` 也是**属性**（产物走 builder 栈），
    // 第二个参数（onFinish 回调）由生成的属性方法透传进来 —— 只取第一个参数会静默丢掉回调
    if (prop === 'transition') { registerTransition(node, value, extra); return; }
    // onAreaChange 由运行时在渲染后按真实几何派发（不是 DOM 事件，见不变量 14）
    if (prop === 'onAreaChange') {
      (node.__areaCbs = node.__areaCbs || []).push(value);
      return;
    }
    const drawAttrs = node.__drawKind && DRAW_ATTRS[node.__drawKind];
    // onChange / 语义属性必须抢在通用事件分支之前（见不变量 14）
    if (drawAttrs && Object.prototype.hasOwnProperty.call(drawAttrs, prop)) {
      drawAttrs[prop](node, value);
      return;
    }
    // SVG 形状族（R26）：fill/stroke/points/commands/… 必须抢在通用 data-* 落点之前变成
    // SVG 表现属性 —— data-* 不是形状语义，CSS 属性又会让 Shape 容器的继承语义走样
    if (node.__shapeEl && SHAPE_ATTRS[prop]) {
      SHAPE_ATTRS[prop](node, value);
      return;
    }
    // 输入类（R27）：select/checked/selectedColor 等语义抢在通用 data-* 落点之前；
    // Slider 的 onChange 是 (value, mode) 双参 —— 必须抢在通用 on* 规则【之前】拦下，
    // 否则只挂 change、丢掉拖动中的 Moving 派发与双参形态（'input'→Moving(1)，'change'→End(2)）
    if (node.__arkuiInput) {
      if (INPUT_ATTRS[prop]) {
        INPUT_ATTRS[prop](node, value);
        return;
      }
      // ArkUI 的 onChange(isOn/isChecked: boolean)：包掉 DOM Event —— 通用规则会原样透传
      // Event 对象（inputdemo 首跑实测 log='CK[object Event];'）。覆盖语义同上（__arkuiEv）。
      // ⚠️ 只对 checkbox/radio（选中语义）；文本输入的 onChange(value: string) 见下。
      if (node.__arkuiInput === 'input' && prop === 'onChange'
        && (node.type === 'checkbox' || node.type === 'radio')) {
        // ⚠️ 包装器带【target 校验】：实测（inputdemo 排查）rd 的包装器会被错误地挂到
        // 其他 input 节点上（tg1/sl1 的 change 也会带起 rd 回调）—— 根因在组件栈复用，
        // 先用"事件目标必须是自己"兜住错投：change 目标不是这个节点就不算它的选中态变化。
        const wrapper = (e) => {
          if (e.target !== node) return;
          try { value(!!node.checked); }
          catch (err) { layoutWarnings.push(`输入类 onChange 派发抛错：${err && err.message}`); }
          // 组内互斥的另一半：Chrome 只给新选中者发 change，被取消成员的 onChange(false)
          // 由这里按登记的组补发（radio.d.ts JSDoc：false = "changes from selected to unselected"）
          if (node.type === 'radio' && node.checked && typeof radioGroups !== 'undefined') {
            const members = radioGroups.get(node.name);
            if (members) {
              members.forEach((m) => {
                if (m !== node && m.__arkuiRadioOn && m.__arkuiEv && m.__arkuiEv.change) {
                  m.__arkuiRadioOn = false;
                  m.__arkuiEv.change({ target: m, type: 'change' });
                }
              });
            }
          }
          node.__arkuiRadioOn = node.checked;
        };
        if (!node.__arkuiEv) node.__arkuiEv = {};
        if (node.__arkuiEv.change) node.removeEventListener('change', node.__arkuiEv.change);
        node.__arkuiEv.change = wrapper;
        node.addEventListener('change', wrapper);
        return;
      }
      // 文本输入（R34）：TextInput/TextArea/Search 的 onChange 签名是 (value: string)——
      // 监听 input 事件（每次键入）并传字符串值（text_common.d.ts：value 双参首参）。
      if (node.__arkuiInput === 'input' && prop === 'onChange'
        && (node.type === 'text' || node.type === 'search' || node.tagName === 'TEXTAREA')) {
        const textWrapper = () => {
          try { value(node.value); }
          catch (e) { layoutWarnings.push(`文本输入 onChange 派发抛错：${e && e.message}`); }
        };
        if (!node.__arkuiEv) node.__arkuiEv = {};
        if (node.__arkuiEv.input) node.removeEventListener('input', node.__arkuiEv.input);
        if (node.__arkuiEv.change) node.removeEventListener('change', node.__arkuiEv.change);
        node.__arkuiEv.input = textWrapper;
        node.__arkuiEv.change = textWrapper;      // change 与 input 同参（值字符串）
        node.addEventListener('input', textWrapper);
        node.addEventListener('change', textWrapper);
        return;
      }
      if (node.__arkuiInput === 'slider' && prop === 'onChange') {
        // 覆盖语义同上：input→Moving(1)，change→End(2)；target 校验同上（防错投）
        const onInput = (e) => {
          if (e.target !== node) return;
          try { value(Number(node.value), 1); }
          catch (err) { layoutWarnings.push(`Slider.onChange 派发抛错：${err && err.message}`); }
        };
        const onChangeEv = (e) => {
          if (e.target !== node) return;
          try { value(Number(node.value), 2); }
          catch (err) { layoutWarnings.push(`Slider.onChange 派发抛错：${err && err.message}`); }
        };
        if (!node.__arkuiEv) node.__arkuiEv = {};
        if (node.__arkuiEv.input) node.removeEventListener('input', node.__arkuiEv.input);
        if (node.__arkuiEv.change) node.removeEventListener('change', node.__arkuiEv.change);
        node.__arkuiEv.input = onInput;
        node.__arkuiEv.change = onChangeEv;
        node.addEventListener('input', onInput);
        node.addEventListener('change', onChangeEv);
        return;
      }
    }
    // 分步器（R37）：Stepper 的五事件 + StepperItem 的 label/status（函数值与语义属性
    // 都必须拦在通用 on* / data-* 落点之前，与 Counter 同理）
    if (node.__arkuiStepper && STEP_ATTRS[prop]) {
      STEP_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiStepperItem && XC_ITEM_ATTRS[prop]) {
      XC_ITEM_ATTRS[prop](node, value);
      return;
    }
    // Image（R45）：objectFit/alt/事件是语义属性，抢在通用落点之前（同 Counter 道理）
    if (node.__arkuiImage && IMAGE_ATTRS[prop]) {
      IMAGE_ATTRS[prop](node, value);
      return;
    }
    // Scroll（R46）：scrollable/scrollBar/edgeEffect/事件是语义属性，抢在通用落点之前
    if (node.__arkuiScroll && SCROLL_ATTRS[prop]) {
      SCROLL_ATTRS[prop](node, value);
      return;
    }
    // 信息展示类（R28）：Counter 的 onInc/onDec 是函数值（必须拦在通用 on* 规则之前，否则
    // 会变成 'inc'/'dec' DOM 监听）；Divider/Marquee 的语义属性抢在通用 data-* 落点之前
    if (node.__arkuiShow && SHOW_ATTRS[prop]) {
      SHOW_ATTRS[prop](node, value);
      return;
    }
    // 弹出类（R29）：selected 按身份分派；Select.onSelect 双参拦在通用 on* 规则之前；
    // MenuItem.onChange 只登记（点击切换在工厂里派发）
    if (node.__arkuiQrValue !== undefined && QR_ATTRS[prop]) {
      QR_ATTRS[prop](node, value);
      return;
    }
    // 小件收官（R36）：Span 的字体属性落在自身元素（Text 内联子段语义）；
    // LoadingProgress.color → currentColor（spinner 边框色）；Blank.color → 空白背景色；
    // Flex 的 create 参数在 ensureComponent.create 时由 applyFlexOptions 处理（CSS 同名透传）
    if (node.__arkuiSpan && SPAN_ATTRS[prop]) {
      SPAN_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiLoading && prop === 'color') {
      node.style.color = colorOf(value);
      return;
    }
    if (node.__arkuiBlank && prop === 'color') {
      node.style.backgroundColor = colorOf(value);
      return;
    }
    if (node.__arkuiPopup) {
      if (POPUP_ATTRS[prop]) {
        POPUP_ATTRS[prop](node, value);
        return;
      }
      if (node.__arkuiPopup === 'Select' && prop === 'onSelect') {
        popupBindSelect(node, value);
        return;
      }
    }
    // 表层类（R31/R32）：Canvas 的 onReady、XComponent 的 onLoad 都是函数值且原生元素
    // 不会自发派发——必须拦在通用 on* 规则之前（坑 86 同族）
    if (node.__arkuiCanvasFlag && CANVAS_ATTRS[prop]) {
      CANVAS_ATTRS[prop](node, value);
      return;
    }
    if (node.__arkuiXComponentFlag && XC_ATTRS[prop]) {
      XC_ATTRS[prop](node, value);
      return;
    }
    // Tabs/Swiper 的 onChange 要由它们自己收集并在切换时派发，不能落成 DOM 事件 ——
    // 必须拦在通用事件分支【之前】，否则会变成永不触发的 'change' 监听器（静默失效）。
    if (prop === 'onChange' && (node.__tabsState || node.__swiperState)) {
      (node.__tabsState || node.__swiperState).onChange.push(value);
      return;
    }
    // NavDestination 的生命周期回调同理：由栈操作派发，不能变成 'willappear' 监听器
    if (node.__navDestCbs && NAVDEST_LIFECYCLE[prop]) {
      const kind = NAVDEST_LIFECYCLE[prop];
      if (kind === 'backPressed') {
        node.__navDestCbs[kind] = value;
        layoutWarnings.push('NavDestination.onBackPressed 已登记，但本运行时没有系统返回键触发源'
          + '（浏览器/Electron 不会产生它）—— 请用 NavPathStack.pop() 走真实路径');
        return;
      }
      node.__navDestCbs[kind] = value;
      return;
    }
    // Navigation 的事件类属性必须在下面的通用 on* 规则之前拦下：否则 onTitleModeChange(fn)
    // 会变成 addEventListener('titlemodechange')，永远没人派发（R25 实测的分发陷阱，坑 86）
    if (node.__navState && prop === 'onTitleModeChange') {
      NAV_ATTRS.onTitleModeChange(node.__navState, value, extra);
      return;
    }
    if (typeof value === 'function') {          // 事件类（onClick/onChange…）
      const ev = prop.replace(/^on/, '').toLowerCase() || 'click';
      // 覆盖语义（R27 实测教训）：同一个属性重复注册【替换】上一个，而不是追加 ——
      // @State 变化会触发重渲染、重渲染会把 `.onChange(cb)` 再应用一遍（isInitialRender=false
      // 的路径），追加语义下监听器每轮翻倍（inputdemo 首跑当场抓住：一次点击回调发两次）
      if (!node.__arkuiEv) node.__arkuiEv = {};
      if (node.__arkuiEv[ev]) node.removeEventListener(ev, node.__arkuiEv[ev]);
      node.__arkuiEv[ev] = value;
      node.addEventListener(ev, value);
      return;
    }
    if (prop === 'id') { node.id = String(resolveResource(value)); return; }
    if (prop === 'tabBar') { applyTabBar(node, value); return; }
    if (node.__swiperState && SWIPER_ATTRS[prop]) { SWIPER_ATTRS[prop](node.__swiperState, value); return; }
    if (node.__navState && NAV_ATTRS[prop]) { NAV_ATTRS[prop](node.__navState, value, extra); return; }
    if (node.__navDest && NAVDEST_ATTRS[prop]) { NAVDEST_ATTRS[prop](node, value, extra); return; }
    // Grid 轨道模板要过单位归一化，所以不能走 cssPropEnum 的原样透传
    if (GRID_TRACK_PROPS[prop]) {
      node.style[GRID_TRACK_PROPS[prop]] = normalizeTrackList(resolveResource(value));
      return;
    }
    // 未实现的 Grid/Tabs/Swiper/Navigation 语义项：不 return，继续落 data-*，但同时留下诊断
    if (node.__arkuiComp === 'Grid' && GRID_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Grid.${prop} 未实现（无模板时的轨道划分）：版式会与设备不一致`);
    }
    if (node.__swiperState && SWIPER_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Swiper.${prop} 未实现，已忽略`);
    }
    if (node.__tabsState && TABS_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Tabs.${prop} 未实现，已忽略`);
    }
    // Navigation/NavDestination：标题栏/工具栏/分栏等是【可见差异】，不能静默
    if (node.__navState && NAV_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`Navigation.${prop} 未实现（本实现只有 Stack 栈语义，不绘制标题栏/工具栏）`);
    }
    if (node.__navDestCbs && NAV_UNSUPPORTED.has(prop)) {
      layoutWarnings.push(`NavDestination.${prop} 未实现（不绘制标题栏/工具栏）`);
    }
    // 注意：这些必须在 cssPropEnum 之前拦掉 —— 例如 ArkUI 的 alignContent 语义
    // 是"叠放子项的对齐"，与 CSS 的 align-content（内容分布）不是一回事。
    // alignRules 只登记，不立刻解析：此刻锚点（兄弟/guideline）可能还没建出来 ——
    // 逆序声明的锚链必然如此。立刻解析既会出错（单趟读到旧位置），又会留下假警告
    // "找不到锚点 'x'"。真正的解析在每轮 syncAlignRules（首渲染后 + 每次重渲染后），
    // 它迭代到不动点，那时锚点才齐。
    if (prop === 'alignRules') { node.__alignRules = value; return; }
    // guideLine 是【容器级】属性（挂在 RelativeContainer 上），位置要等容器有尺寸才能算 ——
    // 这里只登记，真正的计算在每轮 syncAlignRules 里（容器尺寸那时才可信）。
    if (prop === 'guideLine') {
      if (!Array.isArray(value)) {
        layoutWarnings.push('guideLine 需要数组（如 [{id, direction, position:{start}}]），已忽略');
        return;
      }
      node.__guideLines = value;
      applyGuideLines(node);
      return;
    }
    if (prop === 'maxLines') { node.__maxLines = Number(resolveResource(value)); applyTextClamp(node, node.__maxLines, node.__textOverflow); return; }
    if (prop === 'textOverflow') { node.__textOverflow = (value && value.overflow) || value; applyTextClamp(node, node.__maxLines, node.__textOverflow); return; }
    if (prop === 'alignContent') { applyAlignment(node, value); return; }
    if (cssPropSize[prop]) { node.style[cssPropSize[prop]] = toCssSize(value); return; }
    if (cssPropRaw[prop]) { node.style[cssPropRaw[prop]] = String(resolveResource(value)); return; }
    if (cssPropEnum[prop]) { node.style[cssPropEnum[prop]] = String(resolveResource(value)); return; }
    try { node.dataset[prop] = JSON.stringify(value); }
    catch { node.dataset[prop] = String(value); }
  }
