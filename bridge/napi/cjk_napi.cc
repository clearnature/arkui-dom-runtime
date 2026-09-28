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
#include <sys/stat.h>
#include <dirent.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <map>
#include "Cangjie.h"   // kernel/c-abi/Cangjie.h（-I../../kernel/c-abi）；R104 起用其 RuntimeParam
                       // 契约本体在 kernel/shared/protocol/kernel_abi.h（-I 同加，R111）

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
  /* 可选类型化直调符号（R112；缺席回落 kernel_call JSON 万能口） */
  int64_t (*add)(int64_t, int64_t);
  const char *(*echo)(const char *);
};

/* 命名内核槽（R107） */
struct Slot {
  bool ready = false;
  void *handle = nullptr;
  KernelApi K{};
  int abiVersion = 0;
};

bool g_loaded = false;   // 仓颉运行时 dlopen + InitCJRuntime 完成（进程级单例）
bool g_ghcLoaded = false; // GHC RTS 挂载完成（R114：与仓颉序列各自幂等——
                           // 两 RTS 并存于进程时 g_loaded 单例会让 GHC 序列被跳过）
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

bool ensureRuntimeCangjie(const char *rtPath);   // 前向声明（定义在分流入口之后）

/* R114：GHC RTS 挂载（循环引用裁决序——实测见 kernel/hs/kernel.hs 头注）：
 *   libHSrts-*.so 先 RTLD_LAZY|GLOBAL（其引用 init_ghc_hs_iface 是函数符号可挂起），
 *   ghc-internal NOW|GLOBAL（stg_* 数据符号由已载 RTS 提供；先载它会因缺 stg 立败），
 *   ghc-prim/base NOW 补全内核 NEEDED，最后 hs_init(NULL,NULL)（宿主方案 A）。 */
bool ensureRuntimeGhc(const char *dir) {
  if (g_ghcLoaded) return true;
  // R127 勘误：内核 build.sh 恒 -threaded（kernel_init 会 setNumCapabilities，:164-165 注），
  // 必须载 **thr 变体** RTS——载了非线程 RTS 时 setNumCapabilities 报
  // "not supported in the non-threaded RTS" 且内核永不就绪。dev 态此前是 readdir 顺序
  // 碰对 _thr 在前；打包目录文件少就露馅。故 RTS 优先 _thr-，找不到才回落普通变体。
  const char *prefs[] = { "libHSghc-internal-", "libHSghc-prim-", "libHSbase-" };
  char rtsPath[1024] = {0};
  char rtsFallback[1024] = {0};
  char paths[3][1024] = {{0}};
  DIR *d = opendir(dir);
  if (!d) { setHostErr("GHC libdir 无法打开"); return false; }
  for (struct dirent *e; (e = readdir(d)) != nullptr;) {
    if (strncmp(e->d_name, "libHSrts-", 9) == 0
        && strstr(e->d_name, "_debug") == nullptr && strstr(e->d_name, "_p-") == nullptr
        && strlen(e->d_name) < 1000) {
      if (strstr(e->d_name, "_thr-") != nullptr) {
        if (rtsPath[0] == '\0') snprintf(rtsPath, sizeof(rtsPath), "%s/%s", dir, e->d_name);
      } else if (rtsFallback[0] == '\0') {
        snprintf(rtsFallback, sizeof(rtsFallback), "%s/%s", dir, e->d_name);
      }
      continue;
    }
    for (int i = 0; i < 3; i++) {
      if (paths[i][0] == '\0' && strncmp(e->d_name, prefs[i], strlen(prefs[i])) == 0
          && strstr(e->d_name, "_debug") == nullptr && strstr(e->d_name, "_p-") == nullptr
          && strlen(e->d_name) < 1000) {
        snprintf(paths[i], sizeof(paths[i]), "%s/%s", dir, e->d_name);
      }
    }
  }
  closedir(d);
  if (rtsPath[0] == '\0') snprintf(rtsPath, sizeof(rtsPath), "%s", rtsFallback);
  {
    char *all[4] = { rtsPath, paths[0], paths[1], paths[2] };
    const char *desc[4] = { "libHSrts-*(-thr)", "libHSghc-internal-*", "libHSghc-prim-*", "libHSbase-*" };
    for (int i = 0; i < 4; i++) {
      if (all[i][0] == '\0') {
        snprintf(g_lastHostErr, sizeof(g_lastHostErr), "GHC libdir 缺 %s.so", desc[i]);
        return false;
      }
    }
  }
  if (!dlopen(rtsPath, RTLD_LAZY | RTLD_GLOBAL)) {   // RTS 必须 LAZY 先行
    const char *e = dlerror();
    setHostErr(e ? e : "dlopen libHSrts failed");
    return false;
  }
  for (int i = 1; i < 4; i++) {
    if (!dlopen(paths[i], RTLD_NOW | RTLD_GLOBAL)) {
      const char *e = dlerror();
      snprintf(g_lastHostErr, sizeof(g_lastHostErr), "dlopen %s: %s",
               strrchr(paths[i], '/') + 1, e ? e : "?");
      return false;
    }
  }
  void *hsi = dlsym(RTLD_DEFAULT, "hs_init");
  if (!hsi) { setHostErr("hs_init 不可见（RTS 未就位）"); return false; }
  // 宿主方案 A：hs_init/hs_exit 归宿主。能力数不走 argv（-N 在嵌入宿主下段错误、
  // shared lib 的 -with-rtsopts 无效）——由内核 kernel_init 的 setNumCapabilities 设。
  ((void (*)(int *, char ***))hsi)(nullptr, nullptr);
  g_ghcLoaded = true;
  return true;
}

/* 仓颉运行时挂载（进程级单例；纯 C 内核槽不触发）。
 * rtPath 双布局（R114 多 RTS 泛化）：
 *   - 文件 → 仓颉序列（path.join(rtLib, "libcangjie-runtime.so")）
 *   - 目录 → GHC 序列（扫描 libHSrts 前缀、ghc-internal、ghc-prim、base，再 hs_init）
 * 统一入口：按 stat 分流。 */
bool ensureRuntime(const char *rtPath) {
  struct stat st;
  if (stat(rtPath, &st) == 0 && S_ISDIR(st.st_mode)) return ensureRuntimeGhc(rtPath);
  return ensureRuntimeCangjie(rtPath);
}

bool ensureRuntimeCangjie(const char *rtPath) {
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
  /* R112：类型化直调符号（可选；缺席回落 kernel_call JSON 万能口） */
  s.K.add = (int64_t (*)(int64_t, int64_t))dlsym(k, "kernel_add");
  s.K.echo = (const char *(*)(const char *))dlsym(k, "kernel_echo");
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

/* ── R112：类型化直调（零序列化；缺席回落 JSON 口）── */

napi_value AddK(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) { napi_throw_error(env, nullptr, "cjkAddK 需要 (name, a, b)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  if (!s->K.add) { napi_throw_error(env, nullptr, "该内核未导出 kernel_add（typed 直调不可用，走 cjkCall JSON 口）"); return nullptr; }
  double a = 0, b = 0;
  napi_get_value_double(env, argv[1], &a);
  napi_get_value_double(env, argv[2], &b);
  napi_value out;
  napi_create_double(env, (double)s->K.add((int64_t)a, (int64_t)b), &out);
  return out;
}

napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) { napi_throw_error(env, nullptr, "cjkAdd 需要 (a, b)"); return nullptr; }
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  if (!s->K.add) { napi_throw_error(env, nullptr, "该内核未导出 kernel_add（typed 直调不可用，走 cjkCall JSON 口）"); return nullptr; }
  double a = 0, b = 0;
  napi_get_value_double(env, argv[0], &a);
  napi_get_value_double(env, argv[1], &b);
  napi_value out;
  napi_create_double(env, (double)s->K.add((int64_t)a, (int64_t)b), &out);
  return out;
}

napi_value EchoK(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) { napi_throw_error(env, nullptr, "cjkEchoK 需要 (name, input)"); return nullptr; }
  char *name = TakeString(env, argv[0], "name");
  if (!name) return nullptr;
  Slot *s = requireSlot(env, name);
  free(name);
  if (!s) return nullptr;
  if (!s->K.echo) { napi_throw_error(env, nullptr, "该内核未导出 kernel_echo（typed 直调不可用，走 cjkCall JSON 口）"); return nullptr; }
  char *input = TakeString(env, argv[1], "input");
  if (!input) return nullptr;
  const char *r = s->K.echo(input);
  free(input);
  if (!r) { napi_value nullv; napi_get_null(env, &nullv); return nullv; }
  napi_value out;
  napi_create_string_utf8(env, r, NAPI_AUTO_LENGTH, &out);
  s->K.free((void *)r);
  return out;
}

napi_value Echo(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) { napi_throw_error(env, nullptr, "cjkEcho 需要 (input)"); return nullptr; }
  Slot *s = requireSlot(env, "default");
  if (!s) return nullptr;
  if (!s->K.echo) { napi_throw_error(env, nullptr, "该内核未导出 kernel_echo（typed 直调不可用，走 cjkCall JSON 口）"); return nullptr; }
  char *input = TakeString(env, argv[0], "input");
  if (!input) return nullptr;
  const char *r = s->K.echo(input);
  free(input);
  if (!r) { napi_value nullv; napi_get_null(env, &nullv); return nullv; }
  napi_value out;
  napi_create_string_utf8(env, r, NAPI_AUTO_LENGTH, &out);
  s->K.free((void *)r);
  return out;
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
    { "cjkAdd",       nullptr, Add,       nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkEcho",      nullptr, Echo,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkAddK",      nullptr, AddK,      nullptr, nullptr, nullptr, napi_default, nullptr },
    { "cjkEchoK",     nullptr, EchoK,     nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, 16, desc);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, ModuleInit)
