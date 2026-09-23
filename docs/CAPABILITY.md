# 能力矩阵（实测，2026-09-19）

> 每一项都标注**由哪个用例证明**。测试用例本身是证据：`./run.sh <用例>` 或 `./electron/run.sh <用例>` 可复现。

## 复现命令

```bash
cd /data/training/cli/arkui-dom-runtime
npm run check                   # 全部验收：preflight + 生成物一致 + 浏览器 + Electron（退出码可信）
npm run check:quick             # 跳过 Electron
./run.sh all                    # 浏览器侧：32 个用例（Chrome headless）
./electron/run.sh all           # Electron 侧：31 个用例 + 真实磁盘核验
npm run stats                   # 覆盖范围统计（本文档的数字都来自它）
npm run preflight               # 环境自检（缺工具链/宿主/可执行位会明确报错）
node tools/gen-components.mjs   # 重新生成 149 个组件骨架
node tools/gen-components.mjs --check   # 只校验生成物与生成器是否一致（不落盘）
```

**断言计数自动受守门**：两个 runner 每次退出时都会把「本次实测每个用例 emit 了多少条 PASS」与文档里手写的
「（N 条断言）」比对（`tools/assert-counts.mjs`），不一致就红。所以**改断言必须同步改数字**，
而数字只能来自运行期（不许用 `grep` 数 `test/*.html` 里的 `check(`，理由见 `docs/DEVELOPING.md` 坑 77）。

## 一、运行时（语言/框架语义）

| 能力 | 状态 | 证明用例 |
|---|---|---|
| ets-loader 转换产物**原样**执行（不改一字） | ✅ | index |
| 组件 builder 栈（`create`/attr/`pop`）+ elmtId 分配 | ✅ | index |
| `@State` 变更 → 依赖追踪 → 批量重渲染 | ✅ | index/layout |
| `@Prop` 单向 / `@Link` 双向（共享数据单元） | ✅ | rich |
| 自定义组件挂载（静态 `ViewPU.create` + `{name}` 形态） | ✅ | rich |
| 父 → 子参数推送（`updateStateVarsOfChildByElmtId`/`reset`/`resetSource`） | ✅ | rich |
| `@Builder` | ✅ | rich |
| `if / else` 分支（切分支销毁旧子树） | ✅ | rich/leak |
| `ForEach` + `List`/`ListItem` 深渲染 | ✅ | rich/leak |
| `aboutToAppear`（首次）/ `onPageShow`（返回时） | ✅ | router |
| 页面实例保留：`router.back()` 后 `@State` 不丢 | ✅ | router |
| 无泄漏：分支切换/列表 churn 后记录收敛（Δ=0） | ✅ | leak |
| 布局语义：`space→gap`/`justifyContent`/`alignItems`/`textAlign`/`padding`/百分比 | ✅ | layout |
| **L1 `alignRules` 真实相对定位**：6 键（水平 `left`/**`middle`**/`right`，垂直 `top`/**`center`**/`bottom`）+ 容器锚点 + **兄弟锚点** | ✅ | measure（几何断言 Δ=0.0） |
| **L2 `Scroller`**：`scrollToIndex`/`scrollTo`/`currentOffset`（含容器最大滚动量截断语义） | ✅ | measure |
| **L3 文本截断**：`maxLines(1)`+`textOverflow(Ellipsis)` → `nowrap/ellipsis/hidden`；`maxLines(n>1)` → line-clamp | ✅ | measure |
| **L4 `Stack({alignContent})` 叠放**：grid 同格 + 按 `Alignment` 设 justify/align-items | ✅ | measure |
| **V1/V2 `LazyForEach` 虚拟滚动**：只渲染视口窗口 + overscan，spacer 撑总高，滚动/数据变更重算 | ✅ | lazy（1000 项只渲染 11 项） |
| **`Scroller.scrollToIndex` 支持未渲染目标**：靠 estimate 行高换算 + 同步刷新窗口 | ✅ | lazy（跳到 500 → scrollTop 14500） |
| **`@Provide`/`@Consume`**：按名字沿视图链解析；consume 返回的**就是提供者的属性实例** | ✅ | provide（实例相等 + 跨层自动更新） |
| **`@Watch`**：`declareWatch` 挂回调，值变更时触发（回调收到属性名） | ✅ | provide（log 随 bump 增长） |
| **V1 深度观测 —— `@Observed` 类装饰器**：产物里是 `Item = __decorate([Observed], Item)`，运行时返回一个构造函数产出 **Proxy** 的子类，拦 `set` 通知订阅者 | ✅ | observe（`__arkui_dom_isObserved(Item[0]) === true`） |
| **`@ObjectLink`**：`new SynchedPropertyNesedObjectPU(source, view, name)`（**`Nesed` 是官方拼写错误**）；读物时记依赖到对象的通知单元 | ✅ | observe |
| **改数组元素的字段（数组长度不变）驱动重渲染** | ✅ | observe（`items[0].name` 改后子组件文本自动变，长度仍为 2） |
| **子组件内改同一对象 → 写穿透到父侧同一个对象** | ✅ | observe（子组件 `this.item.count += 1`，父读到 1） |
| **`@State` 持有的单个 `@Observed` 对象**（非数组）也走 `@ObjectLink` | ✅ | observe（`single.name` 变更驱动 `SingleView`） |
| **观测边界 = `@Observed` 类的自身字段**：改**嵌套的非 `@Observed`** 对象内部**不**触发重渲染 | ✅ | observe（**负向断言**：`item.child.label` 改了但文本不变） |
| **替换嵌套对象本身**（是 `@Observed` 类的字段写入）→ 触发重渲染 | ✅ | observe（`item.child = new Meta(...)` 后文本变） |
| **`@ObjectLink` 绑到非 `@Observed` 对象时不静默** → 记 `layoutWarnings` | ✅ | observe（无告警；破坏实现时该告警出现） |
| **状态管理 v2 —— `@ComponentV2` 基类 `ViewV2`**（`super(parent, elmtId, extraInfo)`，与 v1 签名不同） | ✅ | v2 |
| **v2 `@Local`**：裸字段 + 原型访问器，改值触发重渲染 | ✅ | v2 |
| **v2 `@Param` / `@Once`**：父→子；`@Once` 只取首次传入（编译器要求必须同时写 `@Param`） | ✅ | v2 |
| **v2 `@Event`**：子→父回调；**不参与观测**（不自省为 observed） | ✅ | v2 |
| **v2 `@Monitor(...)`**：字段变更派发回调；入参形状 = SDK `.d.ts` 的 `IMonitor`（`dirty: string[]` + `value(path?)`） | ✅ | v2（`now`/`before`/`dirty.length` 三项都断言） |
| **v2 `@Provider` / `@Consumer`**：按名跨层解析；绑定发生在 `finalizeConstruction`（产物在普通构造路径**不调** `resetConsumer`） | ✅ | v2（改提供者 → 消费者自动更新） |
| **v2 `@ObservedV2` + `@Trace`**：字段级深度观测（数组元素内部字段变更也触发重渲染） | ✅ | v2 |
| **`@Trace` 是选择性的**：未标 `@Trace` 的字段变更**不**触发重渲染 | ✅ | v2（负向断言） |
| **v2 `@Computed`**：不缓存实现，靠"getter 体在渲染上下文里执行 ⇒ 传递依赖天然成立"保证正确 | ✅ | v2 |
| **v1 与 v2 互通**：v2 的 `@Provider` 注册的对象带 `get/set`，v1 的 `@Consume` 可解析（反之亦可） | ✅ | v2 |

## 二、组件库（149 个骨架）

| 能力 | 状态 | 证明用例 |
|---|---|---|
| 覆盖率：元数据 149 个组件全部注册且可实例化 | ✅ | widgets |
| DOM 标签画像（`Text→div`/`Image→img`/`Progress→progress`/`Divider→hr`/`Slider→input[range]`…） | ✅ | widgets |
| 原生控件参数映射（`placeholder`/`text`/`min`/`max`/`step`/`value`/`total`） | ✅ | widgets |
| `Grid`/`columnsTemplate` → CSS grid；`GridItem` 深渲染 | ✅ | widgets |
| **`Grid` 真实轨道**：`columnsTemplate`/`rowsTemplate` 落下真实 `grid-template-*`，`columnsGap`/`rowsGap` → `columnGap`/`rowGap` | ✅ | tabgrid（几何断言：3 列每列 96px） |
| **`Grid` 轨道尺寸单位归一化**：ArkUI 裸数字 = vp → CSS `px`（`'100 1fr'` → `'100px 1fr'`），保留 `1fr`/`auto`/`%`/`repeat()`/`minmax()` | ✅ | tabgrid（第 0 列真占 100px） |
| **`Grid` 跨行换行**：5 项在 3 列下换行到第 0 列，行距 = 行高 + `rowsGap` | ✅ | tabgrid |
| **`Tabs` / `TabContent` 切换**：`barPosition(Start/End)`、初始 `index`、`TabsController.changeIndex`、`onChange` 派发、点击 tab bar 切换、**切走的面板不销毁**（`display:none` 而非移除） | ✅ | tabgrid |
| **`Swiper` 轮播**：`index`、`loop`（默认 true → 越界回卷；false → 边界停住/越界拒绝）、`indicator(true)` → N 个可点圆点、`autoPlay`+`interval`、`onChange` 派发、`SwiperController.showNext`/`showPrevious`/`changeIndex`/`finishAnimation`/`preloadItems`、切走的页不销毁、autoPlay 在页面卸载后自行停表 | ✅ | swiper |
| **`Navigation` 栈导航**：`NavPathStack` 的 `pushPath`/`pushPathByName`/`pushDestination*`、`pop`/`popToName`/`popToIndex`、`replacePath`/`replacePathByName`、`removeByName`/`removeByIndexes`、`moveToTop`/`moveIndexToTop`、`clear`/`setPathStack`，以及查询族 `size`/`getAllPathName`/`getParamByIndex`/`getParamByName`/`getIndexByName`/`getPathStack` | ✅ | navdemo |
| **`Navigation` 标题栏（四形态 + titleMode 高度）**：string / `{main,sub}` / CustomBuilder / `{builder,height}`；Full=112vp·主+副 138vp、Mini=56vp、Free 非滚动态等同 Full；`NavigationCustomTitle.height` **优先于 titleMode**（`.d.ts` 原文）；`hideTitleBar` 生效 | ✅ | `bash run.sh navbardemo`（四种形态逐一断言 + 三个高度数字） |
| **`Navigation` 返回键 / 菜单 / 工具栏**：栈非空才渲染返回键、点了真 `pop()`；`hideBackButton` 不渲染节点；`backButtonIcon` 记录；`menus`/`toolbarConfiguration` 的 `ToolbarItem.action` 真的被调用 | ✅ | `bash run.sh navbardemo`（`hasBack` 两种形态、点返回键栈空、点菜单/工具栏项写进 `log`） |
| **`Navigation` 分栏**：`mode(Split)` + `navBarWidth`（默认 240vp）+ `navBarPosition(Start/End)` + 1px 分割线；`mode(Auto)` 按**组件自身宽度 ≥600vp** 判（600 = 240+360，`.d.ts` 原文） | ✅ | `bash run.sh navbardemo`（split/200/Start、split/180/End、Auto 700→split、Auto 400→stack） |
| **`Navigation` push/pop 转场 + `onTitleModeChange` 滚动联动**（转场数字 R40 照真机确证，出处 `navigation_group_node.cpp`）：入页从 **+50%** 滑入（`width×HALF`）、被盖页视差 **-20%**（标题栏再 -2%）、弹出页滑向 **+50%**；时长 **450ms**（`InterpolatingSpring(0,1,342,37)` 上界；CSS 用 `cubic-bezier(0.2,0,0,1)` 近似临界阻尼形态）；`animated` 默认 true（JSDoc 原文），四参 `animated=false` 与 `disableAnimation` 不滑；pop 的生命周期回调立即发、DOM 摘除推迟到滑出结束。联动只在 `Free` 生效（`NavigationCustomTitle.height` 显式给过不生效，均 JSDoc 原文）：高度随滚动线性插值 Full↔Mini、主标题缩小、副标题淡出（仅 string/common 形态，builder 只收高度）；模式通知只在端点（触底 Mini / 回顶 Full） | ✅ | `bash run.sh navtransdemo`（52 条断言：三个插值点、端点通知、Full 对照、builder 对照、转场标记/记录、真机数字（450ms/±50%/20% 视差）、两个不滑对照组） |
| **`onPop` 回调**（`pushPathByName(name, param, onPop)` → 弹出时收到 `{info:{name,param}, result}`） | ✅ | navdemo |
| **`NavDestination` 生命周期**：首次挂载 `onWillAppear→onWillShow→onShown→onReady`；再显示只 `onWillShow→onShown`；隐藏 `onWillHide→onHidden`；销毁前 `onWillDisappear`（~~顺序推断~~ R42 部分确证：真机 `navigation_pattern.cpp` 同为"先 will 后实"成对触发；`onWillAppear` 的绝对时机与真机不同——真机挂载前、本实现子树挂载后） | ✅ | navdemo |
| **只有栈顶可见**：push 覆盖上一层，pop 露回下面那个且**实例复用**（`moveToTop` 也是复用不重建） | ✅ | navdemo |
| **根内容（home）在 push/pop 间状态保留**（被覆盖但不销毁） | ✅ | navdemo |
| **目标销毁后 elmtId 零泄漏**（3 层栈 + 替换/移除后 clear，记录数回到基线 25 → 25） | ✅ | navdemo |
| **多层锚链**（c 锚 b、b 锚 a，且可**逆序声明**）：`syncAlignRules` 迭代到不动点 | ✅ | reldemo（a=(0,0) b=(40,20) c=(80,40)） |
| **`Guideline` 虚拟参考线**：`{id, direction, position:{start\|end}}`；竖线锚水平、横线锚垂直；**错轴值恒为 0**；支持 `'30%'` 这类 Dimension 字符串 | ✅ | reldemo（30%→90、end:30→270、错轴→0） |
| **`bias` 居中偏置**：同轴两侧都锚定时按比例定位，**默认 0.5**（权威 `@default`） | ✅ | reldemo（0.2→56、0.8→224、不写→140） |
| **`alignRules` 两套键名**：`left/middle/right` 与本地化的 `start/end/middle`（`middle` 是水平、`center` 是垂直） | ✅ | reldemo + measure |
| **`Progress` 线性/胶囊**：`--progress` 自定义属性 = 百分比、填充宽度、`role=progressbar` + `aria-valuenow/min/max` | ✅ | drawdemo（50/100 → 50%、填充 100px） |
| **`Progress` 环形**：SVG 圆 + `pathLength=100` 归一化的 dasharray | ✅ | drawdemo（25/100 → dash 25） |
| **`Gauge`**：`Gauge({value,min,max})` + `startAngle`/`endAngle`（0 点 = 0°、顺时针）、整圆拆两段、`colors` 分段（权重归一 + 权重 0 不画）、`strokeWidth`、未填充轨道 | ✅ | drawdemo（180°→底部、0°→顶部、默认 0→360 整圆、40∈[20,60]→未填充 50%） |
| **`DataPanel` 环**：`conic-gradient` + 累计色标（余量走轨道色） | ✅ | drawdemo（[30,20,50]/100 → 色标 30/50/100） |
| **`DataPanel` 线**：分段宽度 = value/max | ✅ | drawdemo（[10,30]/100 → 20px/60px） |
| **`Rating`**：`rating`/`stars`/`stepSize` → 满星 + 半星；点击派发 `onChange`；`starStyle` 图片 URI 不可用会告警并退化为内置星形 | ✅ | drawdemo（3/5 → 3 高亮、2.5/4 → 2 满 + 1 半、点第 5 颗 → 5） |
| **SVG 形状族**：`Circle`/`Ellipse`/`Rect`/`Line`/`Path`/`Polygon`/`Polyline`/`Shape` —— 组件根 = `<svg>`，`fill`/`stroke`/`strokeWidth`/`fillOpacity` 落 **SVG 表现属性**（不是 data-*/CSS）；几何照 create 参数（`r = min(w,h)/2` 内切、`rx/ry = w/2,h/2`、圆角 `radiusWidth/Height → rx/ry`、`commands → d` 原样、`points` 序列化）；`Line` 的起点终点是**属性方法** `startPoint`/`endPoint`（`LineOptions` 里没有，`.d.ts` 原文）；`Shape` 容器 `viewPort → viewBox`、容器 fill/stroke 靠表现属性**继承**罩住没显式设置的子形状；默认值不写属性（SVG 原生默认 = `.d.ts` 默认：fill 黑、stroke opacity 0） | ✅ | `bash run.sh shapedemo`（36 条断言：8 组件几何/颜色/属性逐一 + 容器继承 + 默认值） |
| **文本测量 `@ohos:measure`**：`MeasureText.measureText`（**总是单行**，JSDoc 明确 `constraintWidth`/`maxLines` 不影响结果）、`measureTextSize`（受约束宽高，px；`maxLines` 夹高、`lineHeight` 覆盖单行高、`letterSpacing`/`wordBreak`/`textIndent`） | ✅ | textmeasure（与同文本同宽度的真实 Text DOM **逐像素一致**） |
| **SVG 形状族的限制**（R26）：create 之后改 `.width()/.height()` 只动 svg 视口，**不反推几何**（r/cx 不重算）；`fill`/`stroke` 只支持单色（`ResourceColor` 的**渐变形态**未实现，记警告）；`strokeMiterLimit`、`Path` 的 `mil` 单位、`viewPort` 非对象形态未实现（记警告） | ⚠️ | 限制清单，非缺陷 |

| **信息展示类的限制**（R28）：`Badge` 的 `Position` 对象形态（精确 x/y 定位）未实现（记警告）；`Counter` 的 `onStateChange` 只记录；`Marquee` 的 `onBounce` 无 bounce 动画（记录）、`marqueeUpdateStrategy`/`allowScale` 只记 data-*、`fromStart: false` 不改变动画方向；时长公式~~（step×16ms/帧）是推断~~ **R40 照真机确证**（`距离×85/step`，出处 `marquee_pattern.cpp`）；`step≤0` 真机**不除以 step**（duration = 距离×85，R44 确证并修正） | ⚠️ | 限制清单，非缺陷 || **输入类的限制**（R27）：编程 `select`/`checked` **不派发** onChange（DOM 里 change 是用户交互事件；`.d.ts` 没写死编程改态是否触发，取"不派发"）；`Slider` 的 `Begin(0)`/`Click(3)` 模式没有 DOM 事件对应（`input`→Moving、`change`→End）；`contentModifier` 自定义形态、`mark`/`shape`/`radioStyle`/`switchStyle`/`switchPointColor`/`unselectedColor` 只记 data-*（原生控件无对应属性） | ⚠️ | 限制清单，非缺陷 |
| **弹出类的限制**（R29）：`Select.value` 显示文本覆盖记 `data-value-text`（原生 select 不可覆盖）；编程改 `selectedIndex` 不派发 onSelect（同 R27 取舍）；`MenuItem` 无 `onMenuItemClick`（该 SDK 版本多选语义走 onChange）；`Menu.showMenu`/`hide`、`MenuItemGroup`、`Select` 的 `icon/symbolIcon` 选项未实现（记警告） | ⚠️ | 限制清单，非缺陷 |
| **表层类的限制**（R31）：`RenderingContextSettings` 的 antialias/alpha 在浏览器 2D 里无对应开关（记录）；Canvas 尺寸的**后续变更**不重新同步内容尺寸（onReady 后改 `.width()` 需重画）；`XComponent` 未实现（记警告） | ⚠️ | 限制清单，非缺陷 |
| **表层类的限制**（R32）：`XComponent` 的 surface 是**占位**（原生图形栈无对应物，如实降级）；`surfaceId` 格式是 DOM 化选择；`onDestroy` 只登记（触发时机=元素摘除，未挂卸载钩子）；`XComponentType.COMPONENT/NODE` 差异语义未建模 | ⚠️ | 限制清单，非缺陷 |
| **QRCode 的限制**（R33，R40 更新）：ECC 级别 `.d.ts` 未写——**R40 确证真机恒用 M**（`qrcode_modifier.cpp:44` 硬编码 `QRCODE_ECC_MEDIUM`，真机枚举仅 MEDIUM/HIGH；node-qrcode 默认也是 M，R33 的 L 级注记是误判，现显式传参对齐）+ qrdemo ECC 采样断言；`contentOpacity` 作用于内容层（真机语义待核对）；512 截断未测 | ⚠️ | 限制清单，非缺陷 |
| **分步器的限制**（R37，R39 更新）：`ItemState.Waiting` 的**视觉**语义（隐藏 next 按钮、换进度条）未实现——但点击忽略已照真机对齐（R39）；create 的 `index` 只在创建时生效（后续改不跳页）；第 0 页点 prev 发 change(0,0)+prev(0,0) 是照抄真机的怪边界；本 SDK 里 Stepper 全文 `@deprecated since 22 @useinstead Swiper`（照实现，未建议迁移）；真机转场动画进行中会忽略导航条点击（`IsSwiperAnimationStopped`）——本实现无转场动画，点击始终即时响应（R44 记录） | ⚠️ | 限制清单，非缺陷 |
| **输入类 `Checkbox`/`Radio`/`Toggle`/`Slider`**（R27）：原生控件基座上的 ArkUI 语义层 —— `select`/`checked` → 选中态（**幂等 diff**：按上次应用的值，重渲染同值无操作）；`selectedColor` → `accent-color`；`Radio({value, group})` 的 `name = group`（原生互斥基座），组内互斥**两边都发** onChange（新选 true / 被取消 false，.d.ts JSDoc 语义）；`Toggle` 初始选中在 create 的 `isOn`（无 `.select()`，编译期实测）；`Slider` 的 `value/min/max/step` 直落控件，`onChange(value, mode)` 双参：`input`→Moving(1)、`change`→End(2)；`ToggleType`/`SliderChangeMode` 挂 global | ✅ | `bash run.sh inputdemo`（29 条断言：选中态/互斥/双参/幂等/颜色/onSubmit 逐一） |
| **信息展示类 `Badge`/`Counter`/`Divider`/`Marquee`**（R28）：`Badge` 容器 + 绝对定位角标（数字重载 `count` / 字符串重载 `value`，style 必填在 create 参数里——编译期实测；默认值全照 JSDoc 原文 Color.Red/White/10vp/16vp/1vp；`maxCount` 超出折叠 `N+`；位置 RightTop/Right/Left）；`Counter` 内置可点 +/− 真触发 `onInc`/`onDec`（flex order 摆位）；`Divider` div 画线（默认 `#33182431`/1px/横向，JSDoc 原文，`vertical` 纵向转宽）；`Marquee` CSS 动画跑马灯（时长按 step 推算为**推断**；`onStart`/`onFinish` 定时器兜底收口，headless 动画事件被节流不可靠） | ✅ | `bash run.sh showdemo`（28 条断言：角标/步进/分割线/跑马灯逐一） |
| **弹出类 `Select`/`Menu`/`MenuItem`**（R29）：`Select` 原生 `<select>` 基座 —— options → `<option>`、`selected(i) → selectedIndex` 直落、`onSelect(index, value)` 双参（change 派发，通用 on* 规则前拦截；编程改 selectedIndex 不派发，取舍已记录）；`value(str)` 显示文本覆盖记 `data-value-text`（原生 select 不可覆盖，取舍已记录）；`Menu`/`MenuItem` 行式面板：`{content}` 渲染、点击切换自身选中（✓ 标记）并派发 `onChange(新状态)`（多选语义） | ✅ | `bash run.sh popdemo`（16 条断言：选项/选中/双参/点击切换逐一） |
| **表层类 `Canvas`**（R31）：手写 → 原生 `<canvas>`，ctx 对象转发原生 2D context（像素断言天然有牙齿：`getImageData` 坐标采样）；create 时交接原生 context；`onReady` 在尺寸应用后 `setTimeout(0)` 派发（坑 ⑧，同步派发时画布无尺寸）并把 CSS 尺寸同步到内容尺寸（1:1）；`fillRect/fillText/getImageData/toDataURL` 等显式转发（不用 Proxy）；`CanvasRenderingContext2D`/`RenderingContextSettings` 挂 global | ✅ | `bash run.sh canvasedemo`（10 条断言：RDY/尺寸/像素采样 R255 G204 alpha=0/toDataURL 原生前缀） |
| **`QRCode`**（R33，R41 换真机编码器）：**编码器 = 真机源码直接复用**——OHOS arkui_qrcodegen 的 C++ 源码逐字复制（零修改）经 emscripten 编成单文件 WASM（`global.ArkuiQrcodegen`，file:// 可用；securec 三函数兼容 glue 见 NOTICES §3b），vendor 缺席记警告并降级；ECC 恒 MEDIUM（真机组件硬编码）；渲染在渲染后同步阶段（redrawQr 挂 syncDrawings，不变量 18）；组件尺寸 ≤ 0 或 < 矩阵所需（矩阵+quiet）时**照真机拒绝绘制并出声**（`qrcode_modifier.cpp:55` 两分支，R44；无尺寸的组件如 Widgets 页即走此路径）；1:1 内容尺寸 + quiet zone 4（渲染差异：真机 API12+ 满幅无 quiet，已记录）+ 颜色变化整幅重画；**交叉验证**：解码器来自独立第三方 jsQR（test/vendor），ASCII/UTF-8/定制色三块解码回原文 + 编码器对照采样断言（渲染矩阵 = 真机 MEDIUM 输出） | ✅ | `bash run.sh qrdemo`（15 条断言：落位/三块解码回原文/前景背景像素/编码器对照采样/过小组件拒绝×3） |
| **表层类 `XComponent`**（R32）：surface 占位容器（`data-xcomponent` + type）；`XComponent({id, type, controller}, "bundle/module")`（create 二参记录）；`onLoad` 经 setTimeout(0) 派发（与 Canvas.onReady 同思想）；`XComponentController`：`getXComponentSurfaceId()` 生成 `XComponent-<id>`、rect 默认取组件实际尺寸（JSDoc 原文：不调用 set 返回组件尺寸）、`setXComponentSurfaceRect` 记录 | ✅ | `bash run.sh xcompdemo`（7 条断言：占位/onLoad/surfaceId/rect 读写） |
| **`UIContext` 对象面**（R30）：`ViewPU.prototype.getUIContext`（ViewV2 继承）——只实现实测面：`animateTo/animateToImmediately`（委派 `runExplicitAnimation`，与 `Context.animateTo` 同管道，用 `__arkui_dom_animations.history` 的 `api='animateTo'` 钉住“真动画”）；`getRouter()` → `@ohos:router` 垫片（经典 `Router.pushUrl` 形态，编译期实测）；`getPromptAction()` → 垫片；`runScopedTask(cb)` 立即执行（真机 UI 作用域无 DOM 对应，取舍已记录）；其余方法（`getFrameNode`/`getMediaQuery` 等）未实现，调用得 undefined | ✅ | `bash run.sh uictxdemo`（8 条断言：四面按序 / 同步回调 / 真动画记录 / 继承面） |
| **分步器 `Stepper`/`StepperItem`**（R37，R39 照真机源码纠偏）：内置导航条（prev/pages/next 三段），子项渲染后汇入 pages 段、切走的页**不销毁**（display 切换）；`StepperItem.prevLabel/nextLabel` 汇入导航条文案（缺省回退 ‹/›）；派发时序照 ace_engine `stepper_pattern.cpp`——**先 `onChange(index, pending)` 再 `onNext`/`onPrevious`**；Skip 页点 next 只发 `onSkip()` **不切页**；末页 Normal 只发 `onFinish()` 不切页；Waiting/Disabled 点 next 整体忽略；prev 的 pending 经 clamp（第 0 页也发 change(0,0)+prev(0,0)，照抄）；编程改 index 静默切页；`ItemState` 枚举值按声明顺序 `{Normal:0, Disabled:1, Waiting:2, Skip:3}`（产物把 `ItemState.Skip` 原样留给运行时求值，值错 onSkip 永不触发） | ✅ | `bash run.sh stepdemo`（26 条断言：结构 6 + 注册面 5 + 派发链 4 + 导航边界 4 + 多实例与状态族 6 + 回归 1） |
| **输入收官 `TextInput`/`TextArea`/`Search`/`Hyperlink`**（R34，R38 补全）：文本输入三件套走原生 input/textarea 基座——`maxLength` 原生截断、`caretColor` → style、文本 `onChange` 收字符串（与 R27 的 boolean 包装按 type 分流）；`onSubmit(enterKey, event)` 挂 keydown Enter 派发（`enterKeyType` → data-enter-key，未设默认 Done=6，JSDoc 原文；**R38 修复**：此前 wrapper 里 `value` 是未定义标识符，派发被 try/catch 吞掉）；`Hyperlink` → 原生 `<a>`（href/target/content，新窗口） | ✅ | `bash run.sh textdemo`（16 条，SUB6 端到端）+ `bash run.sh inputdemo`（29 条：onSubmit 组 R38 新增） |
| **`Image`**（R45）：真实 `<img>` 基座（div 包装 + 主图 + alt 占位分层）——`create(src)` 单参直落 `img.src`；`objectFit` 五枚举 → CSS `object-fit` 同名对齐（contain/cover/fill/scale-down/none；Auto 记 data-*、对齐族/MATRIX 记警告），枚举数值照 `.d.ts` 声明顺序；`alt` 占位在主图未加载/失败时顶上（真机 "placeholder during loading"）；`onComplete` 载荷带**真实解码尺寸**（naturalWidth/Height）+ 组件尺寸，`onError`/`onLoad` 派发；`syncLoad`/`draggable`/`interpolate` 记 data-*；回调同步认领防双发（load 事件与补派发并发） | ✅ | `bash run.sh imagedemo`（15 条断言：objectFit 两档对照/枚举数值/alt 占位/onError/onComplete 载荷 13×5） |
| **图像信息 `@ohos.multimedia.image`**：`createImageSource(uri)` + `getImageInfo()`（Promise/回调）/`getImageInfoSync()` + `release`；`ImageInfo.size` 来自**真实解码**（`createImageBitmap`） | ✅ | measimage（已知尺寸 PNG 7×3 / 13×5） |
| **`mimeType` = 解码后的真实格式**（嗅探字节魔数，不是响应头）：PNG 字节 + `.jpg` 扩展名的伪装文件也报 `image/png` | ✅ | measimage（真 JPEG → `image/jpeg`；伪装 → `image/png`） |
| **通知 `@ohos.notificationManager`**：`publish`（Promise 与**回调**两种重载）/`cancel`/`cancelAll`/`isNotificationEnabled`；`content` 按 `normal`→`longText`→`multiLine` 取文本；空 `content` 响亮失败 | ✅ | measnotify（四条 Promise 链路 + 回调重载成功/失败） |
| **通知投递路径如实自报**：每条记录带 `via`（`host-Notification`/`record-only`）+ `hostPermission` + `reason`；**只有 `permission='granted'` + 走了宿主 API 才算确证送达**，其余必须写出原因 | ✅ | measnotify（浏览器 `permission=default` → 有原因；Electron `granted` → 确证送达） |
| **通知降级告警的边界**：浏览器没有系统通知是**预期**降级（只记日志）；Electron（注入了 Node fs）里"没送达"进 `layout_warnings` | ✅ | measnotify（同一条断言两端期望不同：浏览器 0 条 / Electron 1 条） |
| **ability 结果链路 `startAbilityForResult`**：`(want, options?)` Promise 与 `(want, cb)` / `(want, options, cb)` 回调两种形态；被启动方在新窗口里渲染自己的页面，`terminateSelfWithResult`/`terminateSelf` 结束并把结果交回调用方（结束顺序 `onWindowStageDestroy → onDestroy`） | ✅ | promptaction（`code=207 answer=14` 由 want 算出；无结果结束不挂住） |
| **轻提示 `promptAction.showToast`**：返回 void；`duration` 默认 1500 / 范围 [1500,10000] / 越界夹取 **真的生效**；缺 `message` 同步抛 401 | ✅ | promptaction（`1500,1500,10000`；1500ms 的到期消失、10000ms 的仍在） |
| **对话框 `promptAction.showDialog`**：DOM 对话框（标题/正文/按钮按序）；点按钮 resolve `{index}` 并消失；`buttons` 为空响亮失败 | ✅ | promptaction（点"确定"→ `idx=1;` 且节点消失；无按钮 → 401 且没造出第二个对话框节点） |
| **后端如实自报**：`describe()` 给后端名 + `isFileSystem` + `osVisiblePath` + 人话；`localStorage` 明说**非真文件系统** | ✅ | realfs（浏览器 `backend=localStorage isFileSystem=false`；Electron `backend=node-fs isFileSystem=true osVisiblePath=true`） |
| **OPFS 现场探测（每步带超时、有界）**：`probeOpfs(budget)` 真走 getDirectory→getFileHandle→createWritable→读回→清理，记录卡在哪一步/多少毫秒；**"未启用"≠"不可用"** | ✅ | realfs（headless Chrome 卡在 `getDirectory()` 200ms；Electron 6 步全过 28ms） |
| **自报与真磁盘一致**：OS 可见后端给出的真路径**确实存在于磁盘**（外部核验）；非 OS 可见后端必须明确声明"不是 OS 路径" | ✅ | realfs（`existsSync('/vfs/files/demo.txt')`；localStorage → '无真实路径'） |
| **显式动画 `animateTo`/`animateToImmediately`**：`fn()` 引起的状态变更 → **被重渲染节点**上的 CSS transition（duration/curve/delay 逐项）；到点清掉并调 `onFinish`；`duration:0` **不进动画**但值照变；默认 `duration=1000` | ✅ | animdemo（`prop='all' dur='300ms' curve='ease-in-out'`；`duration:0` → `els=0/endedBy='duration-0'`） |
| **动画参数降级要出声**：`iterations`/`playMode`/`tempo`/`expectedFrameRateRange`/`ICurve` 曲线（CSS transition 表达不了）一律写警告；`fn()` 无可动目标时也出声 | ✅ | animdemo（`iterations=3`、`playMode=2` 各被点名；无目标时记 `no-target` 并告警） |
| **手势 Pan/Tap/LongPress/Swipe/Pinch**：两层栈（`Gesture.create/pop` + `XxxGesture.create/onAction*/pop`）挂到组件栈顶元素，识别器走真实 pointer 事件 | ✅ | gesturedemo（5 个元素各挂对；`distance`/`count`/`duration`/`speed`/`scale` 逐项断言 + 反向用例） |
| **Pan 的 `offsetX/offsetY` = 合成位移**：横向拖 40 → `40,0`；竖向拖 40 → `0,40`（写死单轴的实现会被另一条抓住） | ✅ | gesturedemo（`end=40,0` / `end=0,40`） |
| **`RotationGesture`**：起始线 = 第二指按下时的两指连线，`angle = arctan2(当前连线) − arctan2(起始连线)`（顺时针正、范围 `[−180,180]`，照 `.d.ts`）；`fingers` 与 `angle` 阈值都要真的起作用 | ✅ | `bash run.sh gesturegroupdemo`（转 90° → `+90`、反向 → `−90`、只转 0.29° 不触发、**单指不触发**） |
| **`GestureGroup` 三态**：Exclusive 先认出者独占、其余作废；Sequence 用 `stage` 按序推进、**只有最后一个能收 `onActionEnd`**、半途抬指 → `onCancel`；Parallel 互不影响 | ✅ | `bash run.sh gesturegroupdemo`（`X;`/`UD;` 互斥；`S1;Sc;` vs `S1;S2;S2e;`；**阈值 1px 的 pan 在没轮到它时被门控挡住**） |
| **手势优先级仲裁（元素级）**：`gesture`="子组件优先"、`priorityGesture`="父组件优先"、`parallelGesture`="准冒泡、父子都响应"、`GestureMask.IgnoreInternal`="禁用子组件手势"（均照 `.d.ts` 原文）；`pointerdown` 时一次性定下（内层先认领、外层可覆盖），**仲裁结论可内省** | ✅ | `bash run.sh gesturegroupdemo`（默认对只出子 `'e;'` vs priority 只出父 `'P;'`；parallel 出 `'d;L;'`；mask 出 `'M;'`；`arb='owner'/'suppressed'`） |
| **`GesturePriority` 两套名字并存**：产物发的是 ets-loader 约定名 `Low/High/Parallel`（`pre_define.js`），`.d.ts` 声明的是 `NORMAL/PRIORITY` —— 两套必须同值对齐，否则三个属性在运行时区分不开 | ✅ | `bash run.sh gesturegroupdemo`（`Low===NORMAL===0`、`High===PRIORITY===1`、`Parallel===2`） |
| **出现/消失过渡 `transition`**：`TransitionOptions`（自己没有时间字段 → 用外层 `animateTo` 窗口的参数）与 `TransitionEffect`（自带 `.animation()`，**不依赖** animateTo）；`TransitionType.Insert/Delete` 方向门控；`asymmetric` 两方向各用各的链与时长；`onFinish(transitionIn)`；**消失时节点留在 DOM 里把过渡走完再摘** | ✅ | `bash run.sh transitiondemo`（58 条断言；两档时长来源分别断言，`exit:d` 与 `enter:e` 必须**不存在**） |
| **`onAreaChange`**：`newValue` = 真实宽高 + 相对父/页坐标；尺寸变化后再次触发，`oldValue` 为上一次真实值 | ✅ | measarea（`120x30` == 真实 rect；`0>100` → `100>140`） |
| **自定义布局协议**（`onMeasureSize` + `onPlaceChildren`）：`Measurable.measure(c)` 回真实测量、返回值覆盖声明尺寸、`Layoutable.layout(pos)` 真摆放 | ✅ | measarea（`measure` 遵守 maxWidth=60、组件宽 = 返回的 60、三子项依次落位） |
| **真实行数**（`Range.getClientRects()` 数行盒，非"按字宽累加"的模拟） | ✅ | textmeasure（`__arkui_dom_countLines` 直接断言：宽 100 → 4 行、宽 400 → 1 行、无显式宽 → 按容器 2 行） |
| 字符串参数不丢（如 `QRCode('hello')` → `data-content`） | ✅ | widgets |

## 三、平台能力（`@ohos:*` 别名层）

| 模块 | 实现 | 证明用例 |
|---|---|---|
| `hilog`（含 `%{public}s/%{public}d` 格式化） | ✅ | ability |
| `app.ability.UIAbility` / `AbilityConstant` / `ConfigurationConstant` / `Want` | ✅ | ability |
| `window`（`windowStage.loadContent` **真的渲染页面**） | ✅ | ability |
| ability 启动路径：`onCreate → onWindowStageCreate → loadContent` | ✅ | ability |
| `router`（`pushUrl`/`back`/`replaceUrl`/`getParams`/`getLength`/`getState`） | ✅ | router |
| `data.preferences`（`getPreferences`/`get`/`put`/`flush`，**落盘为 JSON 文件**） | ✅ | router/netfile |
| `file.fs` **同步** API（`openSync`/`writeSync`/`readTextSync`/`closeSync`/`accessSync`/`mkdirSync`/`unlinkSync`/`statSync`/`listFileSync`） | ✅ | netfile |
| `file.fs` **异步** API（`open`/`write`/`readText`/`close`…，await 即已落盘） | ✅ | async |
| `net.http` GET | ✅ | netfile/async |
| `net.http` POST + 自定义 header + body（服务端回显验证） | ✅ | async |
| `net.http` `readTimeout` → `code=2300028` | ✅ | **electron: async** |
| `net.http` `destroy()` 后请求 → `code=2300035` | ✅ | async |
| `net.http` `expectDataType=ARRAY_BUFFER` → `ArrayBuffer` | ✅ | async |
| 未实现模块的可操作报错（列出已实现 + 指路） | ✅ | ability |

## 四、持久化（**真实落盘**）

| 环境 | 后端 | 证明 |
|---|---|---|
| **Electron** | **Node 真 fs**（`electron/preload.js` → `contextBridge`），真实磁盘 `<项目>/electron/data/files/` | netfile 两阶段 + `electron/run.sh` 的 shell 级 `cat` 核验 |
| **浏览器** | `localStorage`（同步、确定性、跨会话） | netfile 两阶段（跨进程） |
| 浏览器（可选） | OPFS —— 需显式开启；**本机 headless Chrome 实测会挂** | `test/opfs-probe.html` |

**跨进程持久化**：phase 1 在进程 A 写 → phase 2 在**全新进程 B** 先读再断言（浏览器/Electron 各一套）。两阶段共用同一 profile / 同一 `electron/data`。

## 五、Electron 集成

| 能力 | 状态 | 证明 |
|---|---|---|
| 同一份断言页在 Electron 里跑（不复制测试代码） | ✅ | electron 全矩阵 |
| 真实渲染 + offscreen 截图（非白像素占比判定，非 `isEmpty()`） | ✅ | electron 各用例 |
| 同一份断言的双端一致（31 个用例两个 runner 都过） | ✅ | run.sh / electron/run.sh |
| runtime 源码分片与拼接产物一致（`runtime/src/` → `runtime/arkui-dom-runtime.js`，`--check` 只校验不落盘；孤儿分片/成环/漏展开报错） | ✅ | `npm run check:runtime`（`npm run check` 第 3 步）；拆分时用 `md5sum -c` 自证与拆分前逐字节一致 |

---

# 已知限制（不粉饰）

## 布局与视觉
- **`alignRules` 已实现**（6 键 + 容器/兄弟锚点，几何断言 Δ=0.0），但**不是完整的 ArkUI measure/layout**：
  没有约束求解、没有 `Guideline`、锚点链只支持同容器一层、`bias` 未实现。
- **`Grid` 有真实轨道**（`columnsTemplate`/`rowsTemplate` + `columnsGap`/`rowsGap` + 单位归一化，几何断言守着），
  但**无模板时的轨道划分未实现**：`cellLength`/`maxCount`/`minCount`/`layoutDirection` 只记 `layoutWarnings`，不生效。
  另外行高仍是 CSS grid 的自动推导（`align-content: stretch` 会拉伸 auto 行），与 ArkUI 的尺寸推导不同——
  所以 tabgrid 的行距断言写成**关系式**（行距 = 行高 + `rowsGap`）而不是钉死绝对行高。
- **`Tabs` 切换已实现**（`barPosition`/`index`/`TabsController.changeIndex`/`onChange`/点击切换/切走不销毁），
  但下列项**未实现并会记 `layoutWarnings`**：`vertical`（侧边 bar）、`barMode`（Fixed/Scrollable）、
  `barWidth`/`barHeight`/`barOverlap`/`barGridAlign`、全部动画项（`animationDuration`/`animationMode`/
  `animationCurve`/`customContentTransition`/`pageFlipMode`）、以及回调 `onTabBarClick`/`onSelected`/
  `onUnselected`/`onAnimationStart`/`onAnimationEnd`/`onGestureSwipe`/`onContentWillChange`。
  `TabContent.tabBar` **只支持字符串标签**：`SubTabBarStyle`/`BottomTabBarStyle`/自定义 builder 会记警告并留空标签。
- **`Swiper` 轮播已实现**（切换/指示点/loop/autoPlay），但有两条要紧的限制：
  1. **手势滑动完全没有**——只有"控制器 / 点指示点 / autoPlay"三条切换路径。真机上的左右滑动在本实现里不会翻页
     （本项目的手势系统只覆盖显式绑定的 `Gesture`/`XxxGesture`，**组件的内置手势**——`List` 滚动、
     `Swiper` 翻页、`Scroll` 拖动——都还没有）。`disableSwipe` 也会记 `layoutWarnings`。
  2. **无动画**：`duration`/`curve`/`effectMode`/`displayMode`/`displayCount`/`itemSpace`/`nextMargin`/`prevMargin`/
     `vertical`/`cachedCount`/`indicatorStyle`/`indicatorInteractive` 与全部动画/手势回调都记 `layoutWarnings`。
     `indicator` 只支持 boolean，传 `DotIndicator`/`DigitIndicator` 会**退化为默认圆点**并记警告。
  `Swiper` 的直接子项必须是"页"本身：若用 `ForEach` 包一层，那个包裹层是 `display:contents`，
  页面边界识别不出来 → 会记警告（请把 `ForEach` 移到 `Swiper` 之外或用 `@Builder` 展开）。
- **布局仍不是约束求解器**：`alignRules` 现在支持多层链（不动点迭代）、`Guideline`、`bias` 与两套键名，
  但 **`chainMode`（链式排列）未实现**；环状锚定不会报错，而是迭代到上限后记一条 warning。
  `Guideline` 的位置字段只有 `start`/`end`（旧 API 的 `percent` 会被忽略并记警告）。
  另外 `alignRules` 的解析被**推迟到渲染后**（首渲染 + 每次重渲染各一遍），
  所以渲染中途读取几何会看到未应用相对定位的临时状态。
- **绘制类四件套有两条要紧的限制**：
  1. **`Progress` 的形状在 create 时确定**（`Progress({style})`），之后再用 `.style()` 不会换形状（会记警告）。
     `ScaleRing` 的刻度、`Eclipse` 的特殊形状只按环画。
  2. **`Gauge` 的指针/刻度（`indicator`）与 `trackShadow`/`description` 未实现**（记警告）；
     `DataPanel` 的 `strokeWidth`/`trackShadow`/`closeEffect` 未实现、`trackBackgroundColor` 只记值不接入绘制。
     `Rating.starStyle` 是**图片 URI**，本运行时没有资源管线 → **退化为内置星形并记警告**。
     另外 `Progress` **不再是原生 `<progress>`**（R13 起是手写 div + `--progress`）——
     `test/components.html` 里那条旧断言已相应升级（契约变了，不是放宽）。
- **文本测量（`@ohos:measure`）的限制**：`textContent`/尺寸传 `Resource` 引用 → 没有资源管线，
  按默认值/空串处理并记警告；百分比约束在离屏测量里没有父容器，按像素处理并记警告。
  `measureTextSize` 在当前 SDK 里**已标 `@deprecated since 18`**（官方建议 `UIContext.getMeasureUtils()`），
  本实现只做了前者；~~页面若改走 `this.getUIContext()` 会得到响亮的 `TypeError`~~（R30 已实现 `UIContext` 对象面，见能力表）。
  `textAlign`/`baselineOffset`/`textCase` 对测量结果无影响，未接入。
  测量用的是 `sans-serif`（未指定 `fontFamily` 时），**与真机的系统默认字体不同**，绝对像素值会差
  （但"换行行为"这一层是一致的）。
- **`Navigation` 的标题栏 / 工具栏 / 分栏已实现**（R12 收口）：`title` 四形态（string /
  `{main,sub}` / CustomBuilder / `{builder, height}`）、`titleMode`（Full 112vp·主+副 138vp / Mini 56vp /
  Free 非滚动态等同 Full）、`NavigationCustomTitle.height` **优先于 titleMode**（`.d.ts` 原文）、
  `hideTitleBar` / `hideBackButton` / `backButtonIcon` / `menus` / `toolbarConfiguration`（含
  `ToolbarItem.action`）、`mode(Split/Auto)` + `navBarWidth`（默认 240vp）+ `navBarPosition` +
  分割线。返回键可点（真 `pop()`），菜单/工具栏项的 `action` 真的会被调用。
  **仍记警告的**：`menus`/`toolbarConfiguration` 的自定义 builder 形态、`navBarWidthRange`/`hideNavBar`/
  `enableDragBar`/`minNavBarWidth`、`customNavContentTransition`（自定义转场协议）与系统栏样式
  （`systemBarStyle`/`ignoreLayoutSafeArea`）。
  ~~两条推断（标题栏 56vp；TitleHeight 112/138）~~ **R42 照真机确证**：
  `navigation_bar_theme.cpp` 主题默认 `SINGLE_LINE=56 / FULL_SINGLE=112 / FULL_DOUBLE=138`，
  选择逻辑在 `nav_bar_layout_algorithm.cpp`；NavDestination 紧凑标题栏 = `TITLEBAR_HEIGHT_MINI=56vp`
  （`navigation_declaration.h`）。`Auto` 用**组件自身宽度**判（`≥600vp` 走 Split），不是窗口宽度。
  `NavPathStack` 侧未实现：`setInterception`（路由拦截）、`getParent`（嵌套 Navigation 的父栈）、
  `removeByNavDestinationId`（没有 id 概念），三者都记警告并返回安全值。
- **`onBackPressed` 登记即警告**：本运行时没有系统返回键（浏览器/Electron 不产生），
  所以这个回调**永远不会被触发**——登记时会立刻出声，而不是"存了不调"。请用 `NavPathStack.pop()`。
- **生命周期顺序**：~~推断~~ **R42 部分确证**——真机 `navigation_pattern.cpp` 同为"先 will 后实"
  成对触发（`ON_WILL_HIDE → ON_HIDDEN`、`ON_WILL_SHOW → ON_SHOW`），与实现一致；
  `replacePath` 不派发 `onPop`、`moveToTop` 复用实例不重建——这两条 `.d.ts` 未写明，
  仍是按语义推断的实现取舍。`onWillAppear` 的绝对时机也不同（真机在挂载前，本实现在子树挂载后）。
- **`Navigation` 转场与滚动的数字**：~~全是推断~~ **转场 R40 照真机确证**（450ms 弹簧上界 +
  入页 +50%/视差 20%/弹出 +50%，`navigation_group_node.cpp`；CSS 曲线为临界阻尼近似）；
  联动收缩阈值 = 滚满 `Full−Mini` px、高度 clamp [56, Full]；副标题透明度 = `(H−56)/(max−56)`；主标题 = 字号插值 L=30fp↔M=26fp 经 `Curves::SHARP`（DOM 等价 scale=(26+SHARP(p)×4)/30）——R43 照 `title_bar_pattern.cpp` 确证。范围弹栈（`popToName`/`popToIndex`/`clear`）**立即销毁不动画**（真机也只动画
  栈顶）；`edgeEffect` 弹性不模拟（内容不足一屏滚不动 → 联动无从发生，JSDoc 主场景就是"超过一屏"）。
- 滚动：`LazyForEach` **有虚拟滚动**（1000 项只渲染 11 项，spacer 撑总高）；但普通 `ForEach` 仍是**全量渲染**，
  `LazyForEach` 的数据变更也是**整窗重建**（未做按 key 的增量 diff），且无 `onDataAdd/Delete` 的精确索引更新。
- **虚拟滚动已支持变高列表项**（`run.sh lazyvh`）：偏移 = 逐项 advance 的前缀和、渲染后**逐项实测回填**、
  `estItemH` 取已实测项的**均值**、滚动**锚定**（视口顶部那一项不会被"实测改写前缀"顶走）、
  `scrollToIndex` 精确落顶且往返不累积误差；**偏移模型与真实 DOM 逐项相等**（这是"不跳"的判据）。
  仍有的限制：`heights` 按**索引**存（数据源增删/重排后整表失效，靠 `refresh` 重建窗口，不做按 key 迁移）；
  未实测到的深滚动位置，**总高是估计值**（只有"视口覆盖全部项"时才有精确总高）。
- **图像模块的限制**：只实现了 `createImageSource(uri)` + `getImageInfo*` + `release`；
  `PixelMap`/`ImagePacker`/`ImageReceiver`/`createImageSource(buf|fd)` 未实现（调用会响亮报错）；
  `stride`/`density`/`pixelFormat`/`alphaType` 回常量 0（未从解码器取真实值）。
  `getImageInfoSync()` **只回已解码的缓存**（同步等不了解码）→ 没缓存时响亮抛错，不编尺寸。
  失败时抛 `code: 62980103` 且**错误信息带 URI**（可操作）。
- **自定义布局协议的限制**：`Measurable.measure()` 会把约束**永久**写到子项上（真机是"请求尺寸"、父容器随后决定）；
  `onMeasureSize` 会被调用多趟以收敛（上限 3 趟）；`onPlaceChildren` 缺省时会记警告（要求成对实现）；
  实现了协议但没实现 `onPlaceChildren` 时子项**不会被摆放**；`@Entry` 的 build 必须只有一个容器根节点
  → "多子项 builder 模式"只适用于嵌套 `@Component`。
- 文本只有 `maxLines`/`textOverflow`；**换行测量已实现（`@ohos:measure` + `__arkui_dom_countLines`）**，
  但 `Text` 组件自身**尚未把测量结果用于布局决策**（`textIndent`/`wordBreak` 之类仍未接入渲染），
  `onMeasureSize`/`onAreaChange`（R17）也还没做。
- 组件虽有 149 个骨架，但**多数属性只落到 `data-*`**（不丢信息，但不产生视觉效果）。视觉保真度远低于真机。
- 版本：`./run.sh measure` 的 16 条几何断言是当前布局能力的**可复现基线**——改布局相关代码后必须重跑。

## 未实现的框架语义
- `Repeat`、`@LocalBuilder`、`@Reusable`（组件复用）——状态管理 v2 的**核心**已实现（见上表），
  但 `@Reusable` 的复用路径**未实测**（产物里有 `resetStateVarsOnReuse`/`resetComputed`/`resetMonitorsOnReuse` 调用，运行时提供了空实现）
- v2 的已知简化：`@Computed` **不缓存**；`@Monitor` 一次赋值只产生一条 `dirty`，且 `path` 是字段名而非
  `items.0.name` 这样的**点分路径**（嵌套对象的 `@Trace` 变更能触发重渲染，但回调里的路径不精确）
- v1 深度观测的已知边界：`@Observed` 只观测该类的**自身字段**，嵌套的非 `@Observed` 对象内部变更不触发
  （与真机一致，有负向断言守着）；`@Observed` 经 Proxy 实现，**未验证**对 `instanceof`、序列化、
  展开运算符、`for...in` 之外的反射行为有无边界差异
- `chainMode`（相对布局的链式排列）、组件**内置手势**（`List` 滚动、`Swiper`/`Tabs` 滑动翻页、`Scroll` 拖动）、`Refresh`；另：`tabBar` 的自定义 builder、`onGestureJudgeBegin`/`shouldBuiltInRecognizerParallelWith` 这类**手势判定回调**未实现
  （**显式绑定的手势**已完整：`Gesture`/`XxxGesture`/`GestureGroup`/`priorityGesture`/`parallelGesture`/`GestureMask`，见上表 R23 与 R23 收口）
- **其余 85 个骨架组件的视觉语义**（R13 只把 `Progress`/`Gauge`/`DataPanel`/`Rating` 从骨架升级为手写绘制）
- `If` 分支的 elmtId 复用优化
- 父组件重渲染时**子视图内部 elmtId 迁移**未处理（深嵌套自定义组件可能出问题）

## 平台 API
- 已实现仅 10 个模块（见上表）。**未实现**：`media`、`ability` 运行时（`startAbility`/`startAbilityForResult`）、
  `notification`、`deviceInfo`、`i18n`、`resourceManager` 的真实资源解析、`@ohos.arkui` 的对话框/弹窗等。
  未实现模块会给出**可操作报错**，不会静默失败。
- `getContext()` 只给了 `filesDir/cacheDir/resourceManager` 空壳，**没有真实 ResourceManager**（`$r()` 解析是兜底值）。
- `net.http` 无 cookie/代理/证书校验/重定向控制；`result` 除 `ARRAY_BUFFER` 外一律文本。
- `file.fs` 的 `readSync(buffer)` 未实现（**显式抛错**，不再静默返回 0）。

## 存储
- 浏览器后端是 `localStorage`：**不是真文件系统**（仅字符串、~5MB 配额、无真实路径、无并发/权限语义）。
- OPFS 已实现但**默认关闭**：本机 headless Chrome 实测 `getDirectory → getFileHandle → createWritable` 逐级挂死。
- `preferences` 的落盘格式是**自定的 JSON**，与官方 preferences 的存储格式不兼容（换到真机不通用）。

## 平台与流程
- **没有 ArkVM**：`.abc` 无法在宿主执行，本项目走的是"ets-loader 产出 JS → JS 运行时"这条路，与真机的执行模型不同。
  **与真机的差异清单见 `docs/ARKVM-RESEARCH.md`（R24，2026-09-21）**：实测两处分叉 —— ① **装饰器协议**（JS 走 tsc
  `__decorate`、字段装饰器 3 实参；`.abc` 走 es2abc 原生装饰器、2 实参，字节码里没有 `__decorate`）→ 对现有实现**无害**
  （运行时只读前两参），但"按 `__decorate` 形状写装饰器"只在 JS 路径成立；② **模块接线**（`.abc` 走 ESM 模块记录 +
  `@native.*` 重定向，JS 路径走 CommonJS 仿真）→ **凡断言 `@ohos:*` 模块行为的用例，其结论都只关于 `runtime/ohos-shims.js`**，
  与真机原生模块无关。另：本项目的"语义一致"都是**字节码级同构判断**，不是执行级等价证明（本地无 ArkVM）。
- Browser runner 用 `--virtual-time-budget`，会在 fetch 挂起时**暂停虚拟时间** → 超时类断言在浏览器侧不可判定
  （已标注 SKIP，由 Electron 用例严格验证）。
- 未验证：真机行为差异、多窗口、并发/性能、跨机器/跨用户的持久化。
- 本项目的"框架角色"（`__arkui_dom_startAbility`、窗口 stage、路由栈）是**我自己的迷你实现**，
  与官方 `AbilityManagerService`/窗口管理的语义必然有偏差。
| **media 垫片的限制**（R35）：`currentTime` 来自真实挂钟（不来自音频解码——data URI 解码时长 0）；`duration` 对 data URI 恒 -1；**Electron 的时钟推进未打通**（浏览器已通——断言分端）；`SubmitEvent` 类语义无 DOM 对应；`AVRecorder` 未实现 | ⚠️ | 限制清单，非缺陷 |
| **`@ohos.multimedia.media`**（R35）：AVPlayer → HTMLAudioElement 状态机垫片（第 15 个平台模块）——`createAVPlayer()` Promise 面；url 赋值 → 'initialized' → prepare → 'prepared' → play → 'playing' → pause → 'paused'；`on('stateChange')` **订阅先行**（必须在 url 前，否则 initialized 丢）；`duration/currentTime/seek/stop/release` 全挂；`autoplay-policy` 放行（muted+catch 降级） | ✅ | `bash run.sh mediademo`（状态机全链路 + 时钟推进；时钟断言分端——Electron 未打通已记录） |
