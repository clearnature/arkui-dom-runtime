  // ────────────────── 批量输入收官（R66）：CheckboxGroup / ColorPicker / ColorPickerDialog
  //  / Option / PatternLock / SelectionContainer ──────────────────
  //
  // 语义锚点（SDK 实测路径）：
  //   • checkboxgroup.d.ts（全文已读）：CheckboxGroup(options?: {group?: string})；
  //     selectAll(boolean)、selectedColor、unselectedColor、mark(MarkStyle)、
  //     onChange(CheckboxGroupResult { name: string[], status: SelectStatus })、
  //     checkboxShape(CheckBoxShape)、contentModifier(21+)。
  //     SelectStatus 按声明顺序：All=0 / Part=1 / None=2（enums 声明不带初值）。
  //   • pattern_lock.d.ts（全文已读）：PatternLock(controller?)；sideLength/circleRadius/
  //     backgroundColor/regularColor/selectedColor/activeColor/pathColor/pathStrokeWidth/
  //     onPatternComplete(Array<number>)/autoReset/onDotConnect(number)/
  //     activateCircleStyle({color,radius,enableWaveEffect,enableForeground})/
  //     skipUnselectedPoint（⚠️ d.ts 有、ets-loader pattern_lock.json 无）。
  //     PatternLockController: reset() / setChallengeResult(PatternLockChallengeResult
  //     {CORRECT=1, WRONG=2}，d.ts 显式赋值）。onPatternComplete 的点位编号 d.ts 未写死，
  //     本实现取官方文档惯例 1~9（行优先）；取舍记录在此，测试按 1 基断言。
  //   • api/@ohos.arkui.components.SelectionContainer.d.ts（全文已读）：
  //     SelectionContainer({controller})；copyOption/caretColor/selectedBackgroundColor/
  //     enableHapticFeedback/textJoinStyle(NEWLINE=0/DIRECT=1)/bindSelectionMenu/
  //     editMenuOptions/onTextSelectionChange(Callback<Array<string>>)/
  //     onWillCopy((content)=>boolean)/onCopy((content)=>void)。
  //     SelectionContainerController: closeSelectionMenu() / clearTextSelection()。
  //   • ⚠️ ColorPicker / ColorPickerDialog / Option：本 SDK 安装里【没有 d.ts】
  //     （component/、api/、ets-loader/declarations/ 三处 grep 均无）。
  //     唯一权威是 ets-loader 组件表（本机实测路径 build-tools/ets-loader/components/）：
  //       colorPicker.json        attrs: colors, onSelect, setAlignment, setColunms, setRows
  //                               （"setColunms" 是 SDK 原始拼写——setColumns 的笔误，原样保留）
  //       colorPickerDialog.json  attrs: show
  //       option.json             parents: [Menu]；attrs: fontColor, fontSize, fontWeight, fontFamily
  //     三者的 create 签名/回调参数形状官方未在本机 SDK 出面，本实现按 attrs 表 +
  //     ArkUI 同族语义外推，凡外推处都有注释标记；colors/onSelect 用于 ColorPickerDialog
  //     属外推超集（JSON 只列 show），取舍在此记录。
  //
  // DOM 映射：
  //   CheckboxGroup → 原生 <input type=checkbox>（全选母 Checkbox，Part 态走 indeterminate）；
  //     组员同步：优先找带 data-arkui-checkbox-group="<组名>" 标记的原生 checkbox（标记
  //     约定见 docs；input.js 的 Checkbox 目前不落 group，补一行 dataset 即生效）；
  //     无标记时退化为"页面上全部真 Checkbox"（排除 Toggle：input.js 给 Toggle 落
  //     data-toggle-type，Checkbox 没有——可据此区分）；多组并存时退化路径会串组，
  //     每个母 Checkbox 只报一次 layoutWarning，不静默。
  //   PatternLock → div（CSS grid 3×3 点位）+ SVG 连线层；pointer 手势驱动。
  //   SelectionContainer → div（user-select:text）；selectionchange/copy 事件派发回调。
  //   Option → Menu（popup.js 的 flex 列 div）里的行式菜单项（同族 MenuItem 形态）。
  //   ColorPicker → CSS grid 色块阵；ColorPickerDialog → fixed 遮罩 + 居中卡片。
  //
  // 事件派发纪律（坑 86 同族）：onSelect/onPatternComplete/onDotConnect/
  // onTextSelectionChange/onCopy/onWillCopy 全是函数值——必须抢在通用 on* 规则之前登记，
  // 否则会变成永不触发的 DOM 事件监听。统一走 __arkuiBatchIn 标记 + BATCHINPUT_ATTRS
  // 单分派分支（需要的 area.js 接线见分片报告）。
  const SelectStatus = { All: 0, Part: 1, None: 2 };              // checkboxgroup.d.ts 声明顺序
  const CopyOptions = { None: 0, InApp: 1, LocalDevice: 2 };      // enums.d.ts:3229（None=0/InApp=1/LocalDevice=2）
  const CheckBoxShape = { CIRCLE: 0, ROUNDED_SQUARE: 1 };         // enums.d.ts:29（显式赋值）
  const PatternLockChallengeResult = { CORRECT: 1, WRONG: 2 };    // pattern_lock.d.ts 显式赋值
  const SelectionContainerTextJoinStyle = { NEWLINE: 0, DIRECT: 1 }; // SelectionContainer.d.ts 显式赋值

  // ── CheckboxGroup：组员发现与全选同步 ──
  // 组员标记约定：原生 checkbox 带 data-arkui-checkbox-group="<组名>" 即属于该组。
  // input.js 的 Checkbox.create({name, group}) 目前丢弃 group（input.js:39-41 只落 name），
  // 补一行 `el.dataset.arkuiCheckboxGroup = String(o.group)` 即可让本发现路径精确命中。
  /** @type {Set<any>} */
  const cgMasters = new Set();                                    // 页面上所有 CheckboxGroup 母节点
  /** @param {any} master @returns {any[]} */
  const cgMembers = (master) => {
    const g = master.__cg.group;
    // ① 精确路径：带组标记的原生 checkbox（不含母节点自身、不含 Toggle）
    const marked = Array.from((master.ownerDocument || document)
      .querySelectorAll('input[type=checkbox][data-arkui-checkbox-group]'))
      .filter((/** @type {any} */ m) => m !== master && m.dataset.arkuiCheckboxGroup === g);
    if (marked.length) return marked;
    // ② 退化路径：整页所有"真 Checkbox"（Toggle 有 data-toggle-type，Checkbox 没有）
    const all = Array.from((master.ownerDocument || document)
      .querySelectorAll('input[type=checkbox]:not([data-toggle-type])'))
      .filter((/** @type {any} */ m) => m !== master && !m.__cgClaimed);
    if (cgMasters.size > 1) {
      // 多组并存时退化路径会串组（组员无法按组名区分）——只报一次，不静默
      if (!master.__cg.warnedFallback) {
        master.__cg.warnedFallback = true;
        layoutWarnings.push(`CheckboxGroup('${g}') 组员发现退化为全页 Checkbox`
          + '（无 data-arkui-checkbox-group 标记）；多组并存会串组，请给 Checkbox 落组标记');
      }
    }
    all.forEach((/** @type {any} */ m) => { m.__cgClaimed = master; });   // 先到先得，减少串组面
    return all;
  };
  /** @param {any[]} members @returns {number} SelectStatus（All/Part/None） */
  const cgStatusOf = (members) => {
    if (!members.length) return -1;                                 // 无组员：由母节点自态决定
    const on = members.filter((/** @type {any} */ m) => m.checked).length;
    if (on === members.length) return SelectStatus.All;
    return on === 0 ? SelectStatus.None : SelectStatus.Part;
  };
  /** @param {any} master @param {boolean=} [fire] */
  const cgSyncAndFire = (master, fire) => {
    const w = master.__cg;
    const members = cgMembers(master);
    members.forEach((/** @type {any} */ m) => { m.checked = w.all; });     // 编程同步不派发 change（DOM 语义，input.js 同取舍）
    const st = cgStatusOf(members);
    const status = st === -1 ? (w.all ? SelectStatus.All : SelectStatus.None) : st;
    master.indeterminate = status === SelectStatus.Part;
    master.dataset.status = String(status);
    if (fire !== false && typeof w.cbs.change === 'function') {
      const names = members.filter((/** @type {any} */ m) => m.checked)
        .map((/** @type {any} */ m) => String(m.name || ''));
      try { w.cbs.change({ name: names, status }); }
      catch (e) { layoutWarnings.push(`CheckboxGroup.onChange 派发抛错：${e && e.message}`); }
    }
  };
  // 组员自态变化 → 组状态变化也要发 CheckboxGroup.onChange（d.ts："Triggered when the
  // selected status of the check box group or any check box wherein changes"）。
  // 单个捕获监听统一收口；未认领的组员且页面恰有一个组 → 自动认领（单组演示页成立）。
  document.addEventListener('change', (/** @type {Event} */ e) => {
    const t = /** @type {any} */ (e.target);
    // Toggle 不参与；母节点自身的 change 由工厂 click 处理器收口（这里只收组员）
    if (!t || t.type !== 'checkbox' || t.dataset.toggleType || t.__cg) return;
    let master = t.__cgClaimed;
    if (!master && t.dataset.arkuiCheckboxGroup) {
      master = Array.from(cgMasters).find((/** @type {any} */ m) => m.__cg.group === t.dataset.arkuiCheckboxGroup) || null;
      if (master) t.__cgClaimed = master;
    }
    if (!master && cgMasters.size === 1) {
      master = Array.from(cgMasters)[0];
      t.__cgClaimed = master;
    }
    if (!master) return;
    const members = cgMembers(master);
    const st = cgStatusOf(members);
    const status = st === -1 ? (master.checked ? SelectStatus.All : SelectStatus.None) : st;
    master.indeterminate = status === SelectStatus.Part;
    master.__cg.all = status === SelectStatus.All;
    master.checked = status === SelectStatus.All;
    master.dataset.status = String(status);
    if (typeof master.__cg.cbs.change === 'function') {
      const names = members.filter((/** @type {any} */ m) => m.checked).map((/** @type {any} */ m) => String(m.name || ''));
      try { master.__cg.cbs.change({ name: names, status }); }
      catch (err) { layoutWarnings.push(`CheckboxGroup.onChange(组员) 派发抛错：${err && err.message}`); }
    }
  }, true);

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const BATCHINPUT_ATTRS = {
    // ── CheckboxGroup ──
    selectAll: (n, v) => {
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      n.__cg.all = !!v;
      n.checked = !!v;
      cgSyncAndFire(n);                                             // selectAll 走完整"同步+派发"路径
    },
    // selectedColor 双组件同名属性合并为一个条目（同一对象字面量禁止同名键，TS1117）：
    // 按 __arkuiComp 身份分身守卫 —— CheckboxGroup 走 accentColor，PatternLock 走状态袋
    selectedColor: (n, v) => {
      if (n.__arkuiComp === 'CheckboxGroup') { n.style.accentColor = colorOf(v); return; }
      if (n.__arkuiComp === 'PatternLock') {
        const w = n.__patternLock; if (!w) return;
        w.selectedColor = colorOf(v);
        n.dataset.selectedColor = w.selectedColor;
      }
    },
    unselectedColor: (n, v) => { if (n.__arkuiComp === 'CheckboxGroup') n.dataset.unselectedColor = colorOf(v); },
    mark: (n, v) => { if (n.__arkuiComp === 'CheckboxGroup') n.dataset.mark = JSON.stringify(v); },
    checkboxShape: (n, v) => {
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      const s = Number(resolveResource(v));                         // CheckBoxShape：CIRCLE=0 / ROUNDED_SQUARE=1
      n.dataset.checkboxShape = String(s);
      n.style.borderRadius = s === 0 ? '50%' : '';
    },
    contentModifier: (n, v) => {
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      n.dataset.contentModifier = 'recorded';
      layoutWarnings.push('CheckboxGroup.contentModifier 记 data-*（自定义内容区本实现未渲染）');
    },
    onChange: (n, v) => {
      // 六件里只有 CheckboxGroup 的 onChange 是语义回调；其余组件没有该属性，
      // 走不到这条（分派按 __arkuiBatchIn 身份 + 表名双保险）
      if (n.__arkuiComp !== 'CheckboxGroup') return;
      n.__cg.cbs.change = v;
    },
    // ── ColorPicker（ets-loader colorPicker.json attrs）──
    colors: (n, v) => {
      const w = n.__batchPicker; if (!w) return;
      w.colors = Array.isArray(v) ? v : [];
      if (w.kind === 'grid') w.rebuild();
      else if (w.kind === 'dialog') w.rebuildDialog();
    },
    onSelect: (n, v) => {
      const w = n.__batchPicker; if (!w) return;
      w.cbs.select = v;
    },
    setColunms: (n, v) => {                                         // SDK 原始拼写（setColumns 笔误），原样接
      const w = n.__batchPicker; if (!w) return;
      w.cols = Number(resolveResource(v)) || 0;
      if (w.kind === 'grid') w.el.style.gridTemplateColumns = w.cols > 0 ? `repeat(${w.cols}, 1fr)` : '';
      else n.dataset.cols = String(w.cols);
    },
    setRows: (n, v) => {
      const w = n.__batchPicker; if (!w) return;
      w.rows = Number(resolveResource(v)) || 0;
      if (w.kind === 'grid') w.el.style.gridTemplateRows = w.rows > 0 ? `repeat(${w.rows}, 1fr)` : '';
      else n.dataset.rows = String(w.rows);
    },
    setAlignment: (n, v) => {
      // 无 d.ts，取值形状官方未出面：字符串按 CSS 对齐关键字透传，其余记 data-*
      const w = n.__batchPicker; if (!w) return;
      w.alignment = v;
      n.dataset.alignment = String(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
      if (typeof v === 'string') { n.style.justifyItems = v; n.style.alignItems = v; }
    },
    // ── ColorPickerDialog（ets-loader colorPickerDialog.json attrs：show；colors/onSelect 为外推超集）──
    show: (n, v) => {
      const w = n.__batchPicker; if (!w || w.kind !== 'dialog') return;
      const on = v === true || v === 'true';
      n.style.display = on ? '' : 'none';                           // 显隐整个遮罩（卡片随遮罩）
      n.dataset.show = String(on);
    },
    // ── PatternLock（pattern_lock.d.ts）──
    sideLength: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') { n.dataset.sideLength = String(resolveResource(v)); return; }
      const s = toCssSize(v);
      n.style.width = s; n.style.height = s;
      n.dataset.sideLength = s;
      if (n.__patternLock) n.__patternLock.layout();
    },
    circleRadius: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') { n.dataset.circleRadius = String(resolveResource(v)); return; }
      const w = n.__patternLock; if (!w) return;
      w.radius = Number(resolveResource(v)) || 14;
      n.dataset.circleRadius = String(w.radius);
      w.layout();
    },
    regularColor: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      n.dataset.regularColor = colorOf(v);
      n.querySelectorAll('[data-pl-dot]').forEach((/** @type {any} */ d) => { d.style.borderColor = colorOf(v); });
    },
    // selectedColor 已并入上方 CheckboxGroup 段的合并条目（同名键 TS1117，按 __arkuiComp 分身守卫）
    activeColor: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.activeColor = colorOf(v);
      n.dataset.activeColor = w.activeColor;
    },
    pathColor: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.pathColor = colorOf(v);
      n.dataset.pathColor = w.pathColor;
      const line = n.querySelector('[data-pl-line]');
      if (line) line.setAttribute('stroke', w.pathColor);
    },
    pathStrokeWidth: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.strokeWidth = Number(resolveResource(v)) || 6;
      n.dataset.pathStrokeWidth = String(w.strokeWidth);
      const line = n.querySelector('[data-pl-line]');
      if (line) line.setAttribute('stroke-width', String(w.strokeWidth));
    },
    autoReset: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.autoReset = v !== false;                                    // .d.ts 默认 true
      n.dataset.autoReset = String(w.autoReset);
    },
    skipUnselectedPoint: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      w.skipUnselected = !!v;                                       // d.ts 有、ets-loader 表无——按 d.ts 补面
      n.dataset.skipUnselectedPoint = String(w.skipUnselected);
    },
    activateCircleStyle: (n, v) => {
      if (n.__arkuiComp !== 'PatternLock') return;
      const w = n.__patternLock; if (!w) return;
      const o = (v && typeof v === 'object') ? v : {};
      w.actColor = o.color !== undefined ? colorOf(o.color) : w.actColor;
      if (o.radius !== undefined) w.actRadius = Number(resolveResource(o.radius)) || w.actRadius;
      w.actWave = !!o.enableWaveEffect;
      w.actForeground = !!o.enableForeground;
      n.dataset.activateCircleStyle = JSON.stringify(o);
      w.layout();
    },
    onPatternComplete: (n, v) => {
      const w = n.__patternLock; if (!w) return;
      w.cbs.complete = v;
    },
    onDotConnect: (n, v) => {
      const w = n.__patternLock; if (!w) return;
      w.cbs.dotConnect = v;
    },
    // ── SelectionContainer（@ohos.arkui.components.SelectionContainer.d.ts）──
    copyOption: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.copyOption = Number(resolveResource(v));
      n.dataset.copyOption = String(w.copyOption);
    },
    caretColor: (n, v) => {
      if (!n.__selContainer) return;
      n.dataset.caretColor = colorOf(v);                            // 光标色只在可编辑区可见，DOM 选择容器记 data-*
    },
    selectedBackgroundColor: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.selBg = colorOf(v);
      n.dataset.selectedBackgroundColor = w.selBg;
      if (!w.styleEl) {                                             // ::selection 只能走样式表（每实例一条规则）
        w.styleEl = document.createElement('style');
        document.head.appendChild(w.styleEl);
      }
      w.styleEl.textContent = `[data-arkui-selc="${w.seq}"]::selection{background:${w.selBg}}`
        + `[data-arkui-selc="${w.seq}"]::-moz-selection{background:${w.selBg}}`;
    },
    enableHapticFeedback: (n, v) => {
      if (!n.__selContainer) return;
      n.dataset.enableHapticFeedback = String(!!v);                 // DOM 无触感反馈，只记录
    },
    textJoinStyle: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.joinStyle = Number(resolveResource(v));                     // NEWLINE=0 / DIRECT=1
      n.dataset.textJoinStyle = String(w.joinStyle);
    },
    bindSelectionMenu: (n, v) => {
      if (!n.__selContainer) return;
      n.dataset.bindSelectionMenu = 'recorded';
      layoutWarnings.push('SelectionContainer.bindSelectionMenu 记 data-*（选择菜单本实现不渲染）');
    },
    editMenuOptions: (n, v) => {
      if (!n.__selContainer) return;
      const w = n.__selContainer;
      w.editMenu = v;
      n.dataset.editMenuOptions = 'recorded';
    },
    onTextSelectionChange: (n, v) => {
      const w = n.__selContainer; if (!w) return;
      w.cbs.selectionChange = v;
    },
    onWillCopy: (n, v) => {
      const w = n.__selContainer; if (!w) return;
      w.cbs.willCopy = v;
    },
    onCopy: (n, v) => {
      const w = n.__selContainer; if (!w) return;
      w.cbs.copy = v;
    },
  };

  // ── CheckboxGroup（checkboxgroup.d.ts）──
  /** @param {any[]} args */
  const CheckboxGroup = ensureComponent('CheckboxGroup', (args) => {
    const el = document.createElement('input');
    el.style.display = 'inline-block';
    (/** @type {any} */ (el)).type = 'checkbox';
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const w = /** @type {any} */ (el).__cg = /** @type {any} */ ({
      group: o.group !== undefined && o.group !== null ? String(resolveResource(o.group)) : '',
      all: false,
      cbs: {},
      warnedFallback: false,
    });
    el.dataset.checkboxGroup = w.group;
    cgMasters.add(el);
    // 点击母 Checkbox：全选 ↔ 全不选翻转，同步组员并派发 onChange
    el.addEventListener('click', () => {
      w.all = el.checked;
      cgSyncAndFire(el);
    });
    return el;
  });

  // ── PatternLock（pattern_lock.d.ts）──
  // 控制器：产物里是 `new PatternLockController()` 自由变量引用，须挂 global。
  // 绑定走 __el 弱关联（create(args) 的 args[0] 就是控制器本身）。
  class PatternLockController {
    constructor() { this.__el = /** @type {any} */ (null); }
    reset() {
      if (this.__el && this.__el.__patternLock) this.__el.__patternLock.reset();
      else layoutWarnings.push('PatternLockController.reset: 尚未绑定到任何 PatternLock');
    }
    /** @param {number} result */
    setChallengeResult(result) {
      if (!this.__el || !this.__el.__patternLock) {
        layoutWarnings.push('PatternLockController.setChallengeResult: 尚未绑定到任何 PatternLock');
        return;
      }
      const w = this.__el.__patternLock;
      w.challenge = Number(result);                                 // CORRECT=1 / WRONG=2（d.ts 显式赋值）
      this.__el.dataset.challengeResult = String(w.challenge);
      this.__el.classList.remove('pl-wrong', 'pl-correct');
      this.__el.classList.add(w.challenge === PatternLockChallengeResult.WRONG ? 'pl-wrong' : 'pl-correct');
    }
  }
  /** @param {number} a @param {number} b 相邻判（skipUnselectedPoint 用）：相邻点才可直连 */
  const isAdjacent = (a, b) => {
    const ra = Math.floor((a - 1) / 3), ca = (a - 1) % 3;
    const rb = Math.floor((b - 1) / 3), cb = (b - 1) % 3;
    return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
  };
  /** @param {any[]} args */
  const PatternLock = ensureComponent('PatternLock', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    Object.assign(el.style, {
      position: 'relative', touchAction: 'none', boxSizing: 'border-box',
      width: '300px', height: '300px',                             // .d.ts 默认 sideLength 300vp
    });
    // SVG 连线层（viewBox 随 sideLength 重算，点位坐标即像素）
    const svg = svgEl('svg', { 'data-pl-svg': '', width: '100%', height: '100%' });
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.pointerEvents = 'none';
    const line = svgEl('polyline', {
      'data-pl-line': '', fill: 'none', stroke: '#007dff', 'stroke-width': '6',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', visibility: 'hidden',
    });
    svg.appendChild(line);
    el.appendChild(svg);
    // 9 个点位（行优先 1..9），网格坐标由 layout() 摆放
    /** @type {any[]} */
    const dots = [];
    for (let i = 1; i <= 9; i++) {
      const d = document.createElement('div');
      d.setAttribute('data-pl-dot', String(i));
      Object.assign(d.style, {
        position: 'absolute', boxSizing: 'border-box', borderRadius: '50%',
        border: '2px solid #b3b7bb', background: 'transparent',
      });
      el.appendChild(d);
      dots.push(d);
    }
    const w = /** @type {any} */ (el).__patternLock = /** @type {any} */ ({
      seq: [],
      drawing: false,
      radius: 14, strokeWidth: 6,
      side: 300,                                                    // .d.ts 默认 sideLength 300vp
      autoReset: true,
      skipUnselected: false,
      regularColor: '#b3b7bb', selectedColor: '#007dff', activeColor: '#007dff',
      pathColor: '#007dff', actColor: '', actRadius: 0, actWave: false, actForeground: false,
      challenge: 0,
      cbs: {},
      dots,
    });
    // 摆放：3×3 网格中心坐标 = (col+0.5)/3 × side；点直径 = 2×circleRadius
    w.layout = () => {
      const side = el.clientWidth || w.side;
      for (let i = 0; i < 9; i++) {
        const d = /** @type {any} */ (dots[i]);
        const cx = (((i % 3) + 0.5) / 3) * side;
        const cy = ((Math.floor(i / 3) + 0.5) / 3) * side;
        const rr = w.radius;
        d.style.left = (cx - rr) + 'px';
        d.style.top = (cy - rr) + 'px';
        d.style.width = (rr * 2) + 'px';
        d.style.height = (rr * 2) + 'px';
      }
      svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
    };
    // 选中/激活态上色
    /** @param {number} i @param {string} color */
    const paintDot = (i, color) => {
      const d = /** @type {any} */ (dots[i - 1]);
      d.style.borderColor = color;
      if (w.actColor && color === w.selectedColor) {
        d.style.background = w.actColor;                            // activateCircleStyle.color 外环填充近似
        d.style.boxShadow = (w.actRadius > w.radius)
          ? `0 0 0 ${(w.actRadius - w.radius).toFixed(2)}px ${w.actColor}33` : '';
      }
    };
    /** @param {number} i */
    const connectDot = (i) => {
      if (w.seq.includes(i)) return;
      w.seq.push(i);
      paintDot(i, w.selectedColor);
      el.dataset.lastDot = String(i);
      el.dataset.sequence = w.seq.join('-');
      if (typeof w.cbs.dotConnect === 'function') {
        try { w.cbs.dotConnect(i); }
        catch (e) { layoutWarnings.push(`PatternLock.onDotConnect 派发抛错：${e && e.message}`); }
      }
    };
    /** @param {number[]} seq */
    const drawPath = (seq) => {
      const side = el.clientWidth || w.side;
      const pts = seq.map((/** @type {number} */ i) => {
        const k = i - 1;
        return `${(((k % 3) + 0.5) / 3) * side},${((Math.floor(k / 3) + 0.5) / 3) * side}`;
      }).join(' ');
      line.setAttribute('points', pts);
      line.setAttribute('stroke', w.pathColor);
      line.setAttribute('stroke-width', String(w.strokeWidth));
      line.setAttribute('visibility', seq.length ? 'visible' : 'hidden');
    };
    w.reset = () => {
      w.seq = [];
      w.drawing = false;
      el.dataset.sequence = '';
      dots.forEach((/** @type {any} */ d) => {
        d.style.borderColor = w.regularColor;
        d.style.background = 'transparent';
        d.style.boxShadow = '';
      });
      line.setAttribute('visibility', 'hidden');
    };
    /** @param {PointerEvent} e */
    const hitDot = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const d = /** @type {any} */ (t && (t.closest ? t.closest('[data-pl-dot]') : null));
      return d ? Number(d.getAttribute('data-pl-dot')) : 0;
    };
    el.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
      w.reset();
      w.drawing = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 无捕获时退化为 elementFromPoint 命中 */ }
      const i = hitDot(e);
      if (i) connectDot(i);
      drawPath(w.seq);
    });
    el.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
      if (!w.drawing) return;
      const i = hitDot(e);
      if (!i) return;
      if (w.seq.includes(i)) return;
      // skipUnselectedPoint(true)：跨过的未选中点不自动入串（d.ts 属性语义）
      if (w.skipUnselected && w.seq.length && !isAdjacent(w.seq[w.seq.length - 1], i)) return;
      connectDot(i);
      drawPath(w.seq);
    });
    el.addEventListener('pointerup', () => {
      if (!w.drawing) return;
      w.drawing = false;
      const out = w.seq.slice();
      if (typeof w.cbs.complete === 'function') {
        try { w.cbs.complete(out); }
        catch (e) { layoutWarnings.push(`PatternLock.onPatternComplete 派发抛错：${e && e.message}`); }
      }
      el.dataset.completed = out.join('-');
      if (w.autoReset) setTimeout(() => { w.reset(); }, 300);       // autoReset（默认 true）：完成即重置
    });
    // 初始摆放：等一次布局（clientWidth 才可信），与 Stepper 的 setTimeout(syncStepper,0) 同理
    setTimeout(() => { w.layout(); w.reset(); }, 0);
    // create(args)：args[0] 就是 controller 本体（PatternLockInterface 单参）
    const c = args && args[0];
    if (c && typeof c.reset === 'function' && 'setChallengeResult' in c) c.__el = el;
    return el;
  });

  // ── SelectionContainer（@ohos.arkui.components.SelectionContainer.d.ts）──
  class SelectionContainerController {
    constructor() { this.__el = /** @type {any} */ (null); }
    closeSelectionMenu() {
      if (!this.__el || !this.__el.__selContainer) {
        layoutWarnings.push('SelectionContainerController.closeSelectionMenu: 尚未绑定');
        return;
      }
      this.__el.__selContainer.menuOpen = false;
      this.__el.dataset.selectionMenu = 'closed';
    }
    clearTextSelection() {
      const w = this.__el && this.__el.__selContainer;
      if (!w) { layoutWarnings.push('SelectionContainerController.clearTextSelection: 尚未绑定'); return; }
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      w.lastTexts = [];
      if (typeof w.cbs.selectionChange === 'function') {
        try { w.cbs.selectionChange([]); }
        catch (e) { layoutWarnings.push(`SelectionContainer.onTextSelectionChange 派发抛错：${e && e.message}`); }
      }
    }
  }
  /** @type {number} */ let selcSeq = 0;
  /** @param {any[]} args */
  const SelectionContainer = ensureComponent('SelectionContainer', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    Object.assign(el.style, { userSelect: 'text', WebkitUserSelect: 'text' });
    const my = ++selcSeq;
    el.setAttribute('data-arkui-selc', String(my));
    const w = /** @type {any} */ (el).__selContainer = /** @type {any} */ ({
      seq: my,
      copyOption: CopyOptions.InApp,                                // Text 族同款缺省（copyOption 缺省 InApp）
      joinStyle: SelectionContainerTextJoinStyle.NEWLINE,
      selBg: '', styleEl: null, editMenu: null,
      menuOpen: false,
      lastTexts: [],
      cbs: {},
    });
    // create({controller})：SelectionContainerOptions.controller 必填（d.ts）
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.controller && typeof o.controller === 'object') o.controller.__el = el;
    // 选区文本收集：range 与容器求交，逐 range 取克隆文本（数组形态对齐 d.ts Callback<Array<string>>）
    /** @returns {string[]} */
    const collect = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return [];
      /** @type {string[]} */
      const out = [];
      for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i);
        if (!el.contains(r.commonAncestorContainer)) continue;
        const frag = r.cloneContents();
        const holder = document.createElement('div');
        holder.appendChild(frag);
        const text = (holder.textContent || '').trim();
        if (text) out.push(text);
      }
      return out;
    };
    let selTimer = 0;
    const onSelChange = () => {
      if (selTimer) return;
      selTimer = setTimeout(() => {
        selTimer = 0;
        const texts = collect();
        if (texts.length === 0 && w.lastTexts.length === 0) return;   // 空选区只发一次（离开选择不发重复空）
        w.lastTexts = texts;
        if (typeof w.cbs.selectionChange === 'function') {
          try { w.cbs.selectionChange(texts); }
          catch (e) { layoutWarnings.push(`SelectionContainer.onTextSelectionChange 派发抛错：${e && e.message}`); }
        }
      }, 0);
    };
    document.addEventListener('selectionchange', onSelChange);
    el.addEventListener('copy', (/** @type {ClipboardEvent} */ e) => {
      const texts = collect();
      const content = texts.join(w.joinStyle === SelectionContainerTextJoinStyle.NEWLINE ? '\n' : '');
      // copyOption None=0：禁止复制（preventDefault）；其余档位放行
      if (w.copyOption === CopyOptions.None) { e.preventDefault(); return; }
      if (typeof w.cbs.willCopy === 'function') {
        let ok = true;
        try { ok = w.cbs.willCopy(content) !== false; }              // Callback<string, boolean>：false 拦截
        catch (err) { layoutWarnings.push(`SelectionContainer.onWillCopy 派发抛错：${err && err.message}`); }
        if (!ok) { e.preventDefault(); return; }
      }
      if (e.clipboardData) e.clipboardData.setData('text/plain', content);
      e.preventDefault();
      el.dataset.lastCopied = content;
      if (typeof w.cbs.copy === 'function') {
        try { w.cbs.copy(content); }
        catch (err) { layoutWarnings.push(`SelectionContainer.onCopy 派发抛错：${err && err.message}`); }
      }
    });
    return el;
  });

  // ── Option（ets-loader option.json：parents=[Menu]，attrs=字体四件）──
  // ⚠️ 无 d.ts：create 签名官方未在本机 SDK 出面。取宽容形态：字符串或 {value, icon?}。
  // 字体四件（fontColor/fontSize/fontWeight/fontFamily）不进本表——cssPropSize/cssPropRaw
  // 通用落点已覆盖（fontColor→color 等），别处拦会吞掉通用路径。
  /** @param {any[]} args */
  const Option = ensureComponent('Option', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    el.dataset.option = '';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.cursor = 'pointer';
    el.style.padding = '4px 8px';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? (args[0] || {})
      : { value: args && args[0] !== undefined ? args[0] : '' };
    if (o.icon !== undefined && o.icon !== null) {
      const ic = document.createElement('span');
      ic.setAttribute('data-option-icon', '');
      ic.textContent = String(resolveResource(o.icon));
      el.appendChild(ic);
    }
    const text = document.createElement('span');
    text.setAttribute('data-option-value', '');
    text.textContent = String(resolveResource(o.value === undefined ? '' : o.value));
    el.appendChild(text);
    // 点击：记录选中并派发 CustomEvent（attrs 表无 onSelect——点击消费方是 Menu/Select，
    // DOM 侧用事件冒泡给宿主，不虚构 attrs 表之外的属性）
    el.addEventListener('click', () => {
      el.dataset.selected = 'true';
      el.dispatchEvent(new CustomEvent('optionselect', { bubbles: true, detail: { value: text.textContent } }));
    });
    return el;
  });

  // ── ColorPicker（ets-loader colorPicker.json）──
  /** @param {any[]} args @param {string} kind 'grid'=组件本体 / 'dialog'=对话框内嵌 */
  function buildPickerGrid(args, kind) {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiBatchIn = true;
    Object.assign(el.style, { display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(5, 28px)' });
    const w = /** @type {any} */ (el).__batchPicker = /** @type {any} */ ({
      kind, el,
      colors: [], cols: 0, rows: 0, alignment: '',
      cbs: {},
      /** 按当前 colors 重建色块阵 */
      rebuild: () => {
        el.querySelectorAll('[data-swatch]').forEach((/** @type {any} */ s) => s.remove());
        w.colors.forEach((/** @type {any} */ c) => {
          const sw = document.createElement('div');
          sw.setAttribute('data-swatch', '');
          sw.dataset.color = colorOf(c);
          Object.assign(sw.style, {
            width: '28px', height: '28px', borderRadius: '4px',
            background: colorOf(c), cursor: 'pointer', boxSizing: 'border-box',
          });
          sw.addEventListener('click', () => {
            el.querySelectorAll('[data-swatch]').forEach((/** @type {any} */ s) => {
              s.style.border = 'none'; s.dataset.selected = 'false';
            });
            sw.style.border = '2px solid #1a1a1a';
            sw.dataset.selected = 'true';
            el.dataset.lastColor = sw.dataset.color;
            if (typeof w.cbs.select === 'function') {
              try { w.cbs.select(sw.dataset.color); }
              catch (e) { layoutWarnings.push(`ColorPicker.onSelect 派发抛错：${e && e.message}`); }
            }
          });
          el.appendChild(sw);
        });
      },
      /** 对话框形态：colors 落到内嵌网格（外推超集，见头注） */
      rebuildDialog: () => {
        if (!w.gridEl || !w.gridEl.__batchPicker) return;
        w.gridEl.__batchPicker.colors = w.colors;
        w.gridEl.__batchPicker.cbs = w.cbs;
        w.gridEl.__batchPicker.rebuild();
      },
      card: /** @type {any} */ (null),
      gridEl: /** @type {any} */ (null),
    });
    if (kind === 'dialog') {
      // fixed 遮罩 + 居中卡片：show(true/false) 只切卡片显示（BATCHINPUT_ATTRS.show）
      el.style.position = 'fixed';
      el.style.inset = '0';
      el.style.background = 'rgba(0,0,0,0.3)';
      el.style.display = 'none';                                    // 缺省隐藏（show 控制）
      el.style.zIndex = '999';
      const card = document.createElement('div');
      card.setAttribute('data-picker-card', '');
      Object.assign(card.style, {
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        background: '#fff', borderRadius: '8px', padding: '12px',
      });
      const grid = buildPickerGrid([], 'grid');
      grid.removeAttribute('data-arkui-comp');                      // 内嵌网格不冒充独立组件
      (/** @type {any} */ (grid)).__arkuiBatchIn = false;
      w.card = card;
      w.gridEl = grid;
      card.appendChild(grid);
      el.appendChild(card);
    }
    if (args && Array.isArray(args[0])) {                           // 宽容：create([...colors]) 直落
      w.colors = args[0];
      if (kind === 'grid') w.rebuild(); else w.rebuildDialog();
    }
    return el;
  }
  /** @param {any[]} args */
  const ColorPicker = ensureComponent('ColorPicker', (args) => buildPickerGrid(args, 'grid'));
  /** @param {any[]} args */
  const ColorPickerDialog = ensureComponent('ColorPickerDialog', (args) => buildPickerGrid(args, 'dialog'));
