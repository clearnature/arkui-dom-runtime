// R96.2 扩展验证：多 @C 函数导出 + 错误路径（符号缺失）+ Int64 直调精度
// 前提：libkernel2.so 已含 kernelAdd/kernelEcho（kernel2.cj 编译产物）
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

typedef long long (*fn2)(long long, long long);
typedef long long (*fn1)(long long);

int main(void) {
    const char *rtlib = "/data/training/cli/cangjie-sdk-linux-x64-1.1.3/cangjie/runtime/lib/linux_x86_64_cjnative/libcangjie-runtime.so";
    void *rt = dlopen(rtlib, RTLD_NOW | RTLD_GLOBAL);
    if (!rt) { printf("dlopen runtime FAIL: %s\n", dlerror()); return 1; }

    int (*initCJ)(const void *) = (int (*)(const void *))dlsym(rt, "InitCJRuntime");
    int (*loadCJ)(const char *) = (int (*)(const char *))dlsym(rt, "LoadCJLibraryWithInit");
    if (!initCJ || !loadCJ) { printf("dlsym api FAIL\n"); return 1; }

    static char param[4096];
    memset(param, 0, sizeof(param));
    printf("InitCJRuntime → %d\n", initCJ(param));

    const char *lib = "/tmp/cjspeak/libkernel2.so";
    printf("LoadCJLibraryWithInit → %d\n", loadCJ(lib));

    // 正路径：两个 @C 函数（RTLD_DEFAULT 跨库找符号）
    fn2 add = (fn2)dlsym(RTLD_DEFAULT, "kernelAdd");
    fn1 echo = (fn1)dlsym(RTLD_DEFAULT, "kernelEcho");
    printf("kernelAdd(20,22) = %lld\n", (long long)add(20, 22));
    printf("kernelEcho(21)   = %lld\n", (long long)echo(21));

    // 错误路径：不存在的符号 → dlsym 返回 NULL（可检测，不崩溃）
    void *miss = dlsym(RTLD_DEFAULT, "kernelNope");
    printf("missing symbol → %s\n", miss ? "unexpectedly found" : "NULL（可检测）");

    return 0;
}
