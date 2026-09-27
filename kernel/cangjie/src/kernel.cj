// R98/R99：仓颉内核 —— 完整实现 kernel/c-abi.h 的 6 符号契约 + agent 调度原语
//
// 契约（kernel/c-abi.h）：kernel_init / kernel_shutdown / kernel_call /
// kernel_free / kernel_ping / kernel_last_error。换内核 = 换 .so，宿主零改动。
//
// 方法面（method 字符串分派，params/返回均为 JSON 字符串）：
//   基础（R98）：
//   echo  → params 原样返回（JSON 直通，证明跨语言字符串往返）
//   add   → {"a":x,"b":y} → {"sum":x+y}          （JSON 解析）
//   fib   → {"n":k} → {"result":fib(k)}          （递归计算，内核真算力）
//   upper → {"text":"..."} → {"text":"..."}      （ASCII 大写，字符串处理）
//   error → 强制失败路径：返回 NULL，kernel_last_error 给出原因
//   agent 调度原语（R99，trha MVP 数据面——注册表+邮箱，跨调用持久）：
//   agent.spawn → {"name":"x"} → {"id":N,"name":"x","state":"idle"}   （id 单调）
//   agent.list  → {} → {"count":N,"agents":[{"id","name"}…]}          （按 spawn 序）
//   agent.send  → {"id":N,"text":"…"} → {"queued":邮箱长度}
//   agent.poll  → {"id":N} → {"messages":[…],"drained":N}             （排空语义）
//   agent.kill  → {"id":N} → {"killed":"name"}
//
// 边界（v1 刻意不做，避免引依赖）：JSON 手写字节扫描（紧凑形式+整数；agent 的
// name/text 不处理引号转义）；真并发调度（CJThread/std.concurrent）留后续切片——
// 本轮只交付注册表与邮箱两个数据面结构。
//
// 编译（SDK 与 Cangjie.h 见 kernel/c-abi/Cangjie.h）：
//   cjc src/kernel.cj --output-type=dylib -o libkernel.so
// 运行时依赖：libcangjie-runtime.so / libcangjie-std-core.so /
// libcangjie-std-collection.so / libboundscheck.so
// （均在 <SDK>/runtime/lib/linux_x86_64_cjnative/，宿主须先 RTLD_GLOBAL dlopen
// 运行时本体——NAPI 桥 bridge/napi/cjk_napi.cc 按此序加载）。
//
// 实测约束（2026-09-27 nightly 1.3.0-alpha，坑 101/102）：
//   1. @C 函数体内使用仓颉 String（堆分配）要求宿主先 InitCJRuntime，实测正常；
//   2. 【禁用】Int64.toString()：在 @C 帧内返回头部损坏的 String（.size 是垃圾
//      值 6399178）——所有响应数字一律走手写 writeInt（纯算术→ASCII）；
//   3. 字面量拼接与 String.fromUtf8 构造的串 toArray() 正常，可安全使用；
//   4. 默认 CPointer 不是 NULL 位型，free 前必须 isNull() 守卫；
//   5. 【包级初始化器在 dlopen 装载的 dylib 里不跑】——包级容器全局量首调用时
//      是垃圾（HashMap.add 直接 SIGSEGV）；必须 Option<容器> 字面默认 + 首用时
//      惰性构造（agentsOf()/orderOf() 模式）。字面量默认（Bool/String/Int64）的全局不受影响。

import std.collection.*
import std.sync.*
import std.time.*

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

// Int64 → 十进制字符串（ByteBuf.int + done 的常用形态）
func intToStr(v: Int64): String {
    let b = ByteBuf(24)
    b.int(v)
    return b.done()
}

// ── R106：快照序列化辅助 ──
// 邮箱消息分隔符（SOH）；emit 侧转义为 6 字符 "\u0001"，restore 侧解码
func jsonEsc(s: String): String {
    let raw = s.toArray()
    let b = ByteBuf(raw.size * 2 + 8)
    for (i in 0..raw.size) {
        let c = raw[i]
        if (c == 92) { b.raw(92); b.raw(92) }            // \ → \\
        else if (c == 34) { b.raw(92); b.raw(34) }       // " → \"
        else if (c == 1) {                               // SOH → \u0001（6 字符转义）
            b.raw(92); b.raw(117); b.raw(48); b.raw(48); b.raw(48); b.raw(49)
        } else { b.raw(c) }
    }
    return b.done()
}

// 定位式读取器（R106：restore 只解析 snapshot 自产的固定形状 JSON）
class Rd {
    var b: Array<UInt8>
    var i: Int64
    var ok: Bool
    init(s: String) {
        b = s.toArray()
        i = 0
        ok = true
    }
    func ch(c: UInt8): Unit {
        if (!ok) { return }
        if (i < b.size && b[i] == c) { i += 1 } else { ok = false }
        return
    }
    func lit(s: String): Unit {
        if (!ok) { return }
        let p = s.toArray()
        for (k in 0..p.size) {
            if (i >= b.size || b[i] != p[k]) { ok = false; return }
            i += 1
        }
        return
    }
    func int(): Int64 {
        if (!ok) { return 0 }
        var neg = false
        if (i < b.size && b[i] == 45) { neg = true; i += 1 }
        var v: Int64 = 0
        var any = false
        while (i < b.size && b[i] >= 48 && b[i] <= 57) {
            v = v * 10 + Int64(b[i] - 48)
            any = true
            i += 1
        }
        if (!any) { ok = false; return 0 }
        return if (neg) { -v } else { v }
    }
    // 带转义的字符串值：\" \\ \u0001；其他 \x 宽松解码为 x
    func str(): String {
        if (!ok) { return "" }
        if (i >= b.size || b[i] != 34) { ok = false; return "" }
        i += 1
        let out = ByteBuf(32)
        while (ok && i < b.size && b[i] != 34) {
            let c = b[i]
            if (c == 92) {
                i += 1
                if (i >= b.size) { ok = false; break }
                let e = b[i]
                if (e == 34) { out.raw(34) }
                else if (e == 92) { out.raw(92) }
                else if (e == 117 && i + 4 < b.size && b[i+1] == 48 && b[i+2] == 48
                         && b[i+3] == 48 && b[i+4] == 49) {          // \u0001 → SOH
                    i += 4
                    out.raw(1)
                } else { out.raw(e) }
            } else {
                out.raw(c)
            }
            i += 1
        }
        if (!ok) { return "" }
        if (i >= b.size || b[i] != 34) { ok = false; return "" }
        i += 1
        return out.done()
    }
}

// 按 SOH 分隔符拆邮箱消息
func splitMailbox(joined: String): ArrayList<String> {
    let parts = ArrayList<String>()
    let bytes = joined.toArray()
    var cur = ByteBuf(32)
    for (i in 0..bytes.size) {
        if (bytes[i] == 1) {
            parts.add(cur.done())
            cur = ByteBuf(32)
        } else {
            cur.raw(bytes[i])
        }
    }
    parts.add(cur.done())
    // 空串单段 = 无消息（emit 侧空邮箱 join 结果恰为 ""）→ 返回空箱
    if (parts.size == 1 && parts.get(0).getOrThrow().size == 0) {
        return ArrayList<String>()
    }
    return parts
}

// ── agent 注册表 + 邮箱（R99，trha MVP 数据面）──
// 坑 102：容器全局量必须 Option 字面默认 + 首用时惰性构造（包级 init 在 dylib 不跑）。
class Agent {
    var name: String
    var box: ArrayList<String>
    init(n: String) {
        name = n
        box = ArrayList<String>()
    }
}

var gAgents: Option<HashMap<Int64, Agent>> = None
var gOrder: Option<ArrayList<Int64>> = None     // spawn 序（HashMap 无序，输出确定性靠它）
var gNextId: Int64 = 0                          // 单调 id；kernel_init 重置

func agentsOf(): HashMap<Int64, Agent> {
    if (let Some(m) <- gAgents) { return m }
    let m = HashMap<Int64, Agent>()
    gAgents = Some(m)
    return m
}

func orderOf(): ArrayList<Int64> {
    if (let Some(l) <- gOrder) { return l }
    let l = ArrayList<Int64>()
    gOrder = Some(l)
    return l
}

func agentReset(): Unit {
    gAgents = Some(HashMap<Int64, Agent>())
    gOrder = Some(ArrayList<Int64>())
    gNextId = 0
    return
}

// 按 spawn 序展开注册表：{"count":N,"agents":[{"id":..,"name":".."},…]}
func agentListJson(): String {
    let m = agentsOf()
    let order = orderOf()
    let b = ByteBuf(64 + order.size * 48)
    b.str("{\"count\":")
    b.int(Int64(order.size))
    b.str(",\"agents\":[")
    var first = true
    for (i in 0..order.size) {
        let id = order.get(i).getOrThrow()
        let a = m.get(id)
        if (let Some(ag) <- a) {
            if (!first) { b.str(",") }
            first = false
            b.str("{\"id\":")
            b.int(id)
            b.str(",\"name\":\"")
            b.str(ag.name)
            b.str("\",\"state\":\"idle\"}")
        }
    }
    b.str("]}")
    return b.done()
}

// ── agent 作业与并发 drainer（R100，trha MVP 控制面）──
//
// 机制（嵌入模式实测定型，坑 103/104）：
//   · cjthread 只在宿主 RunUIScheduler 泵的窗口里执行；sleep 在此模式下是空操作
//     （timer 线程不跑）→ drainer 不许自旋等待；
//   · Semaphore/Monitor 等阻塞唤醒原语不能从宿主原生线程调（栈腐蚀）→ 队列同步只用
//     Mutex（纯 futex，宿主线程安全）；
//   · 因此 drainer = 「清空队列即返回」的有界 cjthread：宿主（addon 的 cjkCall 后置
//     驱动）看到 pending>0 且空闲时 RunCJTask 拉起一支，泵给它窗口跑，清完即退出。
class Job {
    var agentId: Int64
    var kind: String            // "fib" | "echo"
    var n: Int64                // fib 参数
    var text: String            // echo 参数
    var state: Int64            // 0=pending 2=claimed(in-flight) 1=done
    var value: Int64            // fib 结果
    var out: String             // echo 结果
    var startNs: Int64          // 领取时刻（进程内相对 ns，0=未领取）——R105 并行证据
    var endNs: Int64            // 完成时刻
    init(a: Int64, k: String, nn: Int64, t: String) {
        agentId = a
        kind = k
        n = nn
        text = t
        state = 0
        value = 0
        out = ""
        startNs = 0
        endNs = 0
    }
}

var gJobs: Option<HashMap<Int64, Job>> = None
var gJobQueue: Option<ArrayList<Int64>> = None    // pending FIFO（drain 序；claimed 即出队）
var gDoneOrder: Option<ArrayList<Int64>> = None   // 完成序（agent.timings 的遍历序）
var gNextJobId: Int64 = 0
var gActiveWorkers: Int64 = 0                     // R105：活跃 worker 数（draining 新语义）
var gJobMu: Option<Mutex> = None                  // 队列/结果表锁（宿主线程与 cjthread 共用）
var gT0: Option<MonoTime> = None                  // 时间戳基准（进程内相对 ns）

func jobsOf(): HashMap<Int64, Job> {
    if (let Some(m) <- gJobs) { return m }
    let m = HashMap<Int64, Job>()
    gJobs = Some(m)
    return m
}
func jobQueueOf(): ArrayList<Int64> {
    if (let Some(l) <- gJobQueue) { return l }
    let l = ArrayList<Int64>()
    gJobQueue = Some(l)
    return l
}
func jobMu(): Mutex {
    if (let Some(m) <- gJobMu) { return m }
    let m = Mutex()
    gJobMu = Some(m)
    return m
}
func doneOrderOf(): ArrayList<Int64> {
    if (let Some(l) <- gDoneOrder) { return l }
    let l = ArrayList<Int64>()
    gDoneOrder = Some(l)
    return l
}
func monoNs(): Int64 {
    if (let Some(t) <- gT0) {
        return (MonoTime.now() - t).toNanoseconds()
    }
    gT0 = Some(MonoTime.now())
    return 0
}

func jobReset(): Unit {
    gJobs = Some(HashMap<Int64, Job>())
    gJobQueue = Some(ArrayList<Int64>())
    gDoneOrder = Some(ArrayList<Int64>())
    gJobMu = Some(Mutex())
    gNextJobId = 0
    gActiveWorkers = 0
    gT0 = Some(MonoTime.now())
    return
}

// 可选调度符号（addon 按 dlsym 探测，缺席=旧内核无并发，向后兼容）
@C
public func kernel_pending(): Int32 {
    return Int32(jobQueueOf().size)
}
// R105 新语义：活跃 worker 数（R100-R104 为 0/1 布尔）
@C
public func kernel_draining(): Int32 {
    return Int32(gActiveWorkers)
}

// R102：ABI 版本握手（可选符号；宿主 dlsym 探测，缺席=v1.0 旧内核容忍）
@C
public func kernel_abi_version(): Int32 {
    return 10001
}

// R112：类型化直调符号（可选；与 JSON 方法面 "add"/"echo" 双轨，零序列化）
@C
public func kernel_add(a: Int64, b: Int64): Int64 {
    return a + b
}
@C
public func kernel_echo(input: CPointer<UInt8>): CPointer<UInt8> {
    return stringToCs(csToString(input))
}

// 有界 worker 主循环（R105：可重入，宿主可并发拉起多支）：
// 领取（锁内出队+打时间戳）→ 锁外计算 → 存结果（锁内）→ 队空即退
@C
public func kernel_drain_entry(_p: CPointer<Unit>): CPointer<Unit> {
    jobMu().lock()
    gActiveWorkers += 1
    jobMu().unlock()
    while (true) {
        var job: ?Job = None
        var curJid: Int64 = -1
        jobMu().lock()
        let q = jobQueueOf()
        if (q.size > 0) {
            let jid = q.get(0).getOrThrow()
            let rest = ArrayList<Int64>()
            for (i in 1..q.size) { rest.add(q.get(i).getOrThrow()) }
            gJobQueue = Some(rest)
            job = jobsOf().get(jid)
            if (let Some(j) <- job) {
                j.state = 2                       // claimed（其他 worker 跳过）
                j.startNs = monoNs()
                curJid = jid
            }
        }
        jobMu().unlock()
        if (let Some(j) <- job) {
            if (j.kind == "fib") {
                j.value = fib(j.n)
            } else {
                j.out = j.text
            }
            jobMu().lock()
            j.state = 1
            j.endNs = monoNs()
            doneOrderOf().add(curJid)
            jobMu().unlock()
        } else {
            break
        }
    }
    jobMu().lock()
    gActiveWorkers -= 1
    jobMu().unlock()
    return CPointer<Unit>()
}

// ── 契约实现 ──

@C
public func kernel_init(config: CPointer<UInt8>): Int32 {
    gInitialized = true
    gLastErr = ""
    agentReset()          // 重新初始化 = 全新内核（agent 注册表清零，测试隔离靠它）
    jobReset()            // 作业表与 drainer 状态同步清零
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

    // ── agent 调度原语（R99）──
    if (m == "agent.spawn") {
        let nameO = jsonStr(p, "name")
        gNextId += 1
        let id = gNextId
        let name = if (let Some(nv) <- nameO) { nv } else { "agent-" + intToStr(gNextId) }
        agentsOf().add(id, Agent(name))
        orderOf().add(id)
        let b2 = ByteBuf(96)
        b2.str("{\"id\":")
        b2.int(id)
        b2.str(",\"name\":\"")
        b2.str(name)
        b2.str("\",\"state\":\"idle\"}")
        return stringToCs(b2.done())
    }
    if (m == "agent.list") {
        return stringToCs(agentListJson())
    }
    if (m == "agent.send") {
        let idO = jsonInt(p, "id")
        let textO = jsonStr(p, "text")
        if (idO.isNone() || textO.isNone()) {
            setErr("agent.send: params need integer id and string text")
            return CPointer<UInt8>()
        }
        let a = agentsOf().get(idO.getOrThrow())
        if (let Some(ag) <- a) {
            ag.box.add(textO.getOrThrow())
            let b2 = ByteBuf(32)
            b2.str("{\"queued\":")
            b2.int(Int64(ag.box.size))
            b2.str("}")
            return stringToCs(b2.done())
        }
        let eb = ByteBuf(48)
        eb.str("agent.send: no agent id=")
        eb.int(idO.getOrThrow())
        setErr(eb.done())
        return CPointer<UInt8>()
    }
    if (m == "agent.poll") {
        let idO = jsonInt(p, "id")
        if (idO.isNone()) {
            setErr("agent.poll: params need integer id")
            return CPointer<UInt8>()
        }
        let a = agentsOf().get(idO.getOrThrow())
        if (let Some(ag) <- a) {
            let n = Int64(ag.box.size)
            let b2 = ByteBuf(48 + n * 32)
            b2.str("{\"messages\":[")
            for (i in 0..ag.box.size) {
                if (i > 0) { b2.str(",") }
                b2.str("\"")
                b2.str(ag.box.get(i).getOrThrow())
                b2.str("\"")
            }
            b2.str("],\"drained\":")
            b2.int(n)
            b2.str("}")
            ag.box = ArrayList<String>()       // 排空语义
            return stringToCs(b2.done())
        }
        let eb = ByteBuf(48)
        eb.str("agent.poll: no agent id=")
        eb.int(idO.getOrThrow())
        setErr(eb.done())
        return CPointer<UInt8>()
    }
    if (m == "agent.kill") {
        let idO = jsonInt(p, "id")
        if (idO.isNone()) {
            setErr("agent.kill: params need integer id")
            return CPointer<UInt8>()
        }
        let id = idO.getOrThrow()
        let a = agentsOf().get(id)
        if (let Some(ag) <- a) {
            // spawn 序重排：滤掉被杀 id（避免依赖 ArrayList.remove 的 API 形态）
            let keep = ArrayList<Int64>()
            for (i in 0..orderOf().size) {
                let x = orderOf().get(i).getOrThrow()
                if (x != id) { keep.add(x) }
            }
            gOrder = Some(keep)
            agentsOf().remove(id)
            let b2 = ByteBuf(64)
            b2.str("{\"killed\":\"")
            b2.str(ag.name)
            b2.str("\"}")
            return stringToCs(b2.done())
        }
        let eb = ByteBuf(48)
        eb.str("agent.kill: no agent id=")
        eb.int(id)
        setErr(eb.done())
        return CPointer<UInt8>()
    }

    // ── agent 作业（R100，异步执行：宿主经 RunCJTask+RunUIScheduler 驱动 drainer）──
    if (m == "agent.submit") {
        let idO = jsonInt(p, "id")
        let kindO = jsonStr(p, "kind")
        if (idO.isNone() || kindO.isNone()) {
            setErr("agent.submit: params need integer id and string kind")
            return CPointer<UInt8>()
        }
        let ag = agentsOf().get(idO.getOrThrow())
        if (let Some(_) <- ag) {
            let kind = kindO.getOrThrow()
            if (kind != "fib" && kind != "echo") {
                setErr("agent.submit: kind must be fib or echo, got " + kind)
                return CPointer<UInt8>()
            }
            gNextJobId += 1
            let jid = gNextJobId
            let n: Int64 = if (let Some(nv) <- jsonInt(p, "n")) { nv } else { 0 }
            let t: String = if (let Some(tv) <- jsonStr(p, "text")) { tv } else { "" }
            jobMu().lock()
            jobsOf().add(jid, Job(idO.getOrThrow(), kind, n, t))
            jobQueueOf().add(jid)
            jobMu().unlock()
            let b2 = ByteBuf(48)
            b2.str("{\"jobId\":")
            b2.int(jid)
            b2.str(",\"state\":\"pending\"}")
            return stringToCs(b2.done())
        }
        let eb = ByteBuf(48)
        eb.str("agent.submit: no agent id=")
        eb.int(idO.getOrThrow())
        setErr(eb.done())
        return CPointer<UInt8>()
    }
    if (m == "agent.result") {
        let jidO = jsonInt(p, "jobId")
        if (jidO.isNone()) {
            setErr("agent.result: params need integer jobId")
            return CPointer<UInt8>()
        }
        let j = jobsOf().get(jidO.getOrThrow())
        if (let Some(job) <- j) {
            let b2 = ByteBuf(128)
            if (job.state == 1) {
                // 仅 state==1 视为完成；2=claimed(in-flight) 必须报 pending（R105 修正：
                // 旧写法 else 兜底会把 claimed 误报成 done+value=0）
                if (job.kind == "fib") {
                    b2.str("{\"state\":\"done\",\"value\":")
                    b2.int(job.value)
                    b2.str("}")
                } else {
                    b2.str("{\"state\":\"done\",\"text\":\"")
                    b2.str(job.out)
                    b2.str("\"}")
                }
            } else {
                b2.str("{\"state\":\"pending\"}")
            }
            return stringToCs(b2.done())
        }
        let eb = ByteBuf(48)
        eb.str("agent.result: no job id=")
        eb.int(jidO.getOrThrow())
        setErr(eb.done())
        return CPointer<UInt8>()
    }
    if (m == "agent.timings") {
        // R105 并行证据：已完成作业的 [startNs,endNs]（完成序）
        let order = doneOrderOf()
        let m2 = jobsOf()
        let b2 = ByteBuf(64 + order.size * 48)
        b2.str("{\"n\":")
        b2.int(Int64(order.size))
        b2.str(",\"t\":[")
        for (i in 0..order.size) {
            if (i > 0) { b2.str(",") }
            let j = m2.get(order.get(i).getOrThrow())
            if (let Some(jb) <- j) {
                b2.str("[")
                b2.int(jb.startNs)
                b2.str(",")
                b2.int(jb.endNs)
                b2.str("]")
            }
        }
        b2.str("]}")
        return stringToCs(b2.done())
    }

    // ── 状态快照/恢复（R106：agent 注册表+邮箱+id 计数器；作业不快照）──
    if (m == "sys.snapshot") {
        let b2 = ByteBuf(128)
        b2.str("{\"v\":1,\"nextId\":")
        b2.int(gNextId)
        b2.str(",\"n\":")
        b2.int(Int64(orderOf().size))
        b2.str(",\"a\":[")
        var first = true
        for (i in 0..orderOf().size) {
            let id = orderOf().get(i).getOrThrow()
            let a = agentsOf().get(id)
            if (let Some(ag) <- a) {
                if (!first) { b2.str(",") }
                first = false
                b2.str("[")
                b2.int(id)
                b2.str(",\"")
                b2.str(jsonEsc(ag.name))
                b2.str("\",\"")
                for (k in 0..ag.box.size) {
                    if (k > 0) { b2.raw(1) }
                    b2.str(jsonEsc(ag.box.get(k).getOrThrow()))
                }
                b2.str("\"]")
            }
        }
        b2.str("]}")
        return stringToCs(b2.done())
    }
    if (m == "sys.restore") {
        // 定位解析（形状=sys.snapshot 输出）；先整体解析成功再重建（半途失败不动现状态）
        let rd = Rd(p)
        rd.ch(123)
        rd.lit("\"v\":")
        let v = rd.int()
        rd.ch(44)
        rd.lit("\"nextId\":")
        let nextId = rd.int()
        rd.ch(44)
        rd.lit("\"n\":")
        let n = rd.int()
        rd.ch(44)
        rd.lit("\"a\":")
        rd.ch(91)
        if (!rd.ok || v != 1) {
            setErr("sys.restore: bad snapshot (v=" + intToStr(v) + ")")
            return CPointer<UInt8>()
        }
        var ids = ArrayList<Int64>()
        var names = ArrayList<String>()
        var boxes = ArrayList<String>()
        for (k in 0..n) {
            if (k > 0) { rd.ch(44) }
            rd.ch(91)
            let id = rd.int()
            rd.ch(44)
            let name = rd.str()
            rd.ch(44)
            let boxJoined = rd.str()
            rd.ch(93)
            if (!rd.ok) { break }
            ids.add(id)
            names.add(name)
            boxes.add(boxJoined)
        }
        rd.ch(93)
        rd.ch(125)
        if (!rd.ok) {
            setErr("sys.restore: malformed snapshot")
            return CPointer<UInt8>()
        }
        agentReset()                       // restore = 状态整体替换
        for (k in 0..ids.size) {
            let id = ids.get(k).getOrThrow()
            let ag = Agent(names.get(k).getOrThrow())
            ag.box = splitMailbox(boxes.get(k).getOrThrow())
            agentsOf().add(id, ag)
            orderOf().add(id)
        }
        gNextId = nextId
        return stringToCs("{\"restored\":" + intToStr(Int64(ids.size)) + "}")
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
