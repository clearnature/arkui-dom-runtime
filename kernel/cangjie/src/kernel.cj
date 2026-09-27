// R97: 仓颉内核——最小可编译 dylib（证明 C ABI 编译链通）
// 5 个 C ABI 函数：init/shutdown/ping/add/mul
// 编译: cjc kernel.cj --output-type=dylib -o libkernel.so
// 目标: 证明「cjc 编译 → dylib → 宿主 dlopen → dlsym → 直调」链路通

var initialized: Bool = false

@C
public func kernel_init(config: Int64): Int32 {
    initialized = true
    return 0
}

@C
public func kernel_shutdown(): Int32 {
    initialized = false
    return 0
}

@C
public func kernel_ping(): Int32 {
    return if (initialized) { 0 } else { -1 }
}

@C
public func kernel_add(a: Int64, b: Int64): Int64 {
    return a + b
}

@C
public func kernel_mul(a: Int64, b: Int64): Int64 {
    return a * b
}
