// R96.2 错误路径验证：不存在的仓颉 @C 符号 → dlsym 返回 NULL（可检测、不崩溃）
// 前提：libkernel.so 已含 kernelAdd（kernel.cj 编译产物）
#include <dlfcn.h>
#include <stdio.h>

typedef long long (*add_fn)(long long, long long);

int main(void) {
    void *h = dlopen("./libkernel.so", RTLD_NOW);
    if (!h) { printf("dlopen FAIL: %s\n", dlerror()); return 1; }
    add_fn fn = (add_fn)dlsym(h, "kernelAdd");
    if (!fn) { printf("dlsym FAIL: %s\n", dlerror()); return 1; }
    long long r = fn(2, 3);
    printf("kernelAdd(2,3) = %lld\n", r);
    dlclose(h);
    return (r == 5) ? 0 : 2;
}
