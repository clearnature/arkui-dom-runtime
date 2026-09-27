# HANDOFF — arkui-dom-runtime

> 仓库记忆。不在本文件 = 没发生。每次会话开始读它，结束时裁剪它。
> 细节的唯一权威是五文档：`README.md` / `docs/ROADMAP.md` / `docs/ARCHITECTURE.md` /
> `docs/CAPABILITY.md` / `docs/DEVELOPING.md`；另有专题汇总统稿 `docs/CANGJIE-KERNEL.md`
> （仓颉内核线：架构/ABI/挂载/泵模式/坑速查）。本文件只做索引与进度，不复制内容。

## TL;DR（当前 — 下次会话必须 1 分钟内理解）

- 目标：**ArkTS（ArkUI 声明式）应用跑在 Electron / 浏览器**——复用官方 `ets-loader` 做
  ArkTS→JS 转换，自研 JS 侧 DOM 运行时；不需要 Rosen / ark_js_vm / 宿主 ArkUI / RichPreviewer
- 上次切片：**R116 Go 内核（第四语言）**——kernel/go cgo+c-shared（仅 libc 依赖、
  零宿主序、标准库 JSON、goroutine 作业）；Reasonix 对齐 session.get/set Generation
  CAS + lifecycle 三态；smoke 77（go 段 20 断言）；**四语言齐：仓颉/纯C/Haskell/Go**。
  更早：**R115 Haskell 内核工业级验证**（作业面 forkIO 零驱动+协作 CAS 取消+
  快照跨语言互通+错误矩阵；hs 契约 37→72 ALL PASS、smoke→59、node 层并行重叠 6/6；
  **坑 107：writeIORef 惰性 thunk 时间戳（evaluate 强制）+ setNumCapabilities 在 C 原生
  宿主无效（atInit=1）vs node=8——并行断言安置 addon 层，C 层条件 SKIP 如实**）。
  更早：**R114 Haskell/GHC 内核（第三语言）+ 多 RTS 泛化**——`kernel/hs/kernel.hs`
  按参考 trha 数据面（Agent{state, inbox}+五态 FSM transition 逐条对 StateMachine.hs）；
  addon ensureRuntime 双布局（文件=仓颉/目录=GHC 扫描，双标志幂等）；**坑 106：GHC
  RTS↔ghc-internal 循环引用（stg 数据符号→RTS 必须 LAZY 先行）+ unsafePerformIO
  CSE 共享态（可变分配必须在 IO 里）**；hs 契约 37 条、smoke 三内核同进程全通、
  门禁 7 步全绿。**已实证语言：仓颉（生产）/纯 C（样例）/Haskell（trha 数据面）**；
  剩余候选：hs 打包（98 .so 搬运+$ORIGIN，dev级暂缓）、Rust/Go stub、trha 本体
  （用户裁定划出本线）— **PASS**
- 更早：**R67**（R66 批量组件验收：37 结构 + 兜底绊网 + 14 真编译语义；绊网
  `__arkui_dom_generatedFilled`——手写注册缺席时骨架静默兜底，坑 98）；**R24 收口**（渲染
  路径决策 3f6e209：previewer 实证点火崩在窗口层、es2abc 无 JS 输出——留在分支 B）；
  **定位声明 5ba8874**（ArkTS 桌面应用引擎，Electron 主目标）
- 更早：**R49**（ListItemGroup 分组容器上线：header→items→footer 子序、space 只作用
  item 间、spaceWidth 压过 space、divider ::before 槽、List.sticky 组头吸顶）— **PASS**
  （listitemgroup 19 条双端；破坏 5/3/1 红；手写 48）
- 上一轮：**R48**（多代理验证轮：28 个只读调研代理并行完成 23 个平台组件批量判定
  [platform-only 14/partial 3/feasible 4/not-found 2] + 5 个高价值组件实现级摘要；产物入库
  `docs/research/`；CAPABILITY 增"平台特定组件批量判定"章节——清单 23 项一次性处置完毕）
  — **PASS**（纯只读调研，无实现改动）
- 上一轮：**R47**（ImageAnimator 帧动画上线，新分片 animator.js 第 19 个：逐帧 setTimeout
  引擎 + AnimationStatus 状态机 [Running 推进/Paused 停表保持/Stopped 回首帧/播完落 Stopped]；
  回调延时派发 + images 深 diff——state 先于 onStart 应用、images 字面量重渲染重建，同步发/直接
  重置都会坏）— **PASS**（animatordemo 13 条双端；破坏 0/6/2 红——0 红一条无观察面如实记录；
  手写 47）
- 上一轮：**R46**（Scroll 滚动容器真 overflow 基座上线，新分片 scroll.js 第 18 个 + Scroller
  扩面：scrollTo 官方形参 {xOffset,yOffset,animation}/scrollBy/scrollEdge/scrollPage/isAtEnd、
  currentOffset 返回 {xOffset,yOffset}；onScrollEdge 到达沿触发；onScrollEnd 80ms 静默收口
  [DOM 化近似]）— **PASS**（scrolldemo 16 条双端；破坏 1/1/1 红；手写 46）
- 上一轮：**R45**（Image 组件真 <img> 基座上线，新分片 image.js 第 17 个：objectFit 五枚举→CSS object-fit、alt 占位惰性创建、onComplete 载荷带真实解码尺寸）— **PASS**（imagedemo 15 条双端；手写 45）
- 上一轮：**R44**（已确证组件语义回归扫描：重读真机源码找边界行为——扫出两处分歧已修
  [Marquee step≤0 不除、QRCode 过小拒绝绘制] + onTitleModeChange 端点转确证；新增
  `__arkui_dom_syncDrawings` 钩子；qrdemo 15 / showdemo 28 双端；破坏 1 红/3 红）
- 上一轮：**R43**（语义确证第三轮，两处实现修正：滚动联动副标题透明度 = (H−56)/(max−56)、
  主标题字号插值 L=30fp↔M=26fp 经 SHARP；SLIDE_SWITCH scale 0.8→0.85 照
  `rosen_transition_effect.cpp`）— **PASS**（navtransdemo + transitiondemo 双端；破坏 1/1/1 红）
- 上一轮：**R42**（语义确证第二轮，无实现改动：标题栏高度 56/112/138 确证——注意
  `navigation_declaration.h` 的 137 是未使用常量，险些误改；生命周期"先 will 后实"部分确证）
- 上一轮：**R41**（QRCode 编码器换成真机源码：OHOS arkui_qrcodegen 的 C++ 源码逐字复制
  → emscripten 编独立 WASM 单文件加载器，替换 node-qrcode vendor）— **PASS**
  （qrdemo 12 + widgets 双端；破坏 1 红（ECC 换 HIGH 采样 55/100）；jsQR 交叉验证保留）
- 上一轮：**R40**（语义清账三连：Navigation 转场 450ms 弹簧 + ±50%/20% 视差、Marquee
  时长公式 距离×85/step、QRCode ECC 确证 M）— navtransdemo 52 / showdemo 27 双端
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
| 2026-09-21 | R40 语义清账 | c624b68 | navtransdemo 52 / showdemo 27 / qrdemo 12 双端；破坏 1/1/1 红 | ①Nav 转场：450ms 弹簧 + 入页 50%/视差 20%/弹出 50%（原 300ms 全页推断）；②Marquee：距离×85/step（原 step×16ms/帧），基座改 block，夹具 step 30 走完整重测；③QRCode ECC 确证 M（真机硬编码；node-qrcode 默认即 M——R33 的 L 注记是误判，从未真渲染过 L）；modules.get(row,col) 行优先，读反得转置（暗格数同、位置 43% 错） |
| 2026-09-21 | R41 编码器真机化 | 373e619 | qrdemo 12 + widgets 双端；破坏 1 红 | 用户要求"直接复用真机代码不要单独实现"：arkui_qrcodegen C++ 源码逐字复制（md5 校验）→ emcc STANDALONE_WASM（emscripten 6 工厂是 async 的，同步首绘等不起）→ base64 内嵌单文件加载器；data[i]&1=暗格、ECC 恒 MEDIUM(0)；node-qrcode vendor 删除、jsQR 保留；THIRD-PARTY-NOTICES §3b 重写 |
| 2026-09-21 | R42 语义确证二轮 | 241bb47 | 7 步门禁全绿（无实现改动） | 标题栏 56/112/138 确证（theme 默认值，138 正确——navigation_declaration.h 的 137 是未使用常量，险些误改）；生命周期"先 will 后实"部分确证；Marquee/转场文档滞留清理；FREE 初始高度同取 FULL_*（与我们一致） |
| 2026-09-21 | R43 语义确证三轮 | dfdadfb | navtransdemo + transitiondemo 双端；破坏 1/1/1 红 | 滚动联动确证 + 两处修正：副标题透明度 = (H−56)/(max−56)（原 0.7 系数错）、主标题字号插值 L=30fp↔M=26fp 经 SHARP 曲线（DOM 等价 scale=(26+SHARP(p)×4)/30，SHARP 对称故中点断言不变）；SLIDE_SWITCH 确证 scale 0.85（原 0.8 推断）；SHARP 求值器 = 二分解 x(t)=p |
| 2026-09-21 | R44 语义回归扫描 | 234ff77 | qrdemo 15 / showdemo 28 / widgets 双端；破坏 1 红/3 红 | 重读真机源码扫边界：Marquee step≤0 真机不除（原错替换 6，已修）；QRCode 过小组件真机拒绝绘制（原硬画溢出，已修 + 只尝试一次）；**widgets 无尺寸 QRCode 的旧断言编码了硬画假象 → 升级为拒绝语义**（真机 qrCodeSize≤0 分支）；onTitleModeChange 端点转确证；`__arkui_dom_syncDrawings` 钩子；破坏/恢复脚本两次 old/new 颠倒靠 grep BROKEN 回读抓到——破坏脚本必须回读验证 |
| 2026-09-24 | R45 Image | 71eec3f | imagedemo 15 条双端 + widgets 恢复；破坏 2/0/3 红 | 页面源是**声明式 ArkTS**（@Component struct），产物才是 ViewPU 类——按产物形态写源被 linter 拦（no-in/any/obj-literal）；ArkTS 禁内联对象字面量类型；alt 占位图必须惰性创建（预插空 src <img> 被 querySelector('img') 命中）；图片 URL 绝对路径 /test-assets/（MeasImage 同约定）；fire 同步认领防双发（首跑抓到 load+补派发双触发抛错） |
| 2026-09-24 | R46 Scroll | a6a209b | scrolldemo 16 条双端；破坏 1/1/1 红 | **Scroll.create 单参直接是 Scroller 实例**（不是 {scroller} 选项对象，解包错方向 _bind 没跑、scrollBy 全哑，探针抓到）；Scroller 扩面（layout.js）：官方形参 {xOffset,yOffset,animation} + scrollBy/scrollEdge/scrollPage/isAtEnd；onScrollEdge 到达沿（lastEdge 记忆）；onScrollStart/End = 滚动静默 80ms 收口（近似标注）；测试侧手动滚动后手动派发 scroll（坑 ⑧ rAF 对齐事件 headless 不可靠） |
| 2026-09-24 | R47 ImageAnimator | e32cb1d | animatordemo 13 条双端；破坏 0/6/2 红 | **本 SDK d.ts 无 onFrame 属性**（事件仅 Start/Pause/Repeat/Cancel/Finish 五枚，勿照旧文档实现）；duration=每帧 ms（默认 1000）、iterations=-1 无限；两个必踩点：产物顺序 state 先于 onStart 应用 → 回调延时派发（同步发会丢）、images 字面量重渲染重建 → 深 diff 防重置帧序；破坏脚本缩进层级照抄实际文件（工厂内 6 空格）——两次 AssertionError 都是这原因 |
| 2026-09-24 | R48 多代理验证轮 | 8da24d7 | 28 只读代理并行（53.5 分钟/54 步全 settled）；无实现改动 | **多代理加速实测**：一轮清账 23 个平台组件判定 + 5 份实现级摘要（用户原估 3-4 轮会话的调研量）；platform-only 14/partial 3/feasible 4/not-found 2；复核更正 0 条、ColorPicker×2 not-found 如实标 unconfirmed；中途配额耗尽换 provider 续跑（new-provider/mimo-v2.6-flash），结果全量到手；产物入库 docs/research/；可行队列新增 ContainerReader/Calendar/CalendarPicker/WithTheme |
| 2026-09-24 | R49 ListItemGroup | c717563 | listitemgroup 19 条双端；破坏 5/3/1 红 | 按 R48-A 摘要实现（调研零返工）；**space 只作用 item 间**（margin 实现，通用 gap 是陷阱⑤）；spaceWidth 压过 space；divider = item 顶缘外 ::before 槽（不占高度，真机首项无线同款）；footer 推迟到 pop（真机 AdjustMountTreeSequence 序）；List.sticky → position:sticky 规则；headless 经典滚动条占 15px（List 未隐藏滚动条时组宽=360-15，divider 线宽断言按内容宽算） |
| 2026-09-24 | R50 Refresh | 17ca845 | refreshdemo 25 条双端；破坏 13/6/6 红 | pointer 只收 touch；状态机 5 态；AR 先于 A3；同值不重复发；重渲染时 refreshing 选项重传（create 包装器）；默认指示器未绘制（CAPABILITY 记录）；headless 经典滚动条占 15px |
| 2026-09-24 | R51 DatePicker | 5597def | datepickerdemo 21 条双端；破坏 1/2/1 红 | 三列滚轮（year/month/day 各 5 行）；跨列联动（月变→day 夹取）；start/end 钳制+设了则 canLoop 强制 false；lunar 记警告不实现；month 0/1 基双变换；DCHG 含 CHG 子串——计数断言需负向后行断言 |
| 2026-09-24 | R52 TimePicker | 6300416 | timepickerdemo 10 条双端；破坏 2/1 红 | hour/minute/second 三列滚轮；useMilitaryTime 12h/24h（军事时间 hour 不补零）；TimePickerFormat 挂 global；ROADMAP/CAPABILITY 的 R52 条目漏记，R53 时补记 |
| 2026-09-25 | R53 WaterFlow | 539382c | waterflowdemo 21 条双端；破坏 14/6/7 红；门禁 7 步 | JS 绝对定位复刻真机换列算法（空列→严格最小→平高保左，water_flow_layout_info.cpp:271-298）；事件时序照 TriggerPostLayoutEvents，首帧 I+RS 补发必须排在布局 flush 后（新坑 96）；scrollToIndex 落点=max scroll 时 RE 过境成立（真机语义，修正 R48 摘要漏记）；layout.js scrollToIndex 扩查 FlowItem+补派发；原生 scroll 幽灵双发按 scrollTop 恒等去重（新坑 95）；WaterFlowSections shim；stats 手写 50→58（补账 TextInput/TextArea/Search/Hyperlink/QRCode 漏登记）；**budget 中断一次**：断点落 proof_dag journal（d6309220），恢复后无损续做 |
| 2026-09-25 | R54 CalendarPicker | 74e262c | calendarpickerdemo 19 条双端；破坏 1/1/1 红（B+C 合并跑）；门禁 7 步 | 可行队列选型（ContainerReader/WithTheme/Calendar 缓，理由在 ROADMAP R54）；入口三段+加减步进（+/- 触发 onChange——真机 FireChangeEvents:561-584）；同值不重发（CanReportChangeEvent:1615）；首列周日（calendar_paint_method.cpp:531）；AdjustDateToRange 夹取；静态 CalendarPickerDialog.show（OK/Cancel）；**budget 中断两次**（研究后/首跑后），断点落 todo+会话消息；首跑 4 红三因：calpAdjust 比较符反（真 bug）、标题断言混入翻页键字符、button margin 2px 破坏列位断言（后两为测试缺陷）；坑 93 再现（sel:null 状态袋坍缩，整袋断言修） |
| 2026-09-25 | R54.1 残留清账 | （本提交） | calendarpickerdemo 24 条双端；门禁 7 步 | 三条挂账清零：①Mimosa deep 审计重跑 **0 findings**（seal sha256:f6e09366…，依赖 partial=零 npm 依赖同 R38）；②hintRadius 真视觉（选中日内联 borderRadius 三档，fixture 增 cp3/cp4）；③markToday 状态接线（attr 只写 dataset 没写 st——翻月对照断言首跑即红抓到，升到可观测层后断言才有牙）；fixture 19→24 条 |
| 2026-09-25 | R55 类型化专项 | dd1d1ec | 隐式 any 1464→0；门禁 7 步全绿（noImplicitAny 已翻档） | 十六批人工（7dd7d5a/461e67e/4fa1e08/b7aff8a/dacb528/…/0a39291）+ 六组并行代理工作流（dwfrun-cff39b0a，A=main 174/B=93/C=31/D=17/E=42/F=area 20，join 后门禁循环收敛到 0）+ main.js 后半帮手 A2（转核验）；noImplicitAny=true 进门禁、试验档删除；方法论五条入 ROADMAP R55（表级 Record/工厂形状类型/evolving-let 声明处修/TS1016/按文件切组）； Mimosa deep 审计 0 findings（seal sha256:f6e09366…，R54.1 重跑） |
| 2026-09-25 | R56 TextPicker | 5680d37 | textpickerdemo 11 条双端；破坏合并 2 红；门禁 7 步绿 | 选择器三部曲收官；单列滚轮（wheel 同步单步/边界不动不发/__txpStep 暴露）；onChange 联合类型签名（窄签名被 ArkTS 10605999 拒——参数逆变）；selectedIndex 属性覆盖；对象 range 取 .text；多列/级联只取第一列记警告（R58 补齐）；首跑 4 红=坑 87 再演（onChange 同步发但 @State→DOM 滞后，断言前缺 tick）；noImplicitAny 门禁下新代码原生干净 |
| 2026-09-25 | R58 TextPicker 收尾 | c9863de | textpickerdemo 11→19 条双端；破坏 1 红（级联 build 摘除）；门禁 7 步绿 | 多列 string[][] 独立滚轮；级联 children 联动（colCount 按链深动态，父变→截断 sel+子列重置）；TextPickerDialog.show（fixed 面板 OK/Cancel 走 TextPickerResult）；引擎重构 tpxEngine 统一三态+弹层，__txpStep 单列兼容+__txpStepCol 多列；教训：多代理并行期 fixtures 漂移（test 读旧冻结件 tx4 全 null，probe 即知）；引擎重构后 __txp 变包装对象旧 handler 路径失效；dataset.selectedIndex 变 JSON 数组（R56 断言同步改） |
| 2026-09-25 | R58.1 Mimosa 重跑 | （本提交） | 审计 0 findings | deep 扫描 scan-2026-09-25T12-36-16 seal sha256:bf59cd02…（覆盖 R55~R58 全部新增代码）；依赖 completion=partial（零 npm 依赖不变）；两处流程失误实录：验证链 `\| grep && commit` 吞退出码致红门禁误提交两次（已 amend 修正），后续终验链显式捕获退出码 |
| 2026-09-27 | R97/R98 @ohos:cjk | （本提交） | cjk 双端（Electron 15 / 浏览器 6）；契约测试 22 条；门禁 7 步全绿 | 内核 v2 实现完整 c-abi 6 符号（echo/add/fib/upper/error + last_error/free）；NAPI 桥 bridge/napi/cjk_napi.node（dlopen→InitCJRuntime→dlsym，惰性挂载）；@ohos:cjk 垫片 + cjk.html 按端分流（不进浏览器 all 矩阵——windowdemo 先例，计数守门按端核对）；**坑 101**：@C 帧内 `Int64.toString()` 头部损坏（.size=6399178）→ 数字手写 ASCII；`libcangjie-std-core.so` 无 DT_SONAME → 必须 LD_LIBRARY_PATH；`dlerror()` 只能取一次；Mimosa deep 审计 0 findings（seal sha256:fe6dcc0b…） |
| 2026-09-27 | R99 内核 agent 原语 | 7991b6d | 契约测试 40 条；冒烟 14 条；cjk 双端（Electron 21 / 浏览器 6）；门禁 7 步全绿 | 内核 v3 agent 调度原语五方法（spawn 单调 id/list 按 spawn 序/send 邮箱/poll 排空/kill 收敛），注册表跨调用持久、kernel_init 重置（测试隔离语义）；trha MVP 数据面就位（控制面 CJThread 调度留下一片）；**坑 102**：包级初始化器在 dlopen dylib 不跑（容器全局量首用即 SIGSEGV）→ Option 字面默认+惰性构造；此 nightly `ArrayList.get` 返回 Option<T>；Mimosa deep 审计 0 findings（seal sha256:507a4c5f…） |
| 2026-09-27 | R100 内核并发调度器 | （本提交） | 契约测试 49 条；冒烟 18 条；cjk 双端（Electron 26 / 浏览器 6）；门禁 7 步全绿 | 内核 v4 异步作业（agent.submit/result + 有界 drainer cjthread 清空队列即返回）；c-abi.h 增可选调度符号节（pending/draining/drain_entry，缺席=旧内核向后兼容）；addon cjkCall 后置驱动（RunCJTask + RunUIScheduler 泵）；**坑 103**：Semaphore/Monitor 宿主线程不可用（栈腐蚀/6399178 垃圾值）→ 同步只用 Mutex；**坑 104**：嵌入模式 cjthread 只在 RunUIScheduler 泵窗口执行、sleep 空操作（timer 不跑）→ 禁自旋、宿主逐调用驱动；trha MVP 控制面就位；Mimosa deep 审计 0 findings（seal sha256:566b38d0…） |
