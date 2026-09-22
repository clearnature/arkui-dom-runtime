# HANDOFF — arkui-dom-runtime

> 仓库记忆。不在本文件 = 没发生。每次会话开始读它，结束时裁剪它。
> 细节的唯一权威是五文档：`README.md` / `docs/ROADMAP.md` / `docs/ARCHITECTURE.md` /
> `docs/CAPABILITY.md` / `docs/DEVELOPING.md`。本文件只做索引与进度，不复制内容。

## TL;DR（当前 — 下次会话必须 1 分钟内理解）

- 目标：**ArkTS（ArkUI 声明式）应用跑在 Electron / 浏览器**——复用官方 `ets-loader` 做
  ArkTS→JS 转换，自研 JS 侧 DOM 运行时；不需要 Rosen / ark_js_vm / 宿主 ArkUI / RichPreviewer
- 上次切片：**R40**（语义清账三连：Navigation 转场 450ms 弹簧 + ±50%/20% 视差、Marquee
  时长公式 距离×85/step、QRCode ECC 显式 M——三处原推断两处修正一处破误案）— **PASS**
  （navtransdemo 52 / showdemo 27 / qrdemo 12 双端；破坏 1/1/1 红；夹具重测 ShowDemo step 30）
- **真机源码参考库**：`/data/work/compiler/Ark`（OHOS 全树）。组件语义权威 =
  `arkui_ace_engine/frameworks/core/components_ng/pattern/<组件>/`。后续逐组件对照可清一批
  "推断"标注（Navigation 转场时长/曲线、Marquee 时长公式等）。
- 下一步（README「下一步」原文）：
  1. 其余骨架组件的视觉语义——**按家族推进**；已收：形状族 8 + 输入类 7 + 信息展示类 5 +
     弹出类 3 + 表层类 2 + 小件 4 + 分步器 2 + UIContext + @ohos.media（R35）；
     剩余候选以 `node tools/stats.mjs` 的"骨架·仅 data-*"清单为准
  2. ~~继续拆 `main.js`~~ **已拆到位**（15 分片）；机制随时可用

## 项目目标

让 ets-loader 的转换产物在浏览器/Electron 的 DOM 上跑起来。每轮切片的节奏：**先测量**
（新建 `.ets` 页面 → 官方构建 → 读产物，抄 `.d.ts` JSDoc 原文；SDK 在
`/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/sdk/default/openharmony/ets/component/`）
→ 实现 → 双端断言 → **破坏验证**（人为破坏实现，确认断言真的会红）→ 五文档同步。
语义没数字依据的一律标**推断**。

## 验证门（确切命令）

```
npm run check                 # 6 步：preflight / gen-components --check / build-runtime --check /
                              #       stats --check-doc / browser(run.sh all) / electron(run.sh all)
bash run.sh <用例>            # 单用例·浏览器
bash electron/run.sh <用例>   # 单用例·Electron
```

- 成败**只看退出码**，绝不 grep 日志行（`tools/check-all.sh` 设计约定 1；已发生过 4 次假通过）
- 断言数守门：运行期落盘 TSV 与文档声明比对（`tools/assert-counts.mjs`，DEVELOPING 坑 77）
- 各步日志：`build/check-logs/`

## 当前切片

- 当前切片：**无未收口切片**（拆分第三步完成）；规格入口：`docs/ROADMAP.md`「R5c」第三步记录 +
  `README.md`「下一步」+ `runtime/src/` 文件树
- Lanes：单人顺序开发，无 lane 分片
- Gates（全套 `npm run check` 于每轮收口提交前执行；最近一次 = 拆分第三步）：

| Gate | 命令 | 阈值 | 原始结果 | 裁决 |
|------|------|------|---------|------|
| 环境 preflight | `node tools/preflight.mjs` | exit 0 | build/check-logs/ | PASS |
| 生成物一致 | `gen-components --check` | exit 0 | build/check-logs/ | PASS |
| 运行时拼接一致 | `build-runtime --check` | exit 0 | 9 个分片 | PASS |
| 文档断言数守门 | `stats --check-doc` | exit 0 | build/check-logs/ | PASS |
| 浏览器全量 | `bash run.sh all` | exit 0 | 33 用例 | PASS |
| Electron 全量 | `bash electron/run.sh all` | exit 0 | 32 用例 | PASS |

拆分第三步的硬判据单独记录：**重建产物 md5 = `e861eb81d1af46dac33d97fdfe1ab5df`（与拆分前一致）**。

## 开放分歧

| # | 立场 | 证据（真实文件） | 裁决 |
|---|------|-----------------|------|
| （无） | | | |

### 待办小修（非分歧，随时可做）

- ~~ROADMAP 452 行 R13 重复标题~~（R25 提交时已划掉并加指针）
- ~~`.mimosa/` 未跟踪目录~~（R25 提交时已进 `.gitignore`）
- （当前无）

## 决策日志

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-09-21 | 收口/新功能一律**新建页面**（如 NavBarDemo/NavTransDemo），不在老页面 `.ets` 上扩展 | NavDemo/Rich/Widgets 等老页面只剩官方构建的冻结产物，源不在 git；当前仅 9+1 个页面 + 3 个 ability 的 `.ets` 被跟踪 |
| 2026-09-21 | 建立 `.reasonix/handoff.md` 作为仓库记忆入口 | handoff-memory 技能；五文档仍是细节权威，本文件只做索引 |
| 2026-09-21 | Nav 转场的时长/曲线与联动阈值/缩放比记为**推断** | `.d.ts` 只说"有系统默认转场"，没给任何数字；本项目规矩：没依据的数字必须标注 |

## 会话日志

| 日期 | 切片 | Commits | Gates | 备注 |
|------|------|---------|-------|------|
| 2026-09-21 | R12 收口 | 4571f8f | 6/6 PASS（复跑核验） | 新增坑 85（builder 产物不保证直接子节点）；navdemo 旧契约升级为正向断言 |
| 2026-09-21 | R25 收口 | 290119c | 6/6 PASS | navtransdemo 48 条双端；破坏 13/6/5 红；navdemo 旧契约升级（转场默认开 → 断言前等 settle，74 条恢复）；新增坑 86（on* 分发陷阱）/87（@State 渲染滞后）；ROADMAP R13 重复标题已修；`.mimosa/` 进 .gitignore |
| 2026-09-21 | 拆分第三步 | 1a8c99d | 产物 md5 同拆分前 + 双端全量 PASS | main.js 4248→1869 行，3→9 分片（nav/layout/draw/area/v2/ability）；分节间空行留在 main（坑 84）；LazyForEach 在具体组件内部，切了劈半，不拆 |
| 2026-09-21 | R26 形状族 | 1eb9b53 | 双端 36 条 PASS + 破坏 19/1/4 红 | fixture 空转自纠（正方形 Circle min=max，改 80×60）；Line 起终点是属性方法不是 create 参数（编译期抓到）；新分片 shape.js（第 10 个） |
| 2026-09-21 | R27 输入类 | 98f2d2f | 双端 27 条 PASS + 破坏 3/2/2 红 | RadioOptions 无 name / Toggle 用 isOn（编译期抓到）；坑 88（事件重复注册改覆盖语义）+ target 校验防错投 + Radio 组内补发 onChange(false)；新分片 input.js（第 11 个） |
| 2026-09-21 | R28 信息展示类 | ecec6f3 | 双端 26 条 PASS + 破坏 8/1/1 红 | Badge count/value 双重载 + style 必填在 create（编译期抓到）；Marquee 定时器收口（headless 动画事件被节流）；坑 89（轮询上限吃虚拟时间预算）；新分片 show.js（第 12 个） |
| 2026-09-21 | R29 弹出类 | f22a161 | 双端 16 条 PASS + 破坏 7/3/5 红 | Select.create 单参数（selected 是属性方法）；onSelect 双参 (index, value)；MenuItem 多选语义；value() 记 data-value-text（原生 select 不可覆盖，取舍记录）；新分片 popup.js（第 13 个） |
| 2026-09-21 | R30 UIContext | 1f07f77 | 双端 8 条 PASS + 破坏 4/1 红 | getRouter 返回经典 Router 面（pushUrl，编译期实测）；animateTo 委派显式动画管道（history.api 断言把"真动画"与"裸赋值"区分开）；无新分片（本体 8 行） |
| 2026-09-21 | R31 Canvas | 497fa17 | 双端 10 条 PASS（一次通过）+ 破坏 2/1/1 红 | 原生 <canvas> 转发 + onReady 尺寸同步；像素断言天然有牙齿；fixture 的 toDataURL 断言边界太松（0 红）当场收紧；新分片 canvas.js（第 14 个） |
| 2026-09-21 | R32 XComponent | 8763aa9 | 双端 7 条 PASS（一次通过）+ 破坏 1/1/1 红 | surface 如实降级为占位容器；create 二参 bundle 串实测；接在表层类分片（无新文件） |
| 2026-09-21 | R33 QRCode | 7d1271a | 双端 11 条 PASS + 破坏 3+/2/1 红 | 两件第三方源码首次入库（qrcode bundle + jsQR），THIRD-PARTY-NOTICES §3b；ARGB→RGBA 归一（8 位颜色位数歧义，首跑解码 null）；交叉验证来自独立解码器 |
| 2026-09-21 | R34 输入收官 | 2f8af86 | 双端 16 条 PASS | TextInputController.caretPosition；Enter→onSubmit 的回调值派发未通（keydown 到、终态链接未解），CAPABILITY 记限制 |
| 2026-09-21 | R35 media | 4ec3cab | 双端通过 | AVPlayer → HTMLAudioElement 垫片（第 15 个平台模块）；Electron autoplay-policy 放行 |
| 2026-09-21 | R36 小件收官 | e8d209b | 双端 14 条 PASS + 破坏 1/1/1 红 | Flex 透传 CSS 同名；Span 内联子段；新分片 small.js（第 16 个） |
| 2026-09-21 | R37 分步器 | bf06354 | 双端 16 条 PASS + 破坏 9/1/1 红 | **破坏验证残留 BROKEN-1 跨轮持有 → 派发断言误删**（新坑 90）；分派分支嵌兄弟条件块=静默死分支（新坑 91）；ItemState 枚举值必须按声明顺序（坑 83 再现）；README R35 重复「触及」块顺手清理 |
| 2026-09-21 | R38 质量切片 | 93dd70c | 门禁 7 步全绿（+typecheck）；stepdemo 25 / inputdemo 29 双端；破坏 4/3/2 红 | **检查单元=拼接产物不是分片**（假阳性 153 全消）；runtime.d.ts Element 合并固化 123 个挂载字段；**真 bug×2**：onSubmit `value` 未定义被 try/catch 吞（R34 之谜破案）、v2 `Event` 遮蔽 Scroller new Event（flush 兜底掩盖）；enterKeyType 处理器补全；Mimosa deep 审计封印 0 findings（dependencySummary partial：零 npm 依赖无可扫包，如实记录） |
| 2026-09-21 | R39 语义纠偏 | e854fc2 | stepdemo 26 条双端；破坏 1/1/1 红 | 用户指了真机源码库 /data/work/compiler/Ark；Stepper 三处分歧照 stepper_pattern.cpp 对齐（先 CHG 后 NEXT／Skip 不切页／Waiting 忽略）；编程跳页静默（swiper 桥不转发）；新坑 94（.d.ts 给签名不给时序）；后续可用 pattern/ 目录逐组件清"推断"账 |
| 2026-09-21 | R40 语义清账 | （本次提交） | navtransdemo 52 / showdemo 27 / qrdemo 12 双端；破坏 1/1/1 红 | ①Nav 转场：450ms 弹簧 + 入页 50%/视差 20%/弹出 50%（原 300ms 全页推断）；②Marquee：距离×85/step（原 step×16ms/帧），基座改 block，夹具 step 30 走完整重测；③QRCode ECC 确证 M（真机硬编码；node-qrcode 默认即 M——R33 的 L 注记是误判，从未真渲染过 L）；modules.get(row,col) 行优先，读反得转置（暗格数同、位置 43% 错） |
