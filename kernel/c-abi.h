/*
 * kernel/c-abi.h — 多语言内核统一 C ABI 契约（R95/R96）
 *
 * 设计原则：
 *   1. 5 个函数。内核能做什么由 method 字符串决定，ABI 永不变化。
 *   2. 数据格式 = JSON 字符串（所有语言都有 JSON 库）。
 *   3. 内存：内核分配（kernel_call 返回值），宿主用 kernel_free 释放。
 *   4. 换内核 = 换 .so，宿主零改动。
 *
 * 每种语言内核必须实现这 5 个符号（extern "C" / @C / #[no_mangle] / cgo //export），
 * 编译为 .so 后由宿主 dlopen + dlsym 加载。
 */
#ifndef CJK_KERNEL_ABI_H
#define CJK_KERNEL_ABI_H

/* ── 生命周期 ── */

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
 * method:      方法名（如 "agent.spawn", "llm.chat", "state.query", "compute.run"）
 * params_json: JSON 格式参数
 * 返回:        JSON 字符串（由内核 malloc），宿主用 kernel_free 释放。
 *              失败返回 NULL（错误详情可调 kernel_last_error 获取）。
 */
const char *kernel_call(const char *method, const char *params_json);

/*
 * kernel_free: 释放由内核分配的内存（kernel_call 返回值）。
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

#endif // CJK_KERNEL_ABI_H
