// R98：仓颉内核 v2 —— 完整实现 kernel/c-abi.h 的 6 符号契约
//
// 契约（kernel/c-abi.h）：kernel_init / kernel_shutdown / kernel_call /
// kernel_free / kernel_ping / kernel_last_error。换内核 = 换 .so，宿主零改动。
//
// 方法面 v1（method 字符串分派，params/返回均为 JSON 字符串）：
//   echo  → params 原样返回（JSON 直通，证明跨语言字符串往返）
//   add   → {"a":x,"b":y} → {"sum":x+y}          （JSON 解析）
//   fib   → {"n":k} → {"result":fib(k)}          （递归计算，内核真算力）
//   upper → {"text":"..."} → {"text":"..."}      （ASCII 大写，字符串处理）
//   error → 强制失败路径：返回 NULL，kernel_last_error 给出原因
//
// 边界（v1 刻意不做，避免引依赖）：无 JSON 库（手写字节扫描，只支持无空白紧凑
// 形式 + 整数）；upper 不处理转义与多字节。堆分配用 foreign malloc/free，返回
// 缓冲区由宿主 kernel_free 释放；last_error 缓冲由内核在下次调用时自行释放。
//
// 编译（SDK 与 Cangjie.h 见 kernel/c-abi/Cangjie.h）：
//   cjc src/kernel.cj --output-type=dylib -o libkernel.so
// 运行时依赖：libcangjie-runtime.so / libcangjie-std-core.so / libboundscheck.so
// （均在 <SDK>/runtime/lib/linux_x86_64_cjnative/，宿主须先 RTLD_GLOBAL dlopen
// 运行时本体——NAPI 桥 bridge/napi/cjk_napi.cc 按此序加载）。
//
// 实测约束（2026-09-27 nightly 1.3.0-alpha，坑 101）：
//   1. @C 函数体内使用仓颉 String（堆分配）要求宿主先 InitCJRuntime，实测正常；
//   2. 【禁用】Int64.toString()：在 @C 帧内返回头部损坏的 String（.size 是垃圾
//      值 6399178）——所有响应数字一律走手写 writeInt（纯算术→ASCII）；
//   3. 字面量拼接与 String.fromUtf8 构造的串 toArray() 正常，可安全使用；
//   4. 默认 CPointer 不是 NULL 位型，free 前必须 isNull() 守卫。

@C
foreign func malloc(size: UInt64): CPointer<UInt8>
@C
foreign func free(ptr: CPointer<UInt8>): Unit

// ── 内核状态 ──
var gInitialized: Bool = false
var gLastErr: String = ""
var gLastErrCs: CPointer<UInt8> = CPointer<UInt8>()   // 上次 last_error 的 C 串（惰性持有）

func setErr(s: String): Unit {
    gLastErr = s
    return
}

// C 字符串 → 仓颉 String（两遍：先数长度再拷贝，避免引 std.collection）
func csToString(p: CPointer<UInt8>): String {
    var n: Int64 = 0
    while (unsafe { (p + n).read() } != 0) {
        n += 1
    }
    let arr = Array<UInt8>(n, repeat: 0)
    var i: Int64 = 0
    while (i < n) {
        arr[i] = unsafe { (p + i).read() }
        i += 1
    }
    return String.fromUtf8(arr)
}

// 仓颉 String → malloc 出的 C 字符串（带 0 结尾；宿主经 kernel_free 释放）
func stringToCs(s: String): CPointer<UInt8> {
    let bytes = s.toArray()
    let p = unsafe { malloc(UInt64(bytes.size + 1)) }
    for (i in 0..bytes.size) {
        unsafe { (p + Int64(i)).write(bytes[i]) }
    }
    unsafe { (p + Int64(bytes.size)).write(0) }
    return p
}

// 响应构建器：手写字节缓冲 → String.fromUtf8。
// 数字一律走 writeInt（坑 101：@C 帧内 Int64.toString() 不可用）。
class ByteBuf {
    var data: Array<UInt8>
    var n: Int64
    init(cap: Int64) {
        data = Array<UInt8>(cap, repeat: 0)
        n = 0
    }
    func raw(b: UInt8): Unit {
        data[n] = b
        n += 1
        return
    }
    func str(s: String): Unit {
        for (b in s.toArray()) {
            data[n] = b
            n += 1
        }
        return
    }
    func int(v: Int64): Unit {
        var x = v
        if (x < 0) {
            data[n] = 45   // '-'
            n += 1
            x = -x
        }
        if (x == 0) {
            data[n] = 48   // '0'
            n += 1
            return
        }
        var digits: Int64 = 0
        var t = x
        while (t > 0) { digits += 1; t /= 10 }
        var i = n + digits - 1
        while (i >= n) {
            data[i] = UInt8(48 + (x % 10))
            x /= 10
            i -= 1
        }
        n += digits
        return
    }
    func done(): String {
        return String.fromUtf8(data.slice(0, n))
    }
}

// 极简 JSON 整数提取：扫 "key": 后的（可选负号）十进制整数。
// 只支持紧凑形式（无空白）；找不到/不是整数返回 None。
func jsonInt(src: String, key: String): ?Int64 {
    let bytes = src.toArray()
    let pat = ("\"" + key + "\":").toArray()
    if (pat.size > bytes.size) { return None<Int64> }
    var i = 0
    while (i + pat.size <= bytes.size) {
        var hit = true
        for (j in 0..pat.size) {
            if (bytes[i + j] != pat[j]) { hit = false; break }
        }
        if (hit) {
            var k = i + pat.size
            var neg = false
            if (k < bytes.size && bytes[k] == 45) { neg = true; k += 1 }   // '-'
            var v: Int64 = 0
            var any = false
            while (k < bytes.size && bytes[k] >= 48 && bytes[k] <= 57) {   // 0-9
                v = v * 10 + Int64(bytes[k] - 48)
                any = true
                k += 1
            }
            if (!any) { return None<Int64> }
            return Some(if (neg) { -v } else { v })
        }
        i += 1
    }
    return None<Int64>
}

// 极简 JSON 字符串值提取：扫 "key":" 后直到下一个 '"'。不处理转义（v1 边界）。
func jsonStr(src: String, key: String): ?String {
    let bytes = src.toArray()
    let pat = ("\"" + key + "\":\"").toArray()
    if (pat.size > bytes.size) { return None<String> }
    var i = 0
    while (i + pat.size <= bytes.size) {
        var hit = true
        for (j in 0..pat.size) {
            if (bytes[i + j] != pat[j]) { hit = false; break }
        }
        if (hit) {
            let arr = Array<UInt8>(bytes.size, repeat: 0)
            var n: Int64 = 0
            var k = i + pat.size
            while (k < bytes.size && bytes[k] != 34) {   // '"'
                arr[n] = bytes[k]
                n += 1
                k += 1
            }
            return Some(String.fromUtf8(arr.slice(0, n)))
        }
        i += 1
    }
    return None<String>
}

func fib(n: Int64): Int64 {
    if (n <= 1) { return n }
    return fib(n - 1) + fib(n - 2)
}

// ── 契约实现 ──

@C
public func kernel_init(config: CPointer<UInt8>): Int32 {
    gInitialized = true
    gLastErr = ""
    let cfg = csToString(config)
    // 配置内容 v1 不解析（契约允许各语言自定义内部结构）；非空即记录长度自证可达
    if (cfg.size > 0) {
        let b = ByteBuf(64)
        b.str("init: config bytes=")
        b.int(cfg.size)
        setErr(b.done())
    }
    return 0
}

@C
public func kernel_shutdown(): Int32 {
    gInitialized = false
    return 0
}

@C
public func kernel_ping(): Int32 {
    return if (gInitialized) { 0 } else { -1 }
}

@C
public func kernel_call(method: CPointer<UInt8>, params: CPointer<UInt8>): CPointer<UInt8> {
    if (!gInitialized) {
        setErr("kernel not initialized (call kernel_init first)")
        return CPointer<UInt8>()
    }
    let m = csToString(method)
    let p = csToString(params)

    if (m == "echo") {
        return stringToCs(p)
    }
    if (m == "add") {
        let a = jsonInt(p, "a")
        let b = jsonInt(p, "b")
        if (a.isNone() || b.isNone()) {
            setErr("add: params need integer fields a and b")
            return CPointer<UInt8>()
        }
        let b2 = ByteBuf(48)
        b2.str("{\"sum\":")
        b2.int(a.getOrThrow() + b.getOrThrow())
        b2.str("}")
        return stringToCs(b2.done())
    }
    if (m == "fib") {
        let n = jsonInt(p, "n")
        if (n.isNone()) {
            setErr("fib: params need integer field n")
            return CPointer<UInt8>()
        }
        let nv = n.getOrThrow()
        if (nv < 0 || nv > 40) {
            let eb = ByteBuf(64)
            eb.str("fib: n out of range [0,40], got ")
            eb.int(nv)
            setErr(eb.done())
            return CPointer<UInt8>()
        }
        let b2 = ByteBuf(48)
        b2.str("{\"result\":")
        b2.int(fib(nv))
        b2.str("}")
        return stringToCs(b2.done())
    }
    if (m == "upper") {
        let t = jsonStr(p, "text")
        if (t.isNone()) {
            setErr("upper: params need string field text")
            return CPointer<UInt8>()
        }
        let raw = t.getOrThrow().toArray()
        let out = Array<UInt8>(raw.size, repeat: 0)
        for (i in 0..raw.size) {
            var b = raw[i]
            if (b >= 97 && b <= 122) { b = b - 32 }   // a-z → A-Z
            out[i] = b
        }
        let b2 = ByteBuf(raw.size + 16)
        b2.str("{\"text\":\"")
        b2.str(String.fromUtf8(out))
        b2.str("\"}")
        return stringToCs(b2.done())
    }
    if (m == "error") {
        setErr("error: forced failure for testing")
        return CPointer<UInt8>()
    }
    setErr("unknown method: " + m)
    return CPointer<UInt8>()
}

@C
public func kernel_free(ptr: CPointer<UInt8>): Unit {
    if (!ptr.isNull()) {
        unsafe { free(ptr) }
    }
    return
}

@C
public func kernel_last_error(): CPointer<UInt8> {
    // 上一次的缓冲在此释放（默认空指针 isNull 守卫，free 只对真缓冲发生）
    if (!gLastErrCs.isNull()) {
        unsafe { free(gLastErrCs) }
    }
    gLastErrCs = stringToCs(gLastErr)
    return gLastErrCs
}
