/*
 * bridge/napi/cjk_napi.cc — @ohos:cjk 的进程内执行端（R98 起，R107 多内核槽）
 *
 * 把 kernel/c-abi.h 契约桥接成 NAPI 导出，供 Electron 主进程 require。
 * 挂载序列（R96.2/R98 实测，官方序列见 kernel/c-abi/Cangjie.h）：
 *   1. dlopen(libcangjie-runtime.so)  ← 依赖 LD_LIBRARY_PATH 含 <SDK>/runtime/lib/…，
 *      其中 libcangjie-std-core.so 无 DT_SONAME，无法靠预载匹配，必须走搜索路径
 *   2. InitCJRuntime(RuntimeParam，logLevel=ERROR)   ← 跳过此步则内核内任何堆操作
 *      SIGABRT；零内存参数落成 VERBOSE(0) 会把启动/GC 日志直通 stderr（R104）
 *   3. dlopen(内核.so) + dlsym 契约符号 → kernel_init(config)
 *   4. kernel_call(method, params) → JSON 串；宿主读出后 kernel_free
 *
 * R107 多内核槽：同一进程可挂多个内核（如仓颉内核 + 纯 C 内核）。
 *   · 内部为命名槽注册表；旧 6 个平面 API（cjkInit/cjkCall/…）= "default" 槽别名，
 *     向后兼容；带 K 后缀变体（cjkInitK/cjkCallK/…）首参为槽名。
 *   · rtLib 传空串 = 该槽不需要仓颉运行时（纯 C/C++ 内核）；仓颉运行时进程级单例，
 *     多个仓颉内核槽共享同一次 InitCJRuntime。
 *   · 换同槽内核须重启进程（幂等挂载，不热替换）。
 *
 * 导出面：
 *   cjkInit(rtLib, kernelLib, configJson) → bool                     （default 槽）
 *   cjkInitK(name, rtLib, kernelLib, configJson) → bool              （rtLib 可为 ""）
 *   cjkPing() → number                    cjkPingK(name) → number
 *   cjkCall(method, paramsJson) → string|null          cjkCallK(name, …) 同形
 *   cjkLastError() → string               cjkLastErrorK(name) → string
 *   cjkKernelVersion() → number           cjkKernelVersionK(name) → number
 *   cjkShutdown() → bool                  cjkShutdownK(name) → bool
 *
 * 线程模型：Electron 主进程 IPC handler 串行调度，无锁即可；addon 内不做线程断言。
 */
#include <node_api.h>
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <map>
#include "Cangjie.h"   // kernel/c-abi/Cangjie.h（-I../../kernel/c-abi）；R104 起用其 RuntimeParam

namespace {

constexpr int HOST_ABI_VERSION = 10001;

/* 内核契约符号的函数指针表（dlsym 一次，后续直调） */
struct KernelApi {
  int (*init)(const char *);
  int (*shutdown)(void);
  int (*ping)(void);
  const char *(*call)(const char *, const char *);
  void (*free)(void *);
  const char *(*lastError)(void);
  /* 可选调度符号（R100 起的内核才有；缺席=无并发，宿主跳过驱动） */
  int (*pending)(void);        // pending 队列长度
  int (*draining)(void);       // 活跃 worker 数
  void *(*drainEntry)(void *); // 有界 worker 入口（清空队列即返回，可重入）
};

/* 命名内核槽（R107） */
struct Slot {
  bool ready = false;
  void *handle = nullptr;
  KernelApi K{};
  int abiVersion = 0;
};

bool g_loaded = false;   // 仓颉运行时 dlopen + InitCJRuntime 完成（进程级单例）
void *g_rt = nullptr;
void *(*fnRunCJTask)(void *(*)(void *), void *) = nullptr;
int (*fnRunUIScheduler)(unsigned long long) = nullptr;

std::map<std::string, Slot> g_slots;

char g_lastHostErr[512] = {0};   // 宿主侧（dlopen/dlsym 层）错误，与内核 last_error 分开

void setHostErr(const char *m) {
  snprintf(g_lastHostErr, sizeof(g_lastHostErr), "%s", m);
}

napi_value JsBool(napi_env env, bool v) {
  napi_value out;
  napi_get_boolean(env, v, &out);
  return out;
}

/* R101：取任意长 UTF-8 字符串——先量全长再分配（>1MB 显式抛错，不静默截断）。
 * 成功返回 malloc 缓冲（调用方 free），失败返回 NULL（已 setHostErr + throw）。 */
char *TakeString(napi_env env, napi_value v, const char *what) {
  static const size_t kMaxStr = 1u << 20;   // 1MB 上限
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) {
    setHostErr("参数不是 string");
    napi_throw_error(env, nullptr, g_lastHostErr);
    return nullptr;
  }
  if (len > kMaxStr) {
    char msg[128];
    snprintf(msg, sizeof(msg), "%s too large (%zu bytes > %zu, R101 上限)", what, len, kMaxStr);
    setHostErr(msg);
    napi_throw_error(env, nullptr, g_lastHostErr);
    return nullptr;
  }
  char *buf = (char *)malloc(len + 1);
  if (!buf) { setHostErr("OOM"); napi_throw_error(env, nullptr, g_lastHostErr); return nullptr; }
  if (napi_get_value_string_utf8(env, v, buf, len + 1, &len) != napi_ok) {
    free(buf);
    setHostErr("取字符串失败");
    napi_throw_error(env, nullptr, g_lastHostErr);
    return nullptr;
  }
  return buf;
}

/* 仓颉运行时挂载（进程级单例；纯 C 内核槽不触发） */
bool ensureRuntime(const char *rtPath) {
  if (g_loaded) return true;
  void *rt = dlopen(rtPath, RTLD_NOW | RTLD_GLOBAL);
  if (!rt) {
    const char *e = dlerror();   // dlerror 只能取一次，先存局部再落
    setHostErr(e ? e : "dlopen runtime failed");
    return false;
  }
  g_rt = rt;
  void *symInitRt = dlsym(rt, "InitCJRuntime");
  if (!symInitRt) { setHostErr("dlsym InitCJRuntime 失败（运行时库不对？）"); return false; }
  /* R104：显式 RuntimeParam——heap/gc/co 字段保持 0（=各字段文档默认值），
   * 仅 logParam.logLevel 提到 ERROR：零内存会落成 VERBOSE(0)。 */
  static RuntimeParam param;
  memset(&param, 0, sizeof(param));
  param.logParam.logLevel = RTLOG_ERROR;
  int rc = ((int (*)(const void *))symInitRt)(&param);
  if (rc != 0) { setHostErr("InitCJRuntime 返回非 0"); return false; }
  fnRunCJTask = (void *(*)(void *(*)(void *), void *))dlsym(rt, "RunCJTask");
  fnRunUIScheduler = (int (*)(unsigned long long))dlsym(rt, "RunUIScheduler");
  g_loaded = true;
  return true;
}

/* 内核挂载（dlopen + dlsym + 版本防呆 + kernel_init） */
bool openKernel(Slot &s, const char *kPath, const char *config) {
  void *k = dlopen(kPath, RTLD_NOW | RTLD_GLOBAL);
  if (!k) {
    const char *e = dlerror();
    setHostErr(e ? e : "dlopen kernel failed");
    return false;
  }
  s.handle = k;
  s.K.init = (int (*)(const char *))dlsym(k, "kernel_init");
  s.K.shutdown = (int (*)(void))dlsym(k, "kernel_shutdown");
  s.K.ping = (int (*)(void))dlsym(k, "kernel_ping");
  s.K.call = (const char *(*)(const char *, const char *))dlsym(k, "kernel_call");
  s.K.free = (void (*)(void *))dlsym(k, "kernel_free");
  s.K.lastError = (const char *(*)(void))dlsym(k, "kernel_last_error");
  /* 可选调度符号：缺席容忍（同步内核） */
  s.K.pending = (int (*)(void))dlsym(k, "kernel_pending");
  s.K.draining = (int (*)(void))dlsym(k, "kernel_draining");
  s.K.drainEntry = (void *(*)(void *))dlsym(k, "kernel_drain_entry");
  /* R102：ABI 版本握手（可选；缺席 = v1.0 旧内核容忍） */
  int (*abiver)(void) = (int (*)(void))dlsym(k, "kernel_abi_version");
  s.abiVersion = abiver ? abiver() : 0;
  if (!s.K.init || !s.K.shutdown || !s.K.ping || !s.K.call || !s.K.free || !s.K.lastError) {
    setHostErr("dlsym 内核契约符号不全（须实现 kernel/c-abi.h 全部 6 符号）");
    return false;
  }
  if (s.abiVersion / 10000 > HOST_ABI_VERSION / 10000) {
    char msg[128];
    snprintf(msg, sizeof(msg), "内核 ABI 主版本 %d 高于宿主支持的 %d（向前不兼容，拒绝挂载）",
             s.abiVersion / 10000, HOST_ABI_VERSION / 10000);
    setHostErr(msg);
    return false;
  }
  if (s.K.init(config) != 0) {
    setHostErr("kernel_init 非零");
    return false;
  }
  s.ready = true;
  return true;
}

Slot *requireSlot(napi_env env, const std::string &name) {
  auto it = g_slots.find(name);
  if (it == g_slots.end() || !it->second.ready) {
    napi_throw_error(env, nullptr, "内核未初始化（先 cjkInit/cjkInitK）");
    return nullptr;
  }
  return &it->second;
}

/* 后置驱动（R100/R105）：有在途作业时拉起 worker cjthread 并泵调度器。
 * 机制约束（坑 103/104）：嵌入模式 cjthread 只在 RunUIScheduler 泵窗口执行；
 * sleep/Semaphore 不可用 → worker 清空队列即返回，宿主逐调用驱动。
 * R105 多 worker 策略：worker 数 = min(pending, kMaxWorkers)，drain_entry 可重入。 */
void drive(Slot &s) {
  if (!s.K.pending || !s.K.draining || !s.K.drainEntry || !fnRunCJTask || !fnRunUIScheduler) return;
  static const int kMaxWorkers = 4;
  int pend = s.K.pending();
  int dr = s.K.draining();
  int want = pend < kMaxWorkers ? pend : kMaxWorkers;
  for (int i = dr; i < want; i++) fnRunCJTask((void *(*)(void *))s.K.drainEntry, nullptr);
  if (pend > 0 || dr > 0) fnRunUIScheduler(2);   // 给 worker 执行窗口（≤2ms）
}

/* cjkInitK(name, rtLib, kernelLib, configJson?) → bool
 * rtLib 为空串 = 该槽无需仓颉运行时（纯原生内核）。幂等。 */
napi_value InitK(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    napi_throw_error(env, nullptr, "cjkInitK 需要 (name, rtLib|\"\", kernelLib[, configJson])");
    return nullptr;
  }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  char *rtPath = TakeString(env, argv[1], "rtLib");
  if (!rtPath) { free(name); return nullptr; }
  char *kPath = TakeString(env, argv[2], "kernelLib");
  if (!kPath) { free(name); free(rtPath); return nullptr; }
  char *config = nullptr;
  if (argc >= 4) {
    config = TakeString(env, argv[3], "configJson");
    if (!config) { free(name); free(rtPath); free(kPath); return nullptr; }
  }

  Slot &s = g_slots[name];
  if (s.ready) {
    free(name); free(rtPath); free(kPath); free(config);
    return JsBool(env, true);            // 幂等：换同槽内核须重启进程
  }
  bool ok = true;
  if (rtPath[0] != '\0') ok = ensureRuntime(rtPath);
  if (ok) ok = openKernel(s, kPath, config ? config : "{}");
  if (!ok) napi_throw_error(env, nullptr, g_lastHostErr);
  free(name); free(rtPath); free(kPath); free(config);
  return ok ? JsBool(env, true) : nullptr;
}

/* cjkInit(runtimeLib, kernelLib, configJson?) → bool（default 槽，向后兼容） */
napi_value Init(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    napi_throw_error(env, nullptr, "cjkInit 需要 (runtimeLibPath, kernelLibPath[, configJson])");
    return nullptr;
  }
  char *rtPath = TakeString(env, argv[0], "runtimeLibPath");
  if (!rtPath) return nullptr;
  char *kPath = TakeString(env, argv[1], "kernelLibPath");
  if (!kPath) { free(rtPath); return nullptr; }
  char *config = nullptr;
  if (argc >= 3) {
    config = TakeString(env, argv[2], "configJson");
    if (!config) { free(rtPath); free(kPath); return nullptr; }
  }

  Slot &s = g_slots["default"];
  if (s.ready) {
    free(rtPath); free(kPath); free(config);
    return JsBool(env, true);
  }
  bool ok = ensureRuntime(rtPath);
  if (ok) ok = openKernel(s, kPath, config ? config : "{}");
  if (!ok) napi_throw_error(env, nullptr, g_lastHostErr);
  free(rtPath); free(kPath); free(config);
  return ok ? JsBool(env, true) : nullptr;
}

/* cjkPingK(name) → number */
napi_value PingK(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) { napi_throw_error(env, nullptr, "cjkPingK 需要 (name)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  napi_value out;
  napi_create_int32(env, s->K.ping(), &out);
  return out;
}

napi_value Ping(napi_env env, napi_callback_info info) {
  (void)info;
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  napi_value out;
  napi_create_int32(env, s->K.ping(), &out);
  return out;
}

/* cjkCallK(name, method, paramsJson) → string | null */
napi_value CallK(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) { napi_throw_error(env, nullptr, "cjkCallK 需要 (name, method, paramsJson)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  char *method = TakeString(env, argv[1], "method");
  if (!method) return nullptr;
  char *params = TakeString(env, argv[2], "params");
  if (!params) { free(method); return nullptr; }

  const char *r = s->K.call(method, params);
  free(method);
  free(params);
  if (!r) {
    drive(*s);                         // 失败路径也驱动（不阻塞作业推进）
    napi_value nullv;
    napi_get_null(env, &nullv);
    return nullv;                      // 内核拒绝：null + cjkLastErrorK 取因
  }
  napi_value out;
  napi_create_string_utf8(env, r, NAPI_AUTO_LENGTH, &out);
  s->K.free((void *)r);                // 契约：读出即释放，内核缓冲不滞留
  drive(*s);                           // 后置驱动：有在途作业则拉起 worker + 泵
  return out;
}

/* cjkCall(method, paramsJson) → string | null（default 槽） */
napi_value Call(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) { napi_throw_error(env, nullptr, "cjkCall 需要 (method, paramsJson)"); return nullptr; }
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  char *method = TakeString(env, argv[0], "method");
  if (!method) return nullptr;
  char *params = TakeString(env, argv[1], "params");
  if (!params) { free(method); return nullptr; }

  const char *r = s->K.call(method, params);
  free(method);
  free(params);
  if (!r) {
    drive(*s);
    napi_value nullv;
    napi_get_null(env, &nullv);
    return nullv;
  }
  napi_value out;
  napi_create_string_utf8(env, r, NAPI_AUTO_LENGTH, &out);
  s->K.free((void *)r);
  drive(*s);
  return out;
}

/* cjkLastErrorK(name) → string */
napi_value LastErrorK(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) { napi_throw_error(env, nullptr, "cjkLastErrorK 需要 (name)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  const char *e = s->K.lastError();
  napi_value out;
  napi_create_string_utf8(env, e ? e : "", NAPI_AUTO_LENGTH, &out);
  return out;
}

napi_value LastError(napi_env env, napi_callback_info info) {
  (void)info;
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  const char *e = s->K.lastError();
  napi_value out;
  napi_create_string_utf8(env, e ? e : "", NAPI_AUTO_LENGTH, &out);
  return out;
}

/* cjkKernelVersionK(name) → number（R102；0 = 旧内核无版本符号） */
napi_value KernelVersionK(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) { napi_throw_error(env, nullptr, "cjkKernelVersionK 需要 (name)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  napi_value out;
  napi_create_int32(env, s->abiVersion, &out);
  return out;
}

napi_value KernelVersion(napi_env env, napi_callback_info info) {
  (void)info;
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  napi_value out;
  napi_create_int32(env, s->abiVersion, &out);
  return out;
}

/* cjkShutdownK(name) → bool */
napi_value ShutdownK(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) { napi_throw_error(env, nullptr, "cjkShutdownK 需要 (name)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  bool ok = s->K.shutdown() == 0;
  s->ready = false;
  return JsBool(env, ok);
}

napi_value Shutdown(napi_env env, napi_callback_info info) {
  (void)info;
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  bool ok = s->K.shutdown() == 0;
  s->ready = false;
  return JsBool(env, ok);
}

napi_value ModuleInit(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {
    { "cjkInit",      nullptr, Init,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkPing",      nullptr, Ping,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkCall",      nullptr, Call,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkLastError", nullptr, LastError, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkKernelVersion", nullptr, KernelVersion, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkShutdown",  nullptr, Shutdown,  nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkInitK",     nullptr, InitK,     nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkPingK",     nullptr, PingK,     nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkCallK",     nullptr, CallK,     nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkLastErrorK", nullptr, LastErrorK, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkKernelVersionK", nullptr, KernelVersionK, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkShutdownK", nullptr, ShutdownK, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, 12, desc);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, ModuleInit)
