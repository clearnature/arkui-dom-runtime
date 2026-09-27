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

**验收**：`bash run.sh showdemo`（**28 条断言**；R40 +时长公式，R44 +step=0 回归）双端通过。**破坏验证（3 处）**：分派短路 →
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

**验收**：`bash run.sh qrdemo`（**15 条断言**；R40 +采样，R41 编码器对照，R44 +过小拒绝×3）双端通过。**破坏验证（3 处）**：vendor 缺席不警告
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

### R45 — Image：真实 `<img>` 基座 ✅（2026-09-24）

剩余骨架里最常用的组件。**测量**（新增 `pages/ImageDemo.ets`，声明式 ArkTS——页面源不是产物
里的 ViewPU 类，两个流程坑：ArkTS 禁内联对象字面量类型、回调参数需非空收窄）：`Image.create(src)`
单参、`objectFit(ImageFit)` 自由变量枚举（Contain=0/Cover=1/Auto=2/Fill=3/ScaleDown=4/None=5/
对齐族 7..15/MATRIX=16，照 `.d.ts` 声明顺序）、`alt`/`onError`/`onComplete`/`onLoad`/`syncLoad`。

**实现**（新分片 `image.js`，第 17 个）：根 = div 包装 + 主 `<img>` + alt 占位 `<img>`（主图未
加载/失败时顶上）；`objectFit` → CSS `object-fit`（五枚举与 CSS 关键字同名对齐；Auto/对齐族/
MATRIX 记 data-* 或警告）；`onComplete` 载荷带真实解码尺寸；回调经 `__imgCbs` + **同步认领**
（load 与补派发双触发只跑一次，首跑抓到双发抛错）。图片 URL 用绝对路径 `/test-assets/`
（MeasImage 同约定；相对路径在 /test/ 页面下 404）。

**验收**：`bash run.sh imagedemo`（15 条断言）双端通过。**破坏验证（3 处）**：objectFit CSS
映射短路 **2 红**；alt error 顶上摘除 **0 红**（TryAlt 路径已覆盖，无观察面，如实记录）；
fire 同步认领撤销 **3 红**。还原后 md5 一致。

**触及**：`runtime/src/image.js`（新，第 17 个分片）、`runtime/src/area.js`（IMAGE 分派分支）、
`runtime/src/main.js`（@include + Image/ImageFit global + syncDrawings 钩子）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 44→45）、`fixtures/pages/ImageDemo.ts`、
`test/imagedemo.html`、`run.sh`、`electron/run.sh`

### R46 — Scroll：真实 overflow 基座 ✅（2026-09-24）

**测量**（新增 `pages/ScrollDemo.ets`）：`Scroll(scroller)` create 单参**直接是 Scroller 实例**
（不是 {scroller} 选项对象——首跑解包错方向，`_bind` 没跑、scrollBy 全哑，探针抓到
"未绑定容器"）；枚举自由变量 `ScrollDirection`（Vertical=0/Horizontal=1/Free=2/None=3）、
`BarState`（Off=0/Auto=1/On=2）、`EdgeEffect`（Spring=0/Fade=1/None=2）、`Edge`（Top=0..End=6）。

**实现**（新分片 `scroll.js`，第 18 个）：overflow 基座由 scrollable 决定；scrollBar(Off) →
`scrollbar-width:none` + ::-webkit 注入规则；edgeEffect → overscroll-behavior。**Scroller 扩面**
（layout.js）：`scrollTo({xOffset,yOffset,animation})` 官方形参（animation → DOM smooth 近似）+
新增 `scrollBy`/`scrollEdge(Edge)`/`scrollPage`/`isAtEnd`；`currentOffset()` 返回
`{xOffset,yOffset}`（保留 x/y 兼容）。主动滚动同步派发 scroll 事件。事件：onScrollEdge
**到达沿**触发（离开再到才再发）；onScrollStart/End = 滚动静默 80ms 收口（DOM 化近似，标注）。
测试侧：手动滚动后手动派发 scroll 事件（坑 ⑧ 同族，rAF 对齐事件在 headless 不可靠）。

**验收**：`bash run.sh scrolldemo`（16 条断言）双端通过。**破坏验证（3 处，各 1 红）**：
overflow 映射短路／滚动条隐藏选择器破坏／onScroll 派发删除。还原后 md5 一致。

**触及**：`runtime/src/scroll.js`（新，第 18 个分片）、`runtime/src/layout.js`（Scroller 扩面）、
`runtime/src/area.js`、`runtime/src/main.js`（@include + Scroll/枚举挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 45→46）、`fixtures/pages/ScrollDemo.ts`、
`test/scrolldemo.html`、`run.sh`、`electron/run.sh`

### R47 — ImageAnimator：逐帧定时器 + 状态机 ✅（2026-09-24）

**测量**（新增 `pages/AnimatorDemo.ets`）：`images([{src},…])` 单帧 duration 优先于全局；
`duration` = 每帧 ms（默认 1000）；`iterations` 默认 1/-1 无限；`AnimationStatus`
（Initial=0/Running=1/Paused=2/Stopped=3）；**本 SDK d.ts 无 onFrame 属性**，事件仅
onStart/onPause/onRepeat/onCancel/onFinish。

**实现**（新分片 `animator.js`，第 19 个）：逐帧 setTimeout 引擎 + 迭代计数；Running 推进/
Paused 停表保持/Stopped 回第一帧/播完落 Stopped + onFinish（保持末帧）。两个必踩点：
①产物顺序 `state` 先于 `onStart` 应用 → 回调**延时派发**（同步发会丢，实测）；
②`images` 字面量每次重渲染重建 → **深 diff** 防重置帧序。

**验收**：`bash run.sh animatordemo`（13 条断言）双端通过。**破坏验证（3 处）**：state 同值
守卫摘除 **0 红**（无观察面，如实记录）；引擎不推进 **6 红**；Paused 不清定时器 **2 红**
（帧 1 被越过）。还原后 md5 一致。

**触及**：`runtime/src/animator.js`（新，第 19 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + ImageAnimator/AnimationStatus 挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 46→47）、`fixtures/pages/AnimatorDemo.ts`、
`test/animatordemo.html`、`run.sh`、`electron/run.sh`

### R49 — ListItemGroup：List 分组容器 ✅（2026-09-24）

按 R48-A 摘要实现。**create 选项**：header/footer 是 CustomBuilder（ArkTS 需 @Builder
方法）；space 只作用 item 间（d.ts："not spacing between the header and list items"）；
`spaceWidth` 压过 `space`；style=CARD 记录 + 圆角近似。**属性方法仅两个**：`divider`
（strokeWidth/color/startMargin/endMargin，非首 item 才画、画在 item 顶缘外 ::before 槽不占
高度）与 `childrenMainSize`（只记 data-*，服务于真机懒加载估算）。`List.sticky(StickyStyle)`
注入 position:sticky 规则（组头吸顶、对照组不吸）。footer 推迟到 pop 渲染（真机
AdjustMountTreeSequence 保证 header→items→footer 序）。

**验收**：`bash run.sh listitemgroup`（19 条断言）双端通过。**破坏验证（3 处）**：间距实现
摘除 **5 红**；divider 摘除 **3 红**；sticky 规则选择器破坏 **1 红**。还原后 md5 一致。

**触及**：`runtime/src/main.js`（ListItemGroup 工厂 + ensureComponent 特例 + sticky 样式 +
枚举挂 global）、`runtime/src/area.js`、`runtime/src/runtime.d.ts`、`tools/stats.mjs`
（手写 47→48）、`fixtures/pages/ListGroupDemo.ts`、`test/listitemgroup.html`、`run.sh`、
`electron/run.sh`（调研依据：`docs/research/R48-platform-verdicts-and-digests.md`
ListItemGroup 节）

### R50 — Refresh：pointer 驱动下拉刷新 ✅（2026-09-24）

按 R48-A 摘要实现。**create 单参** `{refreshing}` 支持 $ 双向（DOM 侧回写不实现，应用侧
onRefreshing 显式管理）；**状态机**照 refresh_constant.h：Inactive=0→Drag=1→OverDrag=2→
Refresh=3→Done=4；事件顺序 onRefreshing 先于 onStateChange(3)（真机 :704-710）；同值不发。
pointer 只收 touch（真机禁鼠标）；子组件 translateY 跟手；松手回弹 setTimeout（坑 ⑧）；
Refresh 态回弹到 refreshOffset 并保持。**重渲染时 refreshing 选项处理**：create 包装器每次
调用重传 refreshing 给引擎（否则应用设 refreshing=false 无法触发 Done——首跑实测）。

**验收**：`bash run.sh refreshdemo`（25 条断言）双端通过。**破坏验证（3 处）**：setState 哑火
**13 红**；pullToRefresh 不接线 **6 红**；pullToRefresh 只记 data-* **6 红**。还原后 md5 一致。

**触及**：`runtime/src/refresh.js`（新，第 20 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + Refresh/RefreshStatus 挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 48→49）、`fixtures/pages/RefreshDemo.ts`、
`test/refreshdemo.html`、`run.sh`、`electron/run.sh`

### R51 — DatePicker：三列滚轮选择器 ✅（2026-09-24）

按 R48-A 摘要实现。**create**：`{start, end, selected, mode?}`；**列结构**：year/month/day
三列各 5 行（行高 40px），列内 translateY 定位；**wheel 同步单步**（真机 AXIS+MOUSE 每事件
同步一步，headless 确定性最好——测试用 `__dp.step` 直调避免 wheel 事件不可靠，坑 ⑧ 同族）；
**跨列联动**：月变→重算当月天数→day 夹取（HandleSolarMonthChange）；start/end 钳制；
**设了 start/end 则 canLoop 强制 false**（OnModifyDone:486）；lunar 记警告（无农历换算）。
样式三套照 .d.ts 默认（选中蓝/候选与边缘暗色）。**month 0/1 基**：内部 1 基、onChange 出口
0 基（真机 GetSelectedObject month−1 同款）。

**验收**：`bash run.sh datepickerdemo`（21 条断言）双端通过。**破坏验证（3 处）**：跨列联动
摘除 **1 红**；onChange/onDateChange 不派发 **2 红**；lunar 警告摘除 **1 红**。还原后
md5 一致。

**触及**：`runtime/src/datepicker.js`（新，第 21 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + DatePicker/DatePickerMode 挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 49→50）、
`fixtures/pages/DatePickerDemo.ts`、`test/datepickerdemo.html`、`run.sh`、`electron/run.sh`

### R58 — TextPicker 收尾：多列/级联 + TextPickerDialog ✅（2026-09-25）

R56 的两块待办补齐。**多列**：range string[][] → N 列独立滚轮（selected/onChange 出入都是
数组形态）；**级联**（TextCascadePickerRangeContent children，.d.ts:64-77）：colCount 按
sel 链深动态计算，父变 → 截断 sel、下游从 0 重计、重建子列（选项联动为所选父的 children）。
**TextPickerDialog.show**：fixed 居中面板 + OK/Cancel（onAccept/onCancel 走
TextPickerResult {value,index}；onChange 逐次回调；DOM 无 OverlayManager 弹簧动画，标注），
与组件滚轮共用 tpxEngine。引擎重构：tpxEngine(hostEl, norm, sel0, rowH, fire) 统一支撑
单列/多列/级联三态与弹层；`__txpStep(dir)` 单列兼容保留，多列用 `__txpStepCol(col,dir)`。

**验收**：`bash run.sh textpickerdemo` 扩到 **19 条断言**（单列 10 + 多列 3 + 级联 3 +
弹层 3）双端通过。**破坏验证（1 处）**：级联 build() 摘除 → 父变后子列仍显示旧选项
**1 红**。还原后 grep BROKEN 无残留。

**新坑实录**：①多代理并行期间 fixtures 与 .ets 漂移——test 读的是旧冻结件，tx4/tx5 全
null（probe 一查便知）；②引擎重构后 `__txp` 从 st 变 engine 包装，旧 handler 写 `cbs`
路径失效（单测当场红）；③dataset.selectedIndex 从字符串变 JSON 数组——R56 断言同步更新。

### R57 — Grid/GridItem 网格 ✅（2026-09-25）

CSS grid 与 ArkUI 轨道模板**天然同构**的代表性实现（grid.js，第 26 个分片）：
display:grid 基座 + `columnsTemplate/rowsTemplate → grid-template-*`（normalizeTrackList
归一化，main.js 既有）+ `columnsGap/rowsGap → column-gap/row-gap`；滚动事件族照 WaterFlow
R53 同款收口（原生 scroll 去重坑 95 / onScrollIndex 区间变才发+首帧补发 / onReachEnd 过境
判定 / onScrollStart·Stop 80ms 静默近似）；**GridItem 跨行跨列**：columnStart/End、
rowStart/End → grid-column/row（ArkUI 含端 → CSS 排线 +1）；`Grid.create(scroller)` 单参
直传（工厂里 _bind，Scroll 同款）；cachedCount/GridLayoutOptions 记 data-*。
**测量教训两条**：①夹具 id 打在内层 Text 上——Text 的 offsetParent 跳过静态 GridItem
直达 Grid，按 id 查几何读出 (1,1)/宽 18 的假象，必须按 `[data-arkui-comp="GridItem"]` 查
组件本体；②跨列项被 CSS 稀疏自动放置推到第 4 行（内容 240 而非 180）——CSS 与真机
auto-placement 行为一致，按实测修正预期而非"修"实现。

**验收**：`bash run.sh griddemo`（12 条断言：基座 4/几何 3/初始 1/滚动 3/wheel…）双端通过。
**破坏验证（合并 1 处）**：跨列映射摘除 → **7 红**（几何/滚动链全面偏移，断言网有牙）。
还原后 grep BROKEN 无残留。

**触及**：`runtime/src/grid.js`（新，第 26 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + Grid/GridItem 挂 global）、`runtime/src/runtime.d.ts`、
`tools/stats.mjs`（手写 61→63）、`fixtures/pages/GridDemo.ts`、`test/griddemo.html`、
`run.sh`、`electron/run.sh`

### R63 — Panel 底部滑出面板 ✅（2026-09-26）

panel.js（第 31 个分片）。**实现**：div 底部定位 + dragBar 顶部横条 + mode CSS class 切换
（Mini/Half/Full → panel-mode-{name}）；`PANEL_ATTRS` Record 化（mode/dragBar/
backgroundMask/customHeight/onChange/onHeightChange）；`Panel.create(show?: boolean)`
缺省显示；mode 同值守卫（不重复发 onChange）。**编译器双拒**：`halfFullScreenHeight`
和 `backgroundMask` 不在当前 SDK API——夹具简化为 mode+dragBar+双事件。

**验收**：`bash run.sh paneldemo`（6 条断言：基座 4/mode 切换 2）双端通过。

**触及**：`runtime/src/panel.js`（新，第 31 个分片）、`runtime/src/main.js`（@include +
Panel/PanelMode 挂 global）、`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 69→70）、
`fixtures/pages/PanelDemo.ts`、`test/paneldemo.html`、`run.sh`、`electron/run.sh`

### R65 — RichEditor + Video 双件 ✅（2026-09-26）

richeditor.js（第 33 个分片）+ video.js（第 34 个分片）。**RichEditor**：contenteditable
基座 + placeholder + onReady（setTimeout(0) 延迟触发）；RichEditorController 空壳绑定。
**Video**：`<video>` 原生元素垫片——src/controls/autoPlay/muted/loop 直通原生属性；
生命周期桥接（play→onStart, pause→onPause, ended→onFinish）；VideoController
start/pause/stop/requestFullscreen/exitFullscreen；onPrepared/onUpdate 回调登记。
**编译器拒**：`RichEditor()` 无参调用被 10605999 拒——需要 `{controller}` 参数。

**验收**：`bash run.sh richvideodemo`（6 条断言：RichEditor 3/Video 3）双端通过。

**触及**：`runtime/src/richeditor.js`（新，第 33 个分片）、`runtime/src/video.js`（新，
第 34 个分片）、`runtime/src/main.js`（@include×2 + 四组件挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 72→74）、
`fixtures/pages/RichVideoDemo.ts`、`test/richvideodemo.html`、`run.sh`、`electron/run.sh`

### R60 — AlphabetIndexer 字母索引条 ✅（2026-09-25）

alphabetindexer.js（第 28 个分片）。**声明面**（alphabet_indexer.d.ts）：`create({arrayValue,
selected})`；`selected(index)` 属性（:473，程序化选中，重放不发 onSelect）；`itemSize` 方格
边长（缺省 24）；`selectedColor/selectedBackgroundColor` 选中配色；`onSelect(index)`（:427，
点击触发）。**实现**：纵向 flex 条 + 每项 button；点击 → `w.select(i, true)` 高亮迁移 +
onSelect(index)；`selected` 属性重放 → `w.select(idx, false)`（程序化不发 onSelect）；
usingPopup 记警告。**新坑 97（编译产物缺 .pop()）**：AlphabetIndexer 的编译产物没有
`.pop()` 调用（编译器视作自动弹出），运行时栈不弹出导致后续兄弟 Button 挂进索引条内部
——`parentOfTop()` 增加 leaf 自动弹出：`__arkuiLeaf = true` 标记 + 挂载时循环 pop。
测试侧：click 助手改为同时接受元素与选择器。

**验收**：`bash run.sh alphabetindexerdemo`（8 条断言：基座 3/点击 3/属性选中 2）双端通过。
**破坏验证（1 处）**：onSelect cb 调用摘除 → **4 红**。还原后 grep BROKEN 无残留。

**触及**：`runtime/src/alphabetindexer.js`（新，第 28 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + AlphabetIndexer 挂 global + parentOfTop leaf 弹出）、
`runtime/src/runtime.d.ts`（+__arkuiLeaf）、`tools/stats.mjs`（手写 65→66）、
`fixtures/pages/AlphabetIndexerDemo.ts`、`test/alphabetindexerdemo.html`、
`run.sh`、`electron/run.sh`

### R59 — TextClock/TextTimer 时间文本双件 ✅（2026-09-25）

一片双组件（texttime.js，第 27 个分片）+ 双控制器。**TextClock**：format 令牌子集
（HH/mm/ss；SS 与 a 记警告）、每秒 setInterval 刷新、TextClockController
start/pause/stop、onClockChange 每 tick 触发——**走真实系统时间，断言只锁格式形状
（^\d{2}:\d{2}:\d{2}$），不锁墙钟值**（结构性断言）。**TextTimer**：startTime/endTime/
isCountDown；format 含 .SS → 步进 10ms，否则 100ms 平滑；**elapsed 由 setInterval 累积
驱动，headless 虚拟时间下确定性最好**；countDown 显 startTime-elapsed（到 endTime 停）、
countUp 显 startTime+elapsed（有 endTime 则到点停）；onTimer(utc, elapsedTime) 每 tick
触发；TextTimerController start/pause/reset（reset 停表回 startTime；重复 start 幂等）。
controller 经 options 传入后 _bind 双向绑定（Scroller 同款）。

**验收**：`bash run.sh texttimedemo`（10 条断言：TextClock 结构 2/倒计时 5/正计时 3）
双端通过。**破坏验证（1 处）**：countDown 方向反转摘除 → 初始/区间/reset 三断言 **3 红**。
还原后 grep BROKEN 无残留。

**触及**：`runtime/src/texttime.js`（新，第 27 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + TextClock/TextClockController/TextTimer/
TextTimerController 挂 global）、`runtime/src/runtime.d.ts`、`tools/stats.mjs`
（手写 63→65）、`fixtures/pages/TextTimeDemo.ts`、`test/texttimedemo.html`、
`run.sh`、`electron/run.sh`

### R56 — TextPicker 文本选择器 ✅（2026-09-25）

选择器三部曲收官（DatePicker R51 / TimePicker R52 / TextPicker R56）。**声明面**（本机
text_picker.d.ts，1811 行）：`create({range, selected})`，range 支持 string[] /
TextPickerRangeContent[]（取 .text）/ string[][]（多列）；`onChange(value: string|string[],
index: number|number[])`（**联合类型签名，夹具窄签名被 ArkTS 编译器 10605999 拒——参数逆变**）；
`selectedIndex` 属性 = create 之后的 selected 覆盖；`defaultPickerItemHeight` 行高（缺省 40）。
**真机**（text_picker/pattern.cpp:803 FireChangeEvent(value,index)）：滚轮选中变化即触发，
与 R51/R52 滚轮同族同步单步一致。**实现**（textpicker.js，第 25 个分片）：单列 5 行滚轮
（视觉同 DatePicker：中行高亮/translateY 定位）、wheel 同步单步、边界不动不发、
`__txpStep(dir)` 暴露给测试；多列/级联 range 只取第一列并记警告；TextPickerDialog 静态弹层
未实现（记 ROADMAP 待办）。

**验收**：`bash run.sh textpickerdemo` 双端通过（R56 时 11 条；R58 扩到 19 条，当前口径见 R58 条目）。
**破坏验证（合并跑 2 红）**：边界不动不发摘除 → 重复 'CHG冬:3;' 红；selectedIndex 覆盖摘除 →
tx2 变 '0' 红。**首跑 4 红的根因是坑 87 再演**：onChange 同步发但 `@State`→DOM 批量重渲染
滞后，断言前缺 `tick(30)`（测试缺陷，实现无需改）。

**触及**：`runtime/src/textpicker.js`（新，第 25 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + TextPicker 挂 global）、`runtime/src/runtime.d.ts`、
`tools/stats.mjs`（手写 60→61）、`fixtures/pages/TextPickerDemo.ts`、
`test/textpickerdemo.html`、`run.sh`、`electron/run.sh`

### R55 — noImplicitAny 类型化专项 ✅（2026-09-25，十六批人工 + 六组并行代理）

目标：把 `noImplicitAny` 翻进门禁。**画像**：1464 个隐式 any（TS7006 参数 1202 / TS7053 索引
107 / TS7005 变量 88 / 其余 67）。**人工批 R55-1~16**（7dd7d5a…0a39291）：waterflow/gesture/
layout/nav 整片或分段 JSDoc 化，12 张 attr 分派表 Record 化，四状态类/ViewV2/Swiper 控制器/
TransitionEffect/Canvas 类/ability 全量标注，ensureComponent 与 inputComponent 两根全库级
契约（工厂 args/setup 参数从此全域拿到上下文类型）。**并行代理批（R48 A+C 方法复用）**：
bundle 行→源文件精确映射后按文件切六组（A=main 197/B=106/C=50/D=36/E=72/F=area 31），
工作流扇出 6 代理并行标注（各 17~44 万 token，零失败），join 后统一重建 → 严格门禁修复循环
→ 隐式 any 计数收敛循环（world.run 跑 tsc）→ npm run check 全量验收，**全部 exit=0**；
主会话另派 main.js 后半帮手（A2，转核验+补 1 处）。
**终态**：隐式 any **0**（主会话新鲜重跑复核）；`tsconfig.check.json` 的 noImplicitAny 翻
**true** 进门禁（红线不变 0 错）；试验档 tsconfig.implicit-any.json 删除。零运行时改动
（全程仅 JSDoc/类型断言；每批均有用例计数回归）。**翻档方法论沉淀**：①表级 Record 一行消
30+；②给工厂参数写完整形状类型，下游字面量全免费；③evolving-let（null↔对象摆动的 let）
只能在声明处修，使用点断言无效；④TS1016 可选参后不可跟必参；⑤多代理并行按【文件】切组，
同文件双代理必须串行。

**触及**：runtime/src 全部 23 分片（纯注释/断言）、tsconfig.check.json（翻档）、
tsconfig.implicit-any.json（新建后删除）、tools/typecheck.mjs（头注释）、docs/*、.reasonix/*

### R54 — CalendarPicker 日期选择入口 ✅（2026-09-25）

可行队列选型（ContainerReader 靠 ResizeObserver 在 headless 虚拟时间不可靠、WithTheme 断言弱、
Calendar 要农历数据，均缓）。**真机结构逐条确证后实现**（calendarpicker.js，第 24 个分片）：
**入口 = 年/月/日三段文本 + 加/减两按钮**（calendar_picker_model_ng.cpp LayoutPicker:89-113）；
点日期段 → 开弹层 + 记活动段；点 +/- → 步进活动段 → GetAvailableNextDay 跳过 disabledDateRange
且夹 [start,end]（无可到日 year<=0 哨兵 → 不动不发）→ **同样触发 onChange**
（HandleAddButtonClick:561-584 的 FireChangeEvents）；非年月段步进后回贴 DAY。
**弹层**：点日期 → onChange 由 CanReportChangeEvent **同值不重发**（:1615）、弹层不因点日期关闭
（OK/外点才关）；月历**首列周日**（calendar_paint_method.cpp:531，startOfWeek_ 默认 64→log2=6
→首列=weekNumbers_[0]=SUN）；标题 `${y}年${m}月`。selected 缺省=系统今天；AdjustDateToRange
夹入 [start,end]。**静态 CalendarPickerDialog.show**：OK/Cancel → onAccept/onCancel。
DOM：入口 inline-flex；弹层为入口内绝对定位面板（edgeAlign START/CENTER/END，缺省 END）；
7 列 grid，前置空格=首日 getDay()；语言取 zh（夹具环境，标注）。

**验收**：`bash run.sh calendarpickerdemo`（24 条断言：入口 4/弹层 7/时序 4/步进 3/静态 Dialog 2/
hintRadius+markToday 5——含 hintRadius 0/8/缺省三档内联圆角与 markToday 翻月对照）
双端通过。**破坏验证（3 处）**：前置空格改周一制（列位错位）**1 红**；摘 +/- 的 FireChangeEvents
**1 红**；摘同值去重 **1 红**（B+C 合并跑 3 红）。还原后 grep BROKEN 无残留、门禁复跑全绿。
本切片被预算闸硬拦两次（研究后/首跑后各一次），断点落 todo 无损续做。
**残留清账（R54.1）**：Mimosa deep 审计重跑 **0 findings**（seal sha256:f6e09366…，依赖 partial=
零 npm 依赖同 R38）；hintRadius 落到真实视觉（选中日内联 borderRadius，0 直角/(0,16) px/负数
或>16 回落 50%）；markToday 状态接线补上（attr 只写 dataset 没写 st——翻月对照断言首跑即红，
正是"从 dataset 层升到可观测层"抓到的真 bug）。

**触及**：`runtime/src/calendarpicker.js`（新，第 24 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + CalendarPicker/CalendarPickerDialog/CalendarAlign 挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 58→59）、
`fixtures/pages/CalendarPickerDemo.ts`、`test/calendarpickerdemo.html`、`run.sh`、`electron/run.sh`

### R53 — WaterFlow 瀑布流 ✅（2026-09-25）

CSS 无原生瀑布流 → **JS 绝对定位排布逐行复刻真机 top_down 算法**（`water_flow_layout_info.cpp`）：
换列 `GetCrossIndexForNextItem(:271-298)`=空列直接选 → 累计主轴**严格更小**才换（LessNotEqual
容差 -0.001）→ **平高保左列**；轨道解析支持 `'1fr 1fr'`/`repeat(auto-fill,Npx)`/固定 px。
**事件时序照真机 TriggerPostLayoutEvents(:354-393)**：onScroll(delta,state) → onScrollIndex(变才发)
→ onReachStart/End（过境判定：prev 与 current 分居 minOffset=内容高−视口高 两侧才发）；
onScrollIndex/onReachStart **首帧必发**（itemRange_={-1,-1}/firstLayout）→ setTimeout(0) 补发且
**调度序必须排在布局 flush 之后**；首帧不发 onReachEnd（真机首帧只发 observer）。
onScrollStart/Stop 为 DOM 近似（首个滚动事件 / 80ms 静默收口，scroll.js 同款）。
**默认档 WaterFlow 专属**：scrollBar=Off（≠Scroll 的 Auto）、edgeEffect=None → overscrollBehavior:none。
scrollToIndex 语义确证：落点恰为 max scroll 时 ReachEnd 过境成立发 RE（真机 ReachEnd
`prev>minOffset && current≤minOffset` 负偏移空间）——修正 R48 摘要漏记的这次 RE。
**WaterFlowSections shim**：itemsCount 非负校验，非法 push/splice/update 返 false；sections 启用时
按段列数排布并忽略 columnsTemplate（.d.ts:350-353）。layout.js `scrollToIndex` 扩查 FlowItem +
found-target 路径补同步派发（此前只查 ListItem、无派发）。

**验收**：`bash run.sh waterflowdemo`（21 条断言：基座 5/几何 5/初始 2/滚动序列 5/收口 3，
含最终全串按序全等）双端通过。**破坏验证（3 处）**：position:absolute 摘除 **14 红**；
delta 符号反转 **6 红**；初始 reachStart 摘除 **7 红**。还原后 grep BROKEN 无残留、重跑全绿。

**新增坑 95**（原生 scroll 事件与手动同步派发双发 → delta 幽灵 D0，监听器按 scrollTop 恒等去重）、
**坑 96**（同延时定时器按插入序执行：初始事件调度必须排在布局 flush 之后，否则读到未排布几何）。

**触及**：`runtime/src/waterflow.js`（新，第 23 个分片）、`runtime/src/area.js`、
`runtime/src/main.js`（@include + WaterFlow/FlowItem/WaterFlowSections/WaterFlowLayoutMode 挂 global）、
`runtime/src/layout.js`（scrollToIndex 扩 FlowItem + 派发）、`runtime/src/runtime.d.ts`、
`tools/stats.mjs`（手写 50→58，补账 TextInput/TextArea/Search/Hyperlink/QRCode 漏登记）、
`fixtures/pages/WaterFlowDemo.ts`、`test/waterflowdemo.html`、`run.sh`、`electron/run.sh`

### R52 — TimePicker ✅（2026-09-24，本条为文档补记）

hour/minute/second 三列滚轮；useMilitaryTime 12h/24h（军事时间 hour 不补零）；onChange 双参；
枚举 `TimePickerFormat` 挂 global。验收 `bash run.sh timepickerdemo`（10 条断言）双端通过。
详见 commit 6300416。

### R44 — 已确证组件的语义回归扫描 ✅（2026-09-21）

逐项重读真机源码找首轮漏掉的边界行为。**扫出两处分歧并修正**：
① Marquee `step≤0`：真机只在 `step>0` 时除（`GreatNotEqual(step, 0.0)`），step≤0 时
duration = 距离×85 不除——原实现错替换成默认 6（已修，showdemo DSL 断言 3400ms 精确）；
② QRCode 组件尺寸 < 矩阵模块数：真机记错误拒绝绘制（`qrcode_modifier.cpp:55`）——原实现
cell 兜底 1px 硬画溢出（已修，qrdemo DSL 断言：20px 组件拒绝 + 出声 + 只尝试一次）。
**一处一致转确证**：onTitleModeChange 端点触发（`UpdateTitleModeChange()`：高度≥max→Full、
==56→Mini）——R25 的"端点判定是本实现的选择"升级为确证。Stepper 的
`IsSwiperAnimationStopped`（动画中点击忽略）对我们不适用（无转场动画），记 CAPABILITY。

新增 `__arkui_dom_syncDrawings` 钩子（DSL 建的绘制类组件不经过渲染管线，测试手动触发补画）。

**过程教训**：破坏/恢复脚本两次 old/new 颠倒，靠 `grep BROKEN` 回读抓到——**破坏脚本必须
回读验证**，不能只看打印。

**③ widgets 旧契约升级**：Widgets 页的 QRCode 没给尺寸（DOM 里 clientWidth=0）——真机对
`qrCodeSize≤0` 也拒绝（`LessOrEqual(qrCodeSize, 0)` 分支），原实现"cell 兜底 1px 硬画"是产物
假象。components.html 断言升级为"无尺寸 → 拒绝 + 出声"（渲染落位由 qrdemo 承担）。

**验收**：qrdemo 15 / showdemo 28 / widgets 双端通过；破坏验证 2 处（1 红 / 3 红），还原后
md5 一致。

**触及**：`runtime/src/show.js`、`runtime/src/main.js`（syncDrawings 钩子）、
`test/{qrdemo,showdemo,components}.html`、五文档

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

### R67 — R66 批量组件验收：结构 + 兜底绊网 + 真编译语义 ✅（2026-09-26）

**内容**：R66 六组并行产出的 37 个批量组件只有实现、没有测试。本轮补验收：37 结构断言 +
兜底绊网 + BatchVerifyDemo（13 组件真编译 fixture）语义断言。

**验收**：`bash run.sh batchverify`（86 条断言：结构 47/兜底绊网 1/语义 14/行为 24；R67 时
52、R84 时 62、R87 起增 platform 行为段）双端通过。

**定路径（混合）**：13 个有 SDK 声明的组件走真编译 fixture（`BatchVerifyDemo.ets`）——编译器
强制的嵌套契约直接成为断言对象：ContainerSpan/ImageSpan/SymbolSpan 只能 Text 系内、
MenuItemGroup 子只 MenuItem、Web 必填 controller、ScrollBar 必填 scroller、WithTheme 必填
options 且无 universal `.id`；Calendar 无 SDK 声明（`Cannot find name 'Calendar'`）→ 归
runtime-only 结构组。

**新绊网（`__arkui_dom_generatedFilled`）**：破坏验证抓出盲区——手写注册缺席时 generated
骨架**静默兜底**建出同名同 `data-arkui-comp` 的 div，结构/语义断言全绿（Navigator 案例实测：
改名后 51/52→若沿用旧断言 51/51 全绿）。运行时 `registerGeneratedComponents` 现在把兜底
名册暴露在 `__arkui_dom_generatedFilled`，测试断言 37 个批量组件无一落进去。绊网对所有
组件永久生效：今后任何手写实现被误删/改名，batchverify 必红。

**结构段的两个前置**：裸 `create()` 需要 build 上下文（mountNode 走 `parentOfTop()`：
栈顶或页面 rootNode，无上下文为 null）→ 先 loadRoute 再结构循环；`create` 会 push 栈、
叶组件自动弹（坑 97）→ 每次 create 前后 `ViewStackProcessor.snapshot/restore` 隔离。

**触及**：`harmony-proj/entry/src/main/ets/pages/BatchVerifyDemo.ets`（新）+ `main_pages.json`、
`fixtures/pages/BatchVerifyDemo.ts`（固化）、`test/batch-verify.html`（重写为单页双段）、
`run.sh`、`electron/run.sh`（含 `page_of` 登记）、`runtime/src/main.js`（filled 名册）

---

### R68 — 性能基线门禁：首渲染 / 最小 rerender 入 §6 ✅（2026-09-26）

**内容**：给"怎么保证性能"一个可量化的起点。PerfDemo（30 行 ForEach + @State 计数按钮）
实测首渲染与最小 rerender，数字进 stats/§6；宽松阈值只拦灾难性回退。

**验收**：`bash run.sh perfdemo`（3 条断言）双端通过。基线（Electron 实测，2026-09-26）：
**首渲染 125.5ms**（33 节点：Column+Button+Text+ForEach×30）/ **最小 rerender 12.8ms**
（@State 计数、单 Text 脏区）。

**设计要点**：浏览器端跑在 `--virtual-time-budget` 下时钟不可信（实测 35.7/0.0ms，恰好自证）
——**权威数字只在 Electron 端**（与定位声明一致：Electron 是验收形态）。electron runner 把
全部用例输出落盘 `build/<case>.result.txt`，stats.mjs 采集 PERF 行进 §6（文件缺失打印
"未测"）；阈值 500/100ms 刻意宽松防机器抖动，精确比较看 §6 数字块趋势。

**意义**：后续两大优化的对照起点——模板编译器（目标 rerender ~50x）与属性分派哈希化/
脏区更新——没有基线，"快了多少"只能是口说。

**触及**：`harmony-proj/entry/src/main/ets/pages/PerfDemo.ets`（新）+ `main_pages.json`、
`fixtures/pages/PerfDemo.ts`（固化）、`test/perfdemo.html`（新）、`run.sh`、
`electron/run.sh`（结果落盘）、`tools/stats.mjs`（性能段）

---

### R69 — 模板编译器手工 spike：上限实测 + 两个改向情报 ✅（2026-09-26）

**内容**：编译器立项前的前置验证。同一页面（PerfDemo 语义）三种执行形态在同一环境
（headless Chrome 真实时钟、setTimeout 轮询，三轮）对比：A 当前运行时基线（真编译产物走
ViewPU 协议）/ B 编译器目标形态（手写 c()/m()/p()：静态 DOM 一次建 + 动态绑定直写）/
C 地板（裸 textContent）。`test/perfspike.html`（实验页，不进门禁）。

**结果（三轮实测）**：

| 形态 | 首渲染 | rerender |
|---|---|---|
| A 当前运行时 | 4.8–6.2ms | 1.1–32.8ms |
| B 编译器目标形态 | 0.1–0.3ms | 0.1–0.2ms |
| C 裸 textContent | — | ~0.005ms/次 |

**判定：编译器方向成立**——首渲染上限空间 20–60x（立项假设 10x 保守成立）、rerender 上限
空间 11–270x（假设 50x 在带宽内）。

**两个改向情报（比验证本身更值钱）**：

1. **rerender 的大头是调度管道，不是计算**：A 的 click 同步段仅 0.4–0.6ms（状态置脏+派发），
   文本更新落在后续 tick——12.8ms（R68 Electron 基线）主要是异步调度延迟。**第一刀应是
   rerender 调度路径优化（同步化/微任务化），比模板编译器更便宜**，且编译器削不掉这块。
2. **首渲染 125.5ms 里 DOM 构建只占 ~6ms**：spike 里 A 的纯 DOM 构建 4.8–6.2ms，即
   R68 基线的大头是**启动/模块装载开销**（CJS 包装 eval、运行时初始化、首帧调度）——
   编译器对首渲染的收益被启动开销封顶，启动优化是独立（可能更优先）的战场。

**方法论沉淀**：headless 无 virtual-time 时 rAF 不被驱动（等待永久挂起）——测量页轮询用
`setTimeout(0)`；electron harness 直调需 cwd=electron/ 且 app 参数=该目录；实验页完成信号
`document.title='PASS'` 与正式用例一致。

**触及**：`test/perfspike.html`（新，实验页不进 gate）、`docs/ROADMAP.md`（本节）

---

### R70 — rerender 管道细测：12.8ms 是假象，目标修正为启动开销 ✅（2026-09-26）

**内容**：R69 情报①说"rerender 大头是调度管道"——本片用更细的口径验证后再动手。
perfdemo 增加三种口径：rAF 轮询（原口径）、setTimeout(0) 轮询（管道真实延迟，含 tick 数）、
裸微任务延迟（环境底噪）；stats/§6 同步扩列。

**实测（Electron）**：`rerender_poll_ms=1.5 / poll_ticks=1 / micro_ms=0.00`——**管道已经是
微任务级**：click 置脏 → `Promise.resolve().then` flush → 文本更新，一个轮询 tick 内完成。
同轮 rAF 口径测得 3.2ms（R68 当时的 12.8ms 同理）——**那是 offscreen 帧间隔量化，不是
管道成本**。

**判定：调度代码一行不动**（先测量后实现的胜利：前提被测量推翻，实现就不该发生）。
R69 情报①修正为：*"rerender 的 rAF 口径数字不可信，管道本身已达标"*。

**真正的目标收敛到首渲染 124ms**：DOM 构建仅 ~6ms（R69 实测），其余 ~118ms 在
启动/模块装载（CJS 包装 eval、运行时初始化、loadRoute 首帧）——这是下一个切片。

**顺带的伸缩性备忘**：`rerenderElmt` 每次重渲染后做 `syncAlignRules/syncDrawings/
syncAreas(rootNode)` 三次全树走查——33 节点下无感（1.5ms 内），大树是潜在热点，
列入大树优化时的首批剖面对象。

**触及**：`test/perfdemo.html`（三口径）、`tools/stats.mjs`（性能段扩列）、
`docs/ROADMAP.md`（本节）

---

### R71 — 启动开销剖面：框架同步构建仅 3.5ms，"124ms"是非框架成本 ✅（2026-09-26）

**内容**：把首渲染 121ms 拆到 eval/初始化/路由/首帧各段。perfdemo 增分段时间戳
（requireModule/loadRoute/raf1/raf2）+ 脚本 eval 资源计时（PerformanceResourceTiming）；
stats §6 增 PERF2 剖面行。

**实测（Electron）**：

| 段 | 耗时 | 定性 |
|---|---|---|
| requireModule | 0.2ms | 可忽略 |
| loadRoute 同步（33 节点 DOM 全建） | **3.5ms** | **框架全部工作** |
| raf1 / raf2 | 5.3 / **112.4ms** | offscreen 首帧合成（测试模式成本） |
| 脚本 eval（计时起点之前） | runtime 22.3 / generated 20.4 / shims 21.1 / module 20.6 ≈ 84ms | 页面加载阶段 |

**判定**：运行时代码**没有可优化的大头**——框架同步构建 3.5ms 已达地板量级。
"首渲染 124ms" = 脚本 eval ~84ms（页面架构层，可优化方向：脚本合并/V8 code cache）
+ offscreen 首帧 112ms（Electron 测试模式特有，真窗口场景待打包 spike 佐证）。

**对模板编译器立项的再修正**：框架成本只有 3.5ms，编译器在**小页面**上的首渲染收益
<3%——它的真实定位是**规模化解法**：大树 rerender 的属性重放削减与大批量组件创建。
立项时应以大型页面（百节点级）为验收基准，而非 perfdemo。

**触及**：`test/perfdemo.html`（分段剖面）、`tools/stats.mjs`（PERF2 采集）、
`docs/ROADMAP.md`（本节）

---

### R72 — 打包 + 进程模型 spike：桌面分发三条路全通 ✅（2026-09-26）

**内容**：桌面线前置验证——`electron/` 宿主能否打成分发包、进程模型怎么定。
结论：**能，且零源码改动**。完整报告见 `docs/research/packaging-spike.md`。

**要点**：@electron/packager（285M 目录 / tar.gz 118M）与 electron-builder（`--dir` 285M /
AppImage 120M 单文件）全出包成功，打包后 `ARKUI_TEST/ARKU_PAGE_URL` env 驱动原样可用，
perfdemo 双模式（file:// 与 http）`ELECTRON_RESULT: PASS`；打包工具经 npx 临时使用，
未进任何 package.json（零依赖纪律不变）。三个坑已记录：electron-builder 默认排除 `build/`
（与本项目产物目录名冲突，需 `-c.directories.buildResources` 覆盖）、AppImage 本机需
`--appimage-extract-and-run`、chrome-sandbox 需 `--no-sandbox`。

**进程模型**：主进程目前只是"测试驱动器"（无 ipcMain 处理器）；真 fs 在 preload
（`sandbox:false` + `contextIsolation:true`）直连 `node:fs` 经 contextBridge 暴露，不走 IPC。
后续能力分类建议：file.fs/preferences 留 preload 桥；dialog/wifi/蓝牙/子进程/任意路径 fs
走主进程 IPC；分发场景可写目录应迁 `app.getPath('userData')`。

**触及**：`docs/research/packaging-spike.md`（新）、`docs/ROADMAP.md`（本节）

---

### R73 — 规模化基线：203 节点首渲染 4.8ms，200 行批量翻转 16.1ms ✅（2026-09-26）

**内容**：为模板编译器建立"百节点级"验收基准（R71 结论的落地）。PerfBigDemo
（200 行 ForEach + 翻转按钮，index key 走原地更新路径）+ `test/perfbig.html` 双口径测量。

**验收**：`bash electron/run.sh perfbig`（4 条断言，R76 起含行复用同一性断言）双门禁
Electron 侧通过（与 perfdemo 同理由不进浏览器 all）。基线（Electron 实测，2026-09-26）：
**首渲染同步段 4.8ms**（203 节点）/ **批量翻转 16.1ms**（200 行，~0.08ms/行，轮询口径）。

**两个立项级结论**：
1. **创建路径规模化近乎平坦**：33 节点 3.5ms → 203 节点 4.8ms——运行时 create 路径不是
   瓶颈，"框架慢"的叙事正式终结；
2. **批量更新是真实的可优化面**：200 行原地翻转 16.1ms ≈ 0.08ms/行（ForEach itemGen 重入 +
   属性重放），手写 c()/m()/p() 形态预期 1–2ms——**~8–16x 就是编译器在规模化场景的验收
   空间**，以 `perfbig` 的 PERF3 行为准。

**触及**：`harmony-proj/entry/src/main/ets/pages/PerfBigDemo.ets`（新）+ `main_pages.json`、
`fixtures/pages/PerfBigDemo.ts`（固化）、`test/perfbig.html`（新）、`electron/run.sh`（接线）、
`tools/stats.mjs`（PERF3 采集）、`docs/ROADMAP.md`（本节）

---

### R75/R76 — 模板编译器两连片：属性分裂优化器 v1 + ForEach 行级复用 v2 ✅（2026-09-26）

**版本对照（避免误读）**：本节的 v1/v2/v3 编的是"编译器深化项目的第几片"，不是优化器工具的
版本——**优化器工具本体停在 v1.1**（R75 落地 + R78 闭包参数边界修复，此后未再改）。v2 =
R76 的**运行时**行级复用（不是优化器）；v3 = R77 评估过的"节点池/直写快路径"构想——
**评估后暂缓、从未实现**（剖面证明真实管道 5.8ms，v3 剩余收益 ~5ms/次，风险收益比不足）。

**R75（优化器 v1）**：`tools/arkui-optimizer.mjs`——TS AST 变换，observeComponentCreation2
回调内的常量属性语句包 `isInitialRender` 守卫（`onClick` 注册类：this 只在嵌套函数体内 →
判静态；create/pop/控制流不动；嵌套回调先深访再分类）。`extract.mjs --optimize` 默认关，
门禁仅 perfbig 启用。工具链坑：SDK 定制版 TS 的 transformer 是 **context 工厂式**
（`(context) => (node) => …`），普通 visitor 直接传会炸 `transform2 is not a function`。

**R76（ForEach 行级复用 v2）**：perfbig 行加 4 静态属性后测量暴露真相——**v1 守卫在
ForEach 重入路径从未生效**：`observeComponentCreation2` 里 `elmtId = ++elmtIdSeq` 每次重入
都分配新 id，`isFirst` 恒为 true；且 `forEachUpdateFunction` 是整列表拆除重建语义（key 被
无视）。v2 运行时改动两处：

1. `observeComponentCreation2` 支持行级重入：`rowReentryIds` 名册存在时，行内第 k 个组件
   沿用名册既有 elmtId（`isFirst=false` → v1 守卫真正生效、节点复用+contentUpdater）；
2. `forEachUpdateFunction` 按 key diff：长度同 + 逐位 key 相等 → 行级复用；否则维持整列表
   重建（R22 消失动画语义保留）；无 keyGenFunc 恒为重建。

**验收**：`bash electron/run.sh perfbig`（4 条断言，`--optimize` 管线）——批量翻转
**19.8 → 13.9ms**（-30%），行复用同一性断言（翻转前后 DOM 节点同一）绿；全量门禁 7/7
（所有 ForEach 存量用例零回归）。基线迁移：PERF3 从 16.1（无属性）/19.8（含属性）降至
**13.9**，§6 为准。

**诚实边界**：13.9ms 距手写形态（R69 实测 ~0.1-0.2ms）仍有两个数量级——剩余大头是每行
`observeComponentCreation2` 重入 + create 复用的协议税本身。v3 方向（节点池/直写 content
快路径）需要运行时为 ForEach 行建立"结构快照"协议，立项时以 perfbig 为验收。

**触及**：`runtime/src/main.js`（rowReentry + key diff）、`tools/arkui-optimizer.mjs`（新）、
`tools/extract.mjs`（--optimize）、`tools/stats.mjs`（PERF3/PERF2 采集）、
`harmony-proj/.../PerfBigDemo.ets`（+4 静态属性）+ fixture、`test/perfbig.html`（复用断言）、
`electron/run.sh`（--optimize 管线）、`docs/ROADMAP.md`

---

### R78 — 编译器深化基准：重属性大树 3.8x + 优化器 v1.1 对抗修复 ✅（2026-09-26）

**内容**：编译器深化首片。AttrHeavyDemo（100 行 × 10 静态属性、嵌套 Row+双 Text、
304 节点 / ~1006 条属性语句）+ `test/attrheavy.html` 三口径（首渲染/单点动态/批量翻转），
门禁走优化管线（--optimize + R76 行复用 + R75 守卫全开）。

**验收**：`bash electron/run.sh attrheavy`（4 条断言，含"单点动态 flush < 批量 flush"的
依赖追踪正确性断言）双门禁 Electron 侧通过。基线（Electron 实测，2026-09-26）：
首渲染同步 11.2ms（304 节点 ~1006 属性）/ **单点动态 flush 1.0ms / 批量翻转 flush 2.2ms**。

**A/B（同页无优化 vs 优化，flush 权威口径）**：批量翻转 **8.4 → 2.2ms ≈ 3.8x**
（每行 0.084 → 0.022ms）；单点动态 1.1 → 1.0ms（依赖追踪与优化器正交，符合预期）。
深化构成：R75 属性守卫（跳过 ~1000 条静态重放）+ R76 行复用（不拆不建）。

**优化器 v1.1（对抗自检修复）**：v1 分类器只认 `this` 引用——行属性依赖 itemGen
**闭包参数**（如 `.fontSize(it.length)`）会被误判静态守卫。v1.1 沿作用域链收集全部
参数名，语句引用任一即判动态（保守方向）。修复后两基准回归持平（本页无该形态，
数字不变），边界闭合。头注释与坑记录同步。

**触及**：`harmony-proj/.../AttrHeavyDemo.ets`（新）+ `main_pages.json`、
`fixtures/pages/AttrHeavyDemo.ts`（固化）、`test/attrheavy.html`（新）、
`electron/run.sh`（--optimize 管线接线）、`tools/arkui-optimizer.mjs`（v1.1）、
`tools/stats.mjs`（PERF5 采集）、`docs/ROADMAP.md`（本节）

---

### R79 — 深化三候选收官：千节点压测 + 破坏验证补账 + 路径甲判定 ✅（2026-09-26）

**① 千节点压测**：Stress1kDemo（350 行 × 10 属性，1055 节点 / ~3500 条属性语句）。
**验收**：`bash electron/run.sh stress1k`（5 条断言）Electron 侧通过。
Electron 实测：**首渲染同步 19.0ms**（规模曲线
203→4.8 / 304→11.2 / 1055→19.0，**亚线性**）· 单点动态 flush 1.4ms · **批量翻转 flush
3.3ms**（0.009ms/行）· 行复用同一性在千节点级保持。PERF6 进 §6。

**② 破坏验证补账（两处，各验红→还原绿）**：
- 破坏 A（perfbig）：`keysStable` 强制 false（回退重建语义）→ **行复用同一性断言红**；
- 破坏 B（attrheavy/runtime）：`markDependentsDirty` 置空（依赖跟踪断链）→ **3 FAIL**
  （单点/批量退化 0.0ms、正确性红、bulk 轮询等满 2507ms）。依赖追踪的最小更新语义有了
  直接的红线证据。

**③ 路径甲判定：不立项**。数据：R75 守卫已消除静态重放；依赖追踪已行级粒度
（单点 flush 1.0-1.4ms vs 批量 2.2-3.3ms）；attr 级再分裂的边际收益在 µs 级（低于
测量噪声）。真正的剩余热点是**全树走查 O(N)/次**（R77 剖面：align/draw/areas/nav
≈ 1.6ms@304 节点），千节点级 ~2-3ms——若未来出现大树高频更新场景，立项
"增量走查"（只走查脏节点的子树），当前不投。

**触及**：`harmony-proj/.../Stress1kDemo.ets`（新）+ `main_pages.json`、
`fixtures/pages/Stress1kDemo.ts`（固化）、`test/stress1k.html`（新）、
`electron/run.sh`（接线）、`tools/stats.mjs`（PERF6）、`docs/ROADMAP.md`（本节）

---

### R80 — 桌面线产品化首片：@ohos.window v1（窗口 API → BrowserWindow）✅（2026-09-26）

**内容**：把窗口管理能力面接进 Electron 主窗，走 R74 IPC 模板三层：渲染侧垫片
（`ohos-shims.js`，权威语义对齐 `@ohos.window.d.ts` 9978 行的常用子集）→ preload
`windowOp` 桥（可结构化克隆 + 失败免疫）→ 主进程 `ipcMain.handle('arkui:window:op')`
操作 BrowserWindow 本体。v1 能力面：`getLastWindow/findWindow/getTopWindow/getMainWindow`
（单窗形态收敛主窗实例）+ `setWindowBackgroundColor/resize/moveTo/show/minimize/destroy` +
`on/off('windowSizeChange')`（主进程 'resize' → webContents.send → 渲染侧监听器）。

**两个边界决策**：① `destroy` 在测试驱动下（ARKUI_TEST/ARKUI_PAGE_URL 在场）被主进程拒绝
——harness 靠窗口退出收结果，误销毁会让用例假死；② 浏览器端探测式降级（R21 先例）：
方法存在、操作无效、记 warning，事件推送不验证。

**验收**：`bash electron/run.sh windowdemo`（13 条断言：R80 时 5、R83 起 7、R91 起 13）——
垫片 Promise 链、**windowSizeChange 推送真实尺寸 600x500**（IPC 全链路实证）、
R83 起含 `isFullScreen` 真实回读；浏览器端降级全部通过（事件推送按宿主能力跳过）。
WindowDemo 用 kit 形式导入（`@kit.ArkUI`）过真编译器（getContext(this) 必传；
产物自动转 `import window from "@ohos:window"` 对接垫片）。

**触及**：`runtime/ohos-shims.js`（window 垫片 v1）、`electron/preload.js`（windowOp 桥）、
`electron/main.js`（ipcMain 执行端 + resize 转发）、`harmony-proj/.../WindowDemo.ets`（新，
kit 导入）+ `main_pages.json`、`fixtures/pages/WindowDemo.ts`（固化）、
`test/windowdemo.html`（新）、`run.sh` + `electron/run.sh`（接线）、`docs/ROADMAP.md`

---

### R81 — 桌面线产品化次片：打包工具固化 tools/package-app.mjs ✅（2026-09-26）

**内容**：把 R72 spike 的验证路径变成可重复工具。`node tools/package-app.mjs` 一条命令
完成 staging（76 测试页 + 75 页面模块全量进包）→ 打包 → 冒烟验证
（`ELECTRON_RESULT: PASS` 否则 exit 1）。

**两条路实测通过**：
- **packager**（默认）：`/tmp/arkui-pkg-out/arkui-dom-electron-linux-x64/`，冒烟 perfdemo 3/3；
- **appimage**：`arkui-dom-desktop-0.1.0.AppImage`（121M），`--appimage-extract-and-run` 冒烟 3/3。

**设计要点**：Electron zip 软链零拷贝（packager 只认目录）；`--electron-zip-dir` 复用本地
缓存零下载；R72 三坑内建处理（builder 的 buildResources 覆盖、AppImage extract-and-run、
--no-sandbox）；`--mode/--out/--page` 可调；零依赖纪律不变（npx 临时使用）。

**触及**：`tools/package-app.mjs`（新）、`docs/ROADMAP.md`（本节）

---

### R82 — 桌面线：@ohos:file.picker v1（文件选择/保存 → Electron dialog）✅（2026-09-26）

**内容**：IPC 模板第三落地。渲染侧垫片（`DocumentViewPicker/PhotoViewPicker/AudioViewPicker`，
权威语义对齐 `@ohos.file.picker.d.ts`：Document select/save 返回 `Promise<Array<string>>`、
Photo select 返回 `PhotoSelectResult{photoUris}`）→ preload `fileDialog` 桥 → 主进程
`dialog.showOpenDialog/showSaveDialog`。

**测试驱动注入**：对话框在 harness 下无人点击会阻塞 → `ARKUI_PICK_FILES/ARKUI_PICK_SAVE`
env 或默认 vfs `demo.txt`/`saved.txt` 注入确定性结果；用户交互形态下走真实系统对话框。

**验收**：`bash electron/run.sh pickerdemo`（6 条断言）——doc select 返回 `file://` uri、
save 返回 saved.txt 结尾 uri、photoUris 形；浏览器端降级 4/4（空数组形）。

**一次真机语义纠偏（契约对齐）**：首版 main IPC 端返回 `{uris:[...]}` 包装——与真机
`Array<string>` 错位，渲染侧 `.then((uris)=>uris.join)` 收对象抛 TypeError（3 FAIL 实测）。
修正为 IPC 返回裸数组、photoUris 包装收敛在渲染侧垫片。教训：**IPC 返回形必须逐个对
d.ts 返回类型，不能自造包装**。

**触及**：`runtime/ohos-shims.js`（picker 垫片）、`electron/preload.js`（fileDialog 桥）、
`electron/main.js`（dialog 执行端 + 测试注入）、`harmony-proj/.../PickerDemo.ets`（新，
`@kit.CoreFileKit` 导入）+ `main_pages.json`、`fixtures/pages/PickerDemo.ts`（固化）、
`test/pickerdemo.html`（新）、`run.sh` + `electron/run.sh`（接线）、`docs/ROADMAP.md`

---

### R83 — 桌面线：@ohos.window v2（全屏/常亮/属性查询）✅（2026-09-26）

**内容**：window 垫片扩 v2 能力面（语义对齐 d.ts 实名）：`setFullScreen(isFullScreen)`
（`setWindowFullScreen` 为别名）、`setWindowLayoutFullScreen`（桌面单窗等价全屏）、
`setKeepScreenOn`（桌面无屏幕常亮语义 → 降级为窗口置顶，注释声明）、
`getWindowProperties()` → `{width,height,x,y,isFullScreen,isMaximized}`（主进程真实值）、
`getWindowAvoidArea`（桌面单窗无系统栏 → 全 0 区 + 日志声明，不预造假数据）。

**验收**：`bash electron/run.sh windowdemo`（13 条断言：R83 时 7、R91 起 13）——
`setFullScreen(true)` 后 `isFullScreen` **回读真实值**（主进程 `win.isFullScreen()`）。
fixture 与真产物逐字节一致（diff 验证）。

**触及**：`runtime/ohos-shims.js`（window v2）、`electron/main.js`（setFullScreen/
setKeepScreenOn/getProperties 执行端）、`harmony-proj/.../WindowDemo.ets`（+fullscreen 按钮）、
`fixtures/pages/WindowDemo.ts`（同步固化）、`test/windowdemo.html`（+2 断言）、
`docs/ROADMAP.md`（本节）

---

### R84 — 骨架批量转真语义：platform 分片 10 个 + 分派通用化 ✅（2026-09-26）

**内容**：33 个"仅 data-*"骨架的语义判定收官。**10 个有合理 DOM 对应物** → 新分片
`runtime/src/batch-platform.js` 转真语义：ArcSwiper（Swiper 子集+pop 收子）、ArcListItem
（autoScale/swipeAction）、ArcScrollBar（thumb 比例驱动）、ArcAlphabetIndexer（R60 同构+
usePopup）、DotMatrix（5×7 字形点阵 + text/dotSpacing）、MediaCachedImage（img 同构 + 
objectFit/renderMode/onComplete）、LocationButton/PasteButton/SaveButton（安全按钮三件套：
d.ts 默认样式 + onClick 直通 + Options 样式段）、Skeleton2d（脉冲骨架条）。**其余 23 个**
（Camera/Component3D/Particle/RemoteWindow/Plugin/UIExtension/Embedded/Security/Ability/
Form 系/Screen/WindowScene/RootScene/Isolated/Dynamic/Effect/ContentSlot/NodeContainer/
Piece/WithEnv/Distortion/Depth 等）平台特定、无合理 DOM 对应物——**保持骨架**（硬转=造假，
R72/R48 方法论）。

**分派架构改进**：area.js 不再为每张表硬编码分支——分片以 `__arkuiPlatform` 标记 +
`__platformAttrs` 表挂节点，area.js 一条通用分派（后续同类扩展零改 area.js）。

**验收**：`bash electron/run.sh batchverify`（R84 时 62 条；R87 起含 platform 行为段共 86 条）——
双端全绿；绊网确认 10 个新实现全部走手写分片不落 generated 兜底。

**类型化过程坑（坑 92 同族再现）**：`const st = { onSelect: null }` 在 strictNullChecks 下
窄化为 `null`，后续 `st.onSelect(i)` 报 TS2349 never-callable——修法整袋收类型（坑 93）；
另外 JSDoc 放在"赋值表达式语句"之前不附着到箭头参数，必须内联在参数表前。

**触及**：`runtime/src/batch-platform.js`（新分片）、`runtime/src/main.js`（@include）、
`runtime/src/area.js`（platform 通用分派）、`test/batch-verify.html`（P 组 10 条）、
`docs/ROADMAP.md`（本节）

---

### R86 — 优化器全量毕业：默认开启 + createBlock 活引用修复 ✅（2026-09-26）

**内容**：`--optimize` 翻为 extract.mjs **默认开启**（`--no-optimize` 退出阀）——优化器从
"3 页验证"毕业为全管线默认。首跑全量门禁即抓出一个潜伏 bug，随后全绿。

**首跑抓出的真 bug（坑 99）**：index 页 5 条静态属性全丢（空守卫）。根因：定制版 TS 4.9 的
`ts.factory.createBlock(arr)` 对传入数组持**活引用**（`createNodeArray` 不拷贝，合成节点
场景实测），事后 `statics.length = 0` 原地清空把已建守卫块的语句一起清掉。修复 = 重绑定
（`statics = []`）。三个性能页守卫实测全部有内容（空守卫 0）——其收益是真实守卫，不是属性
删除；幸存纯因节点来源/访问次序差异。**全量推广正是抓这类潜伏 bug 的正确手段**。

**顺带修正（坑 100）**：PERF6 采集正则 8 组却引用 `${m6[9]}` → §6 曾固化"（undefined 节点…"
且两端一致过守门——undefined 字样即采集断链，组号修正后 "350 节点" 就位。

**验收**：`npm run check` 7/7（browser all + electron all 全部用例在优化管线下通过）。
§6 数字为优化管线口径（单跑含噪声，阈值断言为准）。

**触及**：`tools/extract.mjs`（默认翻转）、`tools/arkui-optimizer.mjs`（活引用修复）、
`tools/stats.mjs`（组号修正）、`docs/DEVELOPING.md`（坑 99/100）、`docs/ROADMAP.md`（本节）

---

### R87 — 行为级断言加深：platform 分片 24 条行为语义 ✅（2026-09-26）

**内容**：batchverify 增第三段——platform 分片 10 组件的**行为语义**断言（runtime-only，
真实组件栈驱动：create 压栈 → 属性经 applyAttr 分派 `__platformAttrs` → pop 收尾）。
ArcSwiper（pop 收子/index 显隐切换/duration→CSS/onChange 注册）、ArcAlphabetIndexer
（3 项渲染/点击→onSelect/选中高亮/selected 程序高亮）、DotMatrix（text→30 点/字形 A
首行 010 灭亮灭/dotSpacing→gap）、MediaCachedImage（src 落 img/objectFit→CSS/renderMode
反色）、安全按钮三件套（data 标识/onClick 触发/样式落点/独立回调不串扰）、Skeleton2d
（脉冲动画/keyframes 注入）、ArcListItem（autoScale/swipeAction 处理器）、ArcScrollBar
（thumb/比例→top）。

**测试侧坑（2 个，断言自身的问题）**：① `ensureComponent` 返回的组件是 **Proxy**——
`create()` 的返回值才是 DOM 节点；对 Proxy 读 `.style` 得 undefined（`.indexOf` 直接炸），
所有节点级读取必须用捕获的 create 返回值；② `VSP.restore(snap)` 之后栈已空，属性调用
`applyAttr(top=null)` 静默丢弃——restore 后的属性走 `node.__platformAttrs[prop](node, v)`
同路径直调。

**验收**：`bash run.sh batchverify` 86/86 双端（86 = 结构 47/绊网 1/语义 14/行为 24）。

**触及**：`test/batch-verify.html`（第三段 +24）、`docs/ROADMAP.md`（声明 62→86 + 本节）

---

### R88 — 桌面语义：startAbilityForResult 的 callee 跑在真第二窗口 ✅（2026-09-26）

**内容**：桌面线 IPC 模板第四落地。`context.startAbilityForResult(want)` 在 Electron 下
（`want.parameters.desktopPage` 显式指定 callee 页 + 宿主有桥）走**真第二 BrowserWindow**：
caller 渲染进程 → preload `abilityStart` → 主进程开 callee 窗（同 preload，URL 追加
`__arkui_ability=1` 标记）→ callee 页在自己的进程里跑完整生命周期 → `terminateSelfWithResult`
经 `terminateEntry` 检测桌面 callee 标记 → IPC 回传 caller webContents → caller 的 Promise
resolve + 主进程关 callee 窗。浏览器端无桥 → 探测式降级走既有 overlay 路径（R20 语义不变）。

**语义保真要点**：callee 的 `onWindowStageDestroy/onDestroy` 在**本地**照常跑（生命周期
忠实），只有结果交付与关窗走主进程；desktopTerminate 日志记在 callee 进程（随窗口销毁），
caller 侧的 `desktopResult` 记录即"走了 IPC 终结分支"的证据（overlay 路径不会产生它）。

**验收**：`bash electron/run.sh abilitydesktop`（10 条断言）——desktopStart/desktopResult
日志、resultCode 0、**picked=demo.txt 跨进程回传**、callee 生命周期证据（lifecycle=callee
由 callee 页 terminate 发出）、caller 结果后仍可交互、第二次顺序启动复用；浏览器端降级
10/10（overlay 子由测试驱动终结）。

**调试过程三个教训（全部入档为测试页注释）**：① 浏览器端挂起守卫吃满
`--virtual-time-budget` 会冻结虚拟时间（后续 tick 永不触发）→ 守卫时长分端
（浏览器 1200ms/Electron 8s）；② 竞速结构里**驱动 Promise 不能进 race**（80ms 必 settle
会抢跑 hung:true）——驱动并发运行、race 外 await；③ context 走**构造器**
（`new AbilityClass(context)`，同真机 `this.context`），`onCreate(want)` 第一参是 want。

**触及**：`runtime/src/ability.js`（desktop 路径 + terminateEntry 桌面分支）、
`electron/preload.js`（abilityStart/Terminate/onAbilityResult）、`electron/main.js`
（callee 窗口创建 + 结果转发）、`test/ability-desktop.html`（caller）+
`test/ability-callee.html`（callee）、`run.sh` + `electron/run.sh`（接线 + page_of）、
`docs/ROADMAP.md`（本节）

---

### R89 — @ohos 能力长尾：deviceInfo / i18n / pasteboard ✅（2026-09-26）

**内容**：三个常用平台模块按权威 d.ts 落地，取值不造假：
- **deviceInfo**：宿主真值（Electron 走 preload `node:os`——osFullName='Linux 7.0.0-34-generic'
  实测；浏览器走 navigator 派生降级值）+ SDK 对齐常量（sdkApiVersion/firstApiVersion=26、
  osReleaseType/buildType='Release'，出处 `<CLT>/sdk/.../ets/oh-uni-package.json`）；
- **i18n**：宿主 Intl 真值（渲染进程与浏览器同源，零 IPC）——getSystemLanguage/Locale/Region；
- **pasteboard**：Electron 真系统剪贴板（`clipboard` 模块**仅主进程可用**——preload 直调
  实测静默失败，走 R74 IPC 模板到主进程）；浏览器 headless 无剪贴板权限 → 进程内 Map
  兜底（限制已记录）。

**验收**：`bash electron/run.sh sysapi`（11 条断言）——osFullName 真值、apiVersion=26、
i18n 与 navigator.language 一致（zh/zh-CN/CN）、剪贴板写读回环（真系统剪贴板）、覆盖写、
clipboard 真值联动；浏览器端 11/11（兜底形）。

**两个坑**：① 桥名错位（preload `electronAPI.clip` vs 垫片 `__arkui_dom_clip`）——块级
作用域里 `eapi` 不可见导致 ReferenceError；② **同步调用异步桥**（桥改 IPC 后 readText 返回
Promise，断言少 await）——静默变成字符串比较恒假。

**触及**：`electron/preload.js`（sysInfo/clip 桥）、`electron/main.js`（clip IPC 端）、
`runtime/ohos-shims.js`（三模块垫片）、`test/sysapi.html`（新，11 条）、
`run.sh` + `electron/run.sh`（接线）、`docs/ROADMAP.md`（本节）

---

### R90 — 千节点真实应用样例：NotesDemo 端到端 ✅（2026-09-26）

**内容**：集成度里程碑——一个"真应用"（备忘录）串起全部能力面：**300 行 ForEach 列表
（1208 个 DOM 组件节点）** + router 多页（Home→Detail 带 params）+ @State 搜索过滤 +
pasteboard 剪贴板（Electron 真剪贴板）+ deviceInfo 进页面 + 返回后状态保持。两页走
**真编译链**（kit 导入：@kit.ArkUI router / @kit.BasicServicesKit pasteboard+deviceInfo），
ListItem 走 ets-loader 的 deepRender 产物形态（itemCreation/itemCreation2/deepRenderFunction
三函数——首次被真实产物触发并验证）。

**验收**：`bash electron/run.sh notesdemo`（16 条断言：R90 时 11、R92 起 +5）——首渲染同步 23.0ms（1208 节点）、
pasteboard→真剪贴板（Note 0 正文）、搜索 Note 299→count=1→清空→300、路由详情 idx=0
（params 传递）、back 后 300 行状态保持；浏览器端 11/11（内存兜底 + navigator 派生
deviceInfo）。PERF7 进 §6（信息口径）。

**顺手修一个真运行时 bug**：`forEachUpdateFunction` 调 itemGen 只传 `(item)`——真机
itemGenerator 签名是 **(item, index)**，ets-loader 产物的 itemGen 第二参（NotesHome 的
pushUrl params 用它）一直是 undefined。修复后传 `(item, i)`。这个 bug 藏了 90 个切片：
此前没有任何用例在 itemGen 里用 index。

**触及**：`harmony-proj/.../NotesHome.ets` + `NotesDetail.ets`（新）+ `main_pages.json`、
`fixtures/pages/NotesHome.ts` + `NotesDetail.ts`（固化）、`test/notesdemo.html`（新，11 条）、
`runtime/src/main.js`（ForEach index 参数）、`run.sh` + `electron/run.sh`（两模块接线）、
`docs/ROADMAP.md`（本节）

---

### R92 — NotesDemo 集成深化：保存到文件 + PasteButton 粘贴流 + 坑 97 现行犯修复 ✅（2026-09-26）

**内容**：真实应用继续长厚——两个新用户流：**保存到文件**（picker.save 测试驱动返回 uri →
fs fd 系 openSync/writeSync/closeSync 落盘 vfs，真盘 note-0.txt 实测 28B）+ **PasteButton
粘贴流**（剪贴板 getPrimaryText → concat 新笔记，与 R89 pasteboard/R84 PasteButton 配套）。
真编译器两次教学：fs 在 CoreFileKit 里叫 `fileIo`（直导 `@ohos.file.fs`）；文本访问器是
**PasteData.getPrimaryText()**（Record 上没有）——垫片 record 形状同步对齐。

**坑 97 现行犯（本片最大收获）**：粘贴流首跑出现"幽灵笔记"——**点任何列表行都会触发粘贴**。
栈级定位（getData 调用栈 + isConnected）：Row 是 PasteButton 的**后代**——R84 安全按钮工厂
**没打 `__arkuiLeaf` 标记**，编译产物叶组件无 `.pop()` → PasteButton 常驻栈顶 → 后续 300 行
列表全部挂进按钮内部 → 行点击冒泡穿过按钮。修复 = R84 全部叶组件补标记（6 处：ArcScrollBar/
ArcAlphabetIndexer/DotMatrix/MediaCachedImage/安全按钮三件套/Skeleton2d；ArcSwiper/ArcListItem
保持容器语义）。**坑 97 的判据（"连建两个兄弟"）在真实页面才踩得到——结构断言抓不到，这正是
端到端样例的价值。**

**验收**：`bash electron/run.sh notesdemo`（16 条断言：R90 时 11、R92 起 +5）——save 流
file:// uri + fd 落盘（statSync size=28）、PasteButton → count=301 → Pasted 300 行在列、
粘贴正文与剪贴板一致（相对断言防外部剪贴板干扰）；浏览器端 16/16（picker 降级 null +
localStorage 后端落盘）。

**触及**：`harmony-proj/.../NotesHome.ets`（+save/paste 流）+ fixture（逐字节同步）、
`runtime/src/batch-platform.js`（叶标记 ×6）、`runtime/ohos-shims.js`（record
getPrimaryText 对齐）、`test/notesdemo.html`（+5）、`docs/ROADMAP.md`（本节）

---

### R93 — 行为断言二批：input/media/nav 关键语义 ✅（2026-09-27）

**内容**：`test/batchbehavior.html`（新）——batch-input/media/nav 三分片组件的
行为语义（真实组件栈驱动，属性在栈活时经 applyAttr 分派）。覆盖：CheckboxGroup（原生
checkbox 母框 + onChange 注册）、PatternLock 点阵、Option、SymbolGlyph fontSize→CSS、
Web/RichText iframe 形态、ImageSpan img 形态、NavRouter/Navigator target 登记、
PageTransitionEnter duration、SpringProp/ScrollBar/GeometryView 可建。

**接线与上下文先例**：无模块用例的 build 上下文用 **NotesHome loadRoute**（R90 已注册
路由；`pages/Index` 未注册会报"未注册的路由"）；EntryAbility 模块仅注册 ability 类不注册
路由（实测教训）。属性调用必须在 **VSP.restore 之前**（restore 后栈顶 null，applyAttr
静默丢弃——与 R87 同族坑）。

**验收**：`bash electron/run.sh batchbehavior`（15 条断言）+ `bash run.sh batchbehavior`
双端 ALL PASS。

**触及**：`test/batchbehavior.html`（新，15 条）、`run.sh` + `electron/run.sh`（接线）、
`docs/ROADMAP.md`（本节）

---

### R94 — 行为断言三批：func/motion/layout 关键语义 ✅（2026-09-27）

**内容**：`test/funcbehavior.html`（新）——batch-func/motion/layout 分片的
行为语义（NotesHome 作 build 上下文，属性在栈活时经 applyAttr 分派）。覆盖：
IndicatorComponent（count=4/initialIndex 入状态 + 指示点渲染）、Calendar（__calgrid
状态袋 + onSelectedChange 挂接）、ScrollBar（scrollBarColor→thumb 背景与 dataset 记录）、
FolderStack（onFolderStateChange 注册）、GridContainer/Sheet 标识、Animator/GeometryView。

**验收**：`bash electron/run.sh funcbehavior`（11 条断言）+ `bash run.sh funcbehavior`
双端 ALL PASS。

**触及**：`test/funcbehavior.html`（新，11 条）、`run.sh` + `electron/run.sh`（接线）、
`docs/ROADMAP.md`（本节）

---

### R96 — 仓颉内核挂载路径定型：独立 ELF + stdio（spike 实证）✅（2026-09-27）

**内容**：桌面线第五能力——自研仓颉内核的挂载路径。互操作协议**由本项目自定义**（不依赖
华为 cjffi/ark_interop——那套绑定 PandaVM 的 JSContext/JSRuntime，本运行时无 PandaVM）。
spike 实测（`tools/cjk-spike/`，cjc 1.1.3 cjnative）：`@C` 导出产生无 mangling 的 C ABI
符号（`T kernelAdd`），但 **dylib 不内嵌仓颉运行时初始化序列**——外部进程 dlopen 直调
SIGABRT（`runtime != nullptr`，预载 std-core/runtime 库同样崩）。独立 ELF 自带完整初始化
（`hello` 直接跑通）。

**定型（R96.2 修正）**：**进程内 C ABI 可行且官方支持**——`libcangjie-runtime.so` 以
`MRT_EXPORT` 导出完整初始化序列（`InitCJRuntime` → `LoadCJLibraryWithInit` →
`FindCJSymbol` → 直调 @C 导出函数，全序列实测通过，仓颉 GC 线程真实启动）。
R96 首测崩溃系**跳过官方初始化直接调函数**所致，非不可用。
独立 ELF + stdio 保留为隔离场景选项。`@ohos:cjk` 垫片（主进程一次性 InitCJRuntime +
按需直调导出函数）挂载契约就此齐备，待内核用途定义后立项。

**参考实现核验（R96.1，2026-09-27）**：
- **trha**（Haskell 微内核 agent harness，GHC/cabal + Electron+React 壳）——与"仓颉内核 +
  Electron 壳"完全同构，宿主契约照抄：spawn 内核子进程 + **stdout 首行版本化 JSON 握手**
  （不符拒启）+ 日志只走 stderr + **stdin 作为租约**（关即优雅退出）+ env 传令牌/端口；
  数据面为 HTTP/SSE（servant）——v1 用 stdio 行 JSON，内核长大后升级 HTTP/SSE 有先例；
- **deepseek-harness-rc2**（Cordis 插件架构）：experimental/webworker-runtime 的**初始化
  门控**（模块 ready 前禁止调用）+ zstd WASM 模块 = "原生编译→WASM 进程内挂载"实例——
  但 cjc 无 WASM 后端，此路对仓颉仍是触发条件；
- **GHC 类比确认**：GHC 的 foreign export + hs_init/hs_exit 正是"AOT 语言 + 富 RTS 被外部
  宿主调用"的教科书方案——仓颉 dylib 缺的就是公开的 hs_init 等价物。GHC 先例证明这不是
  语言级不可能，而是**工具链公开承诺缺口**（与 R96 触发条件同构）；
- **官方文档核验（1.2.0 在线文档 + FFI/cangjie-c 页）**：@C 导出规则与 CDECL 调用约定
  与本项目实测一致；CString 所有权（mallocCString+显式释放）与混合宿主三条约束（fork/
  进程退出/阻塞）为 dylib 挂载的落地边界；1.2.0 无宿主嵌入 API 条目；**新增 OHOS 版
  仓颉 SDK（鸿蒙 PC）**确认 2in1 方向为官方在推；**1.1.x STS 2026.10.30 停止维护**——
  本机 1.1.3 需升级 1.2.0（本地已有）。

**触及**：`tools/cjk-spike/`（kernel.cj / test_ffi.c）、
`docs/research/cjk-spike.md`（新）、`docs/ROADMAP.md`（本节）

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

### R24 收口 — 原生渲染路径终审：previewer 实证 + 决策归档 ✅（2026-09-26）

**内容**：SDK 预览器目录（401MB Linux 原生栈：libace_compatible/libark_jsruntime/libskia_canvaskit/
libglfw + 28 组件 .so + 15 框架 .abc）被发现后，"生产渲染走原生还是留在 DOM"悬而未决。
本轮三条独立证据链一次钉死，归档为渲染路径决策记录。

**结论（一句话）**：**留在分支 B（ets-loader 的 ViewPU .ts → `extract.mjs` 剥类型 → DOM 运行时），
不再分叉**。previewer 原生栈不复刻、不嵌入，只作语义参考；`.abc`/PandaVM 线结案。

**三层证据（互相独立、结论一致）**：

| 层 | 证据 | 判决 |
|---|---|---|
| 工具链 | es2abc（=es2panda 同一二进制，在 ets-loader/bin/ark/build/bin/）输出只有 `.abc`（`--output`/`--base64Output`），无任何 JS 输出模式；`--branch-elimination`/`--opt-level 0\|1\|2`/`--opt-try-catch-func` 全是字节码级优化只活在 `.abc`；`ark_disasm` 只出 `.pa` 文本汇编；`.abc` 的 `--debug-info` 是字节码→源码行列映射（给调试器/VM）——**"从 .abc 反推优化后 JS"的通路不存在** | 分支 A（吃 .abc）＝嵌 35MB libark_jsruntime.so：养第二个 JS 引擎＋重建 NAPI 桥＋重接全部 ViewPU 协议，工作量一个数量级 |
| 实测 | 按逆向出的启动契约真机点火：约 30 项参数校验全过 → **GLFW 窗口在 `:0` 真实创建（720×1280）** → SIGSEGV 崩在 `RSUIContextManager` 构造（librender_service_client.so 的 WindowImpl 内，Rosen 窗口服务绑定缺失），发生在用户 JS 装载之前 | previewer 独立启动**死在窗口管理层**——"缺正式 Linux 平台化（窗口/输入/生命周期由宿主提供）"从理论判断升级为实测证据；当 oracle 都要先修它的窗口层（厂商调试范畴，不投） |
| 源码 | `arkui_ace_engine/adapter/preview/entrance/ace_container.cpp` include `bridge/declarative_frontend/…`，走 `FrontendType::DECLARATIVE_JS` + JSI 的 `ark_js_runtime.cpp`（Panda 后端）：预览器加载的用户代码**就是 ets-loader 的产物**，与本项目 `extract.mjs` 吃的是同一批文件；区别只在"ViewPU 协议的服务端"（C++ 组件树+Skia vs 浏览器 DOM） | 两个实现同一协议——语义对照（真机 C++ 源码）持续有效；字节码级编译优化打不到 DOM 解释架构的瓶颈（DOM 操作与布局），收益属于"渲染也原生"那条已否决的路线 |

**可复现命令（启动契约已归档）**：

```bash
CLT=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
BIN=$CLT/sdk/default/openharmony/previewer/common/bin
mkdir -p /tmp/arkpreview && ln -sf $CLT/emulator/libz.so /tmp/arkpreview/libshared_libz.so  # 唯一缺失依赖
export LD_LIBRARY_PATH=/tmp/arkpreview:$CLT/sdk/default/hms/toolchains/lib:$BIN
PROJ=/data/training/cli/arkui-dom-runtime/harmony-proj
timeout 40 $BIN/Previewer \
  -j $PROJ/entry/build/default/intermediates/loader/default \
  -abp $PROJ/entry -arp $PROJ/entry \
  -ljPath $PROJ/entry/build/default/intermediates/loader/default/loader.json \
  -device phone -or 720 1280 -cr 360 780 \
  -n ArkUIProbe -projectPath $PROJ \
  -sid $(python3 -c "import uuid;print(uuid.uuid4().hex)") \
  -url pages/Index
# 期望：约 30 项 Is*Valid 全 INFO → "glfw window" 720x1280（xwininfo -root -tree 可见）→
#       [JsEngine Crash] signal 0xb @ RSUIContextManager（R24 收口阶段的已知终点）
```

契约要点：`-j` 是**目录**（JS 应用资产根）不是 JSON 文件（反汇编 `IsAppPathValid`：
`IsSet("j")`→`IsDirectoryExists`）；`-or/-cr` 各跟 **2 个独立 argv**（源码 `Register("-or", 2, …)`）；
`-sid` 匹配 `^[a-fA-F0-9]+$` 纯 hex。全部 40 个旗标与 3 条校验正则见
`/data/work/compiler/Ark/ide_previewer/util/CommandParser.{cpp,h}` 的 `Register(...)`。

**技术资产（语义参考新金矿）**：`ide_previewer` 全套 C++（`jsapp/rich/JsAppImpl.cpp` 展示官方
"JS 应用装载"链路 `SetAssetPath → AceAbility::CreateInstance`）；`arkui_ace_engine/frameworks/
bridge/declarative_frontend/engine/jsi/`（`jsi_bindings.inl` 绑定表；`jsi/*_bridge.cpp` 组件桥——
"JS 调用如何落到 C++ 语义"的中间层，排查事件时序/属性优先级时可能比 pattern 层更直接）；
`cj_frontend` 181 个 cpp＝仓颉 ArkUI 前端完整成体系（配合 `arkui_napi` 的 cjffi/ark_interop 胶水）。

**版本漂移旁证**：本地开源 ide_previewer 源码直连 GLFW；SDK 26 二进制的 libpreviewer_window.so
已改走 Rosen Window 抽象——同产品代际间窗口层重构，"ABI 不承诺稳定"的活标本。

**触及**：无运行时代码改动（纯调研归档）；`docs/ROADMAP.md`（本节 + 明确不做表加一行）、
`docs/ARCHITECTURE.md`（§4.21 架构测绘 + §9 参考表）

---

## 明确不做

| 不做 | 理由 |
|---|---|
| 重写 `.ets` → `.ts` 转换 | 官方 `ets-loader` 就是规范；自己发明一套语义会和设备分叉 |
| 像素级复刻原生渲染 | 字体/光栅化是平台能力，不是本项目目标；目标是**语义与布局**可用 |
| 实现 `.abc` 解释器 | ArkVM 存在且可用；本项目走 JS 路径 |
| 复刻/嵌入 previewer 原生栈（PandaVM/Skia/GLFW 二进制） | R24 收口三层证据钉死：es2abc 无 JS 输出、独立启动崩在窗口管理层、声明式前端与我们同一协议同瓶颈；性能杠杆在运行时内部（DOM 操作削减/布局批处理），不在字节码级优化 |
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
