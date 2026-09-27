// R96.2 扩展：两个 @C 导出 + 错误路径（符号缺失）
// 验证：多函数导出、dlsym 未命中返回 NULL 可检测、Int64 C ABI 直调
package demo

@C
public func kernelAdd(a: Int64, b: Int64): Int64 {
    return a + b
}

@C
public func kernelEcho(x: Int64): Int64 {
    return x * 2
}

main() {
    println("kernel loaded")
}
