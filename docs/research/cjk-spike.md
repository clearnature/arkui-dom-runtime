# R96 spike：仓颉内核挂载路径验证（2026-09-27）

> 问题：自研 DOM 运行时（无 PandaVM）怎么挂载仓颉内核？
> 结论（R96.2 修正）：**进程内 C ABI 可行且官方支持**——运行时自带头文件 Cangjie.h
> 暴露完整初始化序列（InitCJRuntime → LoadCJLibraryWithInit → FindCJSymbol → 直调），
> 全序列实测跑通（kernelAdd(2,3)=5，仓颉 GC 线程正常起）。独立 ELF + stdio 仍是
> 隔离场景的可选形态，但不再是"唯一"路径。

## 实测环境

- cjc 1.1.3 (cjnative)：`/data/training/cli/cangjie-sdk-linux-x64-1.1.3/cangjie/bin/cjc`
- 另有 cangjie-nightly-1.3.0-alpha 在 `/data/training/cli/`
- 目标：x86_64-unknown-linux-gnu

## 实测结果

| 实验 | 结果 |
|---|---|
| `cjc hello.cj -o hello`（独立 ELF） | ✅ 直接运行（运行时初始化内建） |
| `@C public func kernelAdd(...)` + `--output-type=dylib` | ✅ 编译成功，`nm -D` 见无 mangling 的 `T kernelAdd` |
| C 程序 dlopen dylib 直调 kernelAdd | ❌ SIGABRT：`Check failed: runtime != nullptr` |
| 预载 std-core/boundscheck/runtime（RTLD_GLOBAL）后再调 | ❌ 同样崩溃 |

## 结论

1. **`@C` 导出本身可用**（C ABI 符号无 mangling）；
2. **但 cjc 的 dylib 不内嵌仓颉运行时初始化序列**——那个序列被编译进 exe 的启动代码，SDK 无公开头文件/入口（`CJ_CJThreadEntry` 等符号存在但无文档承诺），外部进程无法合法初始化；
3. **（R96.2 推翻）进程内 C ABI 可用**：`libcangjie-runtime.so` 以 `MRT_EXPORT` 导出官方初始化序列——`InitCJRuntime(RuntimeParam&)`（零初始化参数=全默认）、`LoadCJLibraryWithInit(libName)`、`FindCJSymbol(libName, func)`、`RunCJTask`，全部有 `Cangjie.h` 文档与示例（编译器源码 `InvokeUtilCJNative.cpp` 亦引用）。首测崩溃是**跳过了官方初始化序列直接调函数**所致，非不可用；
4. R96 当时的"唯一路径"结论修正：stdio 子进程降级为**隔离场景选项**；进程内直挂（Electron 主进程一次性 InitCJRuntime + 后续直调导出函数）成为**主推路径**——同步语义、零序列化开销。

## 复现

```bash
CJ=/data/training/cli/cangjie-sdk-linux-x64-1.1.3/cangjie
cd tools/cjk-spike
$CJ/bin/cjc kernel.cj --output-type=dylib -o libkernel.so   # 无 main 版（本目录 kernel.cj 去 main）
gcc test_ffi.c -o test_ffi -ldl
LD_LIBRARY_PATH=$CJ/runtime/lib/linux_x86_64_cjnative:. ./test_ffi
# → Check failed: runtime != nullptr（SIGABRT）—— 即本结论的复现
```


## R96.2 附录：官方 C API 全序列（实测通过）

```c
// dlopen libcangjie-runtime.so (RTLD_GLOBAL) 后：
InitCJRuntime(&param);                    // → 0（仓颉 GC 线程起，"Cangjie runtime started"）
LoadCJLibraryWithInit("/path/libkernel.so"); // → 0
void *fn = FindCJSymbol(libPath, "kernelAdd"); // → 命中
// 直调 @C 导出函数 → kernelAdd(2,3) = 5
```

日志佐证：`Cangjie runtime started.` / `GCThreadPool init` / `FinalizerProcessor thread started`（运行时真实启动）。

**ARCHITECTURE.md §4.21 的修正记录同步更新（R96.2）：进程内 C ABI 从"不可用"改为"可行（官方 C API）"。**
