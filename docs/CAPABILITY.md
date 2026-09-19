# 能力矩阵（实测，2026-09-19）

> 每一项都标注**由哪个用例证明**。测试用例本身是证据：`./run.sh <用例>` 或 `./electron/run.sh <用例>` 可复现。

## 复现命令

```bash
cd /data/training/cli/arkui-dom-runtime
npm run check                   # 全部验收：preflight + 生成物一致 + 浏览器 + Electron（退出码可信）
npm run check:quick             # 跳过 Electron
./run.sh all                    # 浏览器侧：14 个用例（Chrome headless）
./electron/run.sh all           # Electron 侧：13 个用例 + 真实磁盘核验
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
| 同一份断言的双端一致（9 个用例两个 runner 都过） | ✅ | run.sh / electron/run.sh |

---

# 已知限制（不粉饰）

## 布局与视觉
- **`alignRules` 已实现**（6 键 + 容器/兄弟锚点，几何断言 Δ=0.0），但**不是完整的 ArkUI measure/layout**：
  没有约束求解、没有 `Guideline`、锚点链只支持同容器一层、`bias` 未实现。
- **`Grid` 的自动行高/列宽未实现**（`columnsTemplate`/`rowsTemplate` 落到 CSS grid，但 ArkUI 的尺寸推导不同）。
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
- `@Observed`/`@ObjectLink`（**v1** 的深度观测）：v2 的 `@Trace` 已具备等价能力，v1 语法路径仍缺
- `Navigation`、`Tabs`/`TabContent` 的切换语义、`Swiper`、动画/过渡、手势（`gesture`/`panGesture`）、`Refresh`
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
