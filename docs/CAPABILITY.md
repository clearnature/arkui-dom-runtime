# 能力矩阵（实测，2026-09-19）

> 每一项都标注**由哪个用例证明**。测试用例本身是证据：`./run.sh <用例>` 或 `./electron/run.sh <用例>` 可复现。

## 复现命令

```bash
cd /data/training/cli/arkui-dom-runtime
npm run check                   # 全部验收：preflight + 生成物一致 + 浏览器 + Electron（退出码可信）
npm run check:quick             # 跳过 Electron
./run.sh all                    # 浏览器侧：27 个用例（Chrome headless）
./electron/run.sh all           # Electron 侧：26 个用例 + 真实磁盘核验
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
| **`Navigation` 栈导航**：`NavPathStack` 的 `pushPath`/`pushPathByName`/`pushDestination*`、`pop`/`popToName`/`popToIndex`、`replacePath`/`replacePathByName`、`removeByName`/`removeByIndexes`、`moveToTop`/`moveIndexToTop`、`clear`/`setPathStack`，以及查询族 `size`/`getAllPathName`/`getParamByIndex`/`getParamByName`/`getIndexByName`/`getPathStack` | ✅ | navdemo |
| **`onPop` 回调**（`pushPathByName(name, param, onPop)` → 弹出时收到 `{info:{name,param}, result}`） | ✅ | navdemo |
| **`NavDestination` 生命周期**：首次挂载 `onWillAppear→onWillShow→onShown→onReady`；再显示只 `onWillShow→onShown`；隐藏 `onWillHide→onHidden`；销毁前 `onWillDisappear`（顺序**推断**自 `.d.ts` JSDoc，未在真机核对） | ✅ | navdemo |
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
| **文本测量 `@ohos:measure`**：`MeasureText.measureText`（**总是单行**，JSDoc 明确 `constraintWidth`/`maxLines` 不影响结果）、`measureTextSize`（受约束宽高，px；`maxLines` 夹高、`lineHeight` 覆盖单行高、`letterSpacing`/`wordBreak`/`textIndent`） | ✅ | textmeasure（与同文本同宽度的真实 Text DOM **逐像素一致**） |
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
| 同一份断言的双端一致（26 个用例两个 runner 都过） | ✅ | run.sh / electron/run.sh |

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
     （本项目整体未实现手势，见下）。`disableSwipe` 也会记 `layoutWarnings`。
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
  本实现只做了前者；页面若改走 `this.getUIContext()` 会得到响亮的 `TypeError`（不是静默错值）。
  `textAlign`/`baselineOffset`/`textCase` 对测量结果无影响，未接入。
  测量用的是 `sans-serif`（未指定 `fontFamily` 时），**与真机的系统默认字体不同**，绝对像素值会差
  （但"换行行为"这一层是一致的）。
- **`Navigation` 只有 Stack 栈语义**，以下项**未实现并会记 `layoutWarnings`**：
  **标题栏与工具栏**（`title`/`subTitle`/`hideTitleBar`/`hideBackButton`/`titleMode`/`menus`/`menuCount`/
  `toolBar`/`hideToolBar`/`backButtonIcon`/`toolbarConfiguration`——所以**页面看起来没有标题栏和返回按钮**）、
  分栏模式（`mode(Split)`/`mode(Auto)`、`navBarWidth`/`navBarPosition`/`hideNavBar`/`minContentWidth`）、
  转场动画（`customNavContentTransition`）与系统栏样式（`systemBarStyle`/`ignoreLayoutSafeArea`）。
  `NavPathStack` 侧未实现：`setInterception`（路由拦截）、`getParent`（嵌套 Navigation 的父栈）、
  `removeByNavDestinationId`（没有 id 概念），三者都记警告并返回安全值。
- **`onBackPressed` 登记即警告**：本运行时没有系统返回键（浏览器/Electron 不产生），
  所以这个回调**永远不会被触发**——登记时会立刻出声，而不是"存了不调"。请用 `NavPathStack.pop()`。
- **生命周期顺序与两处语义是推断的**：调用顺序按 `.d.ts` 的 JSDoc 语义排出（"即将挂载/显示"早于"已显示"），
  **未在真机核对**；`replacePath` 不派发 `onPop`、`moveToTop` 复用实例不重建——这两条 `.d.ts` 未写明，
  是按语义推断的实现取舍。`onWillAppear` 的绝对时机也不同（真机在挂载前，本实现在子树挂载后）。
- **`Navigation` 没有转场动画**：push/pop 是瞬时切换 `display`，没有滑动/淡入淡出。
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
- `chainMode`（相对布局的链式排列）、动画/过渡、手势（`gesture`/`panGesture`，**含 `Swiper` 的滑动翻页**）、`Refresh`
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
- Browser runner 用 `--virtual-time-budget`，会在 fetch 挂起时**暂停虚拟时间** → 超时类断言在浏览器侧不可判定
  （已标注 SKIP，由 Electron 用例严格验证）。
- 未验证：真机行为差异、多窗口、并发/性能、跨机器/跨用户的持久化。
- 本项目的"框架角色"（`__arkui_dom_startAbility`、窗口 stage、路由栈）是**我自己的迷你实现**，
  与官方 `AbilityManagerService`/窗口管理的语义必然有偏差。
