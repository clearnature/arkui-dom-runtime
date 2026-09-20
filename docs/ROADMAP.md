# ArkUI DOM Runtime —— 路线图（原子任务）

本文是**待办**的唯一权威清单。每项都写成"一个可独立完成、可独立验收的原子任务"，附**可复现的验收命令**。

已完成的机制说明见 `docs/ARCHITECTURE.md`；怎么改见 `docs/DEVELOPING.md`。

**当前状态**：`npm run check` 全绿（preflight + 生成物一致 + 文档数字守卫 + 浏览器 19 用例 + Electron 18 用例）。
v1/v2 状态管理（含 v1 深度观测）、`Grid` 真实轨道、`Tabs` 切换、`Swiper` 轮播、`Navigation` 栈导航、
`alignRules` 多层锚链 + `Guideline` + `bias`、纯绘制四件套、文本真实测量（`@ohos:measure`）、变高列表项均已落地。
**下一步优先级：R17（onMeasureSize/onAreaChange 与真实布局对齐）→ R18–R21（平台模块）→ R22–R23（动画/手势）。**
R5b（出向 `LICENSE`）已降级——本地开发不需要，只在对外分发前才需决定。

---

## 0. 已完成基线

作为后续任务的锚点，这些已落地且有测试：

| 阶段 | 内容 | 证据 |
|---|---|---|
| ① | `@State` + `Text` 最小闭环 | `bash run.sh index` |
| ② | 自定义组件 / `@Prop` / `@Link` / `If` / `ForEach` | `bash run.sh rich` |
| ② | 元素级依赖追踪 + 微任务批量重渲染（无泄漏） | `bash run.sh leak` |
| ② | `alignRules` 六键 / 文本截断 / `Stack` 叠放 / `Scroller` | `bash run.sh layout` |
| ② | 149 个组件骨架 + 原生输入类控件 | `bash run.sh widgets` |
| ② | 测量接口对齐 | `bash run.sh measure` |
| ③ | `LazyForEach` 虚拟滚动（1000 项 → 11 节点） | `bash run.sh lazy` |
| ③ | `@Provide` / `@Consume` / `@Watch` | `bash run.sh provide` |
| ③ | **V1 深度观测**（`@Observed` + `@ObjectLink`，Proxy 实现） | `bash run.sh observe`（20 条断言，含负向） |
| ③ | **状态管理 v2**（`ViewV2` + 11 个装饰器） | `bash run.sh v2`（26 条断言，浏览器 + Electron 双通过） |
| ③ | **`Grid`/`GridItem` 真实轨道** + `Tabs`/`TabContent` 切换 | `bash run.sh tabgrid`（51 条断言，含几何与机制自省；双端通过） |
| ③ | **`Swiper` 轮播**（loop / autoPlay / 指示点 / 控制器） | `bash run.sh swiper`（41 条断言，双端通过，连跑 3 次稳定） |
| ③ | **`Navigation` 栈导航**（NavPathStack / 生命周期 / 状态保留 / 零泄漏） | `bash run.sh navdemo`（72 条断言，双端通过） |
| ③ | **`alignRules` 多层锚链 + `Guideline` + `bias`** | `bash run.sh reldemo`（24 条断言，双端通过） |
| ③ | **纯绘制四件套**（`Progress`/`Gauge`/`DataPanel`/`Rating`） | `bash run.sh drawdemo`（47 条断言，双端通过） |
| ③ | **文本真实测量**（`@ohos:measure` + `__arkui_dom_countLines`） | `bash run.sh textmeasure`（25 条断言，双端通过） |
| ③ | **变高列表项**（实测回填 + 前缀和偏移 + 滚动锚定） | `bash run.sh lazyvh`（22 条断言，双端通过） |
| ③ | `@ohos:*` 别名层 + CommonJS 装载 + 真 fetch | `bash run.sh async` |
| ③ | `UIAbility` 启动链路 | `bash run.sh ability` |
| ③ | `router` 页面栈（返回时保留状态） | `bash run.sh router` |
| ③ | **真落盘**（Electron Node fs + shell 级验证） | `bash electron/run.sh persist` |
| ②.5 | CLT 缺库补齐（`libhilog.so` / `libshared_libz.so`） | `/data/training/cli/arkts-shim/README.md` |
| **P0** | git 仓库 + `.gitignore`（287 MB → 跟踪 484 KB） | `git log`，`git ls-files` |
| **P0** | 环境 preflight 自检 | `npm run preflight` |
| **P0** | 统一验收门禁（退出码可信） | `npm run check`；制造漂移 → exit 1 |
| **P0** | `--check` 真正只校验不落盘 | `node tools/gen-components.mjs --check` |

当前：**浏览器 22 用例 + Electron 21 用例全绿**（`npm run check` → `exit 0`）。

---

## 1. 排序原则

按 **① 工程化地基 → ② 解锁页面最多的语义 → ③ 能靠测试锁死的增量** 排。

**为什么工程化排第一**：本项目现在**不是 git 仓库**，287 MB 里 283 MB 是解压的 Electron。在这种状态下，"完成"不可审计、"回归"不可复现、改动不可回滚——任何功能进展都无法被确认为可信。地基必须先补。

**为什么"能靠测试锁死"是硬门槛**：这个项目已经出现过 4 次"测试通过但结论是假的"（`grep 'ALL PASS'` 匹配到 `<script>` 源码、纯白图被判非空、404 页面读空串全通过、负向断言被后续实现静默失效）。**任务若不能写成可复现的断言，就不该进这个清单。**

优先级速览：

| | 任务 | 影响 | 成本 |
|---|---|---|---|
| P0 | ~~R1–R4 工程化地基~~ **已完成** | — | — |
| P0 | ~~R5a 入向合规：第三方许可清单~~ **已完成** | 中（分发前必须） | 低 |
| — | R5b 出向授权（`LICENSE`）——**本地开发不需要，降级到"分发前"** | 无（现在） | 低 |
| P1 | ~~R6–R8 状态管理 v2 + V1 深度观测~~ **R6/R7/R8 已完成** | 高 → 已拿到 | — |
| P2 | ~~R9–R10 Grid / Tabs 真实语义~~ **已完成** | — | — |
| P2 | ~~R11 Swiper~~ **已完成** | — | — |
| P2 | ~~R12 Navigation~~ **已完成** | — | — |
| P2 | ~~R13 纯绘制四件套~~ **已完成**（其余 85 个骨架仍是 `data-*`） | 中 | 中 |
| P3 | ~~R14 `alignRules` 多层锚链/Guideline/bias~~ **已完成** | — | — |
| P3 | ~~R15 文本真实测量~~ **已完成** | — | — |
| P3 | ~~R16 变高列表项~~ **已完成** | — | — |
| P3 | R17 onMeasureSize/onAreaChange | 中 | 高 |
| P4 | R18–R21 平台模块 | 中 | 低–中 |
| P5 | R22–R23 动画/手势 | 中 | 中 |
| P6 | R24 ArkVM 路径 | 低（研究） | 高 |

---

## P0 工程化地基

### ~~R1 — 建 git 仓库 + `.gitignore`~~ ✅ 已完成

`git init` + `.gitignore`（排除 `build/`、`electron/runtime/`(283 MB)、`electron/data/`）。
被跟踪 **47 个文件 / 484 KB**（磁盘 287 MB）。首次提交 `708cbd1`。

**验收（已执行）**：
```bash
git ls-files | grep -c '^electron/runtime/'   # 0
git ls-files | grep -c '^build/'              # 0
du -sh .git                                   # 648K
```

---

### ~~R2 — `package.json` + 统一入口~~ ✅ 已完成

`npm run check` / `check:quick` / `preflight` / `test:*` / `stats` / `check:gen` / `gen`。
**无 npm 依赖**：TypeScript 直接用 `ets-loader` 自带的 4.9.5。

---

### ~~R3 — `tools/check-all.sh`：一条命令做完所有验收~~ ✅ 已完成

5 步：preflight → 生成物一致 → 浏览器 → Electron → 统计（留档，不影响退出码）。

**设计约定**：成败**只看被调命令的退出码**，绝不用 `grep`/`wc` 数日志行。
逐次失败会打印输出尾部并保留完整日志到 `build/check-logs/`。

**验收（已执行）**：
```bash
bash tools/check-all.sh            # exit 0
# 制造生成物漂移后重跑：
#   ❌ gen-components --check (exit 1) → 汇总列出失败步骤 → exit 1
```

---

### ~~R4 — 环境 preflight 自检~~ ✅ 已完成

`tools/preflight.mjs` 检查：CLT node、`ets-loader` 的 TypeScript、组件元数据数量（≥150）、
Chrome、Electron、**入口脚本可执行位**、核心文件齐备、fixtures 数量。

**首次运行就抓出真实缺陷**：`tools/gen-components.mjs` 与 `tools/stats.mjs` 缺 `+x`
——正是此前让用户报"无法运行"的同类型问题。

**验收（已执行）**：`chmod -x run.sh` → exit 1 并给出修复命令；还原 → exit 0。

---

### ~~R5a — 入向合规：第三方组件与许可清单~~ ✅ 已完成

**产出**：`THIRD-PARTY-NOTICES.md` —— 记录我们**消费/派生**了什么、各自许可状态如何，附可复核命令。

**核验结果（7/7 与期望一致）**：
- 自研代码（`runtime/`、`tools/`、`test/`、`run.sh`、`electron/` 源码）**无任何第三方版权头**
- `fixtures/` 无版权头（ets-loader 输出时剥掉了输入头部）
- **`ets/component/*.d.ts`：121/121 声明 Apache-2.0** ← 真开源，可放心引用接口形状
- **`ets-loader` 本体：`package.json` 的 `license` 为 `None`，无 LICENSE 文件** ← 未声明许可
- **`ets-loader/components/*.json`（150 个）：无 `license`/`copyright` 字段** ← 未声明许可
- **CLT 顶层 `LICENSE.txt` 是《HUAWEI DevEco Studio 使用协议》（专有 EULA）**，其 1.6 条把授权限定为
  "仅为开发运行于 OpenHarmony 兼容设备/HarmonyOS 的应用"

→ 因此 `runtime/generated-components.js`（派生自未声明许可的元数据）**不得标注为 Apache-2.0**。
→ **纯本地开发不受影响**；对外分发前需先厘清第 4/5 两点。

**依赖**：无。**此项不含法律判断**，只记录可核验事实。

---

### R5b — 出向授权（本项目的 `LICENSE`）——**降级：本地开发不需要**

**内容**：给本仓库选一个许可证。

**为什么降级**（原先把入向合规与出向授权混成了一件，是判断失误）：
- 入向合规 = 遵守**别人**的许可 → 做法是**署名清单**（R5a，已完成）
- 出向授权 = **我们**允许别人怎么用 → **只在对外分发时才需要**

**当前状态**：**有意不设** `LICENSE`（`package.json` 已 `"private": true`）。不对外分发就没有需要授权的对象；
仓库内文件默认"保留所有权利"。且选择会受 R5a 查出的上游状态影响，**不宜在厘清前先定**。

**触发条件（满足任一即回到待办）**：
- 要把仓库推送到公开托管 / 交给第三方
- 要作为依赖被别的项目引用
- 要打包成对外发布的产品

**验收（触发后）**：`LICENSE` 存在且与 `THIRD-PARTY-NOTICES.md` §5/§6 的结论一致。

**触及**：`LICENSE`（新）、`README.md`、`docs/ARCHITECTURE.md` §9

---

## P1 状态管理 v2

### ~~R6 — 测量 v2 产物形态~~ ✅ 已完成

产出 `fixtures/pages/V2.ts`（12.7 KB，24 处 `__decorate`）+ `ARCHITECTURE.md` §3.4 的完整契约表。

**关键测量结果**（全部实测，不是推断）：
- `ViewV2` 的 `super(parent, elmtId, extraInfo)` 比 `ViewPU` **少一个参数**
- v2 状态是**裸字段**，观测靠**装饰器装在原型上的访问器**
- 11 个装饰器 + `ViewV2` 的 11 个方法名
- **`IMonitor` 的权威形状在 SDK 的 `.d.ts`**（`dirty: string[]` + `value(path?)`）

---

### ~~R7 — 实现 `@ComponentV2` 运行时~~ ✅ 已完成

`ViewV2 extends ViewPU` + 装饰器层（访问器安装、`v2Cell` 每实例每字段依赖单元、
`@Monitor` 派发、`@Provider`/`@Consumer` 在 `finalizeConstruction` 绑定、
`@Computed` 不缓存实现、`@ObservedV2`/`@Trace` 深度观测）。

**验收（已执行）**：`bash run.sh v2` + `bash electron/run.sh v2` → **26 条断言双通过**，
其中包含"机制正确"类断言（`@Event` 不参与观测、非 `@Trace` 字段不触发重渲染、
装饰器确实装上了访问器）。

**已知简化**（写进 `ARCHITECTURE.md` §6 能力表）：`@Computed` 不缓存；
`IMonitor.dirty` 一次赋值一条且 `path` 非点分路径；`@Reusable` 复用路径未实测。

---

### ~~R8 — `@Observed` / `@ObjectLink`（V1 的深度观测）~~ ✅ 已完成

**内容**：v1 的 `@Observed` 类 + `@ObjectLink` 引用——此前 `ForEach` 只在**数组长度变化**时重建，
元素内部字段变更不触发重渲染。

**测量结果（先测量再实现）**：
- `@Observed` **保留在产物里**（是运行时装饰器）：`Item = __decorate([Observed], Item)`
- `@ObjectLink` → `new SynchedPropertyNesedObjectPU(params.item, this, "item")`
  —— **`Nesed` 是官方拼写错误**（应为 Nested），不能改
- 产物全文搜 `subscribe` / `ObservedObject` / `addSubscriber` 都是 **0 次** —— 订阅必须由运行时隐式完成
- V1 **在字段上没有任何装饰器** → 拿不到字段名 → 只能用 **Proxy** 拦 `set`

**实现**：`Observed(Base)` 返回一个构造函数产出 Proxy 的子类；Proxy 的 `set` 陷阱
→ `markDependentsDirty(cell)`；`SynchedPropertyNesedObjectPU.get()` → `recordDep(cell)`。
复用已有的 `propDeps` 机制，依赖键从"状态对象"换成"对象实例的通知单元"。

**顺带修掉一个静默失败通道**：TS 的 `__decorate` 助手对 **falsy 装饰器静默跳过**
（`__decorate([undefined], Item)` 不报错、原样返回类）。所以 `extract.mjs` 的前奏里加了守卫，
逐个检查绑定到的名字是不是函数，不是就 `throw`。**加装饰器必须同时改运行时表和 `DECORATOR_NAMES`**。

**验收（已执行）**：
```bash
bash run.sh observe && bash electron/run.sh observe   # 20 条断言双通过
```
断言含**负向**项：改嵌套的**非** `@Observed` 对象内部**不应**触发重渲染（`item.child.label` 改了但文本不变）。

**并证明了断言有牙齿**：临时把 `Observed` 改成空操作 → **8 条断言失败**，
其中包括 `@ObjectLink('item') 绑定到非 @Observed 对象` 的 `layoutWarnings` 诊断；
还原后 `md5sum` 与备份逐字节一致。

**已知边界**：`@Observed` 经 Proxy 实现，**未验证**对序列化、展开运算符、`for...in` 之外的
反射行为有无边界差异（`instanceof` 与 `constructor.name` 已断言正常）。

**触及**：`runtime/arkui-dom-runtime.js`、`tools/extract.mjs`、`fixtures/pages/Observe.ts`、
`test/observe.html`、`run.sh`、`electron/run.sh`

---

## P2 组件视觉语义

> 现状：85 个组件"能建出节点但视觉上是个 `div`"。按**真实页面出现频率**挑，不按字母表刷。

### ~~R9 — `Grid` / `GridItem` 真实布局~~ ✅ 已完成

**内容**：`columnsTemplate`/`rowsTemplate`/`columnsGap`/`rowsGap` → 真实 grid 轨道；`GridItem` 落入正确轨道。

**实现**：`columnsGap`/`rowsGap` 加进 `cssPropSize`（此前只落 `data-*`，**版式静默错**）；
轨道模板走新增的 `normalizeTrackList`（ArkUI 裸数字 = vp → CSS 必须带 `px`，否则整条声明作废且不报错）。
`Grid.cellLength`/`maxCount`/`minCount`/`layoutDirection`（无模板时的轨道划分）**未实现**，
但进 `GRID_UNSUPPORTED` 记 `layoutWarnings`，不静默。

**验收（已执行）**：`bash run.sh tabgrid` —— 断言**几何**而非只断字符串：
3 列每列 96px（`(300-2×6)/3`）、第 1 项左移一列（+102）、第 4 项换行回第 0 列、
行距 = 行高 + `rowsGap`（关系式，不钉死绝对行高）、`'100 1fr'` 归一化后第 0 列**真占 100px**。

**触及**：`runtime/arkui-dom-runtime.js`、`fixtures/pages/TabsGrid.ts`、`test/tabgrid.html`、`run.sh`

### ~~R10 — `Tabs` / `TabContent` 切换~~ ✅ 已完成

**内容**：`Tabs({barPosition, index, controller})` + `TabContent().tabBar('T0')` 的切换语义 + `TabsController`。

**实测契约**（`ARCHITECTURE.md` §3.6）：`TabContent.create(deepFn)` 把子构建器**当构造参数传**
（与 `GridItem`/`ListItem` 的 `create(()=>{},false)` + 外部 `deepRender` **不同**）；
`TabContent` 必须挂进 `Tabs` 的内容区（`__tabsContentEl`）而不是包装元素，且 `rec.parentNode` 同步改指。

**两个静默失效陷阱**（都真实踩到）：
1. `Tabs.onChange` 必须在通用事件分支**之前**拦截 —— 否则变成一个永不触发的 `addEventListener('change')`。
2. `TabContent` 是自定义挂载点 → 绕过了 `mountNode` → 必须自己补 `data-arkui-comp` 标记。

**验收（已执行）**：`bash run.sh tabgrid`（51 条断言，双端通过）——`barPosition` 定序、标签顺序 `T0,T1,T2`、
"恰好一个可见"、`changeIndex(1)`/点击 bar 切换、`onChange` 驱动 `@State` 重渲染、
切走的面板**不销毁**、越界 `changeIndex` 记 `layoutWarnings`（负向）。

**破坏验证**：把 `onlyOneVisible` 改空操作 → **4 条断言失败**（含初始可见性）；
把 `normalizeTrackList` 改直传 + 去掉两个 gap → **9 条断言失败**（字符串级 + 几何级都有）。

**触及**：`runtime/arkui-dom-runtime.js`、`fixtures/pages/TabsGrid.ts`、`test/tabgrid.html`、`run.sh`、`electron/run.sh`

### ~~R11 — `Swiper` 轮播~~ ✅ 已完成

**内容**：`Swiper({index, autoPlay, loop, indicator})` 的当前页/切换/指示点。

**实测的签名与预期不同（本项最大的坑）**：本 SDK 的 `SwiperInterface` 只有
`(controller?: SwiperController)` 一个重载 —— **create 的参数就是控制器实例本身**，
`index`/`loop`/`autoPlay`/`interval`/`indicator` 全是**属性 setter**。我按 `Tabs({…options})`
的印象写，被编译器判错 `'index' does not exist in type 'SwiperController'`。

**依赖**：R10 ✅ —— `onlyOneVisible(entries, active)` 直接复用（本轮未改动它）。
结构上比 `Tabs` 更简单：子项直接挂进 Swiper 元素，指示点是 `Swiper.pop()` 时追加的覆盖层
（页面标 `data-arkui-swiper-page`，圆点标 `data-arkui-swiper-dot`，互不污染）。

**实现**：`SwiperController`（`showNext`/`showPrevious`/`changeIndex`/`finishAnimation`/`preloadItems`）+
`setActiveSwiper`（loop 时回卷 / 非 loop 时越界拒绝）+ `stepSwiper`（非 loop 边界**停住**）+
`startSwiperAutoPlay`（回调内查 `isConnected`，页面卸载后**自己停表**，避免跨页面计时器泄漏）+
`SWIPER_UNSUPPORTED` 覆盖 26 个未实现项（含 `vertical`/`displayCount`/全部动画与手势回调）。

**验收（已执行）**：`bash run.sh swiper` —— **41 条断言**，双端通过；浏览器连跑 3 次稳定
（autoPlay 依赖计时器，故用**轮询**而非固定等待，并单独复测稳定性）：

- 初始页/页数/`data-arkui-swiper-page` 标记只标页面不标指示点
- `showNext`/`showPrevious`/`changeIndex` 三条切换路径 + `onChange` 驱动 `@State` 重渲染
- `indicator(true)` → 圆点数 = 页数，活动圆点跟随
- **`loop` 的两套语义**：`loop=true` 末页前进**回卷**；`loop=false` 末页前进**停住**、越界 `changeIndex` 记 warning
- 切走的页**不销毁**；autoPlay 反复推进后页数不变（无泄漏/重复挂载）
- 自省钩子 `__arkui_dom_swiperState`

**破坏验证**：去掉 `loop` 回卷 → 1 条失败；去掉 autoPlay 的 `setInterval` → 1 条失败。

**已知限制（写进 CAPABILITY）**：**手势滑动完全没有**（只有控制器/点指示点/autoPlay 三条路径）；
无动画；`indicator` 只支持 boolean；直接子项若被 `ForEach` 包一层（`display:contents`）会记警告
（页边界识别不出来）。

**触及**：`runtime/arkui-dom-runtime.js`、`fixtures/pages/SwiperDemo.ts`、`test/swiper.html`、
`run.sh`、`electron/run.sh`

### ~~R12 — `Navigation` / `NavDestination`~~ ✅ 已完成

**内容**：栈式导航（此前只有 `router` 页面栈，`Navigation` 组件本身无栈语义）。

**实测到的关键差异**：**builder 由运行时调用，不在页面的 `initialRender` 里**。
`Navigation.navDestination({builder})` 把 builder 交出来，运行时在压栈时调它建 `NavDestination`。
另外 `navDestination` 的参数是 **`{builder: fn}` 对象**（不是函数本身），`NavDestination.create(deepFn, extraInfo)`
的子构建器同样是**构造参数**（同 `TabContent`）。

**实现**：`NavPathStack`（19 个方法 + `onPop`）+ `navPushRec`/`navPopRange`/`navReplaceTop`/`navSyncVisibility`/
`navFire`；DOM 为"根内容 + 绝对定位目标区覆盖层"。
建树走 **"预压容器 → 调 builder → 还原栈 → 校验产出 → 失败回滚"**（新不变量 17）。
销毁调 `purgeDetachedRecords()`。

**语义要点**：
- **只有栈顶可见**；根内容被覆盖但**不销毁** → 这就是"pop 后状态保留"
- 首次挂载 `willAppear→willShow→shown→ready`；再显示只 `willShow→shown`；隐藏 `willHide→hidden`；
  销毁前 `willDisappear`；弹出多个时**从栈顶向下**处理
- `moveToTop` **复用原实例**（只调 DOM 顺序）；`replacePath` 销毁旧的建新的且**不派发 `onPop`**
- `onBackPressed` **登记即警告**（本运行时无系统返回键 → 永不触发，不静默）

**验收（已执行）**：`bash run.sh navdemo` —— **72 条断言**，双端通过：
初始态/builder 登记/根状态保留（push 前改到 2，pop 后仍是 2）/三层栈/`popToName`/`popToIndex`/
`replacePath`/`removeByName`/`moveToTop`/`clear`/`onPop` 的 `{info,result}`/生命周期顺序（4 条相对顺序断言）/
**elmtId 零泄漏（25 → 25）**/两条负向（缺 builder 的 push、越界 `popToIndex`）。

**破坏验证**：去掉"非栈顶隐藏" → 3 条可见性断言失败；交换 `willShow`/`shown` → 1 条失败；
不派发 `onPop` → 1 条失败。

**已知限制（写进 CAPABILITY）**：**无标题栏/工具栏/返回按钮**（`title` 等记警告，是可见差异）；
只有 Stack 语义（`Split`/`Auto` 记警告）；无转场动画；`setInterception`/`getParent`/`removeByNavDestinationId`
未实现；**生命周期顺序与两处语义是推断的**（`.d.ts` JSDoc 未写全序，未在真机核对）。

**触及**：`runtime/arkui-dom-runtime.js`、`fixtures/pages/NavDemo.ts`、`test/navdemo.html`、
`run.sh`、`electron/run.sh`

### R13 — 数据可视化类：`Progress` / `Gauge` / `DataPanel` / `Rating`

**内容**：这 4 个是纯绘制，DOM 侧用 `conic-gradient` / `linear-gradient` / SVG 可实现，性价比高。

**验收**：断言 `Progress({value:50,total:100})` 的宽度/`--progress` 变量为 50%；`Rating({rating:3})` 有 3 个高亮元素。

---

## P3 布局引擎

### ~~R13 — 数据可视化类：`Progress` / `Gauge` / `DataPanel` / `Rating`~~ ✅ 已完成

**内容**：这 4 个原来只是生成骨架（`Progress` → 原生 `<progress>`，其余空 div）。本轮改成**手写绘制实现**。

**画法按形状二分**：条形 = div + `--progress` 百分比；环形分段 = CSS `conic-gradient`；
弧/星 = SVG。详见 `ARCHITECTURE.md` §4.9。

**四个必须记住的点**：
1. **弧长用 `pathLength="100"` 归一化** → `stroke-dasharray` 首数直接是百分比，断言不必反推 `2πr`
2. **整圆不能只画一条 arc**：`endAngle` **默认就是 360**，起终点重合的 arc **渲染成空** → 必须拆两段。
   ⚠️ 这是**默认情形**，我第一版 fixture 只有半圆、**等于没测** → 补了 `Gauge#g3` 专测整圆
3. **角度约定照 `.d.ts` JSDoc**：0 点 = 0°、顺时针为正。断言只钉"起点在顶部/底部中央（x≈cx）"，
   **不钉半径**（`r = min(w,h)/2 - strokeWidth/2` 是本实现的选择，不是规范）
4. **绘制要等尺寸生效**：`.width/.height` 在 create 之后才应用 → 绘制放在 `syncDrawings`
   （与 `syncAlignRules` 同一时机），create 时只建骨架（新不变量 18）

**实现**：`DRAW_ATTRS` 按组件分派语义属性（`value`/`startAngle`/`colors`/`stars`/`stepSize`/`onChange`…）；
`Gauge.colors` 权重按**和归一化**且**权重 0 的段不画**（JSDoc 明说）；`Rating` 半星用 50% 宽裁切覆盖层；
`starStyle` 的图片 URI **加载不了 → 退化为内置星形并记警告**（不静默）。

**验收（已执行）**：`bash run.sh drawdemo` —— **47 条断言**，双端通过。

**破坏验证（4 处）**：角度约定取反、不拆整圆、DataPanel 不按 values 分配、不认半星
→ **9 条失败、跨 4 组**。
⚠️ **并因此发现测试结构的真问题**：一处断言抛异常会**吞掉后面所有断言**（第一轮跑时 DataPanel 与
Rating 的破坏完全没被暴露）→ 改成**分组隔离**（`group()` 逐组 try/catch），之后四处破坏才全部现形。
**这是"破坏验证"的第二次升级**：不仅要破坏，还要保证**破坏能被完整观察到**。

**旧契约升级**：`test/components.html` 里 `Progress → <progress>` 的断言因实现变更而失败 ——
这是"测试编码了旧契约"的信号。新断言**更强**（`--progress` 百分比 + `role`/`aria-valuenow`），不是放宽。

**已知限制**：`Progress` 的形状在 create 时确定（之后改 `.style()` 记警告）；`ScaleRing` 刻度、
`Gauge.indicator`/`trackShadow`/`description`、`DataPanel.strokeWidth`/`trackShadow`/`closeEffect`
未实现（记警告）；`DataPanel.trackBackgroundColor` 只记值不接入绘制。

**触及**：`runtime/arkui-dom-runtime.js`（绘制类区块 + `syncDrawings` + `ensureComponent` 分支）、
`fixtures/pages/DrawDemo.ts`、`test/drawdemo.html`、`test/components.html`、
`run.sh`、`electron/run.sh`

### ~~R14 — 多层锚链 + `Guideline` + `bias`~~ ✅ 已完成

**内容**：`alignRules` 原来只支持**一层**（容器或兄弟）。本轮补上链式锚、`Guideline`（虚拟参考线）、`bias`。

**实测纠正了三处"我以为"**（全部以 `.d.ts` 为准）：
1. **`bias` 默认值是 0.5**（`common.d.ts` 的 `@default {horizontal:0.5,vertical:0.5}`）——
   所以"两侧都锚定但没写 bias"= **居中**，不是"不生效"。我第一版只在显式给 bias 时插值，是错的。
2. **`Guideline` 的方向极易记反**：`Axis.Vertical` 是**竖线**、只能锚子组件的**水平**位置；
   `Axis.Horizontal` 是**横线**、只能锚**垂直**位置；**错轴使用时值恒为 0**（JSDoc 原话）。
3. **`GuideLinePosition` 只有 `start`/`end`，没有 `percent`** —— 本 ROADMAP 原来写的
   `{percent:30}` 是旧 API，已改。百分比写 `start:'30%'`；`end` 表示距右边/下边。

**另外补上两套键名**：`LocalizedAlignRuleOptions` 用 `start/end/middle`（水平）+ `top/bottom/center`（垂直），
老版 `AlignRuleOption` 用 `left/right/middle`。原实现只认后者，本地化写法会**静默漏支持**。

**实现**：
- `syncAlignRules` 改为**不动点迭代**（链长 N 需 N 趟，上限 `min(元素数+2, 12)`，超限记 warning），
  这样**逆序声明**的锚链（c 锚 b、b 锚 a 而 c 写在最前）也能算对
- 新增 `applyGuideLines`（容器尺寸变化时重算）/ `alignBoxOf`（容器 / Guideline / 兄弟 三种锚点）
- `applyBias`：按 `[L, (pw-R)-w]` 区间插值，**默认 0.5**，JSDoc 只要求 `>=0` 故只做下界钳制
- **修掉一个脏警告源**：`alignRules` 原来在属性应用时就立刻解析，那一刻锚点可能还没建出来
  （逆序声明必然如此）→ 实测留下 **4 条假警告**"找不到锚点 'x'"。现在只登记，
  解析统一推迟到渲染后的 `syncAlignRules`。

**验收（已执行）**：`bash run.sh reldemo` —— **24 条断言**，双端通过：
逆序锚链 a/b/c=(0,0)/(40,20)/(80,40) + 右下角重合、Guideline `start:'30%'`→90 / `end:30`→270 /
**错轴→0** / 经 guideline 的链式锚（gv2→110）、bias 0.2→56 / 0.8→224 / **不写→140**、
以及"警告通道里没有把已支持项记成未支持"。

**破坏验证**：退化成单趟解析 → 1 条失败；`bias` 默认值改 0 → 2 条失败；去掉错轴守卫 → 1 条失败。
**并因此发现原来那条"错轴→0"的断言没有牙齿**（横线自身 x=0，用 `Start` 对齐时
"错轴返回 0"与"没做判断"碰巧同值）→ 改用 `Center` 对齐后分离成 0 vs 150。

**已知限制**：仍**不是约束求解器** —— `chainMode`（链式排列）未实现；环状锚定只记警告。

**触及**：`runtime/arkui-dom-runtime.js`（`applyAlignRules`/`syncAlignRules`/`applyGuideLines`/`applyBias`）、
`fixtures/pages/RelDemo.ts`、`test/reldemo.html`、`run.sh`、`electron/run.sh`

### ~~R15 — 文本真实换行/行数测量~~ ✅ 已完成

**内容**：实现真实平台模块 **`@ohos:measure`**（不是自造 API）：`MeasureText.measureText` 与
`measureTextSize`。语义全部取自 `.d.ts` 的 JSDoc —— `measureText` **总是量单行**且
"constraintWidth/maxLines 等布局约束**不影响结果**"；`measureTextSize` 回受约束的**宽高、单位 px**。

**实现取向：让浏览器自己排版，不自己模拟。** 离屏元素（`position:absolute; left:-100000px;
visibility:hidden` —— **不能用 `display:none`**，那样没有布局、量出来全是 0）+ 浏览器真实排版，
再用 `Range.getClientRects()` 数行盒（按 `top` 去重）。这样字距/字体回退/禁则处理的答案**与真实渲染一致**
—— 实测 `measureTextSize` 的宽高与同文本同宽度的真实 `Text` DOM **逐像素相等**。
"按字符宽度累加"的模拟一定会在这三处与渲染分叉，而这条 API 的用途恰恰是预算尺寸。

**验收（已执行）**：`bash run.sh textmeasure` —— **25 条断言**，双端通过：
`measureText` 的单行语义（带约束与不带**完全相同**）、`letterSpacing` 加宽、约束宽度、
行数 = `round(高度/单行高)` 与手工推算一致、`maxLines` 夹高、`lineHeight` 覆盖、
**与真实 Text DOM 的宽高逐像素一致**、以及三条**直接的行数断言**。

**⚠️ 破坏验证暴露的一个"断言盲区"**（本轮最值得记的一条）：
`measureTextSize` 只回 `width`/`height`，而 `height = 行数 × 单行高` —— **行数在算式里被约掉**。
我把"数行"改成恒返回 1 后，**从高度反推出来的行数依然是 4，相关断言全过**。
→ 因此补了自省钩子 **`__arkui_dom_countLines(el)`**（与 `measureTextSize` 内部同一个原始函数），
让数行能被直接断言。**通用教训：中间量在最终结果里被约掉时，只断言最终结果等于没测它。**

**破坏验证（4 处）**：`measureText` 不再忽略约束、数行恒为 1、不夹 `maxLines`、忽略 `lineHeight`
→ 全部被抓（数行那条在补了自省钩子后由 2 条直接断言抓到）。

**我这轮又犯了一次同类错误**：断言"不设宽度的 `Text` 是单行" —— 实际它受**容器**约束
（测试页 `#root` 320px，23 字×16px=368 > 320 必然换行）。**实现是对的、期望是错的**；
改成用元素自身实测宽度自洽推算行数，并另加一个"显式给足宽度 → 单行"的用例。

**已知限制**：`Resource` 引用（无资源管线）与百分比约束按默认值/像素处理并记警告；
`measureTextSize` 在当前 SDK **已标 `@deprecated since 18`**（官方建议 `UIContext.getMeasureUtils()`），
本实现只做了前者（走 `getUIContext()` 会响亮 `TypeError`）。

**触及**：`runtime/ohos-shims.js`（`@ohos:measure` + `__arkui_dom_countLines`）、
`fixtures/pages/TextMeasure.ts`、`test/textmeasure.html`、`run.sh`、`electron/run.sh`

### ~~R16 — `LazyForEach` 变高列表项~~ ✅ 已完成

**内容**：原来用**固定估算高度**（`estItemH`，只从首项校正）。改成"逐项 advance 的前缀和"模型 +
渲染后实测回填 + 滚动锚定。详见 `ARCHITECTURE.md` §4.5。

**验收（已执行）**：`bash run.sh lazyvh` —— **22 条断言**，双端通过：
8 项全实测时 `totalH` 与 DOM 末项底部**逐像素相等**、每一项的 `offsetTop` 与模型**逐项相等**、
`scrollToIndex(100)` 目标 `offsetTop - scrollTop = 0`、往返一次后仍为 0（不累积误差）、
400 项只渲染 4~5 个节点、0 告警。

**四个真 bug（全靠断言抓出来，不是读代码看出来的）**：
1. **topSpacer 也是 flex 子项** → 容器 `gap` 多算一次，模型永远差一个 gap。改成「块级 + 每项 `margin-bottom`」。
2. **`scrollToIndex` 把"渲染空间序号"当成"数据空间索引"** → `scrollToIndex(0)` 跳到 100 段。
   窗口内第 k 个渲染项对应索引 `window[0]+k`。
3. **锚定 delta 算得太早**：先取新偏移、再更新估计值 → 补偿量少算一截（目标偏 10px）。
   → 顺序必须是"**等所有会改前缀的改动都落地，再取新偏移**"。
4. **窗口没变时不重设 spacer** → "旧 spacer + 新模型"错配（整窗口偏 166px）。
   → spacer 高度**每次都按当前偏移重设**。

**我自己的错误断言**：把 `scrollHeight` 当内容高度 —— 内容比视口矮时它被钳到 `clientHeight`。
改成 `max(clientHeight, 末项底部)`。

**跨环境的意外收获**：同一份断言在 Electron 里高度是 **54/124**、浏览器是 **55/125**（字体度量不同），
因为断言只钉"两种取值、相差 70" → 两端都过。**不硬编码像素是对的。**

**破坏验证（4 处）**：不回填实测高度 / 不做锚定 / 窗口没变时不重设 spacer /
`scrollToIndex` 用渲染序号当索引 → **8 条失败、跨 4 组**。

**已知限制**：`heights` 按**索引**存（数据源增删/重排后整表失效，靠 `refresh` 重建窗口，不做按 key 迁移）；
未实测到的深滚动位置**总高是估计值**（只有"视口覆盖全部项"时才有精确总高）。

**触及**：`runtime/arkui-dom-runtime.js`（`createLazyForEach` / `scrollToIndex` / `__arkui_dom_lazyInfo`）、
`fixtures/pages/LazyVar.ts`、`test/lazyvar.html`、`run.sh`、`electron/run.sh`

### R17 — `onMeasureSize` / `onAreaChange` 对齐

**内容**：回传的尺寸要来自真实布局结果，而不是近似值。

**依赖**：R15、R16（都需要真实测量）。

**验收**：断言回调拿到的 `width/height` 与 `getBoundingClientRect()` 一致。

---

## P4 平台模块

### R18 — `@ohos:media`

**内容**：`createImageSource` / `ImageSource.getImageInfo`（尺寸/格式）。浏览器侧用 `new Image()` + `naturalWidth/Height`。

**验收**：对 `tools/serve.py` 提供的一张已知尺寸 PNG，断言 `getImageInfo` 返回的尺寸正确。

### R19 — `@ohos:notification`

**内容**：`notificationManager.publish` → Electron 侧用 `new Notification()`，浏览器侧退化为记录 + 可选 `Notification API`。

**验收**：断言调用后 `__arkui_dom_logs` 有记录，且 Electron 侧通知对象被创建（不做系统级断言，避免依赖桌面环境）。

### R20 — `startAbilityForResult` + `promptAction`

**内容**：`startAbilityForResult` 的回调链路；`promptAction.showToast` / `showDialog`（DOM 实现）。

**依赖**：无（`startAbility` 已实现，补 result 分支）。

**验收**：断言 `startAbilityForResult` 的 `onResult` 被调用且 `resultCode` 符合预期；`showDialog` 后 DOM 里出现对话框节点、点确认后消失。

### R21 — 浏览器真文件系统

**内容**：OPFS 在 headless Chrome 里挂起（已踩），`localStorage` 是"看起来持久化"。做**探测式降级**：先探测可用性（带超时），可用则用 OPFS，不可用明确标注"当前后端是 localStorage，非真文件系统"，并在测试输出里体现。

**验收**：断言测试输出**明确写出**当前后端名与是否真文件系统（让"看起来持久化"无处藏身）。

---

## P5 动画 / 手势

### R22 — `animateTo` / `transition` / `animateToImmediately`

**内容**：`animateTo({duration,curve}, fn)` 包住的状态变更 → CSS transition。`transition` 用于出现/消失。

**验收**：断言 `fn` 执行后节点带上 transition 属性且目标值已变；`duration:0` 时不带 transition（不进动画）。

### R23 — `Gesture`

**内容**：`TapGesture` / `LongPressGesture` / `PanGesture` / `PinchGesture` / `SwipeGesture` 映射到 pointer/touch 事件。

**验收**：用 `dispatchEvent` 合成一次 pan 序列，断言回调的 `offsetX/offsetY` 接近合成位移。

---

## P6 与设备路径对齐（研究性）

### R24 — ArkVM / `.abc` 路径调研

**内容**：本项目执行的是 **JS**，设备执行的是 **`.abc` 字节码**。调研两者差异是否会影响语义（如 `es2abc` 对某些降级语法有不同的处理）。**先测量再决定**，不预设要做什么。

**依赖**：无。

**验收**：产出一份**有证据**的差异清单（哪些 `ets-loader` 产物在 `.abc` 下语义不同），或明确结论"对本项目当前范围无影响"。

**触及**：`docs/`（新增调研文档）

---

## 明确不做

| 不做 | 理由 |
|---|---|
| 重写 `.ets` → `.ts` 转换 | 官方 `ets-loader` 就是规范；自己发明一套语义会和设备分叉 |
| 像素级复刻原生渲染 | 字体/光栅化是平台能力，不是本项目目标；目标是**语义与布局**可用 |
| 实现 `.abc` 解释器 | ArkVM 存在且可用；本项目走 JS 路径 |
| 手改 `runtime/generated-components.js` | 生成物；手改会被 `--check` 拦下（R3 起进 CI） |
| 修改 `fixtures/` 里的 `.ts` | 它们是"官方产物能跑"这一结论的**证据**，改了测试就变成自我验证 |

---

## 执行纪律

1. **每个任务先写断言再改代码**（断言写不出来 → 说明任务没定义清楚）。
2. **每个任务都要在浏览器和 Electron 两侧通过**（除非任务本身只关乎某一侧，且写明理由）。
3. **每个任务结束跑 `npm run check`**（R3 之后），并更新 `ARCHITECTURE.md` §6 的实测数字引用块。
4. **不用 `sed` 改代码**；用 `edit` 工具。
5. **交付脚本必须 `chmod +x`**。
6. 测试失败时**如实报告失败输出**，不修断言去迁就代码。
