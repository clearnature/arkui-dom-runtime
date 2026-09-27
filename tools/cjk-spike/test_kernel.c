// R97：C 测试器——正确序列：
// 1. dlopen libcangjie-runtime.so + dlsym InitCJRuntime 并调用（初始化运行时）
// 2. dlopen kernel dylib + dlsym 并调用 kernel 函数
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

typedef int (*init_rt_fn)(const void *);
typedef void (*void_fn_t)(void);
typedef long long (*ll2_fn_t)(long long, long long);
typedef int (*int_i_fn)(long long);

int main(int argc, char *argv[]) {
    const char *kernel_path = (argc > 1) ? argv[1] : "../cangjie/libkernel.so";
    const char *rt_path = "libcangjie-runtime.so";

    // Step 1: 加载并初始化仓颉运行时
    void *rt = dlopen(rt_path, RTLD_NOW | RTLD_GLOBAL);
    if (!rt) { printf("FAIL dlopen runtime: %s\n", dlerror()); return 1; }
    printf("PASS dlopen runtime\n");

    void *sym_init = dlsym(rt, "InitCJRuntime");
    if (!sym_init) { printf("FAIL dlsym InitCJRuntime\n"); return 1; }
    static char param[4096] = {0};
    int rc = ((init_rt_fn)sym_init)(param);
    printf("InitCJRuntime → %d\n", rc);
    if (rc != 0) { printf("FAIL init\n"); return 1; }
    printf("PASS runtime initialized\n");

    // Step 2: dlopen kernel dylib
    void *k = dlopen(kernel_path, RTLD_NOW);
    if (!k) { printf("FAIL dlopen kernel: %s\n", dlerror()); return 1; }
    printf("PASS dlopen kernel dylib\n");

    // Step 3: dlsym kernel functions
    void *p_init = dlsym(k, "kernel_init");
    void *p_shutdown = dlsym(k, "kernel_shutdown");
    void *p_ping = dlsym(k, "kernel_ping");
    void *p_add = dlsym(k, "kernel_add");
    void *p_mul = dlsym(k, "kernel_mul");
    if (!p_init || !p_shutdown || !p_ping || !p_add || !p_mul) {
        printf("FAIL dlsym kernel functions\n"); return 1;
    }
    printf("PASS dlsym (5 kernel functions)\n");

    // Step 4: 调用
    printf("kernel_init(42) = %d\n", ((int (*)(long long))p_init)(42));
    printf("kernel_ping() = %d\n", ((int (*)(void))p_ping)());
    printf("kernel_add(20,22) = %lld\n", ((long long (*)(long long, long long))p_add)(20, 22));
    printf("kernel_mul(6,7) = %lld\n", ((long long (*)(long long, long long))p_mul)(6, 7));
    printf("kernel_shutdown() = %d\n", ((int (*)(void))p_shutdown)());
    printf("kernel_ping after shutdown = %d\n", ((int (*)(void))p_ping)());

    printf("ALL PASS\n");
    return 0;
}
