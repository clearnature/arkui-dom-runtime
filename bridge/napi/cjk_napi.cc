/*
 * bridge/napi/cjk_napi.cc — @ohos:cjk 的进程内执行端（R98）
 *
 * 把 kernel/c-abi.h 的 6 符号契约桥接成 NAPI 导出，供 Electron 主进程 require。
 * 挂载序列（R96.2/R98 实测，官方序列见 kernel/c-abi/Cangjie.h）：
 *   1. dlopen(libcangjie-runtime.so)  ← 依赖 LD_LIBRARY_PATH 含 <SDK>/runtime/lib/…，
 *      其中 libcangjie-std-core.so 无 DT_SONAME，无法靠预载匹配，必须走搜索路径
 *   2. InitCJRuntime(零参默认 4096 字节零块)   ← 跳过此步则内核内任何堆操作 SIGABRT
 *   3. dlopen(内核.so) + dlsym 6 符号 → kernel_init(config)
 *   4. kernel_call(method, params) → JSON 串；宿主读出后 kernel_free
 *
 * 导出面：
 *   cjkInit(runtimeLib, kernelLib, configJson) → bool   幂等（二次调用直接返回已初始化态）
 *   cjkPing() → number
 *   cjkCall(method, paramsJson) → string | null          null = 内核拒绝（用 cjkLastError 取因）
 *   cjkLastError() → string
 *   cjkShutdown() → bool
 *
 * 线程模型：Electron 主进程 IPC handler 串行调度，无锁即可；addon 内不做线程断言。
 */
#include <node_api.h>
#include <dlfcn.h>
#include <cstring>
#include <string>

namespace {

/* 内核 6 符号的函数指针表（dlsym 一次，后续直调） */
struct KernelApi {
  int (*init)(const char *);
  int (*shutdown)(void);
  int (*ping)(void);
  const char *(*call)(const char *, const char *);
  void (*free)(void *);
  const char *(*lastError)(void);
  /* 可选调度符号（R100 起的内核才有；缺席=无并发，宿主跳过驱动） */
  int (*pending)(void);        // pending 队列长度
  int (*draining)(void);       // drainer 是否在跑
  void *(*drainEntry)(void *); // 有界 drainer 入口（清空队列即返回）
};

bool g_loaded = false;      // dlopen runtime + InitCJRuntime 完成
bool g_kernelReady = false; // 内核 dlopen + dlsym + kernel_init 完成
void *g_rt = nullptr;       // 仓颉运行时句柄（RunCJTask/RunUIScheduler 从这取）
void *g_kernel = nullptr;   // 内核句柄
KernelApi K = {};
void *(*fnRunCJTask)(void *(*)(void *), void *) = nullptr;       // RunCJTask
int (*fnRunUIScheduler)(unsigned long long) = nullptr;           // RunUIScheduler

char g_lastHostErr[512] = {0};   // 宿主侧（dlopen/dlsym 层）错误，与内核 last_error 分开

void setHostErr(const char *m) {
  snprintf(g_lastHostErr, sizeof(g_lastHostErr), "%s", m);
}

/* cjkCall 的后置驱动（R100）：作业在途时拉起 drainer cjthread 并泵调度器。
 * 机制约束（坑 103/104）：嵌入模式 cjthread 只在 RunUIScheduler 泵窗口执行；
 * sleep/Semaphore 不可用 → drainer 清空队列即返回，宿主逐调用驱动。 */
void drive() {
  if (!K.pending || !K.draining || !K.drainEntry || !fnRunCJTask || !fnRunUIScheduler) return;
  int pend = K.pending();
  int dr = K.draining();
  if (pend > 0 && dr == 0) fnRunCJTask((void *(*)(void *))K.drainEntry, nullptr);
  if (pend > 0 || dr > 0) fnRunUIScheduler(2);   // 给 drainer 执行窗口（≤2ms）
}

napi_value JsBool(napi_env env, bool v) {
  napi_value out;
  napi_get_boolean(env, v, &out);
  return out;
}

/* cjkInit(runtimeLib, kernelLib, configJson) → bool */
napi_value Init(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    napi_throw_error(env, nullptr, "cjkInit 需要 (runtimeLibPath, kernelLibPath[, configJson])");
    return nullptr;
  }
  char rtPath[1024] = {0}, kPath[1024] = {0}, config[2048] = {0};
  size_t len = 0;
  napi_get_value_string_utf8(env, argv[0], rtPath, sizeof(rtPath), &len);
  napi_get_value_string_utf8(env, argv[1], kPath, sizeof(kPath), &len);
  if (argc >= 3) napi_get_value_string_utf8(env, argv[2], config, sizeof(config), &len);

  if (g_kernelReady) return JsBool(env, true);   // 幂等：换内核须重启进程

  if (!g_loaded) {
    void *rt = dlopen(rtPath, RTLD_NOW | RTLD_GLOBAL);
    if (!rt) {
      const char *e = dlerror();   // dlerror 只能取一次，先存局部再落
      setHostErr(e ? e : "dlopen runtime failed");
      napi_throw_error(env, nullptr, g_lastHostErr);
      return nullptr;
    }
    g_rt = rt;
    void *symInitRt = dlsym(rt, "InitCJRuntime");
    if (!symInitRt) { setHostErr("dlsym InitCJRuntime 失败（运行时库不对？）"); napi_throw_error(env, nullptr, g_lastHostErr); return nullptr; }
    static char param[4096] = {0};               // 零参默认（R97/R98 实测可用）
    int rc = ((int (*)(const void *))symInitRt)(param);
    if (rc != 0) { setHostErr("InitCJRuntime 返回非 0"); napi_throw_error(env, nullptr, g_lastHostErr); return nullptr; }
    fnRunCJTask = (void *(*)(void *(*)(void *), void *))dlsym(rt, "RunCJTask");
    fnRunUIScheduler = (int (*)(unsigned long long))dlsym(rt, "RunUIScheduler");
    g_loaded = true;
  }

  void *k = dlopen(kPath, RTLD_NOW | RTLD_GLOBAL);
  if (!k) {
    const char *e = dlerror();
    setHostErr(e ? e : "dlopen kernel failed");
    napi_throw_error(env, nullptr, g_lastHostErr);
    return nullptr;
  }
  g_kernel = k;
  K.init = (int (*)(const char *))dlsym(k, "kernel_init");
  K.shutdown = (int (*)(void))dlsym(k, "kernel_shutdown");
  K.ping = (int (*)(void))dlsym(k, "kernel_ping");
  K.call = (const char *(*)(const char *, const char *))dlsym(k, "kernel_call");
  K.free = (void (*)(void *))dlsym(k, "kernel_free");
  K.lastError = (const char *(*)(void))dlsym(k, "kernel_last_error");
  /* 可选调度符号：缺席容忍（旧内核纯同步） */
  K.pending = (int (*)(void))dlsym(k, "kernel_pending");
  K.draining = (int (*)(void))dlsym(k, "kernel_draining");
  K.drainEntry = (void *(*)(void *))dlsym(k, "kernel_drain_entry");
  if (!K.init || !K.shutdown || !K.ping || !K.call || !K.free || !K.lastError) {
    setHostErr("dlsym 内核契约符号不全（须实现 kernel/c-abi.h 全部 6 符号）");
    napi_throw_error(env, nullptr, g_lastHostErr);
    return nullptr;
  }
  if (K.init(config) != 0) {
    setHostErr("kernel_init 非零");
    napi_throw_error(env, nullptr, g_lastHostErr);
    return nullptr;
  }
  g_kernelReady = true;
  return JsBool(env, true);
}

/* cjkPing() → number */
napi_value Ping(napi_env env, napi_callback_info) {
  if (!g_kernelReady) { napi_throw_error(env, nullptr, "内核未初始化（先 cjkInit）"); return nullptr; }
  napi_value out;
  napi_create_int32(env, K.ping(), &out);
  return out;
}

/* cjkCall(method, paramsJson) → string | null */
napi_value Call(napi_env env, napi_callback_info info) {
  if (!g_kernelReady) { napi_throw_error(env, nullptr, "内核未初始化（先 cjkInit）"); return nullptr; }
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) { napi_throw_error(env, nullptr, "cjkCall 需要 (method, paramsJson)"); return nullptr; }
  char method[256] = {0}, params[4096] = {0};
  size_t len = 0;
  napi_get_value_string_utf8(env, argv[0], method, sizeof(method), &len);
  napi_get_value_string_utf8(env, argv[1], params, sizeof(params), &len);

  const char *r = K.call(method, params);
  if (!r) {
    drive();                          // 失败路径也驱动（不阻塞作业推进）
    napi_value nullv;
    napi_get_null(env, &nullv);
    return nullv;                     // 内核拒绝：null + cjkLastError() 取因
  }
  napi_value out;
  napi_create_string_utf8(env, r, NAPI_AUTO_LENGTH, &out);
  K.free((void *)r);                  // 契约：读出即释放，内核缓冲不滞留
  drive();                            // 后置驱动：有在途作业则拉起 drainer + 泵
  return out;
}

/* cjkLastError() → string（内核视角的最近错误；空串 = 无） */
napi_value LastError(napi_env env, napi_callback_info) {
  const char *e = g_kernelReady ? K.lastError() : nullptr;
  napi_value out;
  napi_create_string_utf8(env, e ? e : (g_lastHostErr[0] ? g_lastHostErr : ""), NAPI_AUTO_LENGTH, &out);
  return out;
}

/* cjkShutdown() → bool（kernel_shutdown；运行时本体不卸载——进程级单例） */
napi_value Shutdown(napi_env env, napi_callback_info) {
  if (!g_kernelReady) return JsBool(env, false);
  bool ok = K.shutdown() == 0;
  g_kernelReady = false;
  return JsBool(env, ok);
}

napi_value ModuleInit(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {
    { "cjkInit",      nullptr, Init,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkPing",      nullptr, Ping,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkCall",      nullptr, Call,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkLastError", nullptr, LastError, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkShutdown",  nullptr, Shutdown,  nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, 5, desc);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, ModuleInit)
