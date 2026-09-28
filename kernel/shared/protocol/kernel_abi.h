/*
 * kernel/shared/protocol/kernel_abi.h — 多语言内核统一 C ABI 契约（R95/R96 起；R111 归位于此）
 *
 * 旧路径 kernel/c-abi.h（R97-R107 期间）已移至本文件，内容延续。
 *
 * 设计原则：
 *   1. 6 个核心符号。内核能做什么由 method 字符串决定，核心 ABI 永不变化。
 *   2. 数据格式 = JSON 字符串（所有语言都有 JSON 库）。
 *   3. 内存：内核分配（kernel_call/kernel_echo 返回值），宿主用 kernel_free 释放。
 *   4. 换内核 = 换 .so 路径（单内核路线：一次一个内核，配置切换）；同进程多内核
 *      共存走 addon 命名槽（混合路线，R107）。
 *   5. 每种语言内核必须实现这些符号（extern "C" / @C / #[no_mangle] / cgo //export），
 *      编译为 .so 后由宿主 dlopen + dlsym 加载。已实证语言：仓颉（kernel/cangjie/）、
 *      纯 C（kernel/c-sample/，R107）。
 *
 * 双轨调用（R112 起）：
 *   · 万能口 kernel_call(method, params_json)——所有方法的 JSON 分派（必备）；
 *   · 类型化直调符号 kernel_add / kernel_echo——固定热路径零序列化直调（可选，
 *     缺席回落万能口）。语义与 JSON 方法面一致；返回值由内核分配、宿主 kernel_free。
 */
#ifndef CJK_KERNEL_ABI_H
#define CJK_KERNEL_ABI_H

#include <stdint.h>

/*
 * ABI 版本握手（R102，可选符号）：
 *   int kernel_abi_version(void);
 * 返回内核实现的契约版本 = 主版本*10000 + 次版本。缺席 = v1.0 旧内核，宿主容忍。
 * 宿主规则：内核主版本 > 宿主认识的 → 拒绝挂载（向前不兼容防呆）；次版本更高 → 放行。
 * 当前宿主认识 KERNEL_ABI_VERSION（10001 = 六核心符号 + 三可选调度符号）。
 */
#define KERNEL_ABI_VERSION 10001

/* ── 核心 6 符号（必备）── */

/*
 * kernel_init: 初始化内核。
 * config_json: JSON 格式的内核配置（各语言自行解析内部结构）。
 * 返回: 0 成功，非 0 失败（错误详情可调 kernel_last_error 获取）。
 */
int kernel_init(const char *config_json);

/*
 * kernel_shutdown: 优雅关闭内核。
 * 返回: 0 成功。
 */
int kernel_shutdown(void);

/* ── 方法调用（万能接口：所有业务通过 method 分派）── */

/*
 * kernel_call: 按方法名分派到对应处理器。
 * method:      方法名（如 "echo", "add", "agent.spawn", "sys.snapshot"）
 * params_json: JSON 格式参数
 * 返回:        JSON 字符串（由内核 malloc），宿主用 kernel_free 释放。
 *              失败返回 NULL（错误详情可调 kernel_last_error 获取）。
 */
const char *kernel_call(const char *method, const char *params_json);

/*
 * kernel_free: 释放由内核分配的内存（kernel_call / kernel_echo 返回值）。
 */
void kernel_free(void *ptr);

/* ── 健康 / 错误 ── */

/* kernel_ping: 健康检查。返回 0 = 正常。 */
int kernel_ping(void);

/*
 * kernel_last_error: 获取最近一次错误的描述。
 * 返回: 错误消息字符串（由内核分配，下次调用时释放）。无错误返回 NULL。
 */
const char *kernel_last_error(void);

/*
 * ── 可选调度符号（R100 起，实现异步作业的内核才需要）──
 *
 * 内核可声明这些额外符号，把耗时计算交给内核侧 cjthread 异步执行：
 *   int   kernel_pending(void);       pending 作业队列长度
 *   int   kernel_draining(void);      活跃 worker 数（R105 起为计数；R100-R104 为 0/1）
 *   void* kernel_drain_entry(void*);  有界 worker 入口（清空队列即返回；
 *                                     R105 起可重入——多支并发拉起即多 worker，
 *                                     领取互斥由内核 Mutex 保证）
 *   int   kernel_abi_version(void);   契约版本（R102，见文件头）
 *
 * 宿主义务（bridge/napi/cjk_napi.cc 的 cjkCall 后置驱动已实现）：
 *   worker 数 = min(pending, 4)（宿主策略上限 4）；draining < 目标数的差额逐支
 *   RunCJTask(kernel_drain_entry, NULL) 拉起，然后 RunUIScheduler(2ms) 给执行窗口。
 *
 * 嵌入模式实测约束（坑 103/104，2026-09-27 nightly 1.3.0-alpha）：
 *   · cjthread 只在 RunUIScheduler 泵的窗口里执行；sleep 是空操作（timer 不跑）；
 *   · Semaphore/Monitor 等阻塞唤醒原语不能从宿主原生线程调（栈腐蚀）；
 *     队列同步只用 Mutex（纯 futex，宿主线程安全）。
 * 符号缺席 = 同步内核（R97-R99 形态），宿主自动跳过驱动，向后兼容。
 */

/* ABI 版本握手（可选；见文件头注释）。内核实现时应返回 KERNEL_ABI_VERSION。 */
int kernel_abi_version(void);

/*
 * ── 内核实现纪律（R118 坑 108 之后确立）：单语言封闭、不混合调用 ──
 *
 * 每个内核是【单一语言的封闭单元】，其实现必须满足：
 *   1. 内核间只经宿主 ABI（本头文件的符号 + kernel_call 分派）交互，
 *      永不直接调用另一个内核的代码；
 *   2. 内核【内部】对自身导出符号（kernel_*）的自引用不得依赖动态绑定：
 *      C/C++ 提为 static（本地绑定）；Go/Rust/Haskell 用非导出名的内部函数
 *      （编译器链接期内部解析）。宿主以 RTLD_GLOBAL 加载（仓颉运行时必需），
 *      全局符号表中同名导出会被【后加载者胜出】——自引用经 PLT 会跳进别的
 *      内核的 kernel_init（R118 实测 SIGSEGV，C 内核 do_init 静态化修复）；
 *   3. 宿主的 dlsym 按 handle 限定（无冲突）——风险只在内核自身代码的动态绑定。
 * 违反判据：崩溃栈位于【另一语言内核】而调用方是本内核 → 查自引用绑定。
 */

/*
 * ── 类型化直调符号（R112 起，可选；单内核热路径零序列化）──
 *
 * 与 kernel_call(JSON) 双轨：导出即启用直调，缺席回落万能口。
 * 语义与 JSON 方法面一致：kernel_add ↔ method "add"；kernel_echo ↔ method "echo"。
 * 所有权：kernel_echo 返回值由内核分配，宿主用 kernel_free 释放。
 */
int64_t kernel_add(int64_t a, int64_t b);
const char *kernel_echo(const char *input);

#endif // CJK_KERNEL_ABI_H
