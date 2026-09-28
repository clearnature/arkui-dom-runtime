# R120 — 剩余骨架组件批量判定（11 枚）

> 方法论与格式对齐 `R48-platform-verdicts-and-digests.md`（feasible / partial /
> platform-only / not-found 四档）。三源核验：SDK d.ts（公开 API）→ 真机
> `arkui_ace_engine` pattern 源 → DOM/Electron 可行性。产出：本表 + 各组件落法建议。
>
> 范围来源：元数据 149 组件 − `stats.mjs` HANDWRITTEN 125 = 24 骨架；其中 13 枚
> R48 已判 platform-only（终态=保留骨架即正确行为），本文件补齐**其余 11 枚**。

## 汇总表

| # | 组件 | 判定 | 一句话理由 |
|---|---|---|---|
| 1 | Camera | **not-found** | 声明（无 d.ts）与声明式实现（无 pattern / `CAMERA_ETS_TAG` / js_camera，`devicePosition` 全仓 0 命中）双缺失——仅 json 元数据 + 无障碍桩 + 异框架 lite 引擎相机组件，无从建映射 |
| 2 | Component3D | **platform-only** | Kit-3D/Render3D 场景图 + 着色器管线 + 原生渲染表面（`js_sceneview.cpp:247-294`、`component3d_modifier.cpp:44-58`）；WebGL 重写≠DOM 语义映射 |
| 3 | DistortionComponent | **platform-only** | 系统合成器 SDF/桶形畸变前景滤镜（`distortion_component_pattern.cpp:53-67` → `rosen_render_context.cpp:9239`）；systemApi 未公开，DOM 无逐像素畸变语义 |
| 4 | EffectComponent | **platform-only** | RS 合成器特效图层 `SetCompositeLayer(zOrder)`（`effect_component_pattern.cpp:59-69`）；attrs 空、由 sheet/title_bar 内部创建，DOM 无对应 |
| 5 | Particle | **platform-only** | GPU 粒子系统在 RenderService 合成进程内（`rosen_render_context.cpp:1840-1858`）；DOM 无粒子元素，canvas/WebGL 属重写渲染（XComponentNode 同判词） |
| 6 | Screen | **platform-only** | 物理/虚拟显示屏会话挂树 + 向 MMI 注册显示信息（`screen_pattern.cpp:65-95,130-180`）；systemApi，浏览器 `window.screen` 是只读对象无挂载语义 |
| 7 | DynamicComponent | **platform-only** | UIExtension 跨进程会话 + ABC/worker 动态加载 + 输入/无障碍跨运行时转发（`js_dynamic_component.cpp:83-162`、`dynamic_component_renderer.h:40-98`）；与 R48 IsolatedComponent 同族，全 SDK d.ts 0 命中 |
| 8 | Piece | **feasible** | 语义=图标+文本+删除按钮的标签（`piece_component.cpp:49-66,190-215`），div/span + ✕ button 全映射；**附注**：未公开声明且 `CreateModel()` 返回 nullptr（`piece_loader.cpp:38-41`）——落地前须核实 hvigor 产物是否真生成 `Piece(...)` 调用，否则维持骨架 |
| 9 | ContentSlot（R48 partial 细化） | **partial** | 挂载点与 Attach/Detach → appendChild/insertBefore/removeChild + 生命周期回调可行；缺原生 C 层 `ArkUI_NodeHandle` 节点图与句柄注册（`content_slot_model_ng.cpp:23-33`、`content_slot_node.h:49-66`） |
| 10 | WithEnv（R48 partial 细化） | **partial** | 可写键（`DIRECTION`/`FONT_SCALE`/`customEnv`）与 `env()` 装饰器可全量映射 `dir`/rem/CSS 作用域；只读窗口键仅能近似，`DISPLAY_ID`/`SYSTEM_DENSITY`/`IS_FOCUSED`/`IS_HIGHLIGHTED` 无 DOM 对应（`with_env_node.cpp:76-87` 是可写/只读分界） |
| 11 | ArcList | **partial** | 纯布局数学可 JS 复刻——中心 1.08 → 边缘 ≈0.41 的三次缩放 + translateY（`arc_list_layout_algorithm.cpp:46-62,618-623`，全程无三角函数）；缺 digitalCrown 表冠/触觉、`ScrollBarShape::ARC` 圆弧滚动条、链式弹簧 |

**分布**：not-found 1、platform-only 6、feasible 1、partial 3。
**149 组件终态账**：手写 125 + platform-only 判定结案 13+6=19 + not-found 结案 1 = **145 已决**；
**可实现未实现 = 6 枚**（Piece feasible + ContentSlot/WithEnv/ArcList partial 3 + R48 遗留 partial 2 枚需对照）。

## 落法建议（feasible/partial 共 4 枚新判定）

| 组件 | 分片 | 说明 |
|---|---|---|
| Piece | `runtime/src/batch-layout.js` | 该文件是"无 d.ts 内部组件"批次（Section/Sheet/UnionEffectContainer 同口径）；先核实产物可达性 |
| ContentSlot | `batch-layout.js`（容器）+ `ohos-shims.js`（`@ohos.arkui.node` 的 NodeContent 对象） | XComponentNode 命令式宿主族先例同文件 |
| WithEnv | `runtime/src/batch-func.js` | WithTheme 同文件同族（作用域包裹）；`WritableEnvKey`/`ReadonlyEnvKey`/`SystemProperties` 枚举挂 main.js 全局导出表（ImageFit 先例） |
| ArcList | `runtime/src/batch-platform.js` | Arc 系已全部在该文件（ArcListItem 已真语义，:109）；缺口记 dataset + layoutWarnings |

## 既有文档冲突勘定

- `runtime/src/batch-platform.js:5` 把 ContentSlot/WithEnv 与 21 个平台组件并列
  "保持骨架"（R84 工作假设）——**与 R48 表格的 partial 冲突，以 R48/本表为准**
  （二者当前确实仍是骨架：runtime/src grep 0 命中）。
- d.ts 可达性：11 枚中仅 Particle/Component3D/ContentSlot 三份进 `index-full.d.ts`
  reference（:80/:150/:154），ArcList/WithEnv 走 `@kit.ArkUI` 导出，其余 6 份
  d.ts 全 SDK 不存在（本身就是"未公开"的判定证据）。

## 判据原文（四档，同 R48）

- **feasible**：语义可用 DOM/CSS 标准面完整表达；
- **partial**：外壳/数据面可行、核心原生回路缺失（缺口记 dataset/layoutWarnings）；
- **platform-only**：浏览器/Electron 无对应能力或未公开无从映射（保留骨架=终态，
  强行实现是错的）；
- **not-found**：声明与真机实现双缺失（保留骨架+清单记录）。
