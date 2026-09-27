// R96 P0：NAPI 封装——Node/Electron 进程内挂载仓颉 dylib
//
// 挂载序列（Cangjie.h:687 官方示例 + R96.2 实测）：
//   dlopen(libcangjie-runtime.so) → InitCJRuntime(零参默认)
//   → dlopen(内核.so) → dlsym 导出函数 → 直调
//
// 设计：不用 Cangjie 的 FindCJSymbol（它走运行时内部符号表，实测查不到裸 C 符号）；
// 改用 POSIX dlsym(RTLD_DEFAULT) ——dlopen(RTLD_GLOBAL) 后所有全局符号对 RTLD_DEFAULT
// 可见，不依赖 Cangjie 内部机制。
#include <node_api.h>
#include <dlfcn.h>
#include <cstring>
#include <string>

namespace {

void* g_kernel = nullptr;            // 内核 .so 的 dlopen 句柄
bool g_inited = false;

napi_value InitRuntime(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  char rtPath[1024] = {0}, kPath[1024] = {0};
  size_t len = 0;
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) { napi_throw_error(env, nullptr, "need (runtimeLibPath, kernelLibPath)"); return nullptr; }
  napi_get_value_string_utf8(env, argv[0], rtPath, sizeof(rtPath), &len);
  napi_get_value_string_utf8(env, argv[1], kPath, sizeof(kPath), &len);

  // 1) dlopen Cangjie 运行时（RTLD_GLOBAL 让后续 dlopen 的 .so 能解析其符号）
  void* rt = dlopen(rtPath, RTLD_NOW | RTLD_GLOBAL);
  if (!rt) { napi_throw_error(env, nullptr, dlerror()); return nullptr; }

  // 2) dlopen 内核 .so（不经过 Cangjie 的 LoadCJLibraryWithInit——直接 POSIX dlopen）
  g_kernel = dlopen(kPath, RTLD_NOW | RTLD_GLOBAL);
  if (!g_kernel) { napi_throw_error(env, nullptr, dlerror()); return nullptr; }

  napi_value ok;
  napi_get_boolean(env, true, &ok);
  return ok;
}

// kernelAdd(a, b) → number  （dlsym 找 @C 导出函数，直调）
napi_value KernelAdd(napi_env env, napi_callback_info info) {
  void* fn = dlsym(RTLD_DEFAULT, "kernelAdd");
  if (!fn) { napi_throw_error(env, nullptr, "kernelAdd symbol not found"); return nullptr; }
  typedef long long (*AddFn)(int64_t, int64_t);
  int64_t a = 0, b = 0;
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_get_value_int64(env, argv[0], &a);
  napi_get_value_int64(env, argv[1], &b);
  int64_t r = ((AddFn)fn)(a, b);

  napi_value out;
  napi_create_int64(env, r, &out);
  return out;
}

napi_value ModuleInit(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {
    { "initRuntime", nullptr, InitRuntime, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "kernelAdd",   nullptr, KernelAdd,   nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, 2, desc);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, ModuleInit)
