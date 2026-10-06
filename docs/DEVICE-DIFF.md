# 与鸿蒙真机行为差异清单（DEVICE-DIFF）

> 面向**采购/评审**视角的一页账：本引擎（ArkTS 桌面应用引擎，Linux）与鸿蒙真机
> （ArkUI C++ 渲染 + PandaVM）在行为上**哪里不同、影响多大、依据是什么**。
> 每条都带文档出处（文档:节/行），不收录无出处的推测。
> 本文只列"**与真机不同**"的账；"**已照真机对齐**"的确证账在 `docs/CAPABILITY.md`（逐条断言出处）
> 与 `docs/ROADMAP.md` R39-R44/R48/R123-R126（真机源码确证记录），两份互补，不重复。
>
> **官方对拍通道（2026-10-02 起）**：CLT 自带的 Device Emulator 在本机实测全通
> （起机/hdc/装包/启动/首帧/截图，`docs/HARMONYOS-EMULATOR.md` 六步配方）——
> 本清单的每条差异都可按需升级为"对官方镜像实测对拍"；第六端差分计划见该文档 §6。

**术语口径（R95/R95.1 校准，本文全篇遵守）**：本项目的语言执行层 = **官方编译链生态**
（CLT 26 的 ets-loader 编译前端 + 本运行时作为 **"ets-loader 产物的 JS 运行时"**），
UI 输出层 = DOM 渲染——是 **"ArkTS 官方编译链生态 + Web 渲染后端"的混合架构**，
不是"ArkTS 移植到某个 JS 引擎"（`docs/ARCHITECTURE.md:45`，R95 初版 / R95.1 措辞精化）。
术语精确化两处易错：**es2abc 是编译器不是解释器**（解释器/执行器是 PandaVM）；
ets-loader 前端本身就是 Node.js 上的 JS/TS 实现——本运行时与官方工具链的**前端层**同语言，
与**运行时层**（C++）刻意不同（`docs/ARCHITECTURE.md:57`）。评审表述请以此为准，不要使用
"ArkTS 语义的 JS 执行器"一类未经校准的独立断言。

**影响面三档定义**：

| 档 | 含义 |
|---|---|
| **功能缺失** | 做不了——真机能做、本引擎没有对应能力 |
| **行为差异** | 能做，但结果形态/路径/触发条件与真机不同 |
| **性能差异** | 结果相同，代价（速度/资源）不同 |

## 差异总表

| 差异 | 影响面 | 依据/现状 |
|---|---|---|
| **一、执行模型** | | |
| 真机执行 es2abc 产出的 `.abc` 字节码（PandaVM 执行）；本引擎执行 ets-loader 产物经剥类型后的 ES2021 JS。CLT 内没有 ArkVM，`.abc` 本地不可执行，分发/保护形态因此不同 | **功能缺失**（执行产物不同是整个清单的根差异） | `docs/ARKVM-RESEARCH.md` §0-②、§2（`find -name ark_js_vm` 为空）；`docs/CAPABILITY.md:333` |
| 装饰器调用协议：JS 路径走 tsc 4.9.5 `__decorate`（字段声明装饰器 **3 实参**）；真机 es2abc 自带装饰器实现（**2 实参**），`__decorate` 在字节码里一次都不出现。运行时只读前两参 → 当前可观测行为等价，但"按 `__decorate` 形状写装饰器"这条**依据**只在 JS 路径成立 | **行为差异**（实现依据不同，行为当前等价） | `docs/ARKVM-RESEARCH.md` §6（对照表 §6.4 :406-414；无害判据 §6.5）；`docs/ROADMAP.md:2678`（R24 差异表） |
| `__decorate` 助手有 `Reflect.decorate` 短路分支：宿主一旦定义 `Reflect.decorate`，JS 路径整体切到"描述符式"协议；ABC 路径没有这个分支。当前浏览器/Electron 均无 `Reflect.decorate`，未触发 | **行为差异**（换宿主就可能变语义的隐患） | `docs/ARKVM-RESEARCH.md` §6.5（:438-440） |
| 模块接线：`.abc` 走 ESM 模块记录，`npmEntries.txt` 把 `@ohos.curves` 等重定向到 `@native.*` 原生模块记录；JS 路径走 CommonJS 仿真（`__arkui_dom_defineCommonJS` + `require("@ohos:xxx")`）。**凡断言 `@ohos:*` 模块行为的用例，结论都只关于 `runtime/ohos-shims.js`** | **行为差异**（R24 定性的"结论范围钉子"） | `docs/ARKVM-RESEARCH.md` §7.6、§8.1-#1（:744）；`docs/ROADMAP.md:2671/2679` |
| ArkTS 1.1 检查器闸门：真机路线 `.ets` 源文件写不出 `eval`/`Symbol`/生成器/`#private`/无类型对象字面量等（编译期即拒）；本引擎的 fixtures 是 ets-loader 产物、不经检查器，产物里出现这些是合法的——"JS 路径能跑的某些语法，真机源文件根本写不出来" | **行为差异**（输入语法面比真机宽） | `docs/ARKVM-RESEARCH.md` §7.5（接受/拒绝名单+原始报错） |
| 正则字面量：V8 每个字面量位置共享同一对象（`f()===f()` 为真、`lastIndex` 跨调用保留）；ArkVM 降级为运行期 `new RegExp(...)` 每次新建。依赖对象身份/`lastIndex` 共享的结论只对 JS 路径成立（现有用例无此断言） | **行为差异** | `docs/ARKVM-RESEARCH.md` §7.4（:588-600）；`docs/ROADMAP.md:2680` |
| ArkTS 的类型系统/模块解析不实现——产物已被编译期降级为 ViewPU 协议，运行时只消费降级后的产物 | **功能缺失**（设计取舍：那些在编译期展开） | `docs/ARCHITECTURE.md:45`（R95）；`docs/ROADMAP.md:2815`（明确不做：实现 `.abc` 解释器） |
| 性能形态：真机有 AOT（`ark_aot_compiler`）+ 字节码级优化；本引擎是 JS 执行 + DOM 操作与布局。R24 收口判决：字节码级编译优化打不到 DOM 解释架构的瓶颈，性能杠杆在运行时内部（DOM 操作削减/布局批处理） | **性能差异** | `docs/ROADMAP.md:2766-2768`（R24 收口三层证据）、`:2816`（明确不做表） |
| **二、渲染** | | |
| 渲染底座：真机 ArkUI C++ 组件树 + Skia 光栅化；本引擎 DOM/CSS + Blink。像素级复刻原生渲染（字体/光栅化）**明确不做**，目标语义与布局可用 | **行为差异**（架构本体，不是缺陷） | `docs/ARCHITECTURE.md:34/65`；`docs/ROADMAP.md:2814`（明确不做表） |
| 视觉保真度：149 个组件中多数属性只落到 `data-*`（不丢信息，但不产生视觉效果），视觉保真远低于真机 | **行为差异**（能渲染但形态不同） | `docs/CAPABILITY.md:288` |
| 文本测量字体：测量用 `sans-serif`（未指定 `fontFamily` 时），与真机系统默认字体不同——绝对像素值会差（换行行为这一层一致） | **行为差异** | `docs/CAPABILITY.md:242-243` |
| 动效实现层：真机转场/切换自带渲染层动效（如 SLIDE_SWITCH 自带 curve(0.24,0,0.5,1)/600ms；Navigation 转场 450ms 弹簧）；DOM 实现时长走外层 `animateTo` 窗口、曲线用 CSS `cubic-bezier` 近似（overDrag 回弹已照真机弹簧解析解逐式解算，R126） | **行为差异**（参数已确证、载体不同） | `docs/ROADMAP.md:1191-1193`（R43）；`docs/CAPABILITY.md:84`、`:212-220`（R125/R126） |
| headless 环境 rAF 节流不确定：真机 vsync 驱动；本引擎合并调度改用 `setTimeout(0)` + 关键路径同步 `flush`，测试用轮询——动画/时序事件的触发时机与真机不同 | **行为差异**（宿主环境差，坑 ⑧） | `docs/DEVELOPING.md:468`（坑 ⑧） |
| `--virtual-time-budget` 下 fetch 挂起会暂停虚拟时间 → 超时类断言浏览器侧不可判定（标 SKIP，由 Electron 真定时器严格验证）；轮询上限还可能吃掉虚拟时间预算（坑 89）。真机无此测试概念 | **行为差异**（测试基础设施层，坑 ⑦/89） | `docs/DEVELOPING.md:470`（坑 ⑦）、`:441`（坑 89）；`docs/CAPABILITY.md:339-340` |
| 程序性改 `scrollTop` 会双发（手动同步派发 + Chromium 原生异步 scroll 事件）→ 按 scrollTop 恒等去重；真机 FireOnScroll 的 (0,IDLE) 补发语义由 80ms 静默收口承担 | **行为差异**（坑 95） | `docs/DEVELOPING.md:447`（坑 95） |
| 系统返回键：本运行时没有系统返回键（浏览器/Electron 不产生），`onBackPressed` 登记即警告、永不触发；请走 `NavPathStack.pop()` | **功能缺失** | `docs/CAPABILITY.md:259-260`；`docs/DEVELOPING.md:390`（坑 ㊷） |
| 平台组件 14 个 platform-only：跨进程窗口嵌入（AbilityComponent/UIExtensionComponent 族）、系统卡片（FormComponent/FormLink）、跨应用组件（PluginComponent）、外部窗口（RemoteWindow）、窗口场景（WindowScene）、系统合成器深度渲染（DepthComponent）、命令式 FrameNode（NodeContainer）等——浏览器无对应语义，保留骨架落 `data-*`，不再列入实现清单 | **功能缺失** | `docs/CAPABILITY.md:355-363`（R48 逐个对照真机源码判定） |
| 窗口语义：窗口 = Electron BrowserWindow **单窗形态**；`getWindowAvoidArea` 桌面单窗无系统栏 → 全 0 区（不预造假数据）；`setKeepScreenOn` 桌面无屏幕常亮语义 → 降级窗口置顶；多窗口未验证 | **行为差异** | `docs/ROADMAP.md:1601-1611`（R83）；`docs/CAPABILITY.md:341` |
| 2in1（鸿蒙 PC）窗口语义校准（R91）：`maximize(presentation?)/restore()/isFocused()` + `windowEvent` 数值常量（SHOWN=1/ACTIVE=2/INACTIVE=3/HIDDEN=4/DESTROYED=7，对齐 `@ohos.window.d.ts:2954-2986`）；minimize 补发 HIDDEN（Linux 不一定派发 hide）——事件形态与真机窗口管理器仍有宿主差异 | **行为差异** | `docs/ROADMAP.md:1545/1609`（R91 断言沿革）；提交 435ec45（R91 条目正文）；2in1 方向确认 `docs/ROADMAP.md:1871` |
| `LazyForEach` 数据变更是整窗重建（未做按 key 增量 diff，无 `onDataAdd/Delete` 精确索引更新）；普通 `ForEach` 全量渲染——真机有增量更新管线 | **行为差异**（规模大时也是性能差异） | `docs/CAPABILITY.md:269-270` |
| v2 `@Computed` 不缓存（正确性靠"getter 体在渲染上下文执行 ⇒ 传递依赖天然成立"）；真机有缓存 | **性能差异**（值正确，重算代价不同） | `docs/CAPABILITY.md:64`、`:294`；`docs/DEVELOPING.md:275`（不许随意加缓存的原因） |
| v2 `@Monitor` 的 `dirty` path 是字段名而非 `items.0.name` 点分路径（嵌套 `@Trace` 变更能触发重渲染，但回调里路径不精确） | **行为差异** | `docs/CAPABILITY.md:294-295` |
| **三、并发** | | |
| ArkTS 并发模型不实现（运行时无 TaskPool/Worker 类并发面；产物是单线程事件循环上的 JS）——真机 ArkVM 支持 ArkTS 并发原语 | **功能缺失** | `docs/ARCHITECTURE.md:45`（"不实现 ArkTS 的并发模型"，R95）；`docs/CAPABILITY.md:341`（并发未验证） |
| **四、平台 API** | | |
| `@ohos:*` 平台模块 = **JS 垫片**（已实现 21 个，见 `docs/ARCHITECTURE.md:1757` 名录），真机 = 操作系统原生模块（NAPI/`@native.*`）。有无、时序、错误码全部由垫片决定 | **行为差异**（同名字、不同实现者） | `docs/ARKVM-RESEARCH.md` §7.6、§8.1-#1；`docs/ARCHITECTURE.md:1757` |
| 平台 API 长尾未实现：`@ohos.arkui` 的对话框/弹窗、`startAbility` 运行时等——未实现模块给**可操作报错**（列出已实现+指路），不静默失败 | **功能缺失** | `docs/CAPABILITY.md:321-322`；`:172`（未实现模块的可操作报错，ability 用例） |
| `getContext()` 的 `filesDir/cacheDir` 仍是 vfs 映射路径（Electron 指向 `electron/data/`、浏览器指向 localStorage 后端），非真机应用沙箱目录语义（R128 起 `resourceManager` 已真实现，见"资源"域） | **行为差异** | `docs/CAPABILITY.md:323`（R126 时点表述）；R128 现状见 `docs/ROADMAP.md:2056` |
| `net.http` 无 cookie/代理/证书校验/重定向控制；`result` 除 `ARRAY_BUFFER` 外一律文本 | **功能缺失** | `docs/CAPABILITY.md:324` |
| `file.fs` 的 `readSync(buffer)` 未实现（**显式抛错**，不静默返回 0） | **功能缺失** | `docs/CAPABILITY.md:325` |
| `media` 垫片：`currentTime` 来自真实挂钟（非音频解码）；WAV data URI duration 已按 RIFF 头解析（R152-A），非 WAV 回退 -1；时钟推进已双端贯通（R35"Electron 未打通"系陈旧账，实测翻案） | ~~行为差异~~→已消除 | `docs/CAPABILITY.md:354`（R35/R152-A） |
| 通知投递分档：浏览器无系统通知为**预期降级**（只记日志+原因）；Electron `permission='granted'` 且走了宿主 API 才算**确证送达**——真机是系统通知服务直达 | **行为差异** | `docs/CAPABILITY.md:132-133` |
| 框架角色（`__arkui_dom_startAbility`、窗口 stage、路由栈）是本项目自己的迷你实现，与官方 `AbilityManagerService`/窗口管理的语义必然有偏差 | **行为差异** | `docs/CAPABILITY.md:342-343` |
| 图像模块：只实现 `createImageSource(uri)` + `getImageInfo*` + `release`；`PixelMap`/`ImagePacker`/`ImageReceiver`/`createImageSource(buf\|fd)` 未实现（响亮报错）；`stride`/`density`/`pixelFormat`/`alphaType` 回常量 0 | **功能缺失** | `docs/CAPABILITY.md:276-280` |
| **五、持久化** | | |
| `preferences` 落盘格式是**自定 JSON**，与官方 preferences 存储格式不兼容（数据换到真机不通用） | **行为差异** | `docs/CAPABILITY.md:330` |
| 浏览器后端是 `localStorage`：不是真文件系统（仅字符串、~5MB 配额、无真实路径、无并发/权限语义）；Electron 后端才是 Node 真 fs | **行为差异**（分端形态不同） | `docs/CAPABILITY.md:328`、`:174-182`（四节持久化矩阵） |
| OPFS 已实现但**默认关闭**：本机 headless Chrome 实测 `getDirectory → getFileHandle → createWritable` 逐级挂死 | **行为差异** | `docs/CAPABILITY.md:329`、`:180` |
| **六、内核嵌入（仓颉）** | | |
| ArkTS↔仓颉互操作协议是**本项目自定义**的 6 符号 C ABI（`kernel_abi.h`，换内核=换 .so）；真机走华为 cjffi/ark_interop（绑定 PandaVM 的 JSContext/JSRuntime——本架构无 PandaVM） | **行为差异**（协议面整体不同） | `docs/CANGJIE-KERNEL.md` §1（:12-19）；`docs/ROADMAP.md:1843-1844`（R96） |
| 嵌入泵模式：cjthread 只在 `RunUIScheduler(ms)` 泵的窗口里执行（`RunCJTask` 返回非空句柄但任务不跑）；`sleep()` 在此模式是**空操作**（timer 线程不跑，睡的任务永不醒）→ 等待逻辑禁自旋，走有界 drainer + 宿主逐调用驱动。真机仓颉运行时由系统调度，无此约束 | **功能缺失**（嵌入模式下 sleep 语义直接不可用） | `docs/CANGJIE-KERNEL.md` §5（:131-144）；`docs/DEVELOPING.md:456`（坑 104） |
| 阻塞唤醒原语不能从宿主原生线程（@C 帧内）调：`Semaphore`/`Monitor` 栈腐蚀、`spawn{}` SIGSEGV（实测）；跨线程同步**只用 Mutex**，cjthread 拉起一律宿主 `RunCJTask` | **功能缺失** | `docs/CANGJIE-KERNEL.md` §5-3；`docs/DEVELOPING.md:455`（坑 103） |
| dylib 包级初始化器不跑：包级 `let gMap = HashMap()` 全局槽是垃圾、首用 SIGSEGV → 可变全局容器一律 `Option` 字面默认 + 首用惰性构造。内核代码必须按嵌入模式书写，与独立进程形态不同 | **行为差异** | `docs/CANGJIE-KERNEL.md` §9（坑 102）；`docs/DEVELOPING.md:454`（坑 102） |
| RTLD_GLOBAL 同名符号劫持：宿主多内核 dlopen 用 `RTLD_GLOBAL`（仓颉运行时必需），全局符号表同名导出**后加载者胜出**——内核对自身导出名的自引用经 PLT 会跳进别的内核（实测 C 内核 shutdown→仓颉 init→SIGSEGV），自引用一律 `static` | **行为差异**（真机单运行时环境无此坑） | `docs/CANGJIE-KERNEL.md` §7.1.1（:201-217）；`docs/DEVELOPING.md:458`（坑 108） |
| `Int64.toString()` 在 @C 帧内返回头部损坏的 String（nightly 1.3.0-alpha 实测）→ 数字一律手写 ASCII。注意：坑 101-104 均为 **nightly 实测**，stable 1.2.0/1.0.5 未验证 | **行为差异**（工具链版本相关） | `docs/CANGJIE-KERNEL.md` §9（坑 101）、§10（夜版质量）；`docs/DEVELOPING.md:453`（坑 101） |
| 泵窗口阻塞：`RunUIScheduler(2ms)` 在作业计算期间阻塞 Electron 主进程对应时长（release 编译后 20ms 级，可接受；drainer cjthread fib(32) debug 60ms → release 20ms） | **性能差异** | `docs/CANGJIE-KERNEL.md` §10（生产编译）、§11-5 |
| **七、资源** | | |
| `$r('app.*')` 解析（R128 收口后）：生成表（harmony-proj 资源 + 编译器 ids_map，byId 14 条）+ `resourceManager` 真实现（getStringSync/getColorSync 0xAARRGGBB/getMediaContentSync Uint8Array）；未知资源兜底 = 名字进名字出 + 警告。真机是完整 HAP 资源管线；本表由构建时同步生成（`--check` 防漂移） | **行为差异**（app.* 已真解析；管线来源不同） | `docs/ROADMAP.md:2056`（R128）；`docs/CAPABILITY.md:323` 的"空壳/兜底值"表述早于 R128，以 R128 为准 |
| 系统资源与限定词：`sys.*` 系统资源无运行时解析（主题真值是构建期从 SDK 系统资源反查后固化的，R123）；深色模式/语言/分辨率等限定词目录不参与解析 | **功能缺失** | `docs/ROADMAP.md:2056`（R128 范围=app.*）、R123 条目（`git show ee34d05`）；`docs/DEVELOPING.md:446`（坑 94 的真值方法） |
| `@ohos:measure` 的 `textContent`/尺寸传 `Resource` 引用 → 按空串/默认值处理并记警告（R128 未覆盖 measure 模块） | **行为差异** | `docs/CAPABILITY.md:236-241`；实测同 HEAD（`runtime/ohos-shims.js:601-604`） |
| `Rating.starStyle` 是图片 URI，无图片加载管线 → 退化为内置星形并记警告 | **行为差异** | `docs/CAPABILITY.md:234`；`docs/ARCHITECTURE.md:847` |

## 第六端机器对拍（R163 首轮，2026-10-04）

**方法**：`tools/hm-pages.py`——55 个 main_pages 页面逐页在官方模拟器（真 ArkUI）启动
（EntryAbility `--ps hm_page` 通道），`uitest dumpLayout` 取 app 子树可见文本流，与
同一 fixture 在我们运行时（`test/hm-harness.html` + headless Chrome）的 #root 文本流
归一化逐字符对拍（`tools/hm-pages.sh` 包装器落 `build/assert-counts-hm.tsv`，
双侧全文在 `build/hm-pages.log` 的 `@@TEXT` 块）。**首轮结果：PASS 22 / DIFF 33 / INFRA 0**。
这是本清单首次**机器自动**产差（此前为人工
读真机 C++ 源码考证）。

**已分类的 DIFF 形态**（详单见 tsv，未分类的按形态复用这些类）：
| 形态 | 例 | 定性 |
|---|---|---|
| 真机 API 语义更严 | **MeasNotify**：通知权限禁用（`e1:Notification disabled`）+ `publish` 缺参**同步抛 401**（垫片宽松不抛）——真机 jscrash 进程终止，fixture 已加 sync 兜底（R163 故障日志 `MeasNotify.ets:26:25/60:25`） | **行为差异**（新，本轮最重发现） |
| 错误文案语言 | PromptAct：真机英文 `Required input parameters are missing` vs 垫片中文 `message 未指定` | **行为差异**（文案，语义同） |
| 平台内容 | NotesHome：UA 字符串（OpenHarmony vs Mozilla）进页面 | 环境差异（预期） |
| 时钟敏感 | TextTimeDemo/TimePickerDemo：两侧采集时刻不同 | 环境差异（对拍需时钟归一） |
| 视口/挂载窗口 | ScrollDemo/NavTransDemo/PerfBigDemo/Stress*：设备 dumpLayout 只含可见/已挂载子树，浏览器 TreeWalker 含全部 DOM | **口径差异**（对拍需视口归一，非渲染错） |

### R165 二轮完全分类（rootdump 真实时钟通道，55 页 33 DIFF 逐项裁定）

通道升级后全量复跑（`browser 侧同步 rootdump 化`），33 DIFF 逐项分类：

**硬发现（真渲染/行为差异，11 项——逐项待单独立项对齐）：**

| 页 | 双侧差异 | 定性 |
|---|---|---|
| AnimatorDemo | 设备多 `FIN;`（动画完成回调） | 行为差异：Animator onFinish 派发时机 |
| BuiltinDemo | 浏览器多 `P1P2/S0S1S2/L0L1L2` 指示器文本 | 渲染差异：指示器/拷贝是否进 a11y 树 |
| GridDemo | `I0,5` vs `I0,4`（onReachEnd 索引差 1） | **行为差异**：到达判定边界 |
| ListGroupDemo | 浏览器多 `GA尾gb0gb1gb2`（尾组） | 渲染差异：ListItemGroup 尾组挂载 |
| PanelDemo | `bodyh=1137` vs `bodyh=0` | **渲染差异**：Panel body 高度测量 |
| PopDemo | 设备 `Choosed+选项` vs 浏览器 `ABCXY+✓` | 渲染差异：Select 选中态呈现 |
| ShowDemo | 浏览器多 `Hello/marquee` | 渲染差异：Show/隐藏态是否进树 |
| SideBarDemo | 浏览器多 `→`（箭头） | 渲染差异：图标文本化 |
| StepDemo | 浏览器多 `back0step1step2` | 渲染差异：Stepper 状态文本 |
| TextPickerDemo | 选中集/选项集不同（设备含重复选中态） | 渲染差异：picker 选中与选项呈现 |
| BatchVerifyDemo | 设备含 `<b>` HTML 转义原文 | 序列化口径：富文本转义 |

**口径类（非渲染错，22 项归 5 类）**：视口/挂载窗口 ×10（AttrHeavy/Motion/NavBar/
NavTrans/PerfBig/Scroll/Stress1k/Stress10k/WaterFlow/NotesHome 部分）；value 型
a11y 口径 ×3（BatchInput/Image/TextDemo——设备 a11y 含 input/select 的 value，
浏览器 textContent 不含）；时钟/本地化 ×3（TextTime/TimePicker/CalendarPicker
——采集时刻与 年月日 格式）；平台内容 ×3（Notes UA/Cjk degraded 标记/RichVideo
软渲无日志）；已知 API 语义 ×2（MeasNotify/PromptAct，见上表首行）。

**对拍方法论补强（R165）**：browser 侧同步 rootdump 化（真实时钟 CDP——B0 实证
--dump-dom 虚拟时钟终态树不完整不可信）；value 型组件与视口两类的**口径归一**
（compare 前归一化）是 DIFF 收敛到真语义差的前置工程。

### R166 口径归一后终态（55 页：PASS 22 + PASS-SUBSET 13 + DIFF 20）

**归一手段**：①harness 采集补 value 型（input/textarea/select 的 value 按文档序进
文本流——真机 a11y 含 value、浏览器 textContent 不含，TextDemo 31v7 实锤即此口径）；
②判定加 PASS-SUBSET 档（设备文本流是浏览器流的子序列 = 挂载窗口口径归一——
设备 dumpLayout 只含可见/已挂载子树）。13 项视口/挂载类归一收敛（AttrHeavy/Motion/
NavBar/NavTrans/PerfBig/Scroll/Stress1k/Stress10k/WaterFlow/ListGroup/Step/
RichVideo/Image）。

**剩余 20 DIFF 终分类**：

硬发现（12——逐项待对齐，每项独立切片）：
| 页 | 双侧差异 | 定性 |
|---|---|---|
| AnimatorDemo | 设备多 `FIN;`（onFinish 完成回调） | 行为差异：Animator 完成回调派发时机 |
| BuiltinDemo | 浏览器多 `P1P2/S/L` 指示器文本 | 渲染差异：指示器是否进 a11y 树 |
| GridDemo | `I0,5` vs `I0,4`（onScrollIndex last 差 1） | **视口口径**：设备竖屏可见 6 行 vs 浏览器窗口 5 行（测试页 :81 断言 I0,4 本按我们视口定；非行为差） |
| PanelDemo | ~~`bodyh=0`~~ → 修复后 `h=221/202`（真机 1137 同构语义） | **已修复（R165）**：onHeightChange 零派发+高度档位 CSS 未实现+同值早退跳过首派——四层根因全修，数值环境相关 |
| PopDemo | 设备 `Choosed+选项` vs 浏览器 `BA+ABCXY+✓` | 渲染差异：Select 选中态/面板呈现 |
| ShowDemo | 浏览器多 `Hello/marquee` | 渲染差异：隐藏态内容是否进树 |
| SideBarDemo | 浏览器多 `→` | 渲染差异：图标文本化 |
| **TextDemo** | 设备多 `TIseed;SEhello;` | **行为差异**：真机初始渲染即派发一次 onChange（value 型），垫片不派发 |
| TextPickerDemo | 选中集/选项集不同 | 渲染差异：picker 选中与选项呈现 |
| BatchVerifyDemo | 设备含 `<b>` 转义原文 | 序列化口径：富文本转义 |
| InputDemo | 设备 `cb1ck2ab40.000000` vs 浏览器 `onabon40` | value/checked 口径残余（checkbox/slider 状态进 a11y） |
| BatchInputDemo | 设备 `fruitsapplebanana` vs 浏览器 `on` | value 口径残余（select/option 树） |

口径/环境（8）：MeasNotify（已知 API 语义）、PromptAct（错误文案语言）、NotesHome
（平台 UA）、CjkDemo（仓颉编码器 degraded 标记——环境）、RichText 转义归
BatchVerify、TextTimeDemo/TimePickerDemo/CalendarPickerDemo（时钟采集时刻 +
年月日本地化格式——对拍需时钟/格式归一）。

## 本清单的边界

**"语义一致性断言"覆盖了什么**——三层一致性模型（R95，`docs/ARCHITECTURE.md:49-53`）中，
前两层是"该一致"且**有断言守着**的层：

1. **产物/契约层（✅ 完全一致）**：同一份官方 ets-loader 产物、同一套 ViewPU/ObservedProperty
   协议、同一份 `.d.ts` 权威。fixtures 是官方 hvigor 管线的真产物（6 页中 5 页与构建缓存逐字节相同），
   不是手抄（`docs/ARKVM-RESEARCH.md` §4）。
2. **语义行为层（✅ 对照一致）**：**双端矩阵断言对真机源码**——86+62+16+15+11 条断言对照
   ace_engine 的 pattern 层 + declarative_frontend 的 JSI 桥层（`docs/ARCHITECTURE.md:52`；
   仓库 1000+ 断言即对照记录，`:31`）。时序类语义只认真机 C++ 调用点、不认 JSDoc
   （`docs/DEVELOPING.md:446`，坑 94——Stepper 三处分歧照 `stepper_pattern.cpp` 纠偏即 R39 先例）；
   极端 case 下编码器与真机**字面上同一份代码**（QRCode：OHOS arkui_qrcodegen C++ 源码逐字复制
   经 emscripten 编 WASM，`docs/CAPABILITY.md:114`、`docs/ROADMAP.md:1201` R41）。
   R43 一类的"确证轮"持续把推断升级为真机参数（`docs/ROADMAP.md:1184-1199`）。

**没覆盖什么**（评审时对"一致"二字打折扣的地方，逐条如实）：

1. **无真机硬件**：全部对照是对**真机源码**（`arkui_ace_engine` 树）与**字节码**的静态对照，
   不是对真设备的实测。`docs/CAPABILITY.md:341` 明示未验证：真机行为差异、多窗口、并发/性能、
   跨机器/跨用户的持久化。
2. **无 PandaVM/ArkVM**：CLT 里没有 `ark_js_vm`，`.abc` 在本地无法执行——一切"语义一致"都是
   **字节码级同构判断，不是执行级等价证明**（`docs/ARKVM-RESEARCH.md` §0-④、§10-#1）。
   执行级真值表（`finally`、`isTrue`/falsy、`ldbigint` 运算精度）没有证据。
3. **真机状态管理实现不可得**：`stateMgmt.js`/`ObservedObject.createNew` 不在 CLT 里——
   "`@Observed` 真机也用 Proxy"仍是未证事实，本项目实现对其 `instanceof`/序列化/展开运算符等
   反射边界**未验证**（`docs/ARKVM-RESEARCH.md` §7.3、§10-#2；`docs/CAPABILITY.md:296-298`）。
4. 字节码细节未取证：`definegettersetterbyvalue` 产出的 `enumerable`/`configurable`、
   `tryldglobalbyname` 在"全局记录 vs 全局对象"上的回退次序（`docs/ARKVM-RESEARCH.md` §10-#3/#4）。
5. **previewer 原生栈不复刻、不嵌入**（R24 收口三层证据钉死，`docs/ROADMAP.md:2753-2805`）：
   SDK 预览器独立启动崩在窗口管理层（Rosen 绑定缺失，发生在用户 JS 装载之前）——它只作语义参考，
   不构成第三条执行路径。
6. 仓颉内核嵌入约束（坑 101-104）是 nightly 工具链实测，stable 未验证
   （`docs/CANGJIE-KERNEL.md` §10）。

**一句话**：本清单回答"评审该问哪些问题"；三层一致性模型回答"哪些问题已经有断言在守"。
第三层（实现语言层 ❌ 刻意不一致）是产品差异化本体，不是待消除的债务
（`docs/ARCHITECTURE.md:53`）。
