# R96 spike：仓颉内核挂载路径验证（2026-09-27）

> 问题：自研 DOM 运行时（无 PandaVM）怎么挂载仓颉内核？
> 结论：**独立 ELF 子进程 + stdio 行协议**（唯一被实证支持的形态）。

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
3. **挂载路径定型：独立 ELF 子进程 + stdio 行协议**（Node `child_process.spawn`；仓颉侧 main 里 `Console.stdIn.readln` 循环）；
4. 进程内 C ABI（NAPI 直挂 dylib）**不可用**——除非将来 cjc 提供运行时初始化的公开入口（记触发条件）。

## 复现

```bash
CJ=/data/training/cli/cangjie-sdk-linux-x64-1.1.3/cangjie
cd tools/cjk-spike
$CJ/bin/cjc kernel.cj --output-type=dylib -o libkernel.so   # 无 main 版（本目录 kernel.cj 去 main）
gcc test_ffi.c -o test_ffi -ldl
LD_LIBRARY_PATH=$CJ/runtime/lib/linux_x86_64_cjnative:. ./test_ffi
# → Check failed: runtime != nullptr（SIGABRT）—— 即本结论的复现
```
