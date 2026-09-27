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


## R96.3 附录：官方在线文档核验（仓颉 1.2.0，2026-09-27）

三个权威源（cj-docs.gitcode.com/zh/1.2.0）直接阅读，不猜测：

### FFI/cangjie-c.html（仓颉-C 互操作，权威规则页）
- `@C` 导出规则实证：修饰 foreign 函数、**顶层非泛型函数**、struct；类型须满足 CType
  约束；仓颉侧调用需 unsafe；**命名不建议 CJ_ 前缀**（与 std/运行时内部符号冲突）——
  本项目 kernelAdd 命名合规；
- 调用约定：`@CallingConv[CDECL]`，默认可省略，仅支持 CDECL（与 R96 实测 System V AMD64
  直调成功一致）；
- **CString 所有权**：String→CString 须 `LibC.mallocCString` 且**用后释放**；inout 指针
  仅保证调用期间有效——跨语言字符串是显式的内存管理责任区（本 spike 未测字符串导出，
  立项 @ohos:cjk 时列为首批验证项）；
- **混合宿主约束（官方承认进程内场景存在）**：fork 子进程不支持仓颉逻辑；C 侧退出进程
  时共享资源已释放可能非法访问；不建议其他语言长时间阻塞——这三条 = 官方默认
  "C 宿主 + 仓颉逻辑同进程"场景存在，只是**运行时初始化细节不在本页**。

### deploy_and_run/runtime_deploy.html（运行时部署）
- 只覆盖【仓颉可执行程序自身】的运行时部署（LD_LIBRARY_PATH 指向
  `${CANGJIE_HOME}/runtime/lib/<arch>_cjnative`；全静态链接可免部署）；
- **不含宿主嵌入 API**——InitCJRuntime/LoadCJLibraryWithInit 在官方文档中无公开页面，
  证实"de facto 可用、de jure 未文档化"的判断（入口符号从 libcangjie-runtime.so
  dlsym 可得，用法要从 cangjie_runtime 源码仓库的 Cangjie.h 抄）。

### release-notes/cangjie_1.2（关键条目）
- **无宿主嵌入 API 条目**（"C Invoke Cangjie API"仍未进 SDK，与源码分析一致）；
- 互操作方向 = ObjC/Java 扩展（非 C 宿主嵌入）；
- **"新增 OHOS 版仓颉 SDK（鸿蒙 PC）"**——2in1/PC 形态的仓颉支持是官方在推的方向；
- **破坏性变更**：SDK 间编译产物**二进制不兼容**（Exception/TypeInfo 私有成员）——
  dylib 挂载方案必须**锁定 SDK 版本**并随升级全量重编；
- **1.1.x STS 于 2026.10.30 停止维护**——本机 1.1.3 需升级到 1.2.0（本地已有）或跟随
  nightly。

### 对挂载设计的三条落地约束
1. dylib 挂载必须**锁 SDK 版本**（编译产物二进制不兼容是官方明示的破坏性变更）；
2. 跨语言字符串必须走 `LibC.mallocCString` + 显式释放，inout 指针仅调用期有效；
3. fork 场景（子进程跑仓颉逻辑）官方不支持——子进程化挂载方案中，仓颉逻辑必须留在
   初始化过的那一个进程内。
