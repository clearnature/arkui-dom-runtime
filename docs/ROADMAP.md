# ArkUI DOM Runtime —— 路线图（原子任务）

本文是**待办**的唯一权威清单。每项都写成"一个可独立完成、可独立验收的原子任务"，附**可复现的验收命令**。

已完成的机制说明见 `docs/ARCHITECTURE.md`；怎么改见 `docs/DEVELOPING.md`。

**当前状态**：`npm run check` 全绿（preflight + 生成物一致 + **产物/源一致** + 文档数字守卫 + 断言计数守门 + 浏览器 32 用例 + Electron 31 用例）。
v1/v2 状态管理（含 v1 深度观测）、`Grid` 真实轨道、`Tabs` 切换、`Swiper` 轮播、`Navigation` 栈导航、
`alignRules` 多层锚链 + `Guideline` + `bias`、纯绘制四件套、文本真实测量（`@ohos:measure`）、变高列表项、`onAreaChange` 与自定义布局协议、
R19–R24（平台模块 / 动画 / 手势 / `.abc` 路径调研）均已落地。
**下一步优先级：`Navigation` 的标题栏与分栏模式、其余 85 个骨架组件的视觉语义、`runtime/` 的物理拆分（拆法与实测依据见 `README.md` 的「已知待办」末条）。**
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
| ③ | **V1 深度观测**（`@Observed` + `@ObjectLink`，Proxy 实现） | `bash run.sh observe`（19 条断言，含负向） |
| ③ | **状态管理 v2**（`ViewV2` + 11 个装饰器） | `bash run.sh v2`（25 条断言，浏览器 + Electron 双通过） |
| ③ | **`Grid`/`GridItem` 真实轨道** + `Tabs`/`TabContent` 切换 | `bash run.sh tabgrid`（51 条断言，含几何与机制自省；双端通过） |
| ③ | **`Swiper` 轮播**（loop / autoPlay / 指示点 / 控制器） | `bash run.sh swiper`（38 条断言，双端通过，连跑 3 次稳定） |
| ③ | **`Navigation` 栈导航**（NavPathStack / 生命周期 / 状态保留 / 零泄漏） | `bash run.sh navdemo`（74 条断言，双端通过） |
| ③ | **`alignRules` 多层锚链 + `Guideline` + `bias`** | `bash run.sh reldemo`（24 条断言，双端通过） |
| ③ | **纯绘制四件套**（`Progress`/`Gauge`/`DataPanel`/`Rating`） | `bash run.sh drawdemo`（47 条断言，双端通过） |
| ③ | **文本真实测量**（`@ohos:measure` + `__arkui_dom_countLines`） | `bash run.sh textmeasure`（25 条断言，双端通过） |
| ③ | **变高列表项**（实测回填 + 前缀和偏移 + 滚动锚定） | `bash run.sh lazyvh`（22 条断言，双端通过） |
| ③ | **`onAreaChange` + 自定义布局协议** | `bash run.sh measarea`（28 条断言，双端通过） |
| ③ | **图像信息**（`@ohos.multimedia.image`） | `bash run.sh measimage`（13 条断言，双端通过） |
| ③ | **通知**（`@ohos.notificationManager`，含投递路径自省） | `bash run.sh measnotify`（32 条断言，双端通过） |
| ③ | **ability 结果链路 + 轻提示/对话框**（`startAbilityForResult`、`promptAction`） | `bash run.sh promptaction`（37 条断言，双端通过） |
| ③ | **后端如实自报 + OPFS 现场探测**（"能持久化 ≠ 是文件系统"） | `bash run.sh realfs`（21 条断言，双端通过） |
| ③ | **显式动画**（`animateTo`/`animateToImmediately` → CSS transition） | `bash run.sh animdemo`（36 条断言，双端通过） |
| ③ | **手势**（Pan/Tap/LongPress/Swipe/Pinch → pointer 事件） | `bash run.sh gesturedemo`（24 条断言，双端通过） |
| ③ | **出现/消失过渡**（`transition`：Insert/Delete 方向门控、TransitionEffect 自带时长、asymmetric+onFinish） | `bash run.sh transitiondemo`（58 条断言，双端通过） |
| ③ | `@ohos:*` 别名层 + CommonJS 装载 + 真 fetch | `bash run.sh async` |
| ③ | `UIAbility` 启动链路 | `bash run.sh ability` |
| ③ | `router` 页面栈（返回时保留状态） | `bash run.sh router` |
| ③ | **真落盘**（Electron Node fs + shell 级验证） | `bash electron/run.sh persist` |
| ②.5 | CLT 缺库补齐（`libhilog.so` / `libshared_libz.so`） | `/data/training/cli/arkts-shim/README.md` |
| **P0** | git 仓库 + `.gitignore`（287 MB → 跟踪 484 KB） | `git log`，`git ls-files` |
| **P0** | 环境 preflight 自检 | `npm run preflight` |
| **P0** | 统一验收门禁（退出码可信） | `npm run check`；制造漂移 → exit 1 |
| **P0** | `--check` 真正只校验不落盘 | `node tools/gen-components.mjs --check` |

当前：**浏览器 24 用例 + Electron 23 用例全绿**（`npm run check` → `exit 0`）。

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
| P3 | ~~R17 onAreaChange + 自定义布局协议~~ **已完成** | — | — |
| P4 | ~~R18 图像信息~~ **已完成** | — | — |
| P4 | ~~R19–R21 平台模块~~ **已完成** | — | — |
| P5 | ~~R22–R23 动画/手势~~ **R22 已完成、R22 收口/R23/R23 收口 已完成** | — | — |
| P6 | ~~R24 ArkVM / `.abc` 路径调研~~ **已完成** | — | — |

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

7 步：preflight → 生成物一致 → **产物/源一致（`build-runtime --check`）** → 文档数字一致 → **typecheck（R38）** → 浏览器 → Electron
（另加统计，留档，不影响退出码）。
（后两步由 R5a 之后的守门补上：`stats --check-doc` 于工程化阶段加、`build-runtime --check` 于 2026-09-21
拆分 runtime 源码时加。）

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

### ~~R5c — runtime 源码拆分（"源拆、产物不拆"）~~ ✅ 已完成（2026-09-21）

**背景**：`runtime/arkui-dom-runtime.js` 长到 4615 行 / 220,899 B 的单闭包。它**不是没结构**
（内部 30 个分节/子节横幅覆盖 99% 的字节：141 个函数 / 13 个类 / 147 个顶层 const），但同一份代码
无法按节独立阅读/审查。

**测量（决定了拆法）**：分片之间共享同一个闭包 —— 动画+手势那一块**向内**只提到
`ViewStackProcessor` 1 次、`mountNode` 1 次（`elmtRecords` **0 次**），**向外**只被 4 个入口引用
（`registerTransition` ×2、`detachChildren` ×2、`transitionsDescribe`/`gestureTypes` 各 1），
块内 80 个顶层定义里 54 个零外部引用；但 `animWindow` 是**可变绑定**（动画分片 `let` 重新赋值，
批量重渲染段在块外读它并 `animWindow.els.push(...)`）。加上产物是经典脚本（30 个手写 HTML 与
Electron 按固定顺序加载这一个文件），所以选【源拆、产物不拆】：

- 新增 `tools/build-runtime.mjs`：把 `runtime/src/` 的分片按 `// @include <分片名>` 拼成
  `runtime/arkui-dom-runtime.js`（产物入库；`--check` 只校验不落盘，孤儿分片/成环/漏展开都报错）
- 分两次拆完：先 `transition` 一节，再把**动画 + 手势**整块拆出，最终 3 个分片 ——
  `main.js`（3524 行，其余全部）、`animation.js`（476 行：显式动画 + 出现/消失过渡）、
  `gesture.js`（617 行：手势含分组与仲裁）。规则是"**一个分片 = 一组相关小节**"，而非一节一个文件
  （产物内部有 30 个分节/子节横幅，逐个建文件没有意义）

**验收（已执行，两次拆分各一遍）**：
- **产物与拆分前逐字节一致**：`md5sum -c` → `e73be14f90600b0d490e8a7873c94bc7`（220,899 B），
  `diff -q` 无输出，`git` 里产物**零改动** —— 拆分类重构的唯一硬判据
- `node tools/build-runtime.mjs --check` 绿；破坏验证：改分片不重拼 → 红（报首个不同行 + 修法）、
  删掉 `@include` 标记 → 红（孤儿分片）
- `npm run check` → **6 步全绿**（新增第 3 步 `build-runtime --check`）

**下一步（机制已就位，只是重复同一动作）**：~~`main.js` 剩 3524 行 / 165,512 B / 26 个分节横幅。
按横幅切的实测候选切口（`README.md` 的「下一步」列了完整清单）：`Navigation` 栈导航 370 行、
布局 263 行、状态管理 v2 252 行、`onAreaChange`+自定义布局协议 231 行、`ability` 栈 197 行。~~

**第三步（2026-09-21，R25 收口后执行）**：上列候选切口（尺寸已因 R25 增长）一次拆完，**3 → 9 个分片**：
`nav`(1031 行 / 50,317 B)、`draw`(408)、`area`(237)、`layout`(262)、`v2`(251)、`ability`(196)，
`main.js` 剩 **1869 行 / 86,452 B**。六段全部按"横幅行 → 下一横幅前一行"切（分节间空行留在 `main.js`，
按坑 84 的教训不进分片、不以行数组拼而是整段切片 + 强制末换行）；一次性切完再重拼，
**产物 md5 与拆分前一致**（`e861eb81d1af46dac33d97fdfe1ab5df`）—— 字节同一性即行为同一性。
`LazyForEach`（234 行）与更小的子节留在 `main.js`：它们在 `具体组件` 等大节的**内部**，切了会把
同节劈成两半，性价比有限；`组件注册表`/`安装全局` 按原判据不动。

**触及**：`tools/build-runtime.mjs`（新）、`runtime/src/main.js`、`runtime/src/animation.js`（新）、
`runtime/src/gesture.js`（新）、`tools/check-all.sh`、`tools/preflight.mjs`、`tools/stats.mjs`、`package.json`、
`README.md`、`docs/ARCHITECTURE.md`（§5 不变量 20 + §7 文件职责）、`docs/DEVELOPING.md`（§2 + 坑 84）；
第三步另触及 `runtime/src/{nav,layout,draw,area,v2,ability}.js`（新）

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

**验收（已执行）**：`bash run.sh v2` + `bash electron/run.sh v2` → **25 条断言双通过**，
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
bash run.sh observe && bash electron/run.sh observe   # 19 条断言双通过
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

**验收（已执行）**：`bash run.sh swiper` —— **38 条断言**，双端通过；浏览器连跑 3 次稳定
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

**验收（已执行）**：`bash run.sh navdemo` —— **74 条断言**，双端通过：
初始态/builder 登记/根状态保留（push 前改到 2，pop 后仍是 2）/三层栈/`popToName`/`popToIndex`/
`replacePath`/`removeByName`/`moveToTop`/`clear`/`onPop` 的 `{info,result}`/生命周期顺序（4 条相对顺序断言）/
**elmtId 零泄漏（25 → 25）**/两条负向（缺 builder 的 push、越界 `popToIndex`）。

**破坏验证**：去掉"非栈顶隐藏" → 3 条可见性断言失败；交换 `willShow`/`shown` → 1 条失败；
不派发 `onPop` → 1 条失败。

**已知限制（写进 CAPABILITY）**：~~**无标题栏/工具栏/返回按钮**~~、~~只有 Stack 语义~~ —— 两者已由
**R12 收口**（见下）实现；无转场动画；`setInterception`/`getParent`/`removeByNavDestinationId` 未实现；
**生命周期顺序**：~~推断~~ **R42 部分确证**——真机 `navigation_pattern.cpp` 同为"先 will 后实"
成对触发（`ON_WILL_HIDE → ON_HIDDEN` 等），与实现一致；全序仍以 `.d.ts` JSDoc 语义为准。

**触及**：`runtime/arkui-dom-runtime.js`、`fixtures/pages/NavDemo.ts`、`test/navdemo.html`、
`run.sh`、`electron/run.sh`

---

### R12 收口 — `Navigation` 的标题栏 / 工具栏 / 分栏 ✅（2026-09-21）

**背景**：R12 留下的是**可见差异**——页面没有标题栏、没有返回按钮、`Split`/`Auto` 只记警告。

**先测量**（新增 `pages/NavBarDemo.ets` → 官方构建 → 读产物）三条关键约定：
① `title` 的四种形态（string / `{main,sub}` / CustomBuilder / `{builder,height}`）都走同一个属性调用，
**CustomBuilder 也被 loader 归一化成 `{ builder }` 对象** → "是不是自定义标题"看的是有没有 `builder` 字段；
② `NavigationTitleMode` / `NavBarPosition` / `TitleHeight` 在产物里是**自由变量**（必须挂 global）；
③ 标题栏高度全部能从 `.d.ts` 的 JSDoc 抄到：`Full`=112vp（只有主标题）/138vp（主+副）、`Mini`=56vp、
`Free`（默认）非滚动态等同 Full；`NavigationCustomTitle.height` **优先于 titleMode**（原文）；
`navBarWidth` 默认 240vp；`Auto` = **宽度 ≥600vp 走 Split**（600 = minNavBarWidth 240 + minContentWidth 360）。

**实现**：`Navigation` 增加 `[data-arkui-nav-bar]`（内含 `[data-arkui-nav-titlebar]`）作为第一个子节点，
根内容仍是直接子节点（靠容器 padding 让位，**不需要重定向组件栈**）；目的地增加
`[data-arkui-dest-titlebar]` 与 `[data-arkui-dest-toolbar]`。布局统一放在**渲染后同步阶段**
（`syncOneNav` / `syncOneDest` / `syncNavChrome`，与 `syncAlignRules` 同一时机）——分栏宽度与
`Auto` 判定都要真实尺寸（不变量 18）；另外 `navSyncVisibility` 里也同步一次
（push/pop 不一定伴随重渲染，首版漏了这条，断言当场抓住）。

**验收（已执行）**：`bash run.sh navbardemo`（51 条断言）/ `bash electron/run.sh navbardemo` 双端通过；
`bash run.sh navdemo` **74 条**（原「`Navigation.title` 未实现记警告」的负向断言改为正向：
标题栏存在、文字来自产物、高度 112）。断言覆盖：三组枚举取值、四种 title 形态、三个高度数字、
`NavigationCustomTitle.height` 压过 `titleMode`、`hideTitleBar`、Split/End/分割线/内容列、
`Auto` 的 700/400 两侧、目的地标题栏/返回键（点了真 `pop()`）/菜单与工具栏的 `action`、
`hideBackButton` 不渲染节点、`backButtonIcon` 记录。

**破坏验证**（3 项，各被精确抓住）：① 关掉标题栏绘制 → **14 条**红（分栏与 Auto 断言不受影响）；
② 分栏恒返回 stack → 恰好 **9 条**红；③ 忽略 `NavDestination.hideBackButton` → 恰好 **1 条**红。

**顺带修掉运行时一个既有脆弱点**：`navBuildDest` 原来用 `area.lastElementChild` 认领刚建的目的地，
但 builder 里的 `if/else` 会生成 `If` 包装层（`display:contents`）——目的地是"孙子辈"，于是被判成
"没建出来"、**把栈项回滚掉**（栈空了、页面看着却有一个目的地）。旧的 NavDemo 恰好没有 `if` 分支，
一直没暴露；本轮的 `PageMap` 有 3 个分支，断言当场抓住。改成按"本次新建的节点"认领
（`__arkuiNavNew` 标记），"在目标区内"也从"直接父节点"改成**向上找祖先**（记坑 85）。

**已知限制**：~~`NavDestination` 标题栏恒为紧凑 56vp、`TitleHeight` 数值 112/138 是推断~~
**R42 照真机确证**（`navigation_bar_theme.cpp` 主题默认 112/138/56 + `nav_bar_layout_algorithm.cpp`
选择逻辑；NavDestination 紧凑标题栏 = `TITLEBAR_HEIGHT_MINI=56vp`）；`menus`/`toolbarConfiguration` 只支持
数组形态（builder 形态记警告）；`onTitleModeChange`/`navBarWidthRange`/`hideNavBar`/`enableDragBar`/
`minNavBarWidth`/转场动画/系统栏样式未实现（记警告）；`Auto` 用**组件自身宽度**判而不是窗口宽度。

**触及**：`runtime/src/main.js`（`NavigationTitleMode`/`NavBarPosition`/`TitleHeight` + nav-bar DOM +
`syncOneNav`/`syncOneDest`/`syncNavChrome` + `NAV_ATTRS`/`NAVDEST_ATTRS` + `__arkui_dom_navChrome`）、
`fixtures/pages/NavBarDemo.ts`、`harmony-proj/`（`NavBarDemo.ets` + main_pages.json）、
`test/navbardemo.html`、`test/navdemo.html`、`run.sh`、`electron/run.sh`

### ~~R13 — 数据可视化类：`Progress` / `Gauge` / `DataPanel` / `Rating`~~ ✅ 已完成

> 本条是建仓时的规划残本（同轮号在 P3 下还有一份，完成记录在**那一节**，commit `8a362b9`：
> `drawdemo` 47 条断言、画法与坑）。2026-09-21 收口 R25 时发现并划掉。

### R26 — SVG 形状族：`Circle` / `Ellipse` / `Rect` / `Line` / `Path` / `Polygon` / `Polyline` + `Shape` ✅（2026-09-21）

**内容**：「其余骨架组件的视觉语义」第一批。形状族是纯绘制（无布局语义）、语义全在属性方法上，
与 R13 绘制四件套同一打法。骨架推进策略 = **按家族逐批收**（下一批候选：输入类 / 弹出类 / 表层类）。

**先测量**（新增 `pages/ShapeDemo.ets`）：① create 参数形态（`Rect({width,height,radiusWidth,
radiusHeight})`、`Path({width,height,commands})`…）；② **`LineOptions` 没有 `startPoint`/`endPoint`
—— 它们是属性方法**（放 create 参数第一版编译就红）；③ `Shape.create()` 无参 + `.viewPort({...})`
+ 子形状 `width('100%')` 官方写法。

**实现**：新分片 `runtime/src/shape.js`（第 10 个，手写优先于生成骨架）。组件根 = `<svg>`，
形状元素挂 `__shapeEl`，`fill/stroke/…` 经 `SHAPE_ATTRS` 落 **SVG 表现属性**（不是 data-*/CSS——
fill 要靠表现属性被 Shape 容器继承）；几何 `r = min(w,h)/2`、`commands → d` 原样、`points` 序列化。
默认值不写属性：SVG 原生默认（黑填充/无描边）与 `.d.ts` 默认值（fill=Color.Black、
stroke opacity 0）恰好一致。

**验收**：`bash run.sh shapedemo`（**36 条断言**）双端通过。**破坏验证（3 处）**：分派短路 →
**19 红**；内切圆取 `max` → 恰好 **1 红**（⚠️ 首轮 fixture 是正方形 Circle，min=max 破坏**空转
0 红**——当场改非正方形 80×60，R13 坑 2 教训现场重演）；Shape 容器摘出分派 → 恰好 **4 红**。
还原后 md5 与基准一致。

**已知限制**：create 后改 `.width()/.height()` 只动 svg 视口不反推几何；渐变形态的
`fill`/`stroke`、`strokeMiterLimit`、`Path.mil` 未实现（记警告）。

**触及**：`runtime/src/shape.js`（新）、`runtime/src/area.js`（applyAttr 分支）、
`runtime/src/main.js`（@include + 安装全局）、`tools/stats.mjs`（手写 17→25）、
`fixtures/pages/ShapeDemo.ts`、`harmony-proj/`（ShapeDemo.ets + main_pages.json）、
`test/shapedemo.html`、`run.sh`、`electron/run.sh`

### R27 — 输入类：`Checkbox` / `Radio` / `Toggle` / `Slider` ✅（2026-09-21）

**内容**：骨架语义第二批。生成骨架已映射原生控件（checkbox/radio/checkbox/range），本轮补
ArkUI 语义层：选中态（幂等 diff）、`selectedColor → accent-color`、无对应物的属性照实记 data-*、
`Radio` 组互斥（`name = group`）、`Slider.onChange` 双参 `(value, mode)`（input→Moving、
change→End，通用 on* 规则前拦截）。

**测量**（新增 `pages/InputDemo.ets`，编译期抓到）：`RadioOptions = {value, group}` 没有 `name`；
`ToggleAttribute` 没有 `.select()`（初始选中在 create 的 `isOn`）；`SliderChangeMode = {Begin=0,
Moving=1, End=2, Click=3}`。

**运行时三个真问题**（比语义本身值钱，已修）：① 事件类属性**重复注册**——`@State` 变化触发
重渲染、重渲染把 `.onChange(cb)` 再应用一遍，追加语义下监听器每轮翻倍 → 通用事件规则改
**覆盖语义**（坑 88）；② 跨节点错投（rd 包装器被挂到 tg1/sl1 上）→ 包装器加 **target 校验**；
③ Chrome 只给新选中者发 change，被取消成员的 `onChange(false)` 按组**补发**（radio.d.ts JSDoc：
false = "changes from selected to unselected"）。

**验收**：`bash run.sh inputdemo`（**29 条断言**；R27 时 27，R38 +onSubmit 组）双端通过。**破坏验证（3 处）**：摘 target 校验
→ **3 红**；补发摘除 → **2 红**；幂等 diff 改无条件赋值 → **2 红**（重渲染拉回声明值 + 凭空
RD 对）。还原后 md5 一致，navdemo/tabgrid 回归绿。

**已知限制**：编程 `select`/`checked` 不派发 onChange（取舍已记录）；`Click`/`Begin` 模式无 DOM
事件对应；`contentModifier` 等自定义形态只记 data-*。

**触及**：`runtime/src/input.js`（新，第 11 个分片）、`runtime/src/area.js`（覆盖语义 + 分支）、
`runtime/src/main.js`（@include + 安装全局）、`tools/stats.mjs`（手写 25→29）、
`fixtures/pages/InputDemo.ts`、`harmony-proj/`（InputDemo.ets + main_pages.json）、
`test/inputdemo.html`、`run.sh`、`electron/run.sh`

### R28 — 信息展示类：`Badge` / `Counter` / `Divider` / `Marquee` ✅（2026-09-21）

**内容**：骨架语义第三批。`QRCode` 本轮**不收**（真画需要完整 QR 编码器，单列）。

**测量**（新增 `pages/ShowDemo.ets`，编译期抓到）：Badge 数字重载用 **`count`**、字符串重载用
`value: ResourceStr`；**`BadgeParam.style` 必填且在 create 参数里**（没有 `.style()` 方法，字段名
是 `color/badgeColor/badgeSize`）；`MarqueeOptions.start` 必填。BadgeStyle 默认值全有 JSDoc 原文
（badgeColor Color.Red / color Color.White / fontSize 10vp / badgeSize 16vp / borderWidth 1vp）。

**实现**：新分片 `runtime/src/show.js`（第 12 个）。Badge = 容器 + 绝对定位角标；Counter =
inline-flex + 内置可点元素（flex order 摆位，create 时内容未挂）+ onInc/onDec 拦在通用 on* 规则前；
Divider = div 背景色画线（默认 `#33182431`/1px，JSDoc 原文，纵向转宽）；Marquee = CSS 动画
（~~时长 = 文本长度×16px/step×16ms，推断~~ R40 起照真机公式：`(容器宽+文本宽)×85/step`），
事件收口**定时器兜底**（坑 ⑧：headless 对
不可见页面的动画事件会节流，animationend 实测会丢）。

**验收**：`bash run.sh showdemo`（**27 条断言**；R40 +时长公式断言）双端通过。**破坏验证（3 处）**：分派短路 →
**8 红**（Badge 全绿——语义全在 create 参数，各断言管各的面）；位置映射恒 RightTop → **1 红**；
strokeWidth 方向分支摘除 → **1 红**。还原后 md5 一致。

**新教训（坑 89）**：破坏①首轮"0 红、用例挂"——测试里两个 6s 轮询把 `run_one` 的
`--virtual-time-budget=8000` 拖穿，红条数落不了盘。**轮询上限必须小于"预算 − 前置耗时"**。

**触及**：`runtime/src/show.js`（新）、`runtime/src/area.js`（SHOW 分支）、
`runtime/src/main.js`（@include + 安装全局）、`tools/stats.mjs`（手写 29→33）、
`fixtures/pages/ShowDemo.ts`、`harmony-proj/`（ShowDemo.ets + main_pages.json）、
`test/showdemo.html`、`run.sh`、`electron/run.sh`

### R29 — 弹出类：`Select` / `Menu` + `MenuItem` ✅（2026-09-21）

**内容**：骨架语义第四批。Select 生成骨架已映射原生 `<select>`，本轮补语义层。

**测量**（新增 `pages/PopDemo.ets`）：`Select.create([{value}])` 单参数（`selected` 是属性方法，
`SelectOption = {value, icon?}`）；`onSelect` 双参 `(index, value)`（选中序号 + 选中项文本）；
`MenuItem.onChange` 是**多选语义**（每项独立 selected，非互斥）。

**实现**：新分片 `runtime/src/popup.js`（第 13 个）。Select：options → `<option>`、
`selected(i) → selectedIndex` 直落、`onSelect` 拦在通用 on* 规则前带双参派发（编程改
selectedIndex 不派发 change——DOM 取舍已记录）；`value(str)` 显示文本覆盖记 `data-value-text`
（原生 select 不可覆盖，取舍已记录）；MenuItem 行式面板：点击切换自身选中（✓ 标记）并派发
`onChange(新状态)`。

**验收**：`bash run.sh popdemo`（**16 条断言**）双端通过。**破坏验证（3 处）**：分派短路 →
**7 红**；点击切换摘除 → **3 红**；options 构建摘除 → **5 红**（selectedIndex 变 -1、
双参全空——证明 `<option>` 构建是 selectedIndex 与回调的基座）。还原后 md5 一致。

**触及**：`runtime/src/popup.js`（新）、`runtime/src/area.js`（POPUP 分支）、
`runtime/src/main.js`（@include + 安装全局）、`tools/stats.mjs`（手写 33→35）、
`fixtures/pages/PopDemo.ts`、`harmony-proj/`（PopDemo.ets + main_pages.json）、
`test/popdemo.html`、`run.sh`、`electron/run.sh`

### R30 — `UIContext`（`getUIContext()` 的现代 API 面）✅（2026-09-21）

**内容**：关掉 CAPABILITY 里记录已久的限制——`this.getUIContext()` 原本直接 TypeError。
现代 ArkTS 代码大量走这条面。

**测量**（新增 `pages/UiContextDemo.ets`）：`this.getUIContext()` 是组件实例上的普通方法调用；
`getRouter()` 返回**经典 Router 面**（`Router.pushUrl(options)`，不是 NavPathStack——编译期实测）；
`animateTo(param, fn)` 与 `Context.animateTo` 同源。

**实现**：`ViewPU.prototype.getUIContext`（main.js，无新分片——本体只有 8 行对象面）。只实现
**实测面**：animateTo/animateToImmediately（委派 runExplicitAnimation，与 Context.animateTo 同
管道）、getRouter（@ohos:router 垫片）、getPromptAction（垫片）、runScopedTask（立即执行，取舍
已记录）。ViewV2 extends ViewPU —— @ComponentV2 组件同样继承。

**验收**：`bash run.sh uictxdemo`（**8 条断言**）双端通过。**破坏验证（2 处）**：getUIContext 摘除
→ **4 红**（页面 onClick 直接 TypeError——原限制症状）；animateTo 改裸赋值 → **1 红**
（msg 照样到 B、动画记录缺位——`__arkui_dom_animations.history` 的 `api='animateTo'` 断言把
"真动画"与"裸赋值"区分开）。还原后 md5 一致，v2 回归绿。

**触及**：`runtime/src/main.js`（makeUIContext + 原型挂载）、`fixtures/pages/UiContextDemo.ts`、
`harmony-proj/`（UiContextDemo.ets + main_pages.json）、`test/uictxdemo.html`、
`run.sh`、`electron/run.sh`

### R31 — 表层类：`Canvas`（真实 2D context）✅（2026-09-21）

**测量**（新增 `pages/CanvasDemo.ets`）：`Canvas(this.context)` 的 create 参数是 ctx 对象；
`new CanvasRenderingContext2D(settings)`；`onReady(cb)`（JSDoc："perform any drawing after this
event is triggered"）；绘制面就是标准 Canvas 2D。

**实现**：新分片 `runtime/src/canvas.js`（第 14 个）。手写 Canvas → 原生 `<canvas>`，ctx 转发
原生 2D context（像素断言天然有牙齿）；create 时"交接"原生 context；onReady 在尺寸应用后
`setTimeout(0)` 派发并同步 CSS 尺寸 → canvas 内容尺寸（1:1）。

**验收**：`bash run.sh canvasedemo`（**10 条断言**）双端通过——像素采样 R255/G204/alpha=0、
toDataURL 原生前缀。**破坏验证（3 处）**：fillRect noop → **2 红**；尺寸同步摘除 → **1 红**
（默认 300×150 现形）；toDataURL 假串 → **1 红**——⚠️ 首轮 0 红：fixture 断言的字符串边界
太松（`data:image/png,` 前缀假串也命中），收紧为 `base64,` 前缀（R13 坑 2 又一现场）。还原后
md5 一致。

**触及**：`runtime/src/canvas.js`（新）、`runtime/src/area.js`（CANVAS 分支）、
`runtime/src/main.js`（@include + 安装全局）、`tools/stats.mjs`（手写 35→36）、
`fixtures/pages/CanvasDemo.ts`、`harmony-proj/`（CanvasDemo.ets + main_pages.json）、
`test/canvasedemo.html`、`run.sh`、`electron/run.sh`

### R32 — 表层类另一半：`XComponent` ✅（2026-09-21）

**测量**（新增 `pages/XCompDemo.ets`）：`XComponent.create({id, type, controller}, "bundle/module")`
——create 有第二参（bundle 串，记录）；`onLoad` 在 surface 创建后触发；`XComponentController` 的
rect —— JSDoc 原文："不调用 set 则返回组件实际尺寸"。

**实现**：接在表层类分片（canvas.js）。DOM **如实降级为占位容器**（真机 surface 由原生图形栈
持有）；surfaceId 生成 `XComponent-<id>`（DOM 化选择）；onLoad 经 setTimeout(0) 派发
（与 Canvas.onReady 同思想）；Controller 的 rect 默认取组件实际尺寸、set 只记录（DOM 无
surface 缓冲对应物）；onDestroy 只登记（触发时机已写进 docs，不测）。

**验收**：`bash run.sh xcompdemo`（**7 条断言**）双端通过（一次通过）。**破坏验证（3 处）**：
surfaceId 空串 → **1 红**（fixture 的 LOAD+非空计数正是这颗牙）；rect 默认 0×0 → **1 红**；
set 记录断 → **1 红**。还原后 md5 一致。

**触及**：`runtime/src/canvas.js`（表层类分片扩展）、`runtime/src/area.js`（XC 分支）、
`runtime/src/main.js`（安装全局）、`tools/stats.mjs`（手写 36→37）、
`fixtures/pages/XCompDemo.ts`、`harmony-proj/`（XCompDemo.ets + main_pages.json）、
`test/xcompdemo.html`、`run.sh`、`electron/run.sh`

### R33 — 信息展示收官：`QRCode`（真实编码器 + 独立解码交叉验证）✅（2026-09-21）

**测量**（新增 `pages/QrDemo.ets`）：`QRCode.create(value)` 单参数；color 默认 '#ff000000'／
backgroundColor 默认 '#ffffffff'（API 11+）／contentOpacity 默认 1 [0,1]（全部 JSDoc 原文）；
最多 512 字符（超出取前 512）。

**实现**：QRCode 组件接在信息展示家族（show.js）。**不自己实现编码器**——移植第三方库
~~node-qrcode@1.5.4~~ **R41 起换真机 arkui-qrcodegen 的 WASM**（`global.ArkuiQrcodegen`，
单文件内嵌、file:// 可用，源码逐字复制零修改，
ESM 胶水入口）；vendor 缺席记警告并降级（不静默）。渲染在渲染后同步阶段（redrawQr 挂
syncDrawings——不变量 18）；1:1、quiet zone 4、颜色变化重画。**解码器**来自另一个独立第三方
jsQR@1.4.0（test/vendor，Apache-2.0，原样拷贝）——"画出来的码能被独立解码器读回原文"
（ASCII/UTF-8/定制色三块）是交叉验证的牙齿。**入向合规**：两件第三方源码首次入库，登记
THIRD-PARTY-NOTICES 新增 §3b。

**验收**：`bash run.sh qrdemo`（**12 条断言**；R40 +ECC 采样断言）双端通过。**破坏验证（3 处）**：vendor 缺席不警告
→ 3+ 红；前景色未经 ARGB 归一 → **2 红**（解码 null，定制色 qr3 仍绿）；quiet zone 摘除 →
**1 红**。还原后 md5 一致。

**真问题**：ArkUI 的 8 位颜色字面量是 **ARGB**（'#ff000000' = 不透明黑，JSDoc 原文默认），
CSS 是 RRGGBBAA——位数歧义必须归一（首跑解码 null）。

**触及**：`runtime/vendor/`、`test/vendor/`、`runtime/src/show.js`（QRCode + redrawQr）、
`runtime/src/draw.js`（QR 同步口）、`runtime/src/main.js`（安装全局）、
`fixtures/pages/QrDemo.ts`、`harmony-proj/`（QrDemo.ets + main_pages.json）、
`test/qrdemo.html`、`run.sh`、`electron/run.sh`

### R34 — 输入收官：`TextInput` / `TextArea` / `Search` + `Hyperlink` ✅（2026-09-21）

**测量**（新增 `pages/TextDemo.ets`）：TextInput `{placeholder, text, controller}`；onChange 双参
`(value, previewText?, options?)`（text_common.d.ts 原文）；onSubmit 双参 `(enterKey, event)`；
EnterKeyType（Go=2…NEW_LINE=8，0/1 未声明——产物没引用就不挂）。

**实现**：input.js 扩展（沿用原生基座）。text/placeholder 直落；maxLength → 原生截断属性；
caretColor → style.caretColor；onChange 按 type 分流（checkbox/radio → change+boolean，
文本 → input+change+字符串——R27 的 boolean 包装对文本不适用）；onSubmit 挂 keydown wrapper
（enterKey 未设取 Done=6，.d.ts 默认值原文）；Hyperlink → 原生 `<a>`（href/target/content）。

**验收**：`bash run.sh textdemo`（**16 条断言**）双端通过。~~诚实收尾：Enter→onSubmit 的 value
派发未打通~~ → **R38 已解决**：根因是 wrapper 里写了未定义标识符 `value`（正确是参数 `v`），
ReferenceError 被自家 try/catch 吞掉——tsc --checkJs 静态抓出。textdemo 断言升级为端到端
"Enter → log 出现 SUB6;"，inputdemo 另加 enterKeyType(Send) 的派发断言（顺手补上一直缺失的
`enterKeyType` 属性处理器——此前 wrapper 读的 data-enter-key 无人写入）。

**触及**：`runtime/src/input.js`（三组件 + Controller 基座 + EnterKeyType）、
`runtime/src/area.js`（文本 onChange 分流）、`runtime/src/main.js`（安装全局）、
`fixtures/pages/TextDemo.ts`、`harmony-proj/`（TextDemo.ets + main_pages.json）、
`test/textdemo.html`、`run.sh`、`electron/run.sh`

### R35 — 平台模块收官：`@ohos.multimedia.media`（AVPlayer 垫片）✅（2026-09-21）

**测量**（新增 `pages/MediaDemo.ets`，`import media from '@ohos.multimedia.media'`）：
createAVPlayer Promise 面；url 赋值 → 'initialized'；prepare → 'prepared'；play → 'playing'；
stateChange 双参 (state, reason)。

**实现**：ohos-shims 新增 `multimedia.media` 垫片（第 15 个平台模块）——AVPlayer →
HTMLAudioElement 状态机。三件如实降级：①订阅先行（on 必须在 url 前，否则 initialized 丢）；
②autoplay 政策（合成 click 非真实手势，垫片 muted+catch 照走状态机，Electron 主进程加
`autoplay-policy=no-user-gesture-required`）；③currentTime 挂钟来源（data URI 解码时长为 0，
首跑时钟不推进）。

**验收**：`bash run.sh mediademo`——浏览器 8 条全绿（状态机全链路+时钟推进）；
Electron 状态机绿、时钟未打通——**断言分端**（时钟断言记 docs 已知限制）。

**触及**：`runtime/ohos-shims.js`（media 垫片）、`electron/main.js`（autoplay 放行）、
`fixtures/pages/MediaDemo.ts`、`harmony-proj/`（MediaDemo.ets + main_pages.json）、
`test/mediademo.html`、`run.sh`、`electron/run.sh`

### R36 — 小件收官：`Flex` / `Span` / `LoadingProgress` / `Blank` ✅（2026-09-21）

**测量**（新增 `pages/SmallDemo.ets`）：Flex.create 参数与 CSS 同名对齐（透传）；Span.create
是 Text 内联子段（Text 栈内挂 span）；LoadingProgress.color → spinner currentColor；
Blank = flex:1 占位。

**实现**：新分片 `runtime/src/small.js`（第 16 个）。Flex → display:flex + applyCreateArgs
Flex 分支（direction/wrap/justify/align 透传）；Span → span 元素 + SPAN_ATTRS（fontColor/
fontSize/decoration——decoration 枚举值就是 CSS 关键字，挂 global 后直接透传）；
LoadingProgress → CSS spinner（color → currentColor）；Blank → flex:1 + color → 背景色。
**FlexDirection/TextDecorationType 挂 global**（此前产物没引用这两个枚举）。

**验收**：`bash run.sh smalldemo`（**14 条断言**）双端通过。**破坏验证（3 处）**：Flex.create
参数不落 CSS → **1 红**；Span 分派短路 → **1 红**；Blank flex:1 摘除 → **1 红**（占满断言
宽 0 现形）。还原后 md5 一致。

**触及**：`runtime/src/small.js`（新，第 16 个分片）、`runtime/src/area.js`（SMALL 分支）、
`runtime/src/main.js`（@include + 安装全局 + applyCreateArgs Flex 分支 + 两枚举挂 global）、
`tools/stats.mjs`（手写 38→41）、`fixtures/pages/SmallDemo.ts`、
`harmony-proj/`（SmallDemo.ets + main_pages.json）、`test/smalldemo.html`、`run.sh`、
`electron/run.sh`

### R37 — 分步器：`Stepper` / `StepperItem` ✅（2026-09-21）

**测量**（新增 `pages/StepDemo.ets`）：`Stepper.create({index})` 是 create 选项；五事件
`onNext(index, pendingIndex)` / `onPrevious(index, pendingIndex)` / `onChange(prevIndex, index)`
/ `onSkip()` / `onFinish()` 的双参语义照 `.d.ts` JSDoc；`StepperItem` 只有三个属性方法
`prevLabel` / `nextLabel` / `status(ItemState)`。**注意**：本 SDK 里 Stepper 全文
`@deprecated since 22 @useinstead Swiper`，但产物仍会真实引用，照实现。

**实现**：`runtime/src/small.js` 追加。`StepperItem` → div（`data-stepper-item`，初始隐藏）；
`Stepper` → 内置导航条（prev / pages / next 三段，`:scope > [data-stepper-item]` 在渲染后
同步阶段移进 pages 段）；label 汇入导航条文案（goTo 时读 `dataset.prevLabel/nextLabel`，
没有则回退 ‹/›）；~~导航条点击派发按 .d.ts JSDoc 推断~~ → **R39 照真机源码纠偏**（见下节）。**`ItemState` 枚举值按 `.d.ts` 声明顺序**
`{Normal:0, Disabled:1, Waiting:2, Skip:3}`——产物把 `ItemState.Skip` 原样留给运行时求值，
值错了 onSkip 永远不触发（坑 83 的枚举两套来源又现形）。`area.js` 分发链加两级：
`STEP_ATTRS`（五事件）+ `XC_ITEM_ATTRS`（label/status，含 closest 向 Stepper 回报重汇入）。

**验收**：`bash run.sh stepdemo`（~~16 条~~ → **R39 照真机纠偏后 26 条**）双端通过。**破坏
验证（3 处）**：STEP 分派短路 → **9 红**（注册 5 + 派发 4）；
XC 分派短路 → **1 红**（label 断言现形——通用 data-* 落点是 `JSON.stringify`，导航条出现
`"back0"` 带引号）；Skip 语义短路 → **1 红**（Skip 页错走 onNext）。还原后 md5 一致。

**过程教训**（坑 90/91）：本轮破坏验证一度被打断，`return; // BROKEN-1` 残留进源码，
后续几轮测试全在破坏态下跑、派发断言被误诊"headless 不稳定"而删除——恢复后按"先证注册、
再证派发"重写，16 条全绿。**中断后先清 BROKEN/DBG 残留、对 md5、重跑绿态，再继续**。

**触及**：`runtime/src/small.js`（Stepper/StepperItem/ItemState/XC_ITEM_ATTRS/STEP_ATTRS）、
`runtime/src/area.js`（STEP/XC 分派分支）、`runtime/src/main.js`（安装全局
Stepper/StepperItem/ItemState）、`tools/stats.mjs`（手写 42→44）、`fixtures/pages/StepDemo.ts`、
`harmony-proj/`（StepDemo.ets + main_pages.json）、`test/stepdemo.html`、`run.sh`、
`electron/run.sh`

### R38 — 质量切片：渐进强类型化 + 测试补全 + 两个真 bug ✅（2026-09-21）

**强类型化**：检查单元 = 拼接产物（分片是同一 IIFE 的片段，按文件检查出 153 个假
Cannot-find-name；370 → 211 全是假阳性消失）。三件套：`runtime/src/runtime.d.ts`（Element
声明合并，123 个挂载状态字段成接口词汇表）+ `tsconfig.check.json`（checkJs +
strictNullChecks；noImplicitAny 约 1508 个列后续路线）+ `tools/typecheck.mjs`（门禁第 5 步，
红线 0）。211 → 0 全部 JSDoc/括号级修复（零运行时改动）。

**两个真 bug**（详见 README R38 节）：① onSubmit wrapper 的 `value` 未定义标识符被自家
try/catch 吞掉（R34 "未打通之谜" 的根因）→ 修复 + textdemo 断言端到端化 + enterKeyType
处理器补全；② v2 `const Event` 遮蔽 Scroller 的 `new Event`（flush() 兜底让 lazy.html 一直绿，
炸点潜伏）→ 内部改名 EventDeco。

**测试补全**：stepdemo 16→25（导航边界 4 + 多实例与状态族 5）；inputdemo 27→29（onSubmit 组）；
textdemo onSubmit 断言升级端到端。**破坏验证（3 处）**：越界守卫摘除 **4 红**／Skip 语义反转
**3 红**／enterKeyType 摘除 **2 红**。新坑 92（`x = x || {}` 类型坍缩）/ 93（属性位置 JSDoc
不生效）。

**触及**：`runtime/src/runtime.d.ts`（新）、`tsconfig.check.json`（新）、`tools/typecheck.mjs`（新）、
`tools/check-all.sh`（+1 步）、`package.json`、12 个源分片（JSDoc 注解）、
`test/{stepdemo,inputdemo,textdemo}.html`、五文档

### R40 — 语义清账：真机源码对照三连（Navigation 转场 / Marquee 时长 / QRCode ECC）✅（2026-09-21）

**① Navigation push/pop**（原 R25 推断）：真机编舞 = 入页 `+50% → 0`（`width×HALF`）、被盖页
`0 → -20%` 视差（`CONTENT_OFFSET_PERCENT=0.2`，标题栏再 -2%）、弹出页 `0 → +50%`、露出页
`-20% → 0`；同一根 `InterpolatingSpring(0,1,342,37)`、时长上界 450ms。CSS 无弹簧曲线，取
`cubic-bezier(0.2,0,0,1)` 作临界阻尼近似 + 450ms。navtransdemo 新增 4 断言（450ms / 入页目标位 /
被盖页 -20% / 弹出页 +50%）。

**② Marquee 时长**（原 R28 推断 step×16ms/帧）：真机公式 `duration = |end−start| × 85 / step`
（`DEFAULT_MARQUEE_SCROLL_DELAY=85.0`，LINEAR，step 默认 6vp、大于文本宽按 6 兜底、≤0 不除），
LEFT 方向距离 = 容器宽 + 文本宽。CSS 变量喂真实起止像素；动画在布局后启动（不变量 18）；基座改
block（真机占满行宽）。夹具 mq1 加 `step: 30`（默认 6 一圈 4 秒级，两圈超虚拟预算）——走了完整
重测流程（.ets → hvigorw → 固化产物）。showdemo 新增公式断言 + step 参数断言；用户点击与 MS/MF
的交错不再定序（真实定时器抖动，属时序巧合非语义）。

**③ QRCode ECC**（原 R33 推断"L 级"）：真机 `qrcode_modifier.cpp:44` 硬编码
`QRCODE_ECC_MEDIUM`；且 node-qrcode 默认本就是 M——R33 从未真渲染过 L，"L 级"注记是误判。
现在显式传 `'M'`（碰巧对 → 显式对齐）。qrdemo 新增 ECC 采样断言（渲染矩阵 vs vendor-M 全格
一致，内容在 L/M 下版本 25/29 可区分）。教训：node-qrcode `modules.get(row, col)` 是**行优先**，
按 (x,y) 读会得到转置矩阵、暗格数相同但 43% 位置错——第一次采样 72/100 一致就是这么来的。

**验收**：navtransdemo 52 / showdemo 27 / qrdemo 12 条双端通过。**破坏验证（3 处，各 1 红）**：
转场时长回 300ms → 时长断言红；Marquee 换回旧近似公式 → 公式断言红；QRCode 显式打回 L →
采样断言红（44/100）。还原后 md5 一致。

**触及**：`runtime/src/nav.js`（转场编舞重写）、`runtime/src/show.js`（Marquee 公式 + block 基座 +
QRCode ECC 显式 M）、`harmony-proj/.../ShowDemo.ets` + `fixtures/pages/ShowDemo.ts`（step 30 重测）、
`test/{navtransdemo,showdemo,qrdemo}.html`、五文档

### R43 — 语义确证第三轮：滚动联动 + SLIDE_SWITCH 照真机修正 ✅（2026-09-21）

**① 滚动联动**（`title_bar_pattern.cpp`）：确证收缩模型 = `高度 clamp(default+scroll, 56, Full)`
（阈值 = 滚满 `Full−Mini` px，与实现一致）；**修正副标题透明度** = `(H−56)/(max−56)`（原
0.7×(1−col)）；**修正主标题** = 字号插值 L=30fp↔M=26fp 经 `Curves::SHARP`
（cubic-bezier(0.4,0,0.6,1)），DOM 等价 `scale = (26+SHARP(p)×4)/30`（原线性高度比）。

**② SLIDE_SWITCH**（原 scale(0.8) 推断）：照 `rosen_transition_effect.cpp` 确证
`SLIDE_SWITCH_SCALE=0.85`；真机自带动效 curve(0.24,0,0.5,1)/600ms 属渲染层，DOM 时长仍走外层
窗口。transitiondemo ⑪ 断言升级为确证参数。

**验收**：navtransdemo + transitiondemo 双端通过。**破坏验证（3 处，各 1 红）**：副标题公式回
0.7；SHARP 换线性（scale 0.899≠0.884）；SLIDE_SWITCH 回 0.8。还原后 md5 一致。

**触及**：`runtime/src/nav.js`（副标题/主标题公式 + SHARP 求值器）、`runtime/src/animation.js`
（SLIDE_SWITCH 参数）、`test/{navtransdemo,transitiondemo}.html`（公式化断言）、五文档

### R41 — QRCode 编码器换成真机源码：`arkui-qrcodegen` → WASM ✅（2026-09-21）

**做法**：OHOS `arkui_qrcodegen` 的 C++ 源码（7 cpp + 8 h，88.5KB）**逐字复制**进
`runtime/vendor/arkui-qrcodegen/src/`（md5 对源校验零修改）；本地附加物仅 securec 三函数
兼容 glue + emcc 构建脚本 + 同步加载器。产物 = 单文件 WASM 脚本（24KB wasm base64 内嵌，
file:// 与 http:// 同一份）——编码器与真机设备**字面上同一份代码**。

**关键语义**：`QrcodeImageEncodeString(text, ecc)` → `{version, width, data}`，`data[i] & 0x1`
为暗格（`0x80` 为函数图案标记）；ECC 恒 MEDIUM(0)（真机组件硬编码）；矩阵拷出后立即
`QrcodeImageFree`。**STANDALONE_WASM** 的原因：emscripten 6 的 JS 工厂是 async 的，QRCode
首绘在同步阶段等不起——独立产物用同步的 `new WebAssembly.Module` 自行实例化。

**替换面**：show.js 编码调用（+降级路径补警告，顺手清一处 BROKEN-1 残留注释）、qrdemo
（编码器对照断言：渲染矩阵 vs 真机编码器 MEDIUM 输出 100 格采样一致 + MEDIUM/HIGH 可区分）、
widgets vendor 引用、node-qrcode vendor 删除（NOTICES §3b 重写）。jsQR 保留（独立解码交叉
验证的独立性更纯）。渲染差异记录：真机 API12+ 满幅无 quiet zone，本实现保留 4 模块 quiet
（规范 + jsQR 依赖）。

**验收**：qrdemo 12 条 + widgets 双端通过。**破坏验证（1 处，1 红）**：ECC 换 HIGH(1) →
编码器对照断言红（采样 55/100）。还原后 md5 一致。

**触及**：`runtime/vendor/arkui-qrcodegen/`（新）、`runtime/vendor/arkui-qrcodegen.js`（新）、
`runtime/vendor/qrcode-1.5.4.*`（删）、`runtime/src/show.js`、`runtime/src/main.js`（注释）、
`test/{qrdemo,components}.html`、THIRD-PARTY-NOTICES §3b、五文档

---

### R39 — 语义纠偏：对照 OpenHarmony 真机源码 ✅（2026-09-21）

**参考仓库**：`/data/work/compiler/Ark`（完整 OHOS 树，54 个子系统）。权威出处：
`arkui_ace_engine/frameworks/core/components_ng/pattern/stepper/stepper_pattern.cpp` 的
`HandlingRightButtonClickEvent()` / `HandlingLeftButtonClickEvent()` / `InitSwiperChangeEvent()`。

**Stepper 三处分歧全部对齐**：① **顺序**——真机先 `FireChangeEvent(index, pending)` 再
`FireNextEvent`/`FirePreviousEvent`（我们原先 next/prev 在前）；② **Skip 页**——只发
onSkip，**不切页、不发 onChange**（页面去向由 app 决定；我们原先自动前进并补发 onChange）；
③ **Waiting/Disabled**——点击整体忽略（我们原先按 Normal 放行）。同时确认：末页 onFinish
也不切页；prev 的 pending 经 `clamp(index-1, 0, maxIndex)`（第 0 页点 prev 也发
change(0,0)+prev(0,0)，照抄）；编程改 index 走 swiper 桥**静默切页**（`InitSwiperChangeEvent`
的回调只更新按钮与 index，不转发事件）。

**教训（新坑 94）**：`.d.ts` JSDoc 只给**签名**（参数、默认值），不给**时序**（事件先后、
切不切页、边界态如何分流）——后者必须读真机 pattern 源码。R37 的实现"每条都符合 JSDoc"，
但整条链路的顺序是错的。`pattern/` 目录覆盖我们已实现的全部组件，后续逐个对照可再清一批
"推断"标注。

**验收**：`bash run.sh stepdemo`（26 条断言）双端通过。**破坏验证（3 处，各 1 红）**：顺序
反转 → 派发链断言红；Skip 页误切页 → onSkip 组红；Waiting 放行 → 忽略断言红。还原后
md5 一致。

**触及**：`runtime/src/small.js`（fireNext/firePrev/goTo 照真机重写）、`test/stepdemo.html`
（期望值改真机时序）、五文档、`.reasonix/handoff.md`

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

### ~~R17 — `onAreaChange` + 自定义布局协议~~ ✅ 已完成

**⚠️ 原前提是错的**。本任务原来写成"`onMeasureSize`/`onAreaChange` 回传尺寸"，实测后拆成两件
互不相关的事：

| | 实际是什么 |
|---|---|
| `onAreaChange(cb)` | **链式 `CommonMethod`** —— 这才是"回传真实尺寸"的那条 |
| `onMeasureSize` / `onPlaceChildren` | **组件结构体上的方法** = ArkUI 的**自定义布局协议**（不是尺寸回调） |

**`onAreaChange`**：JSDoc 明确 `newValue` = 变化后的宽高 + **相对父元素**坐标 + **相对页面左上角**坐标。
实现放在渲染后的 `syncAreas()`（与不变量 18 同一条纪律：不能在属性应用时算），只在面积真的变了
（或首次）时派发，`oldValue` 取上一次的真实值。

**自定义布局协议**（`common.d.ts`）：`onMeasureSize(selfLayoutInfo, Measurable[], ConstraintSizeOptions): SizeResult`
+ `onPlaceChildren(selfLayoutInfo, Layoutable[], ConstraintSizeOptions): void`，**必须成对实现**，
**返回值优先级高于组件声明的 `width/height`**，`Measurable.measure(c)` 要回**真实测量**、
`Layoutable.layout(pos)` 负责摆放。

**测出来的两条硬约束（各花掉一次编译失败）**：
1. **`@Entry` 的 `build` 只能有一个【容器】根节点**（编译器原话："can have only one root node,
   which must be a container component"）→ "多子项 builder 模式"只适用于**嵌套 `@Component`**。
2. **带链式属性的自定义组件会被编译器包一层 `__Common__`**（`__Common__.create(true); …; __Common__.pop();`）
   —— 它**不在 149 组件注册表**里，不实现就 `ReferenceError`。

**验收（已执行）**：`bash run.sh measarea` —— **28 条断言**，双端通过：
`onAreaChange` 的 `newValue.width/height` **等于真实 `getBoundingClientRect()`**（原始日志 `A|120x30|`）、
尺寸变化后再次触发且 `oldValue` 为变化前的真实值（`B|100>140|`）、
`measure()` 遵守约束且回真实测量、返回的 `SizeResult` **覆盖**声明尺寸（组件宽 60，父容器 320）、
`layout(pos)` 的三子项依次落位（几何断言）、收敛趟数有上限。

**我这轮又栽在"测试解析页面输出"上**：页面把回调参数拼成 `A|120x30|`，我却按"token 以 A 开头"去找
→ 找不到，一度以为回调没传值；**实际数字完全正确**。改成正则直接解析并把原始日志打进输出（`RAWLOG`）。

**破坏验证（4 处）**：面积不算真实值 / `measure()` 不真实测量 / 不应用返回的 `SizeResult` /
`layout()` 不摆放 → **12 条失败、跨 5 组**。

**已知限制**：`measure()` 会把约束**永久**写到子项上；`onMeasureSize` 会被调用多趟以收敛（上限 3）；
实现了 `onMeasureSize` 却没有 `onPlaceChildren` 时子项**不会被摆放**（记警告）。

**触及**：`runtime/arkui-dom-runtime.js`（`syncAreas` / `runCustomLayout` / `__Common__` /
`ViewPU.create` 钩子 / `__arkui_dom_customLayout`）、`fixtures/pages/MeasArea.ts`、
`test/measarea.html`、`run.sh`、`electron/run.sh`

---

## P4 平台模块

### ~~R18 — `@ohos.multimedia.image`~~ ✅ 已完成

**⚠️ 标题里的模块名要更正**：不是 `@ohos:media`（那是音视频播放那套，`@ohos.multimedia.media`），
而是 **`@ohos.multimedia.image`**。产物里是 `import image from "@ohos:multimedia.image"`。

**内容**：`createImageSource(uri)` + `ImageSource.getImageInfo()`（Promise / 回调）/ `getImageInfoSync()`
+ `release`；`ImageInfo { size: Size{width,height}, density, stride, pixelFormat, alphaType, mimeType, isHdr }`。

**两条实现取向**：
1. **解码交给浏览器**（`fetch` → `blob` → `createImageBitmap`），不自己解析 PNG/JPEG 头 ——
   宽高来自真实解码器。同 R15"让浏览器自己排版"。
2. **`mimeType` 嗅探真实字节的魔数，不用响应头**。依据是 `.d.ts` JSDoc 原话
   **"Actual image format (MIME type)"** —— 是**解码后的真实格式**；文件改名或服务端配置错时两者不一致。

**`getImageInfoSync()` 的取舍**：同步 API 等不了解码 → **只回已解码的缓存**，没缓存就**响亮抛错**，
绝不编一个尺寸出来。失败路径抛 BusinessError 形状的错（`code: 62980103`）且**错误信息带 URI**。

**验收（已执行）**：`bash run.sh measimage` —— **13 条断言**，双端通过：
已知尺寸 PNG 7×3 / 13×5、`mimeType`（PNG/JPEG/伪装文件）、`getImageInfoSync` 的缓存语义与负向、
404 的可操作报错。

**⚠️ 一次"断言没牙齿"的现场修复**：第一版 `mimeType` 断言是"PNG → `image/png`"，
破坏验证时把 `mimeType` **写死成 `'image/png'`，断言照样通过**（写死的值恰好等于真值）。
→ 修法是**造出能让错误实现暴露的输入**：加一张**真 JPEG**（写死 png 会失败）
与一张**伪装文件**（PNG 字节 + `.jpg` 扩展名；用响应头代替嗅探会失败）。
补完后两种错误实现**各被不同的断言精确抓到**。

**破坏验证**：编造尺寸代替真解码 / `mimeType` 用响应头 / `mimeType` 写死 /
同步版编造尺寸 / 404 静默返回 0×0 → 全部被抓。

**已知限制**：`PixelMap`/`ImagePacker`/`ImageReceiver`/`createImageSource(buf|fd)` 未实现；
`stride`/`density`/`pixelFormat`/`alphaType` 回常量 0。

**触及**：`runtime/ohos-shims.js`（`@ohos:multimedia.image`）、`tools/serve.py`（显式图片 MIME）、
`test-assets/*`（4 张已知尺寸图片，含伪装文件）、`fixtures/pages/MeasImage.ts`、
`test/measimage.html`、`run.sh`、`electron/run.sh`

### R19 — `@ohos:notificationManager` ✅

**内容**：`notificationManager.publish` → Electron 侧用 `new Notification()`，浏览器侧退化为记录 + 可选 `Notification API`；
补 `cancel`/`cancelAll`/`isNotificationEnabled` 与 `(request, AsyncCallback<void>)` 重载。

**权威来源**：`@ohos.notificationManager.d.ts`（模块名 `@ohos.notificationManager`；`@kit.NotificationKit` 只是再导出）。

**三档投递，不许压成两档**（本任务的关键点）：DOM 里没有"系统通知"这一层，所以每次 `publish` 都记下
`via`（`host-Notification` / `record-only`）、`hostPermission`、`reason`，并守一条不变量：

> **只有 `via='host-Notification'` 且 `hostPermission='granted'` 才算确证送达；其余一切情况都必须写出非空 `reason`。**

`permission='default'`（未授权）时**浏览器照样能 `new Notification()` 成功**——若当成"已送达"，
就是最典型的"看起来发了"。两端实测（同一条断言、期望值不同）：

```
浏览器（Chrome headless） via=host-Notification permission=default reason=宿主通知权限为 default（已创建通知对象，是否真的弹出由宿主决定）
Electron                  via=host-Notification permission=granted reason=-（确证送达，hostCreated +1）
```

**降级告警的边界**（两端语义刻意不同）：浏览器没有系统通知是**预期**降级 → 只写 `__arkui_dom_logs`；
Electron（preload 注入过 `global.__arkui_dom_nodeFs`）里"没送达"意味着用户看不到 → 进 `__arkui_dom_layout_warnings`。
判端用 `nodeFs` 这个既有的"能力注入"信号，不查 `userAgent`。

**验收（已执行）**：`bash run.sh measnotify` / `bash electron/run.sh measnotify` —— **32 条断言**，双端通过：
四条 Promise 链路（publish×2 + cancel + cancelAll）、空 `content` 被拒绝且错误信息点名 `content`；
payload 真解析（`id`/`title`/`text`）、被拒绝的那条不进历史、`cancelAll` 后 `active` 为空；
三档投递的 `via`/`hostPermission`/`reason` 与 `hostCreated`；回调重载（**异步**触发、返回 `undefined`、
成功 `code=0`/失败非 0）；`cancel('x')` 响亮失败；`isNotificationEnabled()` 是 `Promise<boolean>`；
把宿主 `Notification` 换成 `permission='denied'` 替身后：publish 仍 resolve、替身**构造次数为 0**、
告警条数**两端不同**（浏览器 0 / Electron 1）。

**破坏验证**（6 个注入错误实现，各被精确抓住）：① 交换 `title`/`text` → 2 条 payload 断言红；
② 去掉空 `content` 的拒绝 → 3 个分组共 9 条红（分组隔离生效）；③ 回调改同步 → "不在调用栈内同步触发"单独红；
④ 记录里去掉 `hostPermission` → 权限断言单独红；⑤ **`via` 说走了宿主但 `reason` 留空（谎报送达）→ 诚实性断言单独红**；
⑥ 去掉"浏览器/Electron"区分 → 降级告警边界断言红。

**已回落为可复现**：页面源码入仓 `harmony-proj/`（`devecocli create`，API 26）；`run.sh` 的 `CACHE`
与缺输入提示都指向仓库内工程，不再依赖 `/tmp/hmtest/app`（tmpfs，重启即失效）。

**已知限制**：`picture`/`conversation` 内容类型不渲染（不认就响亮失败，不假装发了）；
`sound`/`vibration`/`slotType`/`badge`/`group` 忽略；通知点击回调 `on('click')` 未实现；
**不做系统级断言**（不依赖桌面环境真的弹出）。

**触及**：`runtime/ohos-shims.js`（`@ohos:notificationManager`）、`fixtures/pages/MeasNotify.ts`、
`harmony-proj/`（页面源码，新增入仓）、`test/measnotify.html`、`run.sh`、`electron/run.sh`

### R20 — `startAbilityForResult` + `promptAction` ✅

**内容**：`startAbilityForResult` 的结果链路（`terminateSelfWithResult` / `terminateSelf`）；
`promptAction.showToast` / `showDialog`（DOM 实现）。

**⚠️ 前提更正（实测）**：原文写的"断言 `onResult` 被调用"基于一个**不存在的 API** ——
`grep -r onAbilityResult <SDK>/ets/api/` **0 命中**（API 26 SDK）。stage 模型的结果**只**从
`startAbilityForResult` 回来：`(want, options?): Promise<AbilityResult>` 与
`(want, callback: AsyncCallback<AbilityResult>)` / `(want, options, callback)`。
→ 验收改为：**Promise 形态与回调形态都拿到"由 want 算出"的 resultCode 与 want**。
另有两条小更正：`startAbility` 原来并**没有**实现（原文写"已实现，补 result 分支"——
context 上当初只有 `getApplicationContext`/`resourceManager`）；`.d.ts` 里
`import` 的模块名是 `@ohos.promptAction`（`@kit.ArkUI` 再导出 `promptAction`）。

**ability = 一份生命周期 + 一个窗口**：子 ability 渲染进新建的窗口容器
（`div[data-arkui-ability-window]`），结束顺序 `onWindowStageDestroy → onDestroy` → **移除窗口**
→ 把结果交回调用方。窗口移除前把它当时渲染出的文本快照进 `__arkui_dom_abilityWindows().history`，
这样"被启动方真的渲染了自己的页面"才有证据（不是只记一行日志）。

**被启动方用自己的页面**：`pages/Callee`（不是把调用方页面再渲染一遍），这样"起了第二个 ability"
在 DOM 里是可见的；ability 用 `want.parameters.role` 区分 caller/callee。

**结果必须由 want 算出来**：`resultCode = 200 + q`、`want.parameters.answer = q × 2` ——
写死结果会被断言抓住（破坏验证 B1）。

**一个关键次序**：结果接收者要在**跑子 ability 生命周期之前**登记好——子 ability 完全可能在
自己的 `onWindowStageCreate` 里**同步**就 `terminateSelfWithResult`（"拿到结果就走"）。
次序写反不会报错，而是**结果永远不回来**（破坏验证 B8）。

**promptAction 的三个非显然细节**（全部照 `.d.ts` 实现并断言）：
`showToast` **返回 void**（不是 Promise）；`duration` 默认 **1500**、范围 **[1500,10000]**、
**小于 1500 用默认值 / 大于 10000 取上限**（断言不止看自省值，还看 **1500ms 的两条真的消失、
10000ms 的仍在**）；`showDialog` resolve 的 `index` 是**被点按钮的下标（从 0 起）**。
两者自 API 18 起 **deprecated**（`@useinstead UIContext.PromptAction#…`）。

**抛还是拒——靠编译器的警告差异定音**：编译器对 `showToast`（void 版）报
"Function may throw exceptions. Special handling is required."，对 `showDialog`（Promise 版）**不报**
→ 实现取 **void 版同步抛 401、Promise 版 reject**；fixture 一条用 `try/catch`、一条用 `.catch`。
（补上 try/catch 后那批警告归零，反向印证了该解释。）

**"没有按钮的对话框"响亮失败**：没有按钮就没有结束方式，而点遮罩结束时的 `index` 语义
`.d.ts` 未规定 → 与其造一个永远点不掉的假对话框，不如 reject 401 并说明要传 `buttons`。
断言钉住"只有一个对话框节点"（没偷偷造第二个）。

**验收（已执行）**：`bash run.sh promptaction` / `bash electron/run.sh promptaction` —— **37 条断言**，双端通过：
被启动窗口建了/渲染了自己的页面/已关闭且 DOM 已移除、调用方页面仍在；
`promise-formed: code=207 answer=14`（200+7 / 7×2）与回调形态 `code=203 answer=6`（200+3 / 3×2）；
`terminateSelf()` 无结果时调用方不挂住；结束走 `onWindowStageDestroy → onDestroy`；
`showToast` 三条 toast 的 DOM 与 `duration` 夹取（`1500,1500,10000`）、缺 `message` 同步抛 401；
`showDialog` 的标题/正文/按钮顺序、点"确定"后节点消失且 `idx=1;`、无按钮时响亮失败；
1500ms 的 toast 自动消失而 10000ms 的还在。

**破坏验证**（7 个注入错误实现，各被精确抓住）：① `terminateSelfWithResult` 忽略 `resultCode` → 2 条红；
② 关窗只记账不摘 DOM → 2 条红；③ 子 ability 渲染进调用方的根（不做窗口隔离）→ 9 条红；
④ `duration` 不夹取 → 3 条红；⑤ `showDialog` 的 `index` 写死 0 → 1 条红；⑥ 允许"没有按钮的对话框" → 3 条红；
⑦ 结果接收者登记晚了（子 ability 同步结束就丢结果）→ 5 条红。

**已知限制**：只启动 `__arkui_dom_startAbility` 注册的那一个类（不按 `abilityName` 路由，无 `requestCode`）；
`StartOptions` 接受不解释；多窗口层叠/返回栈未实现；子 ability 的**异步**重渲染不支持；
`terminateSelf()` 不带结果时 resultCode 取 0（**`.d.ts` 未规定**，是本实现的约定）；
`autoCancel`/`isModal`/`maskRect`/`alignment`/`offset`/`showInSubWindow` 仅接受不解释（不实现点遮罩关闭）；
`closeToast`/`openToast`/`showActionMenu` 与 `UIContext#getPromptAction` 未实现；
`string | Resource` 的 `Resource` 不解析。

**触及**：`runtime/arkui-dom-runtime.js`（ability 栈 + `__arkui_dom_abilityWindows`）、
`runtime/ohos-shims.js`（`@ohos:promptAction` + `__arkui_dom_prompt`）、
`fixtures/entryability/PromptAbility.ts`、`fixtures/pages/PromptAct.ts`、`fixtures/pages/Callee.ts`、
`harmony-proj/`（三个 .ets 源码 + module.json5 的第二个 ability + main_pages.json）、
`test/promptaction.html`、`run.sh`、`electron/run.sh`

### R21 — 浏览器真文件系统（探测式降级 + 如实自报）✅

**内容**：后端**是什么就说是什么**：`__arkui_dom_fs.describe()` 给出后端名 + `isFileSystem` +
`osVisiblePath` + 一句人话；`probeOpfs(budget)` 真的走一遍 OPFS（每步带超时）来判断可用性，
而不是把"headless Chrome 会挂"这句注释当结论。

**真值表**（不是随手定的）：`node-fs` → 文件系统 + OS 可见路径；`opfs` → 文件系统但**无** OS 可见路径；
`localStorage` → **非真文件系统**（无路径、有配额、清站点数据即失效）。
`text()` 的一行人话被测试**打印并断言**，让"看起来持久化"无处藏身。

**实测（同一台机器，两端结论不同 —— 这正是要报出来的东西）**：
```
浏览器  FS backend=localStorage isFileSystem=false osVisiblePath=false root=(localStorage) | OPFS 探测 ok=false 卡在=getDirectory() 200ms
Electron FS backend=node-fs      isFileSystem=true  osVisiblePath=true  root=<repo>/electron/data | OPFS 探测 ok=true 28ms
```
（顺带纠正一句文档里的旧话："OPFS 在浏览器里会挂"应说成"**在 headless Chrome 里**卡在
`getDirectory()`"；Electron 的 Chromium 里 6 步全过。）

**两条不变量**：
1. **"我们没启用"≠"不可用"**：默认不启用 OPFS 是为了两次运行选到同一后端（确定性），
   所以探测 `ok=true` 时自报必须说【可用】并说明为何未启用，绝不许说成"不可用"。
2. **探测必须【有界】**：失败路径上 `getDirectory()` 永不 resolve —— 连**清理**都不能 await 没有超时的调用
   （早先 await 了，把 200ms 的探测撑成 2172ms，实测踩到）。

**验收（已执行）**：`bash run.sh realfs` / `bash electron/run.sh realfs` —— **21 条断言**，双端通过：
产品通过 `@ohos:file.fs` 真写/真读（点 write/read 按钮）；后端名与两个标志位与真值表一致；
"人话"与标志位一致（`非真文件系统` 里含 `真文件系统` 子串，断言必须用否定词先判）；
非 OS 可见后端**明确声明**不是 OS 路径；OS 可见后端给的真路径**在真磁盘上存在**（用 preload 暴露的
`existsSync` 外部核验，不靠页面自报）；探测的逐步耗时/预算/有界性；启动探测有留痕（用 `startupProbe` 的
Promise 等它，不靠 sleep 猜）；**"能持久化 ≠ 是文件系统"两件事同时成立也被断言**。

**破坏验证**（4 项，各被抓住）：① 把 localStorage 谎报成"真文件系统" → **5 条红**（连外部核验都跟着失败）；
② 失败路径的 cleanup 改回不限时 → **整个用例挂住、120s 超时、退出码非 0**（有界性失效的直接症状）；
③ 不看探测结论就宣称 OPFS【可用】 → 1 条红；④ `realPath` 原样吐回 vfs 路径 → 1 条红
（**并因此发现最初那条 `!p.startsWith('/')` 断言没有牙齿**：换成别的串就蒙过去了 → 改成要求"明确声明"）。

**已知限制**：默认浏览器后端仍是 localStorage（确定性优先）；OPFS 需显式启用
（`__arkui_dom_force_backend='opfs'` / `__arkui_dom_enable_opfs`），且**探测通过≠水合通过**
（水合失败会 `switchToLocalStorage` 并记录原因）；探测只覆盖"能不能读写"，不测配额/并发；
`localStorage` 的配额与"清站点数据即失效"未做量化。

**触及**：`runtime/ohos-shims.js`（`probeOpfs` / `describeFs` / `__arkui_dom_fs.describe|text|probeOpfs|startupProbe`）、
`test/realfs.html`、`run.sh`、`electron/run.sh`（复用 `fixtures/pages/NetFile.ts` 做真实读写）

---

## P5 动画 / 手势

### R22 — `animateTo` / `animateToImmediately` ✅（`transition` 仍待办）

**内容**：`animateTo({duration,curve}, fn)` 包住的状态变更 → CSS transition。

**⚠️ 调用约定（实测产物）**：源码里是**全局** `animateTo(value, event)`，编译后是
**`Context.animateTo(...)`** —— `Context` 是自由变量，必须提供全局 `Context`（只挂裸名会 `ReferenceError`）。
`Curve`（13 成员）/`PlayMode`（4 成员）同样是自由变量。`.d.ts` 的默认值：
`duration` **1000**、`curve` **Curve.EaseInOut**；两个函数自 API 18 起 deprecated。

**语义**：`fn()` 改状态 → 同步 flush → 把**这次真的被重渲染的节点**（`rerenderElmt` 里收集，
不是"整棵子树"）挂上 `transition: all <duration>ms <curve> <delay>ms` + `data-arkui-anim`；
到点（`duration+delay+30ms`）清掉并调 `onFinish`。**`duration:0` 不挂 transition**（但状态变更照常落地）。

**验收（已执行）**：`bash run.sh animdemo` / `bash electron/run.sh animdemo` —— **36 条断言**，双端通过：
按钮触发 `animateTo` 后 **目标值真的变**且节点**带上 transition**（prop/duration/curve/delay 逐项）；
`duration:0` 时**调用返回的那一刻没有任何节点被标记**、`els` 记 0、`endedBy='duration-0'`；
窗口结束后 transition **被清掉**（否则会污染后续变更）且 `onFinish` 被调；`animateToImmediately` 同效；
未写 `duration` 时取默认 **1000**；`iterations`/`playMode` **出声**且动画仍正常收口；
`fn()` 无可动目标时**出声**（`.d.ts` 警告别在 `aboutToAppear` 里用）；缺 `event` 闭包抛 **401**。

**两端差异（如实记录，不作断言）**：`sawTransitionEnd` 在 headless Chrome 全为 `false`、
Electron 里框宽那几次为 `true` —— 即"我们把 transition 挂上又按期清了"与"浏览器真的跑了过渡"
是两件事，诊断行里分开报。

**破坏验证**（5 项）：① `duration:0` 也走动画分支 → 2 条红；② 不安排收口（transition 一直挂着）→ **12 条红**；
③ 动画挂到"整棵子树"而非被重渲染的节点 → 5 条红；④ `iterations` 降级静默 → 1 条红；
⑤ `duration` 默认值写成 0 → 3 条红。
（①还暴露了一处**假通过**的断言：原本查 `box` 的 transition，而那次只有读 `op` 的 Text 被重渲染 →
改成"没有任何节点被标记"，并且必须**在同一 tick 内**读，否则会被 30ms 的清理计时器变成竞态。）

**未实现（明确留在待办，不算进本条验收）**：**`transition`（组件出现/消失动画）** —— 它按不变量 3
落 `data-*`，**不假装动画**；`animateToImmediately` 在本运行时与 `animateTo` 等价；
`iterations`/`playMode`/`tempo`/`expectedFrameRateRange`/`ICurve` 曲线只出声不实现；
连带位移（父容器变尺寸带走子节点）不单独过渡。

> **后续**：同一天以 **R22 收口**（见下一节）把 `transition` 补上了 —— 本条"不假装动画"的取舍当时是对的
> （宁可落 `data-*` 也不做假的），但不该是终态。

**触及**：`runtime/arkui-dom-runtime.js`（`Context`/`Curve`/`PlayMode` + `rerenderElmt` 的收集点 +
`__arkui_dom_animations`）、`fixtures/pages/AnimDemo.ts`、`harmony-proj/`（`AnimDemo.ets` + main_pages.json）、
`test/animdemo.html`、`run.sh`、`electron/run.sh`

### R22 收口 — `transition`：组件出现/消失动画 ✅（2026-09-21）

**内容**：把 R22 明确留下的 `transition` 补上 —— `.transition(TransitionOptions | TransitionEffect[, onFinish])`，
在组件**被插入/删除**时播放出现/消失过渡。

**先测量**（新增 `pages/TransitionDemo.ets` → 官方构建 → 读产物）：
- 产物形态是 `Text.transition({ opacity: 0, translate: { x: 0, y: 40 } })`：**属性调用**（走 builder 栈），
  但 `TransitionEffect`/`TransitionType`/`TransitionEdge` 是**自由变量**，必须由运行时提供全局。
- 两参重载 `Text.transition(effect, (transitionIn) => {…})` 真的传两个实参；而生成的属性方法是
  `function (v) {…}` —— **只取第一个参数会把 onFinish 静默丢掉**（已改成 `(...args)` 透传）。
- **顺序陷阱**：产物是 `Text.create('A') → Text.id('a') → Text.transition(…)`，即**规格在挂载之后才到**。
  把"出现动画"的钩子挂进 `mountNode` 永远赶不上（第一版这么写，断言当场抓到）。现在 `mountNode` 只打
  `__arkuiFreshMount` 标记，由 `registerTransition` 见到标记才跑出现动画（重渲染不带标记 → 不会重复播）。

**语义（只用 CSS transition 能表达的部分）**：
- 触发时机 = **插入/删除**。插入点 `mountNode`；删除点是分支切换 / `ForEach` 重建 —— 把原来的
  `rec.node.textContent = ''` 换成 `detachChildren()`：带"消失过渡"的子节点**留在 DOM 里把动画走完再摘**，
  其余立刻摘。**不延迟摘除就不可能有消失动画**。
- 方向：Insert = 从"偏离态"过渡到常态；Delete = 常态 → 偏离态。
- **时长有两档**（最要紧的差别）：`TransitionEffect` 自带 `.animation()` → 用它；`TransitionOptions`
  没有时间字段 → 用**外层 animateTo 窗口**的参数（注意窗口的曲线在 `win.rec.curveCss` 上，读错字段只会静默丢曲线）；
  两者都没有 → AnimateParam 默认（1000ms / Linear），并把 `source` 记成 `default`（自省里看得出这是兜底、不是设备值）。
- 方向门控：`TransitionType.Insert/Delete` 不匹配的方向**立刻摘/不动**，且不产生过渡记录。
- `asymmetric` 两个方向各用各的链与参数；`onFinish` 收到 `transitionIn`（插入 true / 删除 false）。

**验收（已执行）**：`bash run.sh transitiondemo` / `bash electron/run.sh transitiondemo` —— **58 条断言**，双端通过。
11 组断言：登记形状（TransitionOptions / TransitionEffect / asymmetric / 方向）、初次渲染的方向门控、
A 的消失（窗口内仍在 DOM + 300ms + 落到偏离态 + 到点才摘）、A 的出现（从偏离态回来 + 收口清干净）、
D（Insert-only）删除立刻消失且零记录、E（Delete-only）出现零记录、B 的 200ms/effect（不被外层 300 盖掉）、
C 的 asymmetric 150/250 + `onFinish(true/false)`、无关变更零记录、共享常量不被污染、`SLIDE_SWITCH` 降级出声。
自省：`__arkui_dom_transitions()` 给 `registered`/`runs`（含 `source`、`offText`、`endedBy`、`sawTransitionEnd`）。
两端差异与 R22 一致：`sawTransitionEnd` 在无头浏览器里多为 false、Electron 为 true（只当见证，不当收口依据）。

**破坏验证**（4 项，各被精确抓住）：① `detachChildren` 改成立刻 `remove()` → **13 条红**；
② 忽略 `type` 方向门控 → **6 条红**；③ `onFinish` 恒传 true → **1 条红**；
④ 忽略 `TransitionEffect` 自带的 `animation()`（退回窗口/默认）→ **5 条红**。

**已知限制**：`SLIDE`/`SLIDE_SWITCH` 的具体参数 `.d.ts` 未给出 → 按"从左滑入"与 `scale(0.8)+opacity 0`
近似并**出声**（推断）；`IDENTITY` 不动（记 skipped）；`rotate`/`scale` 的 `centerX`/`centerY` 与
`translate.z` 未实现（出声）；消失过渡期间节点**仍占布局位**（真机亦然，但同容器其它项的重排能看出来）；
`Tabs`/`Swiper`/`LazyForEach` 窗口变化、`Navigation` 转场等**其它删除路径**仍是立刻摘除。

**触及**：`runtime/arkui-dom-runtime.js`（`TransitionType`/`TransitionEffect`/`TransitionEdge` + 出现/消失 +
`detachChildren` + `__arkui_dom_transitions`）、`fixtures/pages/TransitionDemo.ts`、
`harmony-proj/`（`TransitionDemo.ets` + main_pages.json）、`test/transitiondemo.html`、`run.sh`、`electron/run.sh`

### R23 — 手势（Pan / Tap / LongPress / Swipe / Pinch）✅

**内容**：`TapGesture` / `LongPressGesture` / `PanGesture` / `PinchGesture` / `SwipeGesture` 映射到 pointer 事件。

**⚠️ 调用约定（实测产物）**：**两层栈**，全部是自由变量（不走 import）：

```js
globalThis.Gesture.create(GesturePriority.Low);   // ① 打开手势作用域（名字来自 ets-loader，见 R23 收口）
PanGesture.create({ fingers: 1, direction: PanDirection.All, distance: 5 });
PanGesture.onActionStart(cb); PanGesture.onActionUpdate(cb); PanGesture.onActionEnd(cb);
PanGesture.pop();                                 // ② 收一个手势
globalThis.Gesture.pop();                         // ③ 关作用域 → 挂到"当前节点"上
```

「当前节点」= **组件栈顶**：手势作用域嵌在组件的构建器里（`Row…Gesture.create…Gesture.pop…Row.pop`），
关作用域时栈顶正是那个组件 —— 所以产物里**没有** `.gesture()` 这样的属性方法，也不需要实现它。

**识别器全部基于真实 DOM pointer 事件**（`pointerdown/move/up/cancel` + `setPointerCapture`），
所以合成事件（`dispatchEvent`）与真实指针走同一条路。实现要点：
`TapGesture` 用 `count` 归组、`repeat` 标后续；`LongPressGesture` 按住 `duration`（默认 500）触发，
**中途移动超过容差就取消**；`PanGesture` 位移超过 `distance`（默认 5）才 `onActionStart`，
之后每次移动 `onActionUpdate`、抬手 `onActionEnd`；`SwipeGesture` 按 `speed`（默认 100 **vp/s**）与方向判定，
`angle` 以水平向右为基准（顺时针 0~180、逆时针 0~-180，照 `.d.ts`）；`PinchGesture` 用两指距离比算 `scale`。
挂在元素上的手势**按渲染批次替换**（同一次渲染里多个作用域合并），否则重渲染会把回调叠成两份。

**验收（已执行）**：`bash run.sh gesturedemo` / `bash electron/run.sh gesturedemo` —— **24 条断言**，双端通过：
5 个元素各自挂对了手势（读自省不读日志）；**合成一次 pan 序列后 `offsetX/offsetY` 与合成位移一致**
（横向 `end=40,0`、竖向 `end=0,40` —— 写死其中一个轴会被另一条抓住）；位移 3px < distance 5 → 不触发；
`TapGesture(count:2)` 两下触发一次且 `repeat=false`、再两下 `repeat=true`；
`LongPressGesture(duration:300)` 按 380ms 触发、**按住期间移动 30px 不触发**；
`SwipeGesture(speed:100)` 快速滑动触发且 `angle≈0`、**慢速（≈66 vp/s）不触发**；
`PinchGesture` 两指从 40px 张到 120px → `scale=3.00`。

**破坏验证**（5 项，各被精确抓住）：① pan 的 `offsetX/offsetY` 写死成标量距离 → 1 条红；
② 忽略 `distance` 阈值 → 1 条红；③ 长按不因移动取消 → 1 条红；④ 忽略 swipe 的 `speed` 阈值 → 1 条红；
⑤ `PinchGesture` 的基准距离改回"第一次 move 时取"（实现时踩过的真 bug）→ 3 条红。
**其中②第一次注入的是"删掉默认值分支"，而 fixture 显式传了 `distance: 5` → 变异没落在被测路径上，
断言照样通过（假阴性）；改成真的忽略阈值才红** —— 这条记进了坑表（破坏验证的变异必须落在被测路径上）。

**已知限制**（其中前两条已由同日的 **R23 收口**补上）：`RotationGesture`/`GestureGroup` 未实现
（`RotationGesture` 已在 `GESTURE_TYPES` 里登记类型但没有识别器，不会认出手势）；
`priorityGesture`/`parallelGesture` 未实现；手势**优先级与冲突仲裁**
（`GesturePriority`/`GestureMode`/`GestureMask`）只记录不参与决策 —— 同一元素上多个手势会**并列触发**；
`onActionCancel` 只在收到 `pointercancel` 时派发；`fingerList` 恒为空数组（不合成手指轨迹）。

**触及**：`runtime/arkui-dom-runtime.js`（`Gesture`/5 个手势构建器 + 指针识别器 + `__arkui_dom_gestures`）、
`fixtures/pages/GestureDemo.ts`、`harmony-proj/`（`GestureDemo.ets` + main_pages.json）、
`test/gesturedemo.html`、`run.sh`、`electron/run.sh`

---

### R23 收口 — 手势分组 / 旋转 / 优先级仲裁 ✅（2026-09-21）

**内容**：R23 明确留下的四项 —— `RotationGesture` 识别器、`GestureGroup`（Sequence/Parallel/Exclusive）、
`priorityGesture`/`parallelGesture`、以及**元素级优先级仲裁**。

**先测量的三条关键约定**（新增 `pages/GestureGroupDemo.ets` → 官方构建 → 读产物）：

1. 三个属性发射**同一套协议**，只差第一个实参：`.gesture`→`GesturePriority.Low`、
   `.priorityGesture`→`High`、`.parallelGesture`→`Parallel`；
   `Gesture.create` 是**两参**的（第二参 `GestureMask`，旧实现只取第一个 → mask 被静默丢掉）。
2. **这些名字来自 ets-loader，不是 `.d.ts`**：`pre_define.js` 里 `GESTURE_ENUM_KEY="GesturePriority"` +
   `GESTURE_ENUM_VALUE_LOW/HIGH/PARALLEL="Low"/"High"/"Parallel"`。`.d.ts` 声明的
   `GesturePriority { NORMAL = 0, PRIORITY = 1 }` 是**另一套**（API 12 `addGesture` 用）。
   **旧实现只定义了 `{NORMAL, PRIORITY}` → 产物的 `GesturePriority.Low` 是 `undefined`，
   三个属性运行时完全区分不开**（全退化成默认档）—— 这是本条修掉的 bug。
3. `GestureGroup` 是**容器式** create/pop：`GestureGroup.create(mode)` → `onCancel` →
   组内各手势 `create/on*/pop`（进的是**组**）→ `GestureGroup.pop()`（组进**作用域**）。

**仲裁 = 三条独立规则，每条都引 `.d.ts` 原文**（引文见运行时注释）：
① **元素级（父子链）**：`gesture`="子组件优先"、`priorityGesture`="父组件优先"、
`parallelGesture`="准冒泡、父子都响应"、`GestureMask.IgnoreInternal`="禁用子组件手势";
在 `pointerdown` 时**一次性定下**（事件由内向外冒泡 → 内层先认领、外层可覆盖），识别循环只查结论。
② **组级**：Exclusive 先认出者独占；Sequence 按序推进且"只有最后一个能收 `onActionEnd`"；
Parallel 互不影响。③ **元素内多作用域**：取最高档（`block > high > parallel > low`），不做逐手势区分。

**验收（已执行）**：`bash run.sh gesturegroupdemo`（39 条断言）与 `bash electron/run.sh gesturegroupdemo` 双端通过：
Loader 名与声明名同值（`Low===NORMAL`/`High===PRIORITY`/`Parallel` 独立）；
4 个组各自登记对了 mode 与成员；两指转 90° → `angle=+90`、反向 → `−90`、未达阈值不触发、
**单指不触发**（`fingers:2`）；Exclusive 点/拖各只认一个 + 认出后 cancel；
Sequence「长按→拖」走完 vs 半途抬指 → `onCancel`、以及**阈值 1px 的 pan 在没轮到它时被门控挡住**；
**非末位手势的 `onActionEnd` 被挡**（`U1;U2;U2e;`）；Parallel 长按与点击都被认；
默认对"子优先"、`priorityGesture` 只有父、`parallelGesture` 父子都出、`IgnoreInternal` 子被禁用；
以及**仲裁结论可内省**（`arb='owner'/'suppressed'`）、会话结束归位。

**破坏验证**（3 项，各被精确抓住）：① 关掉元素级仲裁门控 → 恰好 3 条红（默认对/priority/mask）；
② 旋转角度取绝对值 → 恰好 1 条红（反向旋转）；③ 拿掉 Sequence 门控 → 3 条红，
日志里 `U2;` 抢在 `U1;` 前（乱序可见）。还原后 `md5sum` 与备份逐字节一致。

**修掉的两个真 bug**（都属"静默失效"）：
① `pointerup` 会**继续往外冒泡**，而会话状态被最内层元素先删掉 → 外层查不到仲裁结论、
被压制的祖先**误触发**（默认档父子对当场红）→ 改成只由**冒泡路径上最后参战的那个元素**删会话；
② 识别器在"回调被组门控挡下"时**照样把 `started` 置真** → 被挡的手势此后永远发不出 `onActionStart`
→ 改成 `fireGesture` 返回"有没有被放行"，识别器只在放行时推进内部状态。

**已知限制**：**这些组/仲裁语义是按 `.d.ts` 文档注释实现的，不是真机实测**（本机没有 ArkVM）；
`RotationGesture` 起始线取**第二指按下时**的连线（`.d.ts` 写"detected 时"，差异上界即 `angle` 阈值）；
`IgnoreInternal` 按文档正文实现为"压制所有后代（含并行）"；多指分别落在不同元素时按"每个指针各自认领"
处理（近似）；`fingerList` 仍恒为空。

**触及**：`runtime/arkui-dom-runtime.js`（`GesturePriority`/`GestureMask`/`GestureMode` + 仲裁层 +
`GestureGroup` 构建器 + `RotationGesture` 识别器 + `__arkui_dom_gestures` 内省）、
`fixtures/pages/GestureGroupDemo.ts`、`harmony-proj/`（`GestureGroupDemo.ets` + main_pages.json）、
`test/gesturegroupdemo.html`、`run.sh`、`electron/run.sh`

---

## P6 与设备路径对齐（研究性）

### R24 — ArkVM / `.abc` 路径调研 ✅（2026-09-21）

**内容**：本项目执行的是 **JS**，设备执行的是 **`.abc` 字节码**。调研两者差异是否会失真我们的结论。

**结论（一句话）**：有差异；其中**只有一处是协议级且对现有实现无害**，另有一处**把结论的适用范围钉死** ——
**凡断言 `@ohos:*` 模块行为的用例，其结论都只关于 `runtime/ohos-shims.js`，与真机原生模块无关**。
完整报告见 `docs/ARKVM-RESEARCH.md`（含"可复现命令速查"）。

**差异清单（按对我们是否有影响排）**：

| 差异 | 性质 | 影响 |
|---|---|---|
| 装饰器调用协议：JS 走 tsc `__decorate`（字段装饰器 **3 实参**），`.abc` 走 es2abc 原生装饰器（字段 **2 实参**），`__decorate` 在字节码里**一次都不出现** | 协议级 | **无害**：运行时 `v2Field = (kind) => function (target, key) {…}` 只读前两参；但"按 `__decorate` 形状写装饰器"只在 JS 路径成立 |
| 模块接线：`.abc` 走 **ESM 模块记录** + `npmEntries.txt` 把 `@ohos.*` 重定向到 `@native.*`；JS 路径走 **CommonJS 仿真**（`__arkui_dom_defineCommonJS` + `require("@ohos:xxx")`） | 结构级 | **结论范围钉子**：`@ohos:*` 用例的结论是关于**垫片**的 |
| 正则字面量被降到运行期 `RegExp` 构造（对象身份 / `lastIndex` 不跨调用共享） | 语义级 | 现有用例无此断言（未测，留待需要时） |
| 自由变量 / 原型访问器（`definegettersetterbyvalue`）/ 字面量 / `try-catch` / `async` / `new Function` / `globalThis` / `static {}` | — | 逐项实测**与 JS 同构**，未见分叉 |
| ArkTS 检查器拒绝 `eval`/`Symbol`/生成器/`#private`/`Object.defineProperty`；本机**没有 ArkVM**（`.abc` 不能执行） | 硬边界 | 本项目的结论是**字节码级同构判断**，不是**执行级等价证明** |

**验收（已执行）**：报告存在且每条结论内联"命令 + 原始输出"。其中四条关键命令由**主 agent 独立重跑**核对：

```bash
# ① JS 路径有 __decorate
node tools/extract.mjs fixtures/pages/V2.ts /tmp/v2.js && grep -c __decorate /tmp/v2.js    # → 24
# ② 同一份 .ts 交给官方 es2abc 直编成 .abc，再反汇编
B=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
$B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build/bin/es2abc --module --extension ts \
  --output /tmp/V2.abc --source-file V2.ts fixtures/pages/V2.ts
$B/sdk/default/openharmony/toolchains/ark_disasm --verbose /tmp/V2.abc /tmp/V2.pa
grep -c __decorate /tmp/V2.pa     # → 0
grep -A3 '"Trace"' /tmp/V2.pa     # → tryldglobalbyname "Trace" … callargs2（字段装饰器 2 实参）
# ③ "无害"的判据：我们的实现只读前两参
grep -n "v2Field" runtime/arkui-dom-runtime.js    # → const v2Field = (kind) => function (target, key) {…}
# ④ 正则降级（另起单文件验）：/ab+c/g → 字节码出现 tryldglobalbyname "RegExp" + ldobjbyname "lastIndex"
```

**这次调研顺带修掉的一处文档失效**：`DEVELOPING.md` §8 的 `devecocli build` 在本机**跑不通** —— `devecocli`
是装在**已消失的** fnm v24.21.0 npm 全局里的第三方 CLI（CLT 的 `bin/` 只有 6 个 wrapper）→ 已改成官方
`hvigorw`（附 `DEVECO_CLI_CLT_PATH` / `DEVECO_NODE_HOME` 两行前提），`run.sh` 的缺输入提示同步（见坑 80）。

**未做成（报告 §10 逐条列了）**：`merge_abc` 复现 `.protoBin` 失败；ArkUI 的 `stateMgmt.js` 不在 CLT 里
（真机 `@Observed` 的 Proxy 实现取不到证据）；无 ArkVM → 无执行级验证。

**触及**：`docs/ARKVM-RESEARCH.md`（新增）、本节、`docs/DEVELOPING.md`（§8 构建命令 + 坑 80）、
`run.sh`（缺输入提示）、`docs/CAPABILITY.md`（已知限制里点名"结论只对 JS 路径成立"的类别）

---

### R25 收口 — `Navigation` 转场动画 + `onTitleModeChange` 滚动联动 ✅（2026-09-21）

R12 收口的已知限制里点名的两块**可见差异**，本轮收掉。

**先测量**（新增 `pages/NavTransDemo.ets` → 官方构建 → 读产物）：① `onTitleModeChange(cb)` 是
**函数值属性**，而属性分发里通用 `on*` 规则在组件属性表**之前**——不拦下就变成
`addEventListener('titlemodechange')`，永远没人派发（坑 86）；② `pushPathByName` 两套重载
`(name, param, animated?)` / `(name, param, onPop, animated?)`，`animated` 默认 **true**（`.d.ts`
JSDoc 原文），四参 `(name, param, undefined, false)` 的解析要看 a4；③ `disableAnimation(true)`
进产物、全局关动画。

**实现**：目的地 300ms ease-out 从右滑入/滑出（~~推断~~ **R40 照真机确证并修正**：450ms 弹簧
上界 + 入页 +50% + 被盖页视差 -20%，出处 `navigation_group_node.cpp`；详见 R40 节）；
push 时上一栈顶垫底可见、滑完才藏；pop 时状态层回调照旧立刻发、DOM 摘除推迟到滑出结束、弹到空栈
目标区滑出期间撑住；范围弹栈仍立即销毁。联动只在 `titleMode=Free`（且无 `NavigationCustomTitle.
height`、未 `hideTitleBar`）生效：高度随滚动在 Full↔Mini 间线性插值、主标题缩小（scale=高度比）、
副标题淡出（尺寸不变，仅 string/common 形态）；**模式通知只在端点**（收到底→Mini、回顶→Full），
中途不抖动。

**验收**：`bash run.sh navtransdemo`（**52 条断言**；R40 +4 真机数字）—— Free 联动的三个插值点与端点通知、
Full 对照组不触发、common 的淡出/缩小数值、builder 只收高度、push/pop 转场的运行记录与样式标记、
animated=false 与 disableAnimation 的"不滑"对照。双端通过。

**破坏验证（3 处）**：联动入口 return → **13 红**；动画全关 → **6 红**；端点 `p>=1`→`p>1` → **5 红**
（全是通知、插值一条不红——几何与通知两条链互相独立）。还原后 md5 一致。

**已知限制**：~~时长/曲线/阈值/缩放比是推断~~（R40 确证转场 450ms 弹簧 + ±50%/20% 视差；
R43 确证联动——阈值 = 滚满 `Full−Mini` px、副标题透明度 = `(H−56)/(max−56)`、主标题字号插值
L=30fp↔M=26fp 经 SHARP，出处 `title_bar_pattern.cpp`）；`customNavContentTransition`、
`enableModeChangeAnimation`（单↔分栏切换动画，API 15）、`onNavBarStateChange` 未实现（记警告）；
`edgeEffect` 弹性不模拟（不足一屏滚不动，联动无从发生——`.d.ts` 主场景就是超一屏）。

**触及**：`runtime/src/main.js`（nav 节：`navSlidePush`/`navPopAnimated`/`navWantAnim`/
`navOnContentScroll`/`navCollapseAllowed` + `NAV_ATTRS.onTitleModeChange` + `pop`/`popToName`/
`popToIndex` 重载 + `__arkui_dom_navTrans`）、`fixtures/pages/NavTransDemo.ts`、
`harmony-proj/`（`NavTransDemo.ets` + main_pages.json）、`test/navtransdemo.html`、
`run.sh`、`electron/run.sh`

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
