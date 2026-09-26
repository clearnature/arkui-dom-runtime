// R96 spike：C 侧 dlopen 仓颉 dylib 直调 kernelAdd —— 实测崩溃复现脚本
// （保留为证据：结论见 docs/ROADMAP.md R96，勿在主流程使用）
#include <dlfcn.h>
#include <stdio.h>

typedef long long (*add_fn)(long long, long long);

int main(void) {
    void *h = dlopen("./libkernel.so", RTLD_NOW);
    if (!h) { printf("dlopen FAIL: %s\n", dlerror()); return 1; }
    add_fn fn = (add_fn)dlsym(h, "kernelAdd");
    if (!fn) { printf("dlsym FAIL\n"); return 1; }
    long long r = fn(2, 3);
    printf("kernelAdd(2,3) = %lld\n", r);
    dlclose(h);
    return (r == 5) ? 0 : 2;
}
