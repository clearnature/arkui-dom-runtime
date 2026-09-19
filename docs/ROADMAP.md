# ArkUI DOM Runtime —— 路线图（原子任务）

本文是**待办**的唯一权威清单。每项都写成"一个可独立完成、可独立验收的原子任务"，附**可复现的验收命令**。

已完成的机制说明见 `docs/ARCHITECTURE.md`；怎么改见 `docs/DEVELOPING.md`。

**当前状态**：`npm run check` 全绿（preflight + 生成物一致 + 浏览器 14 用例 + Electron 13 用例）。
v2 状态管理已落地。**下一步优先级：R5（许可证，需决策）→ R9/R10（Grid、Tabs 真实语义）→ R14（多层锚链）。**

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
| ③ | **状态管理 v2**（`ViewV2` + 11 个装饰器） | `bash run.sh v2`（26 条断言，浏览器 + Electron 双通过） |
| ③ | `@ohos:*` 别名层 + CommonJS 装载 + 真 fetch | `bash run.sh async` |
| ③ | `UIAbility` 启动链路 | `bash run.sh ability` |
| ③ | `router` 页面栈（返回时保留状态） | `bash run.sh router` |
| ③ | **真落盘**（Electron Node fs + shell 级验证） | `bash electron/run.sh persist` |
| ②.5 | CLT 缺库补齐（`libhilog.so` / `libshared_libz.so`） | `/data/training/cli/arkts-shim/README.md` |
| **P0** | git 仓库 + `.gitignore`（287 MB → 跟踪 484 KB） | `git log`，`git ls-files` |
| **P0** | 环境 preflight 自检 | `npm run preflight` |
| **P0** | 统一验收门禁（退出码可信） | `npm run check`；制造漂移 → exit 1 |
| **P0** | `--check` 真正只校验不落盘 | `node tools/gen-components.mjs --check` |

当前：**浏览器 14 用例 + Electron 13 用例全绿**（`npm run check` → `exit 0`）。

---

## 1. 排序原则

按 **① 工程化地基 → ② 解锁页面最多的语义 → ③ 能靠测试锁死的增量** 排。

**为什么工程化排第一**：本项目现在**不是 git 仓库**，287 MB 里 283 MB 是解压的 Electron。在这种状态下，"完成"不可审计、"回归"不可复现、改动不可回滚——任何功能进展都无法被确认为可信。地基必须先补。

**为什么"能靠测试锁死"是硬门槛**：这个项目已经出现过 4 次"测试通过但结论是假的"（`grep 'ALL PASS'` 匹配到 `<script>` 源码、纯白图被判非空、404 页面读空串全通过、负向断言被后续实现静默失效）。**任务若不能写成可复现的断言，就不该进这个清单。**

优先级速览：

| | 任务 | 影响 | 成本 |
|---|---|---|---|
| P0 | ~~R1–R4 工程化地基~~ **已完成** | — | — |
| P0 | **R5 许可证与 CHANGELOG** | 低但**阻塞对外发布**，且需决策 | 低 |
| P1 | ~~R6–R8 状态管理 v2~~ **R6/R7 已完成**，R8 待做 | 高 → 已拿到 | — |
| P2 | R9–R13 组件视觉语义 | 中（85 个骨架只有 `data-*`） | 中 |
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

### R5 — `LICENSE` + `CHANGELOG.md`

**内容**：定许可证 + `CHANGELOG.md`（Keep a Changelog 格式）。

**⚠️ 需要项目所有者决策**：本仓库**复用 HarmonyOS CLT 的组件元数据与产物形态**
（`fixtures/` 是 `ets-loader` 的输出，`generated-components.js` 由 CLT 的 JSON 生成）。
自研部分（`runtime/`、`tools/`）的授权需要与"对官方工具链产物的依赖"区分说明。
**不在代码里替用户选许可证。**

**依赖**：无。

**验收**：文件存在；`CHANGELOG.md` 含 `## [Unreleased]`；`LICENSE` 与 `docs/ARCHITECTURE.md` §9 的依赖说明一致。

**触及**：`LICENSE`、`CHANGELOG.md`（新）、`README.md`

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

### R8 — `@Observed` / `@ObjectLink`（**v1** 的深度观测）

**内容**：v1 的 `@Observed` 类 + `@ObjectLink` 引用——目前 `ForEach` 只在**数组长度变化**时重建，
元素内部字段变更不触发重渲染。v2 的 `@Trace` 已具备等价能力（见 R7），但 **v1 语法路径仍缺**。

**依赖**：无（`ViewPU` 一侧，与 v2 实现互不干扰）。

**验收**：新断言——v1 页面里改 `arr[2].name`（长度不变）必须触发重渲染。
**当前会失败，实现后通过**（先确认它会失败，再实现——否则说明断言没测到东西）。

**触及**：`runtime/arkui-dom-runtime.js`（`forEachUpdateFunction` / 新增 v1 深度观测）、`test/rich.html`

---

## P2 组件视觉语义

> 现状：85 个组件"能建出节点但视觉上是个 `div`"。按**真实页面出现频率**挑，不按字母表刷。

### R9 — `Grid` / `GridItem` 真实布局

**内容**：`columnsTemplate`/`rowsTemplate`/`columnsGap`/`rowsGap` → 真实 grid 轨道；`GridItem` 落入正确轨道。

**验收**：断言 `getComputedStyle(grid).gridTemplateColumns === '1fr 1fr'` 且子项实际占位宽度符合 2 列。

**触及**：`runtime/arkui-dom-runtime.js`、`test/components.html`

### R10 — `Tabs` / `TabContent` 切换

**内容**：`Tabs({barPosition})` + `TabContent().tabBar(...)` 的切换语义（当前骨架能建节点但无切换）。需要 `TabsController`。

**验收**：断言初始只显示第 0 个 `TabContent`；调 `controller.changeIndex(1)` 后显示第 1 个、第 0 个隐藏。

**触及**：`runtime/arkui-dom-runtime.js`、`test/components.html`

### R11 — `Swiper` 轮播

**内容**：`Swiper({index, autoPlay, loop, indicator})` 的当前页/切换/指示点。

**依赖**：R10（共享"多子项只显示一个"的机制，先抽出公共实现）。

**验收**：断言初始页、`controller.showNext()` 后页索引变化、指示点数 = 子项数。

### R12 — `Navigation` / `NavDestination`

**内容**：栈式导航（目前只有 `router` 页面栈，`Navigation` 组件本身无栈语义）。

**依赖**：无。

**验收**：断言 push 后 `NavDestination` 出现、pop 后消失且**状态保留**（同 `router` 的断言风格）。

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
