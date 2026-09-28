  // ────────────────── 批次 E：布局/叠放/内部组件（R67）──────────────────
  //
  // 六组件（权威出处）：
  //   FolderStack   —— component/folder_stack.d.ts（public，since 11）
  //   GridContainer —— component/grid_container.d.ts（deprecated since 9，useinstead GridRow/GridCol）
  //   Section       —— build-tools/ets-loader/components/section.json（内部组件：attrs=[]，无 d.ts）
  //   Sheet         —— build-tools/ets-loader/components/sheet.json（内部组件：children=["Section"]，attrs=[]，无 d.ts）
  //   UnionEffectContainer —— build-tools/ets-loader/components/union_effect_container.json（systemApi:true，attrs=["pointLight"]，无 d.ts）
  //   XComponentNode —— api/arkui/XComponentNode.d.ts（deprecated since 12，useinstead typeNode#XComponent）
  //
  // ⚠️ Section/Sheet/UnionEffectContainer 在本 SDK 里【没有 d.ts 声明】——它们只存在于
  //    ets-loader 的组件表（generated-components.js 的 149 个骨架即来源于此）。字段形态
  //    以那三个 JSON 为唯一权威，DOM 语义按组件名/父子关系做保守近似（全部注明）。

  // FolderStack 回调载荷里的两个枚举（enums.d.ts:4431/4482，显式数值）
  const FoldStatus = { UNKNOWN: 0, EXPANDED: 1, FOLDED: 2, HALF_FOLDED: 3 };
  const AppRotation = { ROTATION_0: 0, ROTATION_90: 1, ROTATION_180: 2, ROTATION_270: 3 };
  // GridContainer 的 SizeType（grid_container.d.ts:28-74，声明顺序 Auto/XS/SM/MD/LG）
  const SizeType = { Auto: 0, XS: 1, SM: 2, MD: 3, LG: 4 };
  // XComponentNode.changeRenderType 的 NodeRenderType（api/arkui/BuilderNode.d.ts:87-107）
  const NodeRenderType = { RENDER_TYPE_DISPLAY: 0, RENDER_TYPE_TEXTURE: 1 };

  // ────────────────── FolderStack（叠放 + 折叠屏悬停）──────────────────
  //
  // 产物形态（FolderStackInterface，folder_stack.d.ts:66-80）：
  //   FolderStack.create({ upperItems: ['a', 'b'] });
  //   FolderStack.alignContent(Alignment.Start); FolderStack.enableAnimation(false);
  //   FolderStack.autoHalfFold(true);
  //   FolderStack.onFolderStateChange((e: {foldStatus}) => …);
  //   FolderStack.onHoverStatusChange((p: HoverEventParam) => …);
  //
  // 语义（folder_stack.d.ts）：Stack 叠放基座 + 折叠屏悬停 —— 悬停态下 upperItems 里
  //   的子组件（按 .id() 匹配）避开折痕区移到上半屏，其余子组件留在下半屏；
  //   alignContent 默认 Alignment.Center；enableAnimation/autoHalfFold 默认 true。
  // DOM：与 Stack 同款 grid 同格叠放（子项 gridArea 1/1，mountNode 只认 __arkuiComp==='Stack'，
  //   所以这里用 MutationObserver 给新挂子项补 gridArea——self-contained，不动共享文件）。
  //   悬停态是 DOM 无触发源的系统能力（真机由折屏硬件驱动）：提供状态袋方法
  //   setFoldStatus(status) / setHoverStatus(param) 编程驱动；悬停时 upperItems 子项
  //   绝对定位到上半屏（top:0 h:50%），其余子项到下半屏（top:50% h:50%）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const FOLDERSTACK_ATTRS = {
    // alignContent 刻意【不在本表】：area.js 的通用分支 `prop === 'alignContent' →
    // applyAlignment` 已按同一语义处理（Stack 同款），表里再放一份是双路径漂移点。
    onFolderStateChange: (n, v) => {
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.cbs.foldStatus = v;
    },
    onHoverStatusChange: (n, v) => {
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.cbs.hoverStatus = v;
    },
    enableAnimation: (n, v) => {
      // DOM 无折屏开合动画管道：只落语义标记（与 Panel.dragBar 同级的"记而未演"）
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.enableAnimation = v !== false;
      n.dataset.enableAnimation = String(v !== false);
    },
    autoHalfFold: (n, v) => {
      const w = /** @type {any} */ (n).__folderstack;
      if (w) w.autoHalfFold = v !== false;
      n.dataset.autoHalfFold = String(v !== false);
    },
  };
  /** @param {any} n */
  function applyFolderStackLayout(n) {
    const w = /** @type {any} */ (n).__folderstack;
    if (!w) return;
    for (const k of Array.prototype.slice.call(n.children)) {
      const kid = /** @type {any} */ (k);
      if (!kid || !kid.style) continue;
      if (!w.hoverMode) {
        // 悬停退出：清掉覆盖样式，回到 grid 同格叠放
        kid.style.position = ''; kid.style.top = ''; kid.style.left = '';
        kid.style.width = ''; kid.style.height = '';
        kid.removeAttribute('data-folder-upper'); kid.removeAttribute('data-folder-lower');
        kid.style.gridArea = '1 / 1';
        continue;
      }
      const upper = kid.id !== undefined && w.upperItems.indexOf(String(kid.id)) >= 0;
      kid.style.gridArea = '';                       // 绝对定位脱离网格流
      kid.style.position = 'absolute';
      kid.style.left = '0';
      kid.style.width = '100%';
      kid.style.height = '50%';
      if (upper) { kid.style.top = '0'; kid.setAttribute('data-folder-upper', ''); }
      else { kid.style.top = '50%'; kid.setAttribute('data-folder-lower', ''); }
    }
  }
  /** @param {any[]} args */
  const FolderStack = ensureComponent('FolderStack', (args) => {
    const el = document.createElement('div');
    el.dataset.folderStack = '';
    (/** @type {any} */ (el)).__arkuiFolderStack = true;   // area.js 属性分派的身份守卫（同 GridContainer 等）
    // Stack 同款叠放：grid 同格 + 默认 Alignment.Center（d.ts:147 "Default value: Alignment.Center"）
    el.style.display = 'grid';
    el.style.justifyItems = 'center';
    el.style.alignItems = 'center';
    el.style.position = 'relative';                  // 悬停态子项以它为包含块
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__folderstack = /** @type {any} */ ({
      upperItems: Array.isArray(o.upperItems) ? o.upperItems.map(String) : [],
      foldStatus: 0,
      hoverMode: false,
      enableAnimation: true,                         // d.ts:190 "Default value: true"
      autoHalfFold: true,                            // d.ts:206 "Default value: true"
      cbs: {},
    });
    if (Array.isArray(o.upperItems)) el.dataset.upperItems = JSON.stringify(o.upperItems);
    // 编程驱动（真机由折屏硬件产生，DOM 无触发源 —— 测试/上层用它发事件）
    w.setFoldStatus = (/** @type {any} */ status) => {
      w.foldStatus = status;
      el.dataset.foldStatus = String(status);
      const cb = w.cbs.foldStatus;
      if (typeof cb === 'function') {
        try { cb({ foldStatus: status }); }
        catch (e) { layoutWarnings.push(`FolderStack.onFolderStateChange 回调抛错：${e && e.message}`); }
      }
    };
    w.setHoverStatus = (/** @type {any} */ param) => {
      // param 形状 = HoverEventParam（folder_stack.d.ts:225-262）：
      //   { foldStatus, isHoverMode, appRotation, windowStatusType }
      w.hoverMode = !!(param && param.isHoverMode);
      el.dataset.hoverMode = String(w.hoverMode);
      applyFolderStackLayout(el);
      const cb = w.cbs.hoverStatus;
      if (typeof cb === 'function') {
        try { cb(param); }
        catch (e) { layoutWarnings.push(`FolderStack.onHoverStatusChange 回调抛错：${e && e.message}`); }
      }
    };
    // mountNode 只给 __arkuiComp==='Stack' 的子项补 gridArea（main.js mountNode）；
    // FolderStack 的子项在这里补——观察 childList 即可覆盖 create 后挂进来的全部子项。
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((/** @type {any} */ nd) => {
          if (nd && nd.style && !w.hoverMode) nd.style.gridArea = '1 / 1';
        });
      }
    });
    mo.observe(el, { childList: true });
    return el;
  });

  // ────────────────── GridContainer（deprecated 列网格容器）──────────────────
  //
  // 产物形态（GridContainerInterface，grid_container.d.ts:135-147）：
  //   GridContainer.create({ columns: 4, sizeType: SizeType.SM, gutter: 8, margin: 12 });
  //
  // 语义（grid_container.d.ts，deprecated since 9）：options =
  //   { columns?: number|"auto", sizeType?: SizeType, gutter?: number|string, margin?: number|string }；
  //   GridContainerAttribute extends ColumnAttribute —— 链式属性与 Column 同（无自有 setter）。
  // DOM：display:grid + repeat(N, 1fr)；gutter → column-gap；margin → 左右 padding。
  //   columns:"auto"/缺省：真机按设备宽度档位（SizeType）解析列数，DOM 无设备型号 ——
  //   固定按 12 列渲染并 warnOnce 记差异（不静默）。
  /** @param {any} el @param {any} o */
  function applyGridContainerOptions(el, o) {
    if (o.columns !== undefined && o.columns !== 'auto') {
      const cols = Number(resolveResource(o.columns)) || 12;
      el.dataset.columns = String(cols);
      el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    } else {
      el.dataset.columns = 'auto';
      // DOM 侧固定 12 列的取舍（真机 "auto" 按设备解析）必须留痕：
      warnOnce('GridContainer.columns 为 auto/缺省：真机按设备宽度档位解析列数，DOM 固定按 12 列渲染');
      el.style.gridTemplateColumns = 'repeat(12, 1fr)';
    }
    if (o.sizeType !== undefined) {
      el.dataset.sizeType = String(Number(resolveResource(o.sizeType)));
    }
    if (o.gutter !== undefined) el.style.columnGap = toCssSize(resolveResource(o.gutter));
    if (o.margin !== undefined) {
      const m = toCssSize(resolveResource(o.margin));
      el.style.paddingLeft = m;                      // "Spacing on both sides"（d.ts:117）
      el.style.paddingRight = m;
    }
  }
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const GRIDCONTAINER_ATTRS = {
    // 四个 options 键同时接受链式 setter（防编译产物把选项摊平成属性链的形态）
    columns: (n, v) => { applyGridContainerOptions(n, { columns: v }); },
    sizeType: (n, v) => { applyGridContainerOptions(n, { sizeType: v }); },
    gutter: (n, v) => { applyGridContainerOptions(n, { gutter: v }); },
    margin: (n, v) => { applyGridContainerOptions(n, { margin: v }); },
  };
  /** @param {any[]} args */
  const GridContainer = ensureComponent('GridContainer', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiGridContainer = true;
    el.dataset.gridContainer = '';
    el.style.display = 'grid';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    applyGridContainerOptions(el, o);
    return el;
  });

  // ────────────────── Sheet / Section（内部组件对）──────────────────
  //
  // 语义（sheet.json："children": ["Section"]；section.json："attrs": []）：真机 bindSheet
  //   的内部承载结构 —— Sheet 是弹层面板容器，Section 是其中的内容段。本 SDK 无公开 d.ts、
  //   无公开属性；产物里也不会出现用户态的 Sheet.create()（由框架内部建出）。
  // DOM：Sheet → 白底 flex column 面板（弹层定位由上层驱动，这里只做承载）；
  //   Section → flex column 内容段（flex:1 占满面板剩余空间）。
  // 无 SHEET_ATTRS/SECTION_ATTRS：attrs 为空表时 area.js 无需分派分支（通用属性走通用规则）。
  const Sheet = ensureComponent('Sheet', () => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiSheet = true;
    el.dataset.sheet = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.backgroundColor = '#ffffff';
    return el;
  });
  const Section = ensureComponent('Section', () => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiSection = true;
    el.dataset.section = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.flex = '1';
    el.style.minHeight = '0';
    el.style.minWidth = '0';
    return el;
  });

  // ────────────────── Piece（操作块标签，R122）──────────────────
  //
  // 权威出处（R120 feasible 判定后落地；无公开 d.ts，ets-loader 组件表即可达性证明）：
  //   build-tools/ets-loader/components/piece.json
  //     —— attrs 8 个：iconPosition/fontColor/fontSize/fontStyle/fontWeight/fontFamily/
  //        showDelete/onClose；factories [create]；非容器。
  //   jsview/js_piece.cpp:39-80  create({content, icon})：主题 height→盒高、paddingH/V、
  //     圆角 = height/2（胶囊）。
  //   piece_component.cpp:49-66  BuildChild：content 空 → 整行不建（仅剩外盒）；Row
  //     FLEX_START/CENTER + mainAxisSize MIN（fit-content）。
  //   piece_component.cpp:183-210  SetImage：图标=用户 icon URL 或默认删除资源
  //     （PIECE_DELETE_SVG）；iconSize×iconSize；interval padding 落【朝文本一侧】
  //     （RTL 或 Start→右，否则→左）；【图标可见性=showDelete】（GONE，占位随消）；
  //     图标点击=onDelete（js_piece.cpp:132-151 onClose 只挂图标）。
  //   piece_component.cpp:212-219  SetText：Text(content)+textStyle。
  //   piece_component.h:33-36,102  IconPosition{Start=0,End=1}，默认 End。
  //   js_piece.cpp:108-130  showDelete 容错：boolean 直用；number 只认 0/1；其余→false。
  //   js_piece.cpp:27,194-208  fontStyle 表 [Normal,Italic]，越界忽略；fontWeight 字符串。
  //
  // 【推断】主题数值（height/paddingH/V/interval/iconSize/文字配色/背景）出自 theme
  //   pattern JSON（piece_theme.h:58-72 的键），该 JSON 不在本机源码树 —— 以下默认值
  //   全部标推断：height 28vp / paddingH 12 / paddingV 4 / interval 6 / iconSize 16 /
  //   文字 14fp rgba(0,0,0,0.9) / 背景 rgba(0,0,0,0.05)；文本 ELLIPSIS+单行（h 主题键）。
  //
  // DOM：胶囊 div（inline-flex 居中，min 宽 fit-content 即 flex 默认）→ 文本 span +
  //   图标 wrap（img，默认图标 = SDK previewer ohos_piece_delete.svg 原文内嵌 data URI）。
  //   空 content 只空行（外盒仍在——真机 SoleChild 无 child 时盒照画）。
  // 默认删除图标：SDK previewer/common/resources/resources/base/media/ohos_piece_delete.svg
    // 原文（56×56 双圆头线 ✕，stroke #000 0.9 6px）——不重画，逐字内嵌
    const PIECE_DELETE_SVG = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<svg viewBox="0 0 56 56" version="1.1" xmlns="http://www.w3.org/2000/svg">'
      + '<g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">'
      + '<line x1="14" y1="14" x2="43" y2="43" stroke="#000000" opacity="0.9" '
      + 'stroke-width="6" stroke-linecap="round"></line>'
      + '<line x1="14" y1="14" x2="43" y2="43" stroke="#000000" opacity="0.9" '
      + 'stroke-width="6" stroke-linecap="round" '
      + 'transform="translate(28.5,28.5) scale(-1,1) translate(-28.5,-28.5)"></line>'
      + '</g></svg>';
    const PIECE_DEFAULT_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(PIECE_DELETE_SVG);
    // 主题默认值【推断】（见上）
    const PIECE_THEME = {
      height: 28, paddingHorizontal: 12, paddingVertical: 4, interval: 6,
      iconSize: 16, textColor: 'rgba(0,0,0,0.9)', fontSize: 14,
      backgroundColor: 'rgba(0,0,0,0.05)',
    };
    /** @param {any} el @param {number} pos */
    function pieceApplyIconPosition(el, pos) {
      const w = /** @type {any} */ (el).__piece;
      if (!w) return;
      w.iconPosition = pos === 0 ? 0 : 1;            // 非 0 归 End（piece_component.h:102 默认 End）
      const rtl = el.dir === 'rtl';                  // RTL 或 Start → interval 落右侧（:194）
      w.iconWrap.style.paddingRight = (w.iconPosition === 0 || rtl) ? w.interval + 'px' : '0';
      w.iconWrap.style.paddingLeft = (w.iconPosition === 0 || rtl) ? '0' : w.interval + 'px';
      if (w.textSpan.parentNode !== el) return;      // 空 content：行未建（children 挂不上）
      // Start→[icon][text]，End→[text][icon]
      if (w.iconPosition === 0) { el.insertBefore(w.iconWrap, w.textSpan); }
      else { el.insertBefore(w.textSpan, w.iconWrap); }
    }
    /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
    const PIECE_ATTRS = {
      iconPosition: (n, v) => { pieceApplyIconPosition(n, Number(v)); n.dataset.iconPosition = String(Number(v)); },
      // js_piece.cpp:108-130：boolean 直用；number 只认 0/1；其余一律 false
      showDelete: (n, v) => {
        const w = /** @type {any} */ (n).__piece;
        if (!w) return;
        let show = false;
        if (typeof v === 'boolean') show = v;
        else if (typeof v === 'number' && (v === 0 || v === 1)) show = !!v;
        w.showDelete = show;
        w.iconWrap.style.display = show ? '' : 'none';   // GONE：不占位
        n.dataset.showDelete = String(show);
      },
      fontColor: (n, v) => {
        const w = /** @type {any} */ (n).__piece; if (w) w.textSpan.style.color = String(resolveResource(v));
      },
      fontSize: (n, v) => {
        const w = /** @type {any} */ (n).__piece; if (w) w.textSpan.style.fontSize = toCssSize(v);
      },
      fontStyle: (n, v) => {
        // js_piece.cpp:27 FONT_STYLES=[Normal,Italic]，越界忽略
        const w = /** @type {any} */ (n).__piece;
        if (w && (v === 0 || v === 1)) w.textSpan.style.fontStyle = v === 1 ? 'italic' : 'normal';
      },
      fontWeight: (n, v) => {
        const w = /** @type {any} */ (n).__piece; if (w) w.textSpan.style.fontWeight = String(resolveResource(v));
      },
      fontFamily: (n, v) => {
        const w = /** @type {any} */ (n).__piece; if (w) w.textSpan.style.fontFamily = String(resolveResource(v));
      },
      // 只挂图标点击（js_piece.cpp:132-151 → piece_component.cpp:190-192）；
      // 刻意不走通用 on* —— 那会把整颗胶囊变成关闭热区（语义错）
      onClose: (n, v) => {
        const w = /** @type {any} */ (n).__piece;
        if (!w) return;
        w.onClose = v;
        n.dataset.hasOnClose = '1';
      },
    };
    /** @param {any[]} args */
    const Piece = ensureComponent('Piece', (args) => {
      const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
      const el = document.createElement('div');
      (/** @type {any} */ (el)).__arkuiPiece = true;
      el.dataset.piece = '';
      const t = PIECE_THEME;
      el.style.display = 'inline-flex';               // Row + mainAxisSize MIN（fit-content）
      el.style.alignItems = 'center';
      el.style.boxSizing = 'border-box';
      el.style.height = t.height + 'px';
      el.style.borderRadius = (t.height / 2) + 'px';  // 胶囊：圆角=高/2（js_piece.cpp:66）
      el.style.backgroundColor = t.backgroundColor;
      el.style.padding = t.paddingVertical + 'px ' + t.paddingHorizontal + 'px';
      // 文本 span（content 空 → 不挂进盒：BuildChild nullptr 语义——真机连行都不建，
      // 图标也在行内，同样不出现；span/iconWrap 对象仍创建，属性派发不炸）
      const textSpan = document.createElement('span');
      textSpan.style.color = t.textColor;
      textSpan.style.fontSize = t.fontSize + 'px';
      textSpan.style.overflow = 'hidden';             // ELLIPSIS + 单行（主题键，推断）
      textSpan.style.textOverflow = 'ellipsis';
      textSpan.style.whiteSpace = 'nowrap';
      // 图标 wrap + img（默认删除资源；用户 icon URL 覆盖）
      const iconWrap = document.createElement('div');
      iconWrap.style.display = 'flex';
      iconWrap.style.alignItems = 'center';
      const img = document.createElement('img');
      img.style.width = t.iconSize + 'px';
      img.style.height = t.iconSize + 'px';
      img.style.display = 'block';
      img.src = o.icon ? String(o.icon) : PIECE_DEFAULT_ICON;
      img.alt = '';
      iconWrap.appendChild(img);
      if (o.content !== undefined && o.content !== null && String(o.content) !== '') {
        textSpan.textContent = String(o.content);
        el.appendChild(textSpan);
        el.appendChild(iconWrap);
      }
      const w = /** @type {any} */ (el).__piece = /** @type {any} */ ({
        textSpan, iconWrap, interval: t.interval,
        iconPosition: 1, showDelete: false, onClose: null,
      });
      // 默认 End + showDelete=false（图标 GONE）
      pieceApplyIconPosition(el, 1);
      w.iconWrap.style.display = 'none';
      // onClose 只挂 img（冒泡自 img 点击；文本/胶囊点击不触发）
      img.addEventListener('click', (/** @type {any} */ ev) => {
        ev.stopPropagation();
        if (typeof w.onClose === 'function') {
          try { w.onClose(); }
          catch (e) { layoutWarnings.push('Piece.onClose 回调抛错：' + e.message); }
        }
      });
      return el;
    });

  // ────────────────── UnionEffectContainer（systemApi 联动光效容器）──────────────────
  //
  // 语义（union_effect_container.json，systemApi:true）：唯一属性 pointLight（本 SDK 无该
  //   属性的任何 d.ts 声明 —— 无参数形状可依，按 options 对象/布尔宽容记录）。
  // DOM：普通容器（block + relative）；pointLight 的视觉光效（真机渲染管线特效）在 DOM 无
  //   对应物 —— 参数落 data-* 并记 layoutWarnings（不静默忽略）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const UNIONEFFECT_ATTRS = {
    pointLight: (n, v) => {
      try { n.dataset.pointLight = JSON.stringify(v); }
      catch (e) { n.dataset.pointLight = String(v); }
      warnOnce('UnionEffectContainer.pointLight 视觉光效无 DOM 对应物（渲染管线特效），参数已记 data-point-light');
    },
  };
  /** @param {any[]} args */
  const UnionEffectContainer = ensureComponent('UnionEffectContainer', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiUnionEffect = true;
    el.dataset.unionEffectContainer = '';
    el.style.display = 'block';
    el.style.position = 'relative';
    return el;
  });

  // ────────────────── XComponentNode（自定义节点宿主）──────────────────
  //
  // 这个名字在 SDK 里有【两副面孔】，两副都实现、共用同一个导出名：
  // ① 声明式组件（ets-loader components/xcomponentNode.json，attrs 共 7 个）——
  //    ensureComponent 注册（进 components 表 → generated-components.js 的同名骨架被
  //    "手写优先"跳过），工厂产出宿主 div。
  // ② 类（api/arkui/XComponentNode.d.ts:32-81，extends FrameNode，deprecated since 12）——
  //    constructor(uiContext, options, id, type, libraryName?)；
  //    onCreate(event?)/onDestroy() 是子类覆写的生命周期；changeRenderType(type): boolean。
  //    DOM 无 FrameNode 基类：实例自带状态袋 __xcn，宿主 DOM 由 __arkuiBindHost 绑定。
  //    按 id 注册进 xcNodeRegistry —— 声明式面的宿主 div 建出时按 id 认领实例并在
  //    surface 就绪刻度（setTimeout(0)，与 canvas.js XComponent.onLoad 同款）触发 onCreate。
  // changeRenderType 只认 NodeRenderType（BuilderNode.d.ts:87-107 DISPLAY=0/TEXTURE=1），
  //   非法值返回 false 并记警告；合法值落 dataset.renderType。
  /** @type {Map<string, any>} */
  const xcNodeRegistry = new Map();
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const XCNODE_ATTRS = {
    type: (n, v) => { n.dataset.xcnType = String(resolveResource(v)); },
    libraryName: (n, v) => { n.dataset.xcnLibrary = String(resolveResource(v)); },
    onCreate: (n, v) => {
      n.__arkuiXcnOnCreate = v;
      if (n.__arkuiXcnScheduled) return;             // 覆盖语义：cb 替换、调度只排一次
      n.__arkuiXcnScheduled = true;
      setTimeout(() => {
        if (typeof n.__arkuiXcnOnCreate === 'function') {
          try { n.__arkuiXcnOnCreate({ surfaceId: 'XComponent-' + (n.dataset.xcnId || '') }); }
          catch (e) { layoutWarnings.push(`XComponentNode.onCreate 抛错：${e && e.message}`); }
        }
      }, 0);
    },
    onDestroy: (n, v) => {
      n.__arkuiXcnOnDestroy = v;                     // DOM 销毁时机无卸载钩子，只登记
    },
    changeRenderType: (n, v) => {
      const t = Number(resolveResource(v));
      if (t !== 0 && t !== 1) {
        layoutWarnings.push(`XComponentNode.changeRenderType(${String(v)}): 非法 NodeRenderType，已忽略`);
        return;
      }
      n.dataset.renderType = String(t);
    },
  };
  /** @param {any[]} args */
  const XComponentNodeComp = ensureComponent('XComponentNode', (args) => {
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiXComponentNodeFlag = true;
    el.dataset.xcomponentNode = '';
    el.style.position = 'relative';
    const id = o.id === undefined ? '' : String(o.id);
    if (id) el.dataset.xcnId = id;
    if (o.type !== undefined) el.dataset.xcnType = String(o.type);
    if (o.libraryName !== undefined) el.dataset.xcnLibrary = String(o.libraryName);
    // 宿主建出 → 认领同类面实例，按 surface 就绪刻度触发 onCreate（真机时序的 DOM 近似）
    const inst = id !== '' ? xcNodeRegistry.get(id) : null;
    if (inst) {
      setTimeout(() => {
        try {
          /** @type {any} */ (inst).__arkuiBindHost(el);
          /** @type {any} */ (inst).onCreate({ surfaceId: 'XComponent-' + id });
        } catch (e) { layoutWarnings.push(`XComponentNode.onCreate 抛错：${e && e.message}`); }
      }, 0);
    }
    return el;
  });
  class XComponentNodeHost {
    /** @param {any} uiContext @param {any} options @param {any} id @param {any} type @param {any=} [libraryName] */
    constructor(uiContext, options, id, type, libraryName) {
      const self = /** @type {any} */ (this);
      self.__xcn = /** @type {any} */ ({
        uiContext: uiContext || null,                // DOM 运行时不使用 UIContext，仅存档
        options: options || null,
        id: String(id === undefined ? '' : id),
        type: type,
        libraryName: libraryName === undefined ? '' : String(libraryName),
        renderType: 0,                               // NodeRenderType.RENDER_TYPE_DISPLAY
        hostEl: null,
        created: false,
        destroyed: false,
      });
      if (self.__xcn.id) xcNodeRegistry.set(self.__xcn.id, self);
    }
    /** @param {any=} [event] */
    onCreate(event) {
      const w = /** @type {any} */ (this).__xcn;
      if (w) { w.created = true; w.lastCreateEvent = event || null; }
    }
    onDestroy() {
      const w = /** @type {any} */ (this).__xcn;
      if (w) w.destroyed = true;
    }
    /** @param {any} type */
    changeRenderType(type) {
      const w = /** @type {any} */ (this).__xcn;
      const ok = type === 0 || type === 1;
      if (!w) return ok;
      if (!ok) {
        layoutWarnings.push(`XComponentNode.changeRenderType(${String(type)}): 非法 NodeRenderType，返回 false`);
        return false;
      }
      w.renderType = type;
      if (w.hostEl) w.hostEl.dataset.renderType = String(type);
      return true;
    }
    /** @param {HTMLElement} el */
    __arkuiBindHost(el) {
      const w = /** @type {any} */ (this).__xcn;
      if (w) w.hostEl = el;
    }
  }
  // 类面作导出名；create/pop 从声明式面的 ensureComponent 实例借来（同一闭包，行为一致）
  const XComponentNode = /** @type {any} */ (XComponentNodeHost);
  XComponentNode.create = XComponentNodeComp.create;
  XComponentNode.pop = XComponentNodeComp.pop;
