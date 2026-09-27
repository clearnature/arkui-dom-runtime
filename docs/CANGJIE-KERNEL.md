# 仓颉内核接线技术文档（@ohos:cjk）

> 状态：**R97-R100 四连片交付，全链路可用（能力面为骨架级）**。本文是汇总统稿——
> 把散在 ROADMAP / DEVELOPING / 源码头注里的仓颉内核知识收拢为一篇入口文档；
> 演进历史与逐条验收数字的权威仍在 `docs/ROADMAP.md` R96-R100 条目。
> 最后更新：2026-09-27（对应 commit dffe7cf / 7991b6d / df11a83）。

---

## 1. 定位

arkui-dom-runtime（自研 JS DOM 运行时）与自研仓颉内核的**进程内互操作**。互操作协议由
本项目自定义——**不依赖华为 cjffi/ark_interop**（那套绑定 PandaVM 的 JSContext/JSRuntime，
本架构无 PandaVM）。渲染侧一行 `cjk.call('fib', {n: 24})` 直达内核，46368 由仓颉堆上的
递归真实算出（见 `test/cjk.html`）。

设计目标（`kernel/c-abi.h` 头注原文）：**内核能做什么由 method 字符串决定，ABI 永不变化；
换内核 = 换 .so，宿主零改动**。c-abi.h 按多语言内核设计（仓颉/Rust/Go/Haskell 皆可实现
同一契约），当前唯一已验证的内核是仓颉版。

## 2. 四层架构

| 层 | 文件 | 职责 |
|---|---|---|
| 内核 | `kernel/cangjie/src/kernel.cj` → `libkernel.so` | 实现 `kernel/c-abi.h` 全部符号；注册表/邮箱/作业队列 + 递归计算等业务逻辑 |
| 桥 | `bridge/napi/cjk_napi.cc` → `cjk_napi.node` | dlopen 运行时 → InitCJRuntime → dlopen 内核 → dlsym → 后置驱动（泵调度）；NAPI ABI 跨 Node/Electron 通用 |
| 主进程 | `electron/main.js` + `electron/preload.js` | `ipcMain.handle('arkui:cjk:*')` 四处理器；**惰性挂载**（首个 cjk 调用才 dlopen，无 SDK 时其余页面零依赖）；preload `electronAPI.cjk` 失败免疫 |
| 垫片 | `runtime/ohos-shims.js` 的 `@ohos:cjk` | `isAvailable/call/ping/lastError`；params 对象自动 JSON 序列化；浏览器端探测式降级 |

调用链（桌面线）：

```
渲染进程（Chromium）                    Electron 主进程（Node）
┌──────────────────────────┐           ┌─────────────────────────────────┐
│ ets-loader 产物页面        │           │ electron/main.js                │
│   │ __arkui_dom_require   │ ipc invoke│   ipcMain.handle('arkui:cjk:*') │
│   ▼                      │ ────────► │   │ require('../bridge/napi/…)  │
│ @ohos:cjk 垫片            │ via       │   ▼                             │
│ (runtime/ohos-shims.js)  │ preload   │ NAPI addon → dlopen 仓颉运行时    │
│ electronAPI.cjk.call()   │ electronAPI│ InitCJRuntime → RunUIScheduler 泵│
└──────────────────────────┘ .cjk      │ dlopen libkernel.so → dlsym 直调 │
                                       └─────────────────────────────────┘
```

浏览器端：无主进程桥 → 探测式降级（R21 先例）：`isAvailable()=false`、`call` 返 null
不抛、`ping=-1`。断言页按端分流（见 §8）。

## 3. ABI 契约（`kernel/c-abi.h`）

### 3.1 六个核心符号（必备）

```c
int   kernel_init(const char *config_json);   // 初始化；返回 0 成功
int   kernel_shutdown(void);                  // 优雅关闭；返回 0
const char *kernel_call(const char *method,
                        const char *params_json); // 万能分派口；失败返回 NULL
void  kernel_free(void *ptr);                 // 释放内核分配的返回缓冲
int   kernel_ping(void);                      // 0=健康，非 0=不可用
const char *kernel_last_error(void);          // 最近一次错误；空串/NULL=无
```

**内存所有权**：`kernel_call` 返回值由内核 malloc，宿主读出后必须 `kernel_free`；
`kernel_last_error` 的缓冲由内核在下次调用时自行释放（宿主读出即用，不持有）。

**数据格式**：method 为方法名字符串，params 与返回均为 JSON 字符串（紧凑形式）。

### 3.2 三个可选调度符号（R100 起，异步作业内核才需要）

```c
int   kernel_pending(void);          // pending 作业队列长度
int   kernel_draining(void);         // drainer 是否在跑（1=在跑）
void* kernel_drain_entry(void*);     // 有界 drainer 入口（清空队列即返回）
```

三符号**全部缺席 = 同步内核**，宿主自动跳过驱动，向后兼容（addon 按 dlsym 探测）。
另有可选 `kernel_abi_version()`（R102）：返回契约版本 = 主版本*10000 + 次版本
（当前 10001）；缺席 = v1.0 旧内核；宿主规则：内核主版本 > 宿主认识的 → 拒绝挂载
（向前不兼容防呆），`cjkKernelVersion()` 可查（0 = 旧内核无符号）。
宿主义务与嵌入模式约束见 §5 与 c-abi.h 头注。

### 3.3 演进纪律

- 业务扩展 = 加 method，**不加符号**——ABI 一字未动扛过 v2→v3→v4 三次内核演进；
- 符号只增不改不删；新增符号必须走"可选 + dlsym 探测 + 缺席降级"路线；
- 内核签名级改动（如 R97→R98 从数字签名换成全契约）= 破坏性变更，需换 major 并重验三层测试。

## 4. 挂载序列（宿主侧）

按序严格执行，顺序或前置条件错误即崩（各步骤的失败模式见 §9 坑表）：

```
0. LD_LIBRARY_PATH 含 <SDK>/runtime/lib/linux_x86_64_cjnative
   ★ 必须在进程启动前导出：libcangjie-std-core.so 无 DT_SONAME，
     预载无法满足内核 DT_NEEDED 匹配，只能走搜索路径
   （electron/run.sh 自动探测 nightly-current 软链并导出 CANGJIE_RT_LIB + LD_LIBRARY_PATH）
1. dlopen("libcangjie-runtime.so", RTLD_NOW | RTLD_GLOBAL)
2. dlsym(rt, "InitCJRuntime")
   显式 RuntimeParam：heap/gc/co 字段保持 0（=各字段文档默认值），仅
   logParam.logLevel = RTLOG_ERROR（R104）——零内存落成 VERBOSE(0)，运行时
   启动/GC 日志会全部直通 stderr；跳过 InitCJRuntime 则内核内任何堆操作 SIGABRT
3. dlopen(内核.so, RTLD_NOW | RTLD_GLOBAL)
4. dlsym 六核心符号（+可选调度/版本符号，缺席容忍）
5. kernel_init("{}")   ← re-init = 全新内核（agent/作业状态清零，测试隔离语义）
```

Electron 主进程为**惰性挂载**（`electron/main.js` 的 `cjkEnsure`）：首个 cjk IPC 调用
才加载 addon 与 dlopen；失败以 `{error}` 返回、`call` 返 null，渲染侧经 `lastError`
取因——初始化绝不让其他页面失败。

## 5. 执行模型：嵌入泵模式（并发三条铁律）

官方导出 InitCJRuntime/RunCJTask/RunUIScheduler，但嵌入行为的实际语义**官方文档零承诺**，
以下全部为本机 nightly 实测钉死（坑 103/104，探针过程见 ROADMAP R100）：

1. **cjthread 只在 `RunUIScheduler(ms)` 泵的窗口里执行**。`RunCJTask` 返回非空句柄但
   任务不跑（心跳计数器实测 loops=0），必须宿主显式泵；不泵则整个 Cangjie 任务世界冻结
   （空闲零 CPU 是这个模型的副产品优点）。
2. **`sleep()` 在此模式下是空操作**（timer 线程不跑，睡的任务永不醒）→ 等待逻辑禁止
   自旋/睡眠，长任务走**有界 drainer**：清空 pending 队列即返回，宿主在下一次
   kernel_call 时按需重启。
3. **`Semaphore`/`Monitor` 等阻塞唤醒原语不能从宿主原生线程（@C 帧内）调**——栈腐蚀/
   垃圾返回值；`spawn{}` 同样禁止从 @C 帧内调（SIGSEGV）。跨线程同步**只用 `Mutex`**
   （纯 futex 实现，宿主线程安全）；cjthread 拉起一律宿主 `RunCJTask`。

**驱动链路**（`bridge/napi/cjk_napi.cc` 的 `drive()`，每次 `cjkCall` 后置执行）：

```
worker 数目标 = min(pending, 4)                        ← 宿主策略上限（c-abi.h 文档）
draining(活跃数) < 目标 → 逐支 RunCJTask(drain_entry)   ← R105：worker 可重入，并发多支
pending > 0 或 draining > 0 → RunUIScheduler(2ms)       ← 给执行窗口
```

**并行证据（R105 实测）**：4×fib(28) 由 4 支 worker 并行执行，`agent.timings` 的两两
时间窗 **6/6 全重叠**、总窗 3.4ms vs 作业时和 10.9ms = **3.17x 加速**——时间戳重叠
排除"协作式单线程交错"（fib 无让点，串行窗口必然不相交）。

渲染侧零感知：`agent.submit` 后反复调用 `agent.result` 轮询即自然推进（每次轮询的
kernel_call 都会触发 drive）。

## 6. 内核方法面 v1 全表（`kernel_call` 分派）

请求/返回均为 JSON。所有方法都要求先 `kernel_init`（否则 NULL + last_error 报 not initialized）。

| method | params → 返回 | 语义 |
|---|---|---|
| `echo` | `{"x":1}` → 原样返回 | JSON 直通（UTF-8 往返保真） |
| `add` | `{"a":20,"b":22}` → `{"sum":42}` | 手写 JSON 整数扫描，支持负数 |
| `fib` | `{"n":24}` → `{"result":46368}` | 递归计算，n∈[0,40]（越界报错） |
| `upper` | `{"text":"ab"}` → `{"text":"AB"}` | ASCII 大写（不处理转义/多字节） |
| `error` | 任意 → NULL | 强制失败路径（测试 last_error 用） |
| `agent.spawn` | `{"name":"x"}` → `{"id":1,"name":"x","state":"idle"}` | 注册；id 单调；无名给 `agent-N` |
| `agent.list` | `{}` → `{"count":N,"agents":[…]}` | 按 spawn 序（HashMap 无序，确定性靠 side 列表） |
| `agent.send` | `{"id":N,"text":"…"}` → `{"queued":长度}` | 入邮箱（FIFO） |
| `agent.poll` | `{"id":N}` → `{"messages":[…],"drained":N}` | **排空语义**（读即清） |
| `agent.kill` | `{"id":N}` → `{"killed":"name"}` | 摘除，spawn 序表同步收敛 |
| `agent.submit` | `{"id":2,"kind":"fib","n":20}` → `{"jobId":1,"state":"pending"}` | 异步作业入队即返回；kind 校验 fib/echo；agent 必须存在 |
| `agent.result` | `{"jobId":1}` → `{"state":"pending"}` / `{"state":"done","value":6765}`（echo 型返回 `text`） | 轮询取结果；**仅 state==1 报 done**，claimed/in-flight 报 pending（坑 105）；宿主后置驱动自动推进 |
| `agent.timings` | `{}` → `{"n":K,"t":[[startNs,endNs],…]}` | 已完成作业时间窗（完成序）——两两窗口重叠 = 多 worker 真并发证据（R105） |
| `sys.snapshot` | `{}` → `{"v":1,"nextId":N,"n":K,"a":[[id,"name","box"],…]}` | 快照注册表+邮箱+id 计数器（box 内消息以 SOH 分隔、转义 `"`/`\`/SOH）；**作业不快照**（R106） |
| `sys.restore` | snapshot 原文 → `{"restored":K}` | 整体替换注册表+邮箱，nextId 随快照、作业计数器归位；定位解析只认 snapshot 自产格式（R106） |

三类失败路径统一形态：返回 NULL + `kernel_last_error` 给因（未知 method / 参数缺失 /
未知 id / 越界），错误不破坏服务（`ping` 仍 0，后续调用正常）。

## 7. 如何扩展

### 7.1 加一个 method（仓颉内核）

1. `kernel/cangjie/src/kernel.cj` 的 `kernel_call` 加一个 `if (m == "xxx")` 分支：
   - 参数解析用 `jsonInt(p, "key")` / `jsonStr(p, "key")`（返回 `?T`，`.getOrThrow()` 取值）；
   - 响应用 `ByteBuf` 拼接：`b.str(...)` / `b.int(...)`（**数字禁止 `Int64.toString()`**，
     坑 101）+ `stringToCs(b.done())` 返回；
   - 失败路径：`setErr("...")` + 返回 `CPointer<UInt8>()`（空指针，isNull 语义）。
2. 编译：`cjc src/kernel.cj --output-type=dylib -o libkernel.so`
   （envsetup 后运行；引入 std.collection/std.sync 需知坑 102 的惰性构造约束）。
3. 三层测试同步扩（见 §8）：契约测试 → smoke → cjk.html（Electron 分支）；
   cjk.html 断言数变化须同步 ROADMAP 声明（沿革注记格式，见 §8 计数守门）。

### 7.2 用其他语言写内核（契约兼容性）

c-abi.h 是纯 C ABI，任何能导出 C 符号、能编译 .so 的语言都可实现。宿主（addon）零改动：

- **必需**：6 核心符号精确导出（C++ 加 `extern "C"`；Rust `#[no_mangle] pub extern "C"`
  + `panic=abort`；Go 用 cgo `//export`；Haskell `foreign export ccall` + 启动时 hs_init）。
- **可选**：三调度符号 + 宿主泵契约——等价于 GHC 的 hs_init/hs_exit 教科书方案
  （"AOT 语言 + 富 RTS 被外部宿主调用"），仓颉的 InitCJRuntime 即其对应物。
- **诚实边界**：以上仅仓颉版经过 49+18+26 条断言验证；Rust/Go/Haskell 是可行方向而非
  已验证事实。各语言运行时自身的嵌入约束（Go 的 goroutine 调度、Haskell 的 RTS 参数）
  需按坑 103/104 的同类思路实测钉死后再立项。

## 8. 测试与守门

三层，全部可独立复跑（本机实测数：49 / 18 / 26+6）：

| 层 | 命令 | 覆盖 |
|---|---|---|
| C 契约测试 | `cd kernel/cangjie/test && gcc kernel_contract_test.c -o kernel_contract_test -ldl && LD_LIBRARY_PATH=<SDK运行时库目录> ./kernel_contract_test` | 生命周期/全部方法语义/错误路径/re-init 隔离/C 宿主自驱动 drain |
| NAPI 冒烟 | `cd bridge/napi && CANGJIE_HOME_TEST=<运行时库目录> KERNEL_LIB_TEST=<内核.so> LD_LIBRARY_PATH=$CANGJIE_HOME_TEST node smoke.cjs` | addon 透传 + 后置驱动自动推进 |
| 端到端 | `bash electron/run.sh cjk`（桌面真内核）；`bash run.sh cjk`（浏览器降级面） | 渲染进程直达内核的完整生命周期 |

- `<SDK运行时库目录>` = `/data/work/compiler/cangjie/Nightly/cangjie-nightly-current/runtime/lib/linux_x86_64_cjnative`。
- **双端分流惯例**：cjk 两端断言数不同（桌面 26 / 浏览器 6），**不进浏览器 all 矩阵**、
  ROADMAP 只写一处 Electron 声明——计数守门（`tools/assert-counts.mjs`）按端核对且
  `electron/` 前缀可选，双声明会假红（windowdemo/pickerdemo 先例）。
- 声明数沿革写法：`26 条断言：R98 时 15、R99 起 21、R100 起 26`。

## 9. 坑速查（细节权威：`docs/DEVELOPING.md` 坑 101-104）

| 坑 | 症状 | 修法 |
|---|---|---|
| 101 | `Int64.toString()` 在 @C 帧内返回头部损坏的 String（`.size`=6399178 族垃圾值） | 数字一律手写 ASCII（`ByteBuf.int`）；字符串只走 `String.fromUtf8`；`free` 前 `isNull()` 守卫；`dlerror()` 只取一次 |
| 102 | 包级 `let gMap = HashMap()` 全局槽是垃圾，首用 SIGSEGV（栈顶 std/collection） | 容器全局量 `Option<容器>` 字面默认 + 首用时惰性构造（`agentsOf()` 模式）；`ArrayList.get(i)` 返回 `Option<T>` |
| 103 | Semaphore/Monitor 宿主线程调用栈腐蚀；`spawn{}` 从 @C 帧内 SIGSEGV | 跨线程同步只用 Mutex；cjthread 拉起一律宿主 RunCJTask；等待逻辑禁自旋 |
| 104 | RunCJTask 句柄非空但任务不跑；sleep 永不醒 | cjthread 只在 RunUIScheduler 泵窗口执行——有界 drainer + 宿主逐调用后置驱动（addon `drive()`） |

## 10. 版本与部署约束

- **工具链**：系统默认即最新线——`.bashrc` 末行自动 source `nightly-current`
  （→ 1.3.0-alpha.20260919003053；三条线 LTS 1.0.5 / STS 1.2.0 / nightly 中最新）。
  **不存在"SDK 升级"待办**（R96 时代 spike 在 1.1.3 上的结论已废，ROADMAP R96.3 有注记）。
- **锁版本纪律**：SDK 间 dylib 二进制不兼容——`cjnightly-fetch` 刷新 nightly-current
  软链后，`libkernel.so` 必须重编并复跑三层测试（`electron/run.sh` 探测的是软链指向，
  不锁具体版本号）。
- **夜版质量**：坑 101-104 均为 nightly 实测，stable 1.2.0/1.0.5 未验证。
- **生产编译**（R103 实测，2026-09-27 nightly 1.3.0-alpha）：构建走
  `bash kernel/cangjie/build.sh`（默认 `-O2` release；`BUILD=debug` 可切）。同口径
  对比：drainer cjthread 内 fib(32)（217 万次递归）debug **60 ms** → release **20 ms**
  （3x）。修正 R100 时的未验证假设——"百毫秒级"并不成立（debug fib(32)=60ms），
  但 release 对高频调用仍值得。`RunUIScheduler(2ms)` 泵窗口在作业计算期间仍会
  阻塞主进程对应时长（20ms 级可接受）。
- **打包**：分发形态需随包携带内核 .so 与仓颉运行时库（依赖清单见 §4 步骤 0），
  `tools/package-app.mjs` 尚未覆盖仓颉运行时——分发场景立项时补。

## 11. 边界与未竟事项（诚实清单）

由 trha（Haskell 微内核 agent harness 的仓颉重写）真实需求牵引，不做空转加固：

1. 作业 kind 只有 fib/echo 演示——agent 调度逻辑本身是 trha MVP 的内容；
2. drainer 单支（一队一清），多 worker 并行未做；
3. 无真实 .ets fixture 页面消费 `@ohos:cjk`（只有测试页）；
4. 内核状态纯内存、跨进程重启即失；内核换版需重启进程（addon 幂等加载，不热替换）；
5. `RunUIScheduler` 泵窗口阻塞 Electron 主进程（§10 生产编译项缓解）；
6. JSON 手写扫描只支持紧凑形式 + 整数；agent 的 name/text 不处理引号转义。
   传输层限制已由 R101 消除（addon 取全长再分配，>1MB 显式抛错——不再静默截断）。

## 12. 相关文档与提交

- 演进历史与验收：`docs/ROADMAP.md` R96（挂载路径定型）、R97/R98（全链路）、R99（数据面）、
  R100（控制面/泵模式）；
- 坑全录：`docs/DEVELOPING.md` 坑 101-104；
- 调研归档：`docs/research/cjk-spike.md`（trha/deepseek-harness/GHC 类比、官方文档核验）；
- ABI 权威：`kernel/c-abi.h`（本文 §3 是导读，冲突时以头文件为准）；
- 提交：dffe7cf（R98）、7991b6d（R99）、df11a83（R100）；Mimosa deep 审计逐片 0 findings
  （最新 seal sha256:566b38d0…）。
