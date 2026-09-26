// R96 spike：仓颉内核挂载路径验证——@C 导出 + 进程内 C ABI 调用
// 结论：@C 产生无 mangling 的 C ABI 符号（kernelAdd），但 dylib 不自带仓颉运行时
// 初始化序列，外部进程 dlopen 后调用必然触发 "Check failed: runtime != nullptr"。
// 独立 ELF 自带完整初始化（cjc 默认 exe 直接跑通）→ 挂载路径定型为【独立 ELF + stdio】。
package demo

@C
public func kernelAdd(a: Int64, b: Int64): Int64 {
    return a + b
}

main() {
    println("kernel loaded")
}
