# ArkUI DOM Runtime —— 路线图（原子任务）

本文是**待办**的唯一权威清单。每项都写成"一个可独立完成、可独立验收的原子任务"，附**可复现的验收命令**。

已完成的机制说明见 `docs/ARCHITECTURE.md`；怎么改见 `docs/DEVELOPING.md`。

**当前状态**：`npm run check` 全绿（preflight + 生成物一致 + 文档数字守卫 + 浏览器 18 用例 + Electron 17 用例）。
v1/v2 状态管理（含 v1 深度观测）、`Grid` 真实轨道、`Tabs` 切换、`Swiper` 轮播、`Navigation` 栈导航均已落地。
**下一步优先级：R14（多层锚链 + Guideline + bias）→ R13/R15–R17（纯绘制组件、文本换行、变高列表）。**
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
| ③ | `@ohos:*` 别名层 + CommonJS 装载 + 真 fetch | `bash run.sh async` |
| ③ | `UIAbility` 启动链路 | `bash run.sh ability` |
| ③ | `router` 页面栈（返回时保留状态） | `bash run.sh router` |
| ③ | **真落盘**（Electron Node fs + shell 级验证） | `bash electron/run.sh persist` |
| ②.5 | CLT 缺库补齐（`libhilog.so` / `libshared_libz.so`） | `/data/training/cli/arkts-shim/README.md` |
| **P0** | git 仓库 + `.gitignore`（287 MB → 跟踪 484 KB） | `git log`，`git ls-files` |
| **P0** | 环境 preflight 自检 | `npm run preflight` |
| **P0** | 统一验收门禁（退出码可信） | `npm run check`；制造漂移 → exit 1 |
| **P0** | `--check` 真正只校验不落盘 | `node tools/gen-components.mjs --check` |

当前：**浏览器 18 用例 + Electron 17 用例全绿**（`npm run check` → `exit 0`）。

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
| P2 | R13 其余组件视觉语义 | 中（85 个骨架只有 `data-*`） | 中 |
| P3 | R14–R17 布局引擎 | 中高（真实页面一定踩） | 高 |
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

### R14 — 多层锚链 + `Guideline` + `bias`

**内容**：`alignRules` 现在只支持**一层**（容器或兄弟）。补：链式锚（A 锚 B、B 锚 C）、`Guideline`（虚拟参考线）、`bias`（居中偏置）。

**验收**：三层嵌套锚定的元素位置断言；`Guideline({start:{id:'g1',direction:Axis.Horizontal,position:{percent:30}}})` 后锚到 `g1` 的元素落在 30%。

**触及**：`runtime/arkui-dom-runtime.js`（`applyAlignRules` / `syncAlignRules`）、`test/layout.html`

### R15 — 文本真实换行/行数测量

**内容**：`maxLines` 当前用 CSS `-webkit-line-clamp` 近似，`measure` 的行数不真实。用 `canvas.measureText` 或二分 + `Range` 精确算换行点与行数。

**验收**：断言一段已知文本在已知宽度下的**测量行数**等于手工计算的期望值（当前会失败）。

**触及**：`runtime/arkui-dom-runtime.js`、`test/measure.html`

### R16 — `LazyForEach` 变高列表项

**内容**：现在用**固定估算高度**（`estItemH`）。补：渲染后回填实测高度、修正 spacer、滚动位置稳定（避免跳动）。

**验收**：列表项高度不等（50px/120px 交替）时，`scrollToIndex(20)` 后目标项的 `getBoundingClientRect().top` 相对容器一致；总高度 = 实测高度之和。

**触及**：`runtime/arkui-dom-runtime.js`（`createLazyForEach`）、`test/lazy.html`

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
