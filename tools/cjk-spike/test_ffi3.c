// R96.2 spike：官方 C API 全序列——进程内挂载仓颉内核【可行】
// 序列（Cangjie.h 官方示例）：InitCJRuntime(&param) → LoadCJLibraryWithInit(libName)
//   → FindCJSymbol(libName, func) → 直调（RunCJTask 用于跑仓颉闭包）
// 实测：InitCJRuntime→0（GC 线程起/"Cangjie runtime started"），
//       LoadCJLibraryWithInit→0，FindCJSymbol 命中，kernelAdd(2,3)=5，exit 0。
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

typedef int (*init_fn)(const void *);
typedef int (*load_fn)(const char *);
typedef void *(*find_fn)(const char *, const char *);
typedef long long (*add_fn)(long long, long long);

int main(void) {
    const char *rtlib = "/data/training/cli/cangjie-sdk-linux-x64-1.1.3/cangjie/runtime/lib/linux_x86_64_cjnative/libcangjie-runtime.so";
    void *rt = dlopen(rtlib, RTLD_NOW | RTLD_GLOBAL);
    if (!rt) { printf("dlopen runtime FAIL: %s\n", dlerror()); return 1; }

    init_fn initCJ = (init_fn)dlsym(rt, "InitCJRuntime");
    load_fn loadCJ = (load_fn)dlsym(rt, "LoadCJLibraryWithInit");
    find_fn findCJ = (find_fn)dlsym(rt, "FindCJSymbol");
    task_fn runTask = (task_fn)dlsym(rt, "RunCJTask");
    if (!initCJ || !loadCJ || !findCJ || !runTask) {
        printf("dlsym FAIL: init=%p load=%p find=%p run=%p\n", initCJ, loadCJ, findCJ, runTask);
        return 1;
    }

    // RuntimeParam 零初始化（全默认参数；编译器对 0 值字段回落默认——实测可行）
    static char param[4096];
    memset(param, 0, sizeof(param));
    int ir = initCJ(param);
    printf("InitCJRuntime → %d\n", ir);
    if (ir != 0) return 1;

    const char *libPath = "/tmp/cjspeak/libkernel.so";
    int lr = loadCJ(libPath);
    printf("LoadCJLibraryWithInit → %d\n", lr);
    if (lr != 0) return 1;

    void *fn = findCJ(libPath, "kernelAdd");
    printf("FindCJSymbol(kernelAdd) → %p\n", fn);
    if (!fn) return 1;

    add_fn add = (add_fn)fn;
    long long r = add(2, 3);
    printf("kernelAdd(2,3) = %lld\n", r);
    return (r == 5) ? 0 : 2;
}
