/*
 * 自动生成，请勿手改 —— 由 tools/gen-components.mjs 从
 * <CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/components/*.json 生成。
 * 重新生成： node tools/gen-components.mjs
 * 组件数: 149
 */
(function (global) {
  'use strict';
  global.__ARKUI_COMPONENTS = {
 "AbilityComponent": {
  "attrs": [
   "onReady",
   "onDestroy",
   "onAbilityCreated",
   "onAbilityMoveToFront",
   "onAbilityWillRemove",
   "onConnect",
   "onDisconnect"
  ],
  "children": [],
  "file": "ability_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "AlphabetIndexer": {
  "attrs": [
   "onSelected",
   "selectedColor",
   "popupColor",
   "selectedBackgroundColor",
   "popupBackground",
   "usingPopup",
   "selectedFont",
   "popupFont",
   "itemSize",
   "font",
   "color",
   "alignStyle",
   "onRequestPopupData",
   "onPopupSelect",
   "selected",
   "popupPosition",
   "onSelect",
   "popupItemFont",
   "popupItemBackgroundColor",
   "popupSelectedColor",
   "popupUnselectedColor",
   "autoCollapse",
   "popupItemBorderRadius",
   "itemBorderRadius",
   "popupBackgroundBlurStyle",
   "popupTitleBackground",
   "enableHapticFeedback"
  ],
  "children": [],
  "file": "alphabet_indexer.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Animator": {
  "attrs": [
   "state",
   "duration",
   "curve",
   "delay",
   "fillMode",
   "iterations",
   "playMode",
   "motion",
   "onStart",
   "onPause",
   "onRepeat",
   "onCancel",
   "onFinish",
   "onFrame"
  ],
  "children": [],
  "file": "animator.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ArcList": {
  "attrs": [
   "digitalCrownSensitivity",
   "space",
   "scrollBar",
   "scrollBarColor",
   "scrollBarWidth",
   "cachedCount",
   "chainAnimation",
   "childrenMainSize",
   "enableScrollInteraction",
   "fadingEdge",
   "friction",
   "flingSpeedLimit",
   "onScrollIndex",
   "onReachStart",
   "onReachEnd",
   "onScrollStart",
   "onScrollStop",
   "onWillScroll",
   "onDidScroll"
  ],
  "children": [
   "ArcListItem"
  ],
  "file": "arcList.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ArcListItem": {
  "attrs": [
   "autoScale",
   "swipeAction"
  ],
  "children": [],
  "file": "arcListItem.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ArcAlphabetIndexer": {
  "attrs": [
   "color",
   "selectedColor",
   "popupColor",
   "selectedBackgroundColor",
   "popupBackground",
   "usePopup",
   "selectedFont",
   "popupFont",
   "itemSize",
   "font",
   "selected",
   "onSelect",
   "autoCollapse",
   "popupBackgroundBlurStyle"
  ],
  "children": [],
  "file": "arc_alphabet_indexer.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ArcScrollBar": {
  "attrs": [],
  "children": [],
  "file": "arc_scrollbar.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ArcSwiper": {
  "attrs": [
   "index",
   "indicator",
   "duration",
   "vertical",
   "disableSwipe",
   "digitalCrownSensitivity",
   "onChange",
   "onAnimationStart",
   "onAnimationEnd",
   "onGestureSwipe",
   "effectMode",
   "customContentTransition",
   "disableTransitionAnimation"
  ],
  "children": [],
  "file": "arc_swiper.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Badge": {
  "attrs": [],
  "children": [],
  "file": "badge.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "inline-block",
   "position": "relative"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Blank": {
  "attrs": [
   "color"
  ],
  "children": [],
  "file": "blank.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {
   "flexGrow": "1",
   "alignSelf": "stretch"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Button": {
  "attrs": [
   "type",
   "stateEffect",
   "fontColor",
   "fontSize",
   "fontWeight",
   "fontStyle",
   "fontFamily",
   "controlSize",
   "role",
   "contentModifier",
   "labelStyle",
   "buttonStyle",
   "minFontScale",
   "maxFontScale"
  ],
  "children": [],
  "file": "button.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "inline-flex",
   "alignItems": "center",
   "justifyContent": "center"
  },
  "inputType": null,
  "factories": [
   "create",
   "createWithLabel",
   "createWithIcon",
   "createWithChild"
  ]
 },
 "Calendar": {
  "attrs": [
   "date",
   "showLunar",
   "startOfWeek",
   "offDays",
   "onSelectChange",
   "onRequestData",
   "currentData",
   "preData",
   "nextData",
   "needSlide",
   "showHoliday",
   "direction",
   "currentDayStyle",
   "nonCurrentDayStyle",
   "todayStyle",
   "weekStyle",
   "workStateStyle"
  ],
  "children": [],
  "file": "calendar.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "CalendarPicker": {
  "attrs": [
   "edgeAlign",
   "textStyle",
   "onChange",
   "markToday"
  ],
  "children": [],
  "file": "calendarPicker.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Camera": {
  "attrs": [
   "devicePosition"
  ],
  "children": [],
  "file": "camera.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Canvas": {
  "attrs": [
   "onReady",
   "enableAnalyzer"
  ],
  "children": [],
  "file": "canvas.json",
  "tag": "canvas",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Checkbox": {
  "attrs": [
   "select",
   "selectedColor",
   "onChange",
   "shape",
   "unselectedColor",
   "mark",
   "contentModifier"
  ],
  "children": [],
  "file": "checkbox.json",
  "tag": "input",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": "checkbox",
  "factories": [
   "create"
  ]
 },
 "CheckboxGroup": {
  "attrs": [
   "selectAll",
   "selectedColor",
   "onChange",
   "unselectedColor",
   "mark",
   "checkboxShape"
  ],
  "children": [],
  "file": "checkboxgroup.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Circle": {
  "attrs": [],
  "children": [],
  "file": "circle.json",
  "tag": "circle",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ColorPicker": {
  "attrs": [
   "colors",
   "onSelect",
   "setAlignment",
   "setColunms",
   "setRows"
  ],
  "children": [],
  "file": "colorPicker.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ColorPickerDialog": {
  "attrs": [
   "show"
  ],
  "children": [],
  "file": "colorPickerDialog.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Column": {
  "attrs": [
   "alignItems",
   "justifyContent",
   "reverse"
  ],
  "children": [],
  "file": "column.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex",
   "flexDirection": "column"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ColumnSplit": {
  "attrs": [
   "resizeable",
   "divider"
  ],
  "children": [],
  "file": "column_split.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Component3D": {
  "attrs": [
   "environment",
   "customRender",
   "shader",
   "shaderImageTexture",
   "shaderInputBuffer",
   "renderWidth",
   "renderHeight"
  ],
  "children": [],
  "file": "component3d.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ContainerReader": {
  "attrs": [
   "breakpointConfig"
  ],
  "children": [],
  "file": "container_reader.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ContainerSpan": {
  "attrs": [
   "textBackgroundStyle",
   "attributeModifier"
  ],
  "children": [
   "Span",
   "ImageSpan"
  ],
  "file": "container_span.json",
  "tag": "span",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ContentSlot": {
  "attrs": [],
  "children": [],
  "file": "content_slot.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Counter": {
  "attrs": [
   "onStateChange",
   "onInc",
   "onDec",
   "height",
   "width",
   "enableDec",
   "enableInc"
  ],
  "children": [],
  "file": "counter.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "inline-flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DataPanel": {
  "attrs": [
   "closeEffect",
   "valueColors",
   "trackBackgroundColor",
   "strokeWidth",
   "trackShadow",
   "contentModifier"
  ],
  "children": [],
  "file": "datapanel.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DatePicker": {
  "attrs": [
   "lunar",
   "onChange",
   "useMilitaryTime",
   "disappearTextStyle",
   "textStyle",
   "selectedTextStyle",
   "onDateChange",
   "enableHapticFeedback"
  ],
  "children": [],
  "file": "datePicker.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DepthComponent": {
  "attrs": [
   "depthMap",
   "camera",
   "light",
   "backgroundOffset",
   "backgroundScale"
  ],
  "children": [],
  "file": "depth_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DistortionComponent": {
  "attrs": [],
  "children": [],
  "file": "distortion_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Divider": {
  "attrs": [
   "color",
   "vertical",
   "strokeWidth",
   "lineCap"
  ],
  "children": [],
  "file": "divider.json",
  "tag": "hr",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DotMatrix": {
  "attrs": [
   "dotSpacing",
   "dotMatrixEffects",
   "onEffectChanged"
  ],
  "children": [],
  "file": "dot_matrix.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DynamicLayout": {
  "attrs": [],
  "children": [],
  "file": "dynamicLayout.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "DynamicComponent": {
  "attrs": [
   "onError"
  ],
  "children": [],
  "file": "dynamic_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "EffectComponent": {
  "attrs": [],
  "children": [],
  "file": "effect_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Ellipse": {
  "attrs": [],
  "children": [],
  "file": "ellipse.json",
  "tag": "ellipse",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "EmbeddedComponent": {
  "attrs": [
   "onTerminated",
   "onError"
  ],
  "children": [],
  "file": "embedded_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Flex": {
  "attrs": [],
  "children": [],
  "file": "flex.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex",
   "flexDirection": "row",
   "flexWrap": "wrap"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "FlowItem": {
  "attrs": [],
  "children": [],
  "file": "flow_item.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "FolderStack": {
  "attrs": [
   "alignContent",
   "onFolderStateChange",
   "onHoverStatusChange",
   "enableAnimation",
   "autoHalfFold"
  ],
  "children": [],
  "file": "folder_stack.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "FormComponent": {
  "attrs": [
   "size",
   "moduleName",
   "dimension",
   "allowUpdate",
   "visibility",
   "onAcquired",
   "onError",
   "onRouter",
   "onUninstall"
  ],
  "children": [],
  "file": "form_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "FormLink": {
  "attrs": [],
  "children": [],
  "file": "form_link.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "FrictionMotion": {
  "attrs": [],
  "children": [],
  "file": "friction_motion.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Gauge": {
  "attrs": [
   "value",
   "startAngle",
   "endAngle",
   "colors",
   "strokeWidth",
   "labelConfig",
   "description",
   "trackShadow",
   "indicator",
   "contentModifier",
   "privacySensitive"
  ],
  "children": [],
  "file": "gauge.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "GeometryView": {
  "attrs": [],
  "children": [],
  "file": "geometryView.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Grid": {
  "attrs": [
   "columnsTemplate",
   "rowsTemplate",
   "columnsGap",
   "rowsGap",
   "scrollBar",
   "scrollBarWidth",
   "scrollBarColor",
   "editMode",
   "editModeOptions",
   "maxCount",
   "minCount",
   "cellLength",
   "onItemDragStart",
   "onItemDragMove",
   "onItemDragEnter",
   "onItemDrop",
   "layoutDirection",
   "direction",
   "supportAnimation",
   "onItemDragLeave",
   "multiSelectable",
   "onScrollIndex",
   "edgeEffect",
   "onScrollBarUpdate",
   "enableScrollInteraction",
   "fadingEdge",
   "onScrollStart",
   "onScroll",
   "onScrollStop",
   "onWillScroll",
   "onDidScroll",
   "cachedCount",
   "nestedScroll",
   "friction",
   "alignItems",
   "onReachStart",
   "onReachEnd",
   "onScrollFrameBegin",
   "flingSpeedLimit",
   "clipContent",
   "backToTop",
   "focusWrapMode",
   "onWillStopDragging",
   "syncLoad",
   "onWillStartDragging",
   "onDidStopDragging",
   "onWillStartFling",
   "onDidStopFling",
   "contentStartOffset",
   "contentEndOffset",
   "supportEmptyBranchInLazyLoading",
   "autoAdjustScrollBarMargin",
   "enableScrollWithMouse",
   "enableEditMode",
   "onEditModeChange",
   "scrollBarHeight"
  ],
  "children": [
   "GridItem"
  ],
  "file": "grid.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "grid",
   "overflow": "auto",
   "position": "relative"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "GridItem": {
  "attrs": [
   "rowStart",
   "rowEnd",
   "columnStart",
   "columnEnd",
   "forceRebuild",
   "selectable",
   "onSelect",
   "selected"
  ],
  "children": [],
  "file": "gridItem.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "GridCol": {
  "attrs": [
   "span",
   "offset",
   "order",
   "gridColOffset"
  ],
  "children": [],
  "file": "grid_col.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "GridContainer": {
  "attrs": [
   "columns",
   "sizeType",
   "gutter",
   "margin"
  ],
  "children": [],
  "file": "grid_container.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "GridRow": {
  "attrs": [
   "onBreakpointChange",
   "alignItems"
  ],
  "children": [
   "GridCol"
  ],
  "file": "grid_row.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "grid"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Hyperlink": {
  "attrs": [
   "color"
  ],
  "children": [
   "Image"
  ],
  "file": "hyperlink.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Image": {
  "attrs": [
   "alt",
   "objectFit",
   "matchTextDirection",
   "fitOriginalSize",
   "objectRepeat",
   "renderMode",
   "interpolation",
   "onComplete",
   "onError",
   "onFinish",
   "sourceSize",
   "fillColor",
   "autoResize",
   "syncLoad",
   "resizable",
   "dynamicRangeMode",
   "orientation",
   "colorFilter",
   "copyOption",
   "draggable",
   "enableAnalyzer",
   "privacySensitive",
   "imageMatrix"
  ],
  "children": [],
  "file": "image.json",
  "tag": "img",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create",
   "createWithUri"
  ]
 },
 "ImageAnimator": {
  "attrs": [
   "images",
   "state",
   "duration",
   "reverse",
   "fixedSize",
   "preDecode",
   "fillMode",
   "iterations",
   "onStart",
   "onPause",
   "onRepeat",
   "onCancel",
   "onFinish"
  ],
  "children": [],
  "file": "image_animator.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ImageSpan": {
  "attrs": [
   "verticalAlign",
   "objectFit",
   "textBackgroundStyle",
   "alt",
   "colorFilter",
   "onComplete",
   "onError"
  ],
  "children": [],
  "file": "image_span.json",
  "tag": "span",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "IndicatorComponent": {
  "attrs": [
   "initialIndex",
   "count",
   "onChange",
   "style",
   "loop",
   "vertical"
  ],
  "children": [],
  "file": "indicatorcomponent.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "IsolatedComponent": {
  "attrs": [
   "onError"
  ],
  "children": [],
  "file": "isolated_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "LazyColumnLayout": {
  "attrs": [
   "space",
   "alignItems",
   "header",
   "footer",
   "sticky",
   "onVisibleIndexesChange"
  ],
  "children": [],
  "file": "lazy_column_layout.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "LazyDynamicLayout": {
  "attrs": [
   "onVisibleIndexesChange"
  ],
  "children": [],
  "file": "lazy_dynamic_layout.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "LazyVGridLayout": {
  "attrs": [
   "rowsGap",
   "columnsGap",
   "columnsTemplate",
   "header",
   "footer",
   "sticky",
   "onVisibleIndexesChange"
  ],
  "children": [],
  "file": "lazy_v_grid_layout.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "LazyVWaterFlowLayout": {
  "attrs": [
   "rowsGap",
   "columnsGap",
   "columnsTemplate",
   "header",
   "footer",
   "sticky",
   "onVisibleIndexesChange"
  ],
  "children": [],
  "file": "lazy_v_water_flow_layout.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Line": {
  "attrs": [
   "startPoint",
   "endPoint"
  ],
  "children": [],
  "file": "line.json",
  "tag": "line",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "List": {
  "attrs": [
   "listDirection",
   "scrollBar",
   "edgeEffect",
   "divider",
   "editMode",
   "editModeOptions",
   "cachedCount",
   "sticky",
   "chainAnimation",
   "lanes",
   "onScroll",
   "onReachStart",
   "onReachEnd",
   "onScrollStop",
   "onItemDelete",
   "onItemMove",
   "onItemDragStart",
   "onItemDragEnter",
   "onItemDragMove",
   "onItemDragLeave",
   "onItemDrop",
   "multiSelectable",
   "enableScrollInteraction",
   "onScrollIndex",
   "onScrollBegin",
   "scrollSnapAlign",
   "fadingEdge",
   "alignListItem",
   "nestedScroll",
   "friction",
   "contentStartOffset",
   "contentEndOffset",
   "childrenMainSize",
   "maintainVisibleContentPosition",
   "onScrollFrameBegin",
   "onScrollStart",
   "onScrollVisibleContentChange",
   "flingSpeedLimit",
   "clipContent",
   "onWillScroll",
   "onDidScroll",
   "scrollBarColor",
   "scrollBarWidth",
   "backToTop",
   "stackFromEnd",
   "focusWrapMode",
   "onWillStopDragging",
   "syncLoad",
   "onWillStartDragging",
   "onDidStopDragging",
   "onWillStartFling",
   "onDidStopFling",
   "supportEmptyBranchInLazyLoading",
   "SetBackPressBehavior",
   "autoAdjustScrollBarMargin",
   "enableScrollWithMouse",
   "enableEditMode",
   "onEditModeChange",
   "scrollBarHeight"
  ],
  "children": [
   "ListItem",
   "Section",
   "ListItemGroup",
   "LazyVGridLayout",
   "LazyVWaterFlowLayout",
   "LazyColumnLayout",
   "LazyDynamicLayout"
  ],
  "file": "list.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex",
   "flexDirection": "column",
   "overflow": "auto",
   "position": "relative"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ListItem": {
  "attrs": [
   "sticky",
   "editable",
   "selectable",
   "swipeAction",
   "onSelect",
   "selected"
  ],
  "children": [],
  "file": "listItem.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ListItemGroup": {
  "attrs": [
   "divider",
   "childrenMainSize"
  ],
  "children": [
   "ListItem"
  ],
  "file": "listItemGroup.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "LoadingProgress": {
  "attrs": [
   "color",
   "enableLoading",
   "contentModifier"
  ],
  "children": [],
  "file": "loadingProgress.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "LocationButton": {
  "attrs": [
   "iconSize",
   "layoutDirection",
   "position",
   "markAnchor",
   "offset",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "fontColor",
   "iconColor",
   "backgroundColor",
   "borderStyle",
   "borderWidth",
   "borderColor",
   "borderRadius",
   "padding",
   "textIconSpace",
   "onClick",
   "key"
  ],
  "children": [],
  "file": "location_button.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Marquee": {
  "attrs": [
   "fontColor",
   "fontSize",
   "allowScale",
   "fontWeight",
   "fontFamily",
   "onStart",
   "onBounce",
   "onFinish",
   "marqueeUpdateStrategy",
   "onStart",
   "onBounce",
   "onFinish"
  ],
  "children": [],
  "file": "marquee.json",
  "tag": "span",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "MediaCachedImage": {
  "attrs": [
   "objectFit",
   "matchTextDirection",
   "fitOriginalSize",
   "objectRepeat",
   "renderMode",
   "interpolation",
   "onComplete",
   "onError",
   "onFinish",
   "sourceSize",
   "fillColor",
   "autoResize"
  ],
  "children": [],
  "file": "media_cached_image.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Menu": {
  "attrs": [
   "show",
   "showPosition",
   "fontColor",
   "fontSize",
   "fontWeight",
   "fontFamily",
   "font",
   "radius",
   "menuItemDivider",
   "menuItemGroupDivider",
   "subMenuExpandingMode"
  ],
  "children": [
   "Option",
   "MenuItem",
   "MenuItemGroup"
  ],
  "file": "menu.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "MenuItem": {
  "attrs": [
   "selectIcon",
   "onChange",
   "selected",
   "contentFont",
   "contentFontColor",
   "labelFont",
   "labelFontColor",
   "subMenuBuilder"
  ],
  "children": [],
  "file": "menu_item.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "MenuItemGroup": {
  "attrs": [],
  "children": [
   "MenuItem"
  ],
  "file": "menu_item_group.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "NavDestination": {
  "attrs": [
   "title",
   "hideTitleBar",
   "toolbarConfiguration",
   "hideToolBar",
   "mode",
   "backButtonIcon",
   "menus",
   "ignoreLayoutSafeArea",
   "systemBarStyle",
   "onShown",
   "onHidden",
   "onWillAppear",
   "onWillShow",
   "onWillHide",
   "onWillDisappear",
   "onBackPressed",
   "onReady"
  ],
  "children": [],
  "file": "nav_destination.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "NavRouter": {
  "attrs": [
   "onStateChange",
   "mode"
  ],
  "children": [],
  "file": "nav_router.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Navigation": {
  "attrs": [
   "title",
   "subTitle",
   "hideTitleBar",
   "hideBackButton",
   "titleMode",
   "menus",
   "menuCount",
   "toolBar",
   "hideToolBar",
   "onTitleModeChange",
   "onNavBarStateChange",
   "navBarWidth",
   "navBarPosition",
   "mode",
   "backButtonIcon",
   "hideNavBar",
   "navDestination",
   "minContentWidth",
   "ignoreLayoutSafeArea",
   "navBarWidthRange",
   "systemBarStyle",
   "toolbarConfiguration",
   "onNavigationModeChange",
   "customNavContentTransition"
  ],
  "children": [],
  "file": "navigation.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Navigator": {
  "attrs": [
   "target",
   "type",
   "params",
   "active"
  ],
  "children": [],
  "file": "navigator.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "NodeContainer": {
  "attrs": [],
  "children": [],
  "file": "nodeContainer.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Option": {
  "attrs": [
   "fontColor",
   "fontSize",
   "fontWeight",
   "fontFamily"
  ],
  "children": [],
  "file": "option.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "PageTransitionEnter": {
  "attrs": [
   "onEnter"
  ],
  "children": [],
  "file": "pageTransition_enter.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "PageTransitionExit": {
  "attrs": [
   "onExit"
  ],
  "children": [],
  "file": "pageTransition_exit.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Panel": {
  "attrs": [
   "type",
   "mode",
   "dragBar",
   "customHeight",
   "fullHeight",
   "backgroundMask",
   "halfHeight",
   "miniHeight",
   "show",
   "onChange",
   "onHeightChange",
   "showCloseIcon"
  ],
  "children": [],
  "file": "panel.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Particle": {
  "attrs": [],
  "children": [],
  "file": "particle.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "PasteButton": {
  "attrs": [
   "iconSize",
   "layoutDirection",
   "position",
   "markAnchor",
   "offset",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "fontColor",
   "iconColor",
   "backgroundColor",
   "borderStyle",
   "borderWidth",
   "borderColor",
   "borderRadius",
   "padding",
   "textIconSpace",
   "onClick",
   "key"
  ],
  "children": [],
  "file": "paste_button.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Path": {
  "attrs": [
   "commands"
  ],
  "children": [],
  "file": "path.json",
  "tag": "path",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "PatternLock": {
  "attrs": [
   "sideLength",
   "circleRadius",
   "backgroundColor",
   "regularColor",
   "selectedColor",
   "activeColor",
   "pathColor",
   "pathStrokeWidth",
   "onPatternComplete",
   "autoReset",
   "onDotConnect",
   "activateCircleStyle"
  ],
  "children": [],
  "file": "pattern_lock.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Piece": {
  "attrs": [
   "iconPosition",
   "fontColor",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "showDelete",
   "onClose"
  ],
  "children": [],
  "file": "piece.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "PluginComponent": {
  "attrs": [
   "size",
   "onComplete",
   "onError"
  ],
  "children": [],
  "file": "plugin_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Polygon": {
  "attrs": [
   "points"
  ],
  "children": [],
  "file": "polygon.json",
  "tag": "polygon",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Polyline": {
  "attrs": [
   "points"
  ],
  "children": [],
  "file": "polyline.json",
  "tag": "polyline",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Progress": {
  "attrs": [
   "value",
   "color",
   "cricularStyle",
   "circularStyle",
   "style",
   "contentModifier",
   "privacySensitive"
  ],
  "children": [],
  "file": "progress.json",
  "tag": "progress",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "QRCode": {
  "attrs": [
   "color",
   "backgroundColor",
   "contentOpacity"
  ],
  "children": [],
  "file": "qrcode.json",
  "tag": "canvas",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Radio": {
  "attrs": [
   "checked",
   "onChange",
   "radioStyle",
   "contentModifier"
  ],
  "children": [],
  "file": "radio.json",
  "tag": "input",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": "radio",
  "factories": [
   "create"
  ]
 },
 "Rating": {
  "attrs": [
   "stars",
   "stepSize",
   "starStyle",
   "onChange",
   "contentModifier"
  ],
  "children": [],
  "file": "rating.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Rect": {
  "attrs": [
   "radiusWidth",
   "radiusHeight",
   "radius"
  ],
  "children": [],
  "file": "rect.json",
  "tag": "rect",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Refresh": {
  "attrs": [
   "onStateChange",
   "onRefreshing",
   "refreshOffset",
   "pullToRefresh",
   "pullDownRatio",
   "onOffsetChange",
   "pullUpToCancelRefresh"
  ],
  "children": [],
  "file": "refresh.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "RelativeContainer": {
  "attrs": [
   "guideLine",
   "barrier"
  ],
  "children": [],
  "file": "relative_container.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block",
   "position": "relative"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "RemoteWindow": {
  "attrs": [
   "WindowAnimationTarget"
  ],
  "children": [],
  "file": "remote_window.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Repeat": {
  "attrs": [
   "each",
   "key",
   "onMove",
   "template",
   "templateId",
   "virtualScroll"
  ],
  "children": [],
  "file": "repeat.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "RichEditor": {
  "attrs": [
   "onReady",
   "onSelect",
   "aboutToIMEInput",
   "onIMEInputComplete",
   "aboutToDelete",
   "onDeleteComplete",
   "onSelectionChange",
   "bindSelectionMenu",
   "copyOptions",
   "enableDataDetector",
   "dataDetectorConfig",
   "placeholder",
   "onDidIMEInput",
   "onEditingChange",
   "onWillChange",
   "onDidChange"
  ],
  "children": [],
  "file": "rich_editor.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "RichText": {
  "attrs": [
   "onStart",
   "onComplete"
  ],
  "children": [],
  "file": "rich_text.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "RootScene": {
  "attrs": [],
  "children": [],
  "file": "root_scene.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Row": {
  "attrs": [
   "alignItems",
   "justifyContent",
   "reverse"
  ],
  "children": [],
  "file": "row.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex",
   "flexDirection": "row"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "RowSplit": {
  "attrs": [
   "resizeable"
  ],
  "children": [],
  "file": "row_split.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SaveButton": {
  "attrs": [
   "iconSize",
   "layoutDirection",
   "position",
   "markAnchor",
   "offset",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "fontColor",
   "iconColor",
   "backgroundColor",
   "borderStyle",
   "borderWidth",
   "borderColor",
   "borderRadius",
   "padding",
   "textIconSpace",
   "onClick",
   "key"
  ],
  "children": [],
  "file": "save_button.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Screen": {
  "attrs": [],
  "children": [],
  "file": "screen.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Scroll": {
  "attrs": [
   "scrollable",
   "onScroll",
   "onScrollEdge",
   "onScrollEnd",
   "scrollBar",
   "scrollBarColor",
   "scrollBarWidth",
   "edgeEffect",
   "enableScrollInteraction",
   "onScrollBegin",
   "scrollSnap",
   "nestedScroll",
   "friction",
   "enablePaging",
   "initialOffset",
   "onScrollFrameBegin",
   "onWillScroll",
   "onDidScroll",
   "onScrollStart",
   "onScrollStop",
   "flingSpeedLimit",
   "fadingEdge",
   "clipContent",
   "onReachStart",
   "onReachEnd",
   "backToTop",
   "onWillStopDragging",
   "maxZoomScale",
   "minZoomScale",
   "zoomScale",
   "enableBouncesZoom",
   "onDidZoom",
   "onZoomStart",
   "onZoomStop",
   "onWillStartDragging",
   "onDidStopDragging",
   "onWillStartFling",
   "onDidStopFling",
   "contentStartOffset",
   "contentEndOffset",
   "autoAdjustScrollBarMargin",
   "enableScrollWithMouse",
   "scrollBarHeight"
  ],
  "children": [],
  "file": "scroll.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block",
   "overflow": "auto",
   "position": "relative"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ScrollBar": {
  "attrs": [
   "enableNestedScroll"
  ],
  "children": [],
  "file": "scroll_bar.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "ScrollMotion": {
  "attrs": [],
  "children": [],
  "file": "scroll_motion.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Search": {
  "attrs": [
   "searchButton",
   "placeholderColor",
   "placeholderFont",
   "textFont",
   "minFontSize",
   "maxFontSize",
   "decoration",
   "letterSpacing",
   "lineHeight",
   "onSubmit",
   "onChange",
   "onCopy",
   "onCut",
   "onPaste",
   "copyOption",
   "enableKeyboardOnFocus",
   "onTextSelectionChange",
   "onContentScroll",
   "selectionMenuHidden",
   "enterKeyType",
   "textAlign",
   "searchIcon",
   "cancelButton",
   "fontColor",
   "caretStyle",
   "customKeyboard",
   "type",
   "maxLength",
   "fontFeature",
   "selectedBackgroundColor",
   "inputFilter",
   "textIndent",
   "onEditChange",
   "enablePreviewText",
   "editMenuOptions",
   "onWillInsert",
   "onDidInsert",
   "onWillDelete",
   "onDidDelete",
   "enableHapticFeedback",
   "constructor",
   "caretPosition",
   "setTextSelection",
   "stopEditing"
  ],
  "children": [],
  "file": "search.json",
  "tag": "input",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": "search",
  "factories": [
   "create"
  ]
 },
 "Section": {
  "attrs": [],
  "children": [],
  "file": "section.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SecurityUIExtensionComponent": {
  "attrs": [
   "onError",
   "onReceive",
   "onRemoteReady",
   "onTerminated"
  ],
  "children": [],
  "file": "security_ui_extension_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Select": {
  "attrs": [
   "selected",
   "value",
   "font",
   "fontColor",
   "selectedOptionBgColor",
   "selectedOptionFont",
   "selectedOptionFontColor",
   "optionBgColor",
   "optionFont",
   "optionFontColor",
   "onSelect",
   "menuAlign",
   "optionWidth",
   "optionHeight",
   "controlSize",
   "menuItemContentModifier",
   "divider",
   "menuBackgroundColor",
   "menuBackgroundBlurStyle",
   "arrowPosition",
   "space",
   "showInSubWindow",
   "showDefaultSelectedIcon"
  ],
  "children": [],
  "file": "select.json",
  "tag": "select",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SelectionContainer": {
  "attrs": [
   "copyOption",
   "caretColor",
   "selectedBackgroundColor",
   "enableHapticFeedback",
   "textJoinStyle",
   "bindSelectionMenu",
   "editMenuOptions",
   "onTextSelectionChange",
   "onWillCopy",
   "onCopy"
  ],
  "children": [],
  "file": "selection_container.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Shape": {
  "attrs": [
   "stroke",
   "fill",
   "strokeDashOffset",
   "strokeLineCap",
   "strokeLineJoin",
   "strokeMiterLimit",
   "strokeOpacity",
   "fillOpacity",
   "strokeWidth",
   "antiAlias",
   "strokeDashArray",
   "viewPort",
   "mesh"
  ],
  "children": [
   "Rect",
   "Path",
   "Circle",
   "Ellipse",
   "Shape",
   "Polyline",
   "Polygon",
   "Image",
   "Text",
   "Column",
   "Row"
  ],
  "file": "shape.json",
  "tag": "svg",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Sheet": {
  "attrs": [],
  "children": [
   "Section"
  ],
  "file": "sheet.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SideBarContainer": {
  "attrs": [
   "showSideBar",
   "controlButton",
   "showControlButton",
   "onChange",
   "sideBarWidth",
   "minSideBarWidth",
   "maxSideBarWidth",
   "autoHide",
   "sideBarPosition",
   "minContentWidth",
   "divider"
  ],
  "children": [],
  "file": "sideBar_container.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Skeleton2d": {
  "attrs": [],
  "children": [],
  "file": "skeleton2d.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Slider": {
  "attrs": [
   "blockColor",
   "trackColor",
   "selectedColor",
   "minLabel",
   "maxLabel",
   "showSteps",
   "showTips",
   "trackThickness",
   "onChange",
   "blockBorderColor",
   "blockBorderWidth",
   "stepColor",
   "trackBorderRadius",
   "selectedBorderRadius",
   "blockStyle",
   "blockSize",
   "sliderInteractionMode",
   "slideRange",
   "minResponsiveDistance",
   "stepSize",
   "contentModifier",
   "enableHapticFeedback"
  ],
  "children": [],
  "file": "slider.json",
  "tag": "input",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": "range",
  "factories": [
   "create"
  ]
 },
 "Span": {
  "attrs": [
   "fontColor",
   "fontSize",
   "fontStyle",
   "fontFamily",
   "fontWeight",
   "decoration",
   "letterSpacing",
   "textCase",
   "font",
   "textBackgroundStyle",
   "lineHeight",
   "textShadow",
   "baselineOffset"
  ],
  "children": [],
  "file": "span.json",
  "tag": "span",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SpringMotion": {
  "attrs": [],
  "children": [],
  "file": "spring_motion.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SpringProp": {
  "attrs": [],
  "children": [],
  "file": "spring_prop.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Stack": {
  "attrs": [
   "alignContent"
  ],
  "children": [],
  "file": "stack.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex",
   "position": "relative"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Stepper": {
  "attrs": [
   "onFinish",
   "onSkip",
   "onChange",
   "onNext",
   "onPrevious"
  ],
  "children": [
   "StepperItem"
  ],
  "file": "stepper.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "StepperItem": {
  "attrs": [
   "prevLabel",
   "nextLabel",
   "status"
  ],
  "children": [],
  "file": "stepperItem.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Swiper": {
  "attrs": [
   "index",
   "autoPlay",
   "interval",
   "indicator",
   "displayArrow",
   "loop",
   "duration",
   "vertical",
   "itemSpace",
   "cachedCount",
   "displayMode",
   "displayCount",
   "effectMode",
   "disableSwipe",
   "curve",
   "onChange",
   "indicatorStyle",
   "nextMargin",
   "prevMargin",
   "customContentTransition",
   "onContentDidScroll",
   "indicatorInteractive",
   "onAnimationStart",
   "onAnimationEnd",
   "onGestureSwipe",
   "nestedScroll",
   "pageFlipMode",
   "onContentWillScroll",
   "onSelected",
   "onUnselected",
   "maintainVisibleContentPosition",
   "onScrollStateChanged"
  ],
  "children": [],
  "file": "swiper.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex",
   "position": "relative",
   "overflow": "hidden"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SymbolSpan": {
  "attrs": [
   "fontSize",
   "fontColor",
   "fontWeight",
   "effectStrategy",
   "renderingStrategy",
   "attributeModifier"
  ],
  "children": [],
  "file": "symbol_span.json",
  "tag": "span",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "SymbolGlyph": {
  "attrs": [
   "fontSize",
   "fontColor",
   "fontWeight",
   "effectStrategy",
   "renderingStrategy",
   "symbolEffect"
  ],
  "children": [],
  "file": "symbolglyph.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "TabContent": {
  "attrs": [
   "tabBar",
   "onWillShow",
   "onWillHide"
  ],
  "children": [],
  "file": "tab_content.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Tabs": {
  "attrs": [
   "vertical",
   "scrollable",
   "barMode",
   "barWidth",
   "barHeight",
   "animationDuration",
   "onChange",
   "onAnimationStart",
   "onAnimationEnd",
   "onGestureSwipe",
   "barPosition",
   "barOverlap",
   "barBackgroundColor",
   "customContentTransition",
   "barBackgroundBlurStyle",
   "onContentWillChange",
   "animationMode",
   "edgeEffect",
   "onTabBarClick",
   "fadingEdge",
   "divider",
   "barGridAlign",
   "barBackgroundEffect",
   "pageFlipMode",
   "onSelected",
   "onUnselected",
   "cachedMaxCount",
   "animationCurve"
  ],
  "children": [
   "TabContent"
  ],
  "file": "tabs.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Text": {
  "attrs": [
   "fontColor",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "textAlign",
   "lineHeight",
   "textOverflow",
   "maxLines",
   "decoration",
   "letterSpacing",
   "textCase",
   "baselineOffset",
   "minFontSize",
   "maxFontSize",
   "copyOption",
   "textIndent",
   "font",
   "fontFamily",
   "textShadow",
   "heightAdaptivePolicy",
   "wordBreak",
   "selection",
   "ellipsisMode",
   "enableDataDetector",
   "dataDetectorConfig",
   "bindSelectionMenu",
   "fontFeature",
   "lineSpacing",
   "privacySensitive",
   "lineBreakStrategy",
   "textSelectable",
   "editMenuOptions",
   "minFontScale",
   "maxFontScale",
   "halfLeading",
   "enableHapticFeedback",
   "caretColor",
   "selectedBackgroundColor",
   "onCopy",
   "onTextSelectionChange",
   "closeSelectionMenu",
   "setStyledString",
   "getLayoutManager",
   "marqueeOptions"
  ],
  "children": [
   "Span",
   "ImageSpan",
   "ContainerSpan",
   "SymbolSpan"
  ],
  "file": "text.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "TextPicker": {
  "attrs": [
   "defaultPickerItemHeight",
   "onAccept",
   "onCancel",
   "onChange",
   "selectedIndex",
   "divider",
   "gradientHeight",
   "selectedTextStyle",
   "textStyle",
   "disappearTextStyle",
   "canLoop",
   "enableHapticFeedback"
  ],
  "children": [],
  "file": "textPicker.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "TextClock": {
  "attrs": [
   "format",
   "onDateChange",
   "fontColor",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "textShadow",
   "fontFeature",
   "contentModifier",
   "dateTimeOptions"
  ],
  "children": [],
  "file": "text_clock.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "TextArea": {
  "attrs": [
   "placeholderColor",
   "placeholderFont",
   "textAlign",
   "caretColor",
   "onChange",
   "onCopy",
   "onCut",
   "onPaste",
   "fontSize",
   "fontColor",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "minFontSize",
   "maxFontSize",
   "heightAdaptivePolicy",
   "decoration",
   "letterSpacing",
   "lineHeight",
   "inputFilter",
   "copyOption",
   "onEditChange",
   "maxLength",
   "showCounter",
   "style",
   "enableKeyboardOnFocus",
   "onTextSelectionChange",
   "onContentScroll",
   "selectionMenuHidden",
   "enterKeyType",
   "onSubmit",
   "barState",
   "maxLines",
   "wordBreak",
   "customKeyboard",
   "type",
   "enablePreviewText",
   "editMenuOptions",
   "lineBreakStrategy",
   "lineSpacing",
   "contentType",
   "onWillDelete",
   "onDidDelete",
   "onWillInsert",
   "onDidInsert",
   "fontFeature",
   "textOverflow",
   "textIndent",
   "caretStyle",
   "selectedBackgroundColor",
   "enableAutoFill",
   "enableHapticFeedback",
   "constructor",
   "caretPosition",
   "setTextSelection",
   "stopEditing"
  ],
  "children": [],
  "file": "textarea.json",
  "tag": "textarea",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "TextInput": {
  "attrs": [
   "type",
   "placeholderColor",
   "placeholderFont",
   "enterKeyType",
   "caretColor",
   "maxLength",
   "onEditChanged",
   "onSubmit",
   "onChange",
   "onCopy",
   "onCut",
   "onPaste",
   "fontSize",
   "fontColor",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "minFontSize",
   "maxFontSize",
   "heightAdaptivePolicy",
   "decoration",
   "letterSpacing",
   "lineHeight",
   "inputFilter",
   "onEditChange",
   "copyOption",
   "style",
   "passwordIcon",
   "showError",
   "showUnit",
   "showUnderline",
   "enableKeyboardOnFocus",
   "onTextSelectionChange",
   "onContentScroll",
   "selectionMenuHidden",
   "selectedBackgroundColor",
   "showPasswordIcon",
   "selectAll",
   "showCounter",
   "cancelButton",
   "textAlign",
   "caretStyle",
   "caretPosition",
   "barState",
   "maxLines",
   "wordBreak",
   "customKeyboard",
   "enableAutoFill",
   "passwordRules",
   "showPassword",
   "underlineColor",
   "enablePreviewText",
   "editMenuOptions",
   "lineBreakStrategy",
   "contentType",
   "onWillDelete",
   "onDidDelete",
   "onWillInsert",
   "onDidInsert",
   "onSecurityStateChange",
   "textOverflow",
   "textIndent",
   "fontFeature",
   "enableHapticFeedback",
   "cancelButton",
   "constructor",
   "caretPosition",
   "setTextSelection",
   "stopEditing",
   "keepEditableState"
  ],
  "children": [],
  "file": "textinput.json",
  "tag": "input",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": "text",
  "factories": [
   "create"
  ]
 },
 "TextTimer": {
  "attrs": [
   "format",
   "fontColor",
   "fontSize",
   "fontStyle",
   "fontWeight",
   "fontFamily",
   "onTimer"
  ],
  "children": [],
  "file": "texttimer.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "TimePicker": {
  "attrs": [
   "onChange",
   "useMilitaryTime",
   "loop",
   "disappearTextStyle",
   "textStyle",
   "selectedTextStyle",
   "dateTimeOptions",
   "enableHapticFeedback",
   "enableCascade"
  ],
  "children": [],
  "file": "timePicker.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Toggle": {
  "attrs": [
   "onChange",
   "selectedColor",
   "switchPointColor",
   "switchStyle",
   "contentModifier"
  ],
  "children": [],
  "file": "toggle.json",
  "tag": "input",
  "isContainer": false,
  "baseStyle": {
   "display": "inline-block"
  },
  "inputType": "checkbox",
  "factories": [
   "create"
  ]
 },
 "ToolBarItem": {
  "attrs": [],
  "children": [],
  "file": "toolbaritem.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "UIExtensionComponent": {
  "attrs": [
   "onResult",
   "onRelease",
   "onError",
   "onTerminated",
   "onReceive",
   "onRemoteReady"
  ],
  "children": [],
  "file": "ui_extension_component.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "UIPickerComponent": {
  "attrs": [
   "onChange",
   "onScrollStop",
   "canLoop",
   "enableHapticFeedback",
   "selectionIndicator"
  ],
  "children": [
   "SymbolGlyph",
   "Text",
   "Image",
   "Row"
  ],
  "file": "ui_picker_component.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "UnionEffectContainer": {
  "attrs": [
   "pointLight"
  ],
  "children": [],
  "file": "union_effect_container.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Video": {
  "attrs": [
   "muted",
   "autoPlay",
   "controls",
   "loop",
   "objectFit",
   "enableAnalyzer",
   "analyzerConfig",
   "onSeeking",
   "onFullscreenChange",
   "onStart",
   "onPause",
   "onPrepared",
   "onFinish",
   "onSeeked",
   "onUpdate",
   "onError",
   "onStop",
   "start",
   "pause",
   "stop",
   "reset",
   "setCurrentTime",
   "requestFullscreen",
   "exitFullscreen"
  ],
  "children": [],
  "file": "video.json",
  "tag": "video",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "WaterFlow": {
  "attrs": [
   "onReachEnd",
   "onReachStart",
   "itemConstraintSize",
   "rowsTemplate",
   "columnsTemplate",
   "columnsGap",
   "rowsGap",
   "layoutDirection",
   "enableScrollInteraction",
   "fadingEdge",
   "nestedScroll",
   "onScrollFrameBegin",
   "friction",
   "cachedCount",
   "edgeEffect",
   "onScroll",
   "onScrollStart",
   "onScrollStop",
   "onScrollIndex",
   "scrollBar",
   "scrollBarWidth",
   "scrollBarColor",
   "flingSpeedLimit",
   "onWillScroll",
   "onDidScroll",
   "clipContent",
   "backToTop",
   "onWillStopDragging",
   "syncLoad",
   "onWillStartDragging",
   "onDidStopDragging",
   "onWillStartFling",
   "onDidStopFling",
   "contentStartOffset",
   "contentEndOffset",
   "supportEmptyBranchInLazyLoading",
   "autoAdjustScrollBarMargin",
   "enableScrollWithMouse",
   "scrollBarHeight"
  ],
  "children": [
   "FlowItem",
   "LazyVGridLayout",
   "LazyVWaterFlowLayout",
   "LazyColumnLayout",
   "LazyDynamicLayout"
  ],
  "file": "water_flow.json",
  "tag": "div",
  "isContainer": true,
  "baseStyle": {
   "display": "flex"
  },
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "Web": {
  "attrs": [
   "password",
   "cacheMode",
   "tableData",
   "wideViewModeAccess",
   "overviewModeAccess",
   "textZoomAtio",
   "databaseAccess",
   "onRefreshAccessedHistory",
   "onUrlLoadIntercept",
   "onSslErrorReceive",
   "onRenderExited",
   "onFileSelectorShow",
   "onPageEnd",
   "onPageBegin",
   "onProgressChange",
   "onTitleReceive",
   "onGeolocationHide",
   "onGeolocationShow",
   "onRequestSelected",
   "javaScriptAccess",
   "fileAccess",
   "onAlert",
   "onBeforeUnload",
   "onlineImageAccess",
   "domStorageAccess",
   "imageAccess",
   "mixedMode",
   "zoomAccess",
   "geolocationAccess",
   "javaScriptProxy",
   "onFullScreenExit",
   "onFullScreenEnter",
   "userAgent",
   "onConfirm",
   "onConsole",
   "onErrorReceive",
   "onHttpErrorReceive",
   "onDownloadStart",
   "webDebuggingAccess",
   "onShowFileSelector",
   "initialScale",
   "onResourceLoad",
   "onScaleChange",
   "onHttpAuthRequest",
   "onPermissionRequest",
   "onContextMenuShow",
   "textZoomRatio",
   "onScroll",
   "mediaPlayGestureAccess",
   "onSslErrorEventReceive",
   "onClientAuthenticationRequest",
   "horizontalScrollBarAccess",
   "verticalScrollBarAccess",
   "javaScriptOnDocumentStart",
   "javaScriptOnDocumentEnd"
  ],
  "children": [],
  "file": "web.json",
  "tag": "iframe",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "WindowScene": {
  "attrs": [],
  "children": [],
  "file": "window_scene.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "WithEnv": {
  "attrs": [
   "env",
   "customEnv"
  ],
  "children": [],
  "file": "with_env.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "WithTheme": {
  "attrs": [],
  "children": [],
  "file": "with_theme.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "XComponent": {
  "attrs": [
   "id",
   "type",
   "libraryname",
   "controller",
   "imageAIOptions",
   "enableAnalyzer",
   "enableSecure",
   "onLoad",
   "onDestroy",
   "getXComponentSurfaceId",
   "getXComponentContext",
   "setXComponentSurfaceRect",
   "getXComponentSurfaceRect",
   "onSurfaceCreated",
   "onSurfaceChanged",
   "onSurfaceDestroyed",
   "startImageAnalyzer",
   "stopImageAnalyzer",
   "setXComponentSurfaceRotation",
   "getXComponentSurfaceRotation"
  ],
  "children": [],
  "file": "xcomponent.json",
  "tag": "canvas",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 },
 "XComponentNode": {
  "attrs": [
   "uiContext",
   "options",
   "type",
   "libraryName",
   "onCreate",
   "onDestroy",
   "changeRenderType"
  ],
  "children": [],
  "file": "xcomponentNode.json",
  "tag": "div",
  "isContainer": false,
  "baseStyle": {},
  "inputType": null,
  "factories": [
   "create"
  ]
 }
};
})(typeof globalThis !== 'undefined' ? globalThis : self);
