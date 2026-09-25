// ────────────────── 运行时的类型词汇表（R38 渐进强类型化）──────────────────
//
// 这个文件只服务 `npm run typecheck`（tsc --checkJs 检查【拼接后的产物】），
// 【不】参与 build-runtime 拼接（build-runtime 只按 @include 链取 .js，自动忽略 .d.ts）。
//
// 为什么检查产物而不是分片：15 个分片在运行时是【同一个 IIFE 的函数作用域片段】
//（`resolveResource` 等声明在 main.js 的 IIFE 体内），按文件检查会得到 153 个假的
// "Cannot find name"；按产物检查的作用域模型与运行时完全一致。
//
// 这里做的事：与 lib.dom 的 Element/HTMLElement 做【声明合并】，把运行时挂在 DOM
// 元素上的状态字段（`el.__stepCbs = ...` 这类）固化成接口词汇表——此后拼错字段名、
// 漏挂状态在 typecheck 直接红。类型取"最窄的可信类型"：动态记录一律 Record<string, any>
// （如实：这些记录天生是动态的），标量取 number/boolean。

interface Element {
  // ── 组件身份标记（applyAttr 分发链靠它们路由，见 area.js）──
  __arkuiComp?: string;                    // 组件注册名（Text/Button/…）
  __arkuiStepper?: boolean;                // Stepper 根
  __arkuiStepperItem?: boolean;            // StepperItem 根
  __arkuiStepperIndex?: number;            // Stepper 当前页
  __arkuiStepperGo?: (i: number) => void;  // Stepper 编程跳页（测试内省用）
  __arkuiStepperSync?: () => void;         // Stepper 重汇入（label/status 回报）
  __arkuiInput?: string;                   // 输入类基座标记（'input'|'checkbox'…）
  __arkuiShow?: string;                    // 信息展示类（值 = 组件名 'Badge'/'Counter'/…）
  __arkuiSpan?: boolean;
  __arkuiLoading?: boolean;
  __arkuiBlank?: any;                      // Blank.min 等 create 参数暂存

  __arkuiLink?: boolean;                   // Hyperlink（原生 <a>）
  __arkuiHref?: string;
  __arkuiCanvas?: boolean;
  __arkuiCanvasFlag?: boolean;
  __arkuiCanvasCtx?: any;
  __arkuiCanvasOnReady?: any;
  __arkuiReadyScheduled?: boolean;
  __arkuiNative?: boolean;                 // 原生控件基座（input[range] 等）
  __arkuiEditable?: any;
  __arkuiBindEditable?: (el: Element) => void;
  __arkuiBindXComponent?: any;
  __arkuiCheckedApplied?: boolean;         // checkbox/radio 幂等 diff（坑 88 同族）
  __arkuiQrValue?: string;
  __arkuiQrFg?: string;
  __arkuiQrBg?: string;
  __arkuiQrOpacity?: any;
  __arkuiQrPending?: boolean;
  __arkuiXComponentFlag?: boolean;
  __arkuiXcId?: string;
  __arkuiXcEl?: Element;
  __arkuiXcRect?: any;
  __arkuiXcOnLoad?: any;
  __arkuiXcOnDestroy?: any;
  __arkuiXcScheduled?: boolean;
  __arkuiGestureState?: any;
  // Image（R45）：回调袋用 `x = x || {}` 惯用法 → any（坑 92）
  __arkuiImage?: boolean;
  __arkuiScroll?: boolean;
  __arkuiAnimator?: boolean;
  __arkuiLig?: boolean;
  __arkuiRefresh?: boolean;
  __arkuiDatePicker?: boolean;
  __arkuiTimePicker?: boolean;
  __tp?: any;
  __tpCbs?: any;
  __tpRender?: () => void;
  __tpFireChange?: () => void;
  __tpStep?: (col: string, dir: number) => void;
  __dp?: any;
  __dpCbs?: any;
  __rf?: any;
  __rfCbs?: any;
  __rfApplyRefreshing?: (on: boolean) => void;
  __rfEnterRefresh?: () => void;
  __arkuiWaterFlow?: boolean;
  __wf?: any;
  __wfCbs?: any;
  __arkuiFlowItem?: boolean;
  __arkuiCalPick?: boolean;
  __calp?: any;
  __arkuiTextPick?: boolean;
  __txp?: any;
  __txpStep?: (dir: number) => void;
  __txpStepCol?: (c: number, dir: number) => void;
  __arkuiGrid?: boolean;
  __grid?: any;
  __gridCbs?: any;
  __arkuiGridItem?: boolean;
  __arkuiTextClock?: boolean;
  __tclock?: any;
  __arkuiTextTimer?: boolean;
  __ttimer?: any;
  __arkuiAlphabetIndexer?: boolean;
  __aix?: any;
  __arkuiLeaf?: boolean;
  __arkuiSideBar?: boolean;
  __sbc?: any;
  __sbcApply?: () => void;
  __lig?: any;
  __an?: any;
  __anCbs?: any;
  __anApplyState?: (v: number) => void;
  __scrollCbs?: any;
  __imgCbs?: any;
  __arkuiImgTryAlt?: () => void;
  __arkuiImgEnsureAlt?: () => HTMLImageElement;
  __arkuiImgFireIfDone?: () => void;
  __arkuiImgLoaded?: boolean;
  __arkuiImgFailed?: boolean;
  __arkuiTransition?: any;
  __arkuiFreshMount?: boolean;
  __arkuiSettings?: any;
  __areaCbs?: any;
  __animStyle?: any;

  // ── 分发表 / 回调槽 ──
  // 这些回调袋用 `x = x || {}` 惯用法初始化：字段类型必须 any，否则 `{} | Record` 坍缩成 {}
  __stepCbs?: any;                         // Stepper 五事件（onChange/onNext/…）
  __marqueeCbs?: any;
  __counterCbs?: any;
  __popupCbs?: any;
  __navDestCbs?: any;
  __arkuiPopup?: any;                      // 弹出类身份（'Select'/'Menu'/'MenuItem'）
  __arkuiOnReadyCbs?: any;                 // Canvas onReady 回调列表
  __onChange?: unknown[];                  // Rating 的监听列表
  __arkuiEv?: any;                         // 通用 on* 注册表（覆盖语义，坑 88）

  // ── 布局 / 绘制 / 形状 ──
  __drawKind?: string;
  __rating?: number;
  __arkuiBlankMin?: number;
  __drawOpts?: any;
  __svg?: SVGElement;
  __shapeEl?: Element;
  __fill?: any;                            // Shape 容器继承路径上会被赋节点
  __stroke?: string | number;
  __strokeW?: string | number;
  __strokeColor?: string;
  __colors?: unknown[] | null;
  __startAngle?: number;
  __endAngle?: number;
  __ratio?: number;
  __step?: number;
  __starCount?: number;
  __panelType?: string;
  __panelColors?: unknown[] | null;
  __panelMax?: number;
  __interactive?: boolean;
  __group?: string;
  __values?: unknown[];
  __min?: number;
  __max?: number;
  __alignRules?: Record<string, any>;
  __guideLines?: unknown[];
  __guideLineBoxes?: unknown[];
  __maxLines?: number;
  __textOverflow?: string;
  __lastMeasure?: any;
  __item?: any;

  // ── Tabs / Swiper / Navigation ──
  __tabsState?: any;
  __tabBarLabel?: any;
  __tabContentRendered?: boolean;
  __tabContentOf?: (el: Element) => Element | null;
  __swiperState?: any;
  __navState?: any;
  __navDest?: any;
  __mask?: any;

  // ── 状态 / 框架内部 ──
  __v2?: any;
  __providedVars?: Map<string, any>;
  __localStorage?: any;
  __extraInfo?: any;
  __elmtId?: number;
  __viewId?: number;
  __theme?: any;
  __parent?: any;
  __aboutToAppearDone?: boolean;
}
