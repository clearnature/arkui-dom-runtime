# 能力矩阵（实测，2026-09-19）

> 每一项都标注**由哪个用例证明**。测试用例本身是证据：`./run.sh <用例>` 或 `./electron/run.sh <用例>` 可复现。

## 复现命令

```bash
cd /data/training/cli/arkui-dom-runtime
npm run check                   # 全部验收：preflight + 生成物一致 + 浏览器 + Electron（退出码可信）
npm run check:quick             # 跳过 Electron
./run.sh all                    # 浏览器侧：17 个用例（Chrome headless）
./electron/run.sh all           # Electron 侧：16 个用例 + 真实磁盘核验
npm run stats                   # 覆盖范围统计（本文档的数字都来自它）
npm run preflight               # 环境自检（缺工具链/宿主/可执行位会明确报错）
node tools/gen-components.mjs   # 重新生成 149 个组件骨架
node tools/gen-components.mjs --check   # 只校验生成物与生成器是否一致（不落盘）
```

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
| 同一份断言的双端一致（16 个用例两个 runner 都过） | ✅ | run.sh / electron/run.sh |

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
- **`Swiper` 轮播已实现**（3 页/切换/指示点/loop/autoPlay，41 条断言守着），但有两条要紧的限制：
  1. **手势滑动完全没有**——只有"控制器 / 点指示点 / autoPlay"三条切换路径。真机上的左右滑动在本实现里不会翻页
     （本项目整体未实现手势，见下）。`disableSwipe` 也会记 `layoutWarnings`。
  2. **无动画**：`duration`/`curve`/`effectMode`/`displayMode`/`displayCount`/`itemSpace`/`nextMargin`/`prevMargin`/
     `vertical`/`cachedCount`/`indicatorStyle`/`indicatorInteractive` 与全部动画/手势回调都记 `layoutWarnings`。
     `indicator` 只支持 boolean，传 `DotIndicator`/`DigitIndicator` 会**退化为默认圆点**并记警告。
  `Swiper` 的直接子项必须是"页"本身：若用 `ForEach` 包一层，那个包裹层是 `display:contents`，
  页面边界识别不出来 → 会记警告（请把 `ForEach` 移到 `Swiper` 之外或用 `@Builder` 展开）。
- 滚动：`LazyForEach` **有虚拟滚动**（1000 项只渲染 11 项，spacer 撑总高）；但普通 `ForEach` 仍是**全量渲染**，
  `LazyForEach` 的数据变更也是**整窗重建**（未做按 key 的增量 diff），且无 `onDataAdd/Delete` 的精确索引更新。
- 虚拟滚动的行高是**估计值**（首帧后用真实项高校正）；变高项的行高估算会漂移。
- 文本只有 `maxLines`/`textOverflow`；**换行测量、`Text` 的 `textIndent`/`wordBreak` 细粒度控制未实现**。
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
- `Navigation`、动画/过渡、手势（`gesture`/`panGesture`，**含 `Swiper` 的滑动翻页**）、`Refresh`
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
- Browser runner 用 `--virtual-time-budget`，会在 fetch 挂起时**暂停虚拟时间** → 超时类断言在浏览器侧不可判定
  （已标注 SKIP，由 Electron 用例严格验证）。
- 未验证：真机行为差异、多窗口、并发/性能、跨机器/跨用户的持久化。
- 本项目的"框架角色"（`__arkui_dom_startAbility`、窗口 stage、路由栈）是**我自己的迷你实现**，
  与官方 `AbilityManagerService`/窗口管理的语义必然有偏差。
