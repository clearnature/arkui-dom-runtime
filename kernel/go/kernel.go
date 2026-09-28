// =====================================================================================
// kernel/go/kernel.go — Go 内核：kernel_abi.h 契约（R116，第四语言）
//
// 数据面对齐 /home/yanli/work/DeepSeek-Reasonix（module reasonix，go 1.26）。
// 方法面 = 仓颉/Haskell 可测子集（echo/add/fib/error + agent 五件 + 作业面），
// 形状与 kernel_abi.h 一致 → 同一份 C 契约测试可跑（同契约多实现的第四语言实证）。
//
// 与前三语言的差异（分发形态最优）：
//   · -buildmode=c-shared：Go runtime 静态链进 .so，产物仅依赖 libc
//   · dlopen 时 constructor 自初始化 → 零宿主序（rtLib="" 挂载，同纯 C 路径；
//     不需要仓颉 InitCJRuntime、不需要 GHC hs_init/泵）
//   · JSON 标准库 encoding/json（前三语言均为手写解析——Go 原生更稳）
//   · goroutine 自调度（runtime 自管）→ 无需 kernel_pending/draining/drain_entry
//
// 构建：bash kernel/go/build.sh（= go build -buildmode=c-shared）
// =====================================================================================
package main

/*
#include <stdlib.h>
*/
import "C"
import (
	"encoding/json"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

// ── 错误缓冲（kernel_last_error 语义） ──────────────────────────────────────────

var lastErr atomic.Value // string

func setErr(msg string) (string, bool) {
	lastErr.Store(msg)
	return "", false
}

func getErr() string {
	v, _ := lastErr.Load().(string)
	return v
}

// ── 可测子集 ────────────────────────────────────────────────────────────────────

func fibN(n int) int64 {
	if n <= 1 {
		return int64(n)
	}
	return fibN(n-1) + fibN(n-2)
}

// esc 输出转义（与仓颉 jsonEsc / Haskell esc 同集：引号 反斜杠 换行 SOH——跨内核互通）
func esc(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		switch c := s[i]; c {
		case '"':
			out = append(out, '\\', '"')
		case '\\':
			out = append(out, '\\', '\\')
		case '\n':
			out = append(out, '\\', 'n')
		case 1:
			out = append(out, '\\', 'u', '0', '0', '0', '1')
		default:
			out = append(out, c)
		}
	}
	return string(out)
}

func monoNs() int64 {
	return time.Now().UnixNano() // 进程内相对（测试只看差值）
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

// ── agent 注册表 + 邮箱（与仓颉 v3/Haskell 同形） ──────────────────────────────

type Agent struct {
	Name  string
	State string // "idle"
	box   []string
	// Reasonix 对齐（internal/session + workspacestate/lifecycle.go 模式）：
	Lifecycle  string // active|archived|deleted（生命周期三态枚举）
	Generation uint64 // 乐观并发：每次状态变更 +1，set 须携带 expected（CAS）
}

type registry struct {
	mu     sync.Mutex
	agents map[int]*Agent
	order  []int
	next   int
}

var reg = &registry{agents: map[int]*Agent{}}

// ── 作业面（goroutine——宿主零驱动；四态与坑 105 纪律同前） ────────────────────

type Job struct {
	mu    sync.Mutex
	state int // 0=pending 2=claimed 1=done 3=cancelled
	kind  string
	n     int
	text  string
	value int64
	out   string
	start int64
	end   int64
}

type jobTable struct {
	mu     sync.Mutex
	jobs   map[int]*Job
	next   int
	doneOr []int
}

var jobs = &jobTable{jobs: map[int]*Job{}}

func stateOf(j *Job) int {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.state
}

// ── dispatch ────────────────────────────────────────────────────────────────────

func dispatch(m string, p string) (string, bool) {
	if m == "echo" {
		return p, true // 原样直通
	}
	var in map[string]any
	if err := json.Unmarshal([]byte(p), &in); err != nil {
		in = map[string]any{} // 损坏按各方法语义报错（缺字段）
	}
	num := func(k string) (int64, bool) {
		if v, ok := in[k].(float64); ok {
			return int64(v), true
		}
		return 0, false
	}
	str := func(k string) (string, bool) {
		if v, ok := in[k].(string); ok {
			return v, true
		}
		return "", false
	}

	switch m {
	case "add":
		a, ok1 := num("a")
		b, ok2 := num("b")
		if !ok1 || !ok2 {
			return setErr("add: params need integer fields a and b")
		}
		return `{"sum":` + itoa(a+b) + `}`, true
	case "fib":
		n, ok := num("n")
		if !ok {
			return setErr("fib: params need integer field n")
		}
		if n < 0 || n > 40 {
			return setErr("fib: n out of range [0,40], got " + itoa(n))
		}
		return `{"result":` + itoa(fibN(int(n))) + `}`, true
	case "error":
		return setErr("error: forced failure for testing")
	case "agent.spawn":
		name, has := str("name")
		reg.mu.Lock()
		reg.next++
		id := reg.next
		if !has || name == "" {
			name = "agent-" + itoa(int64(id))
		}
		reg.agents[id] = &Agent{Name: name, State: "idle", Lifecycle: "active", Generation: 0}
		reg.order = append(reg.order, id)
		reg.mu.Unlock()
		return `{"id":` + itoa(int64(id)) + `,"name":"` + esc(name) + `","state":"idle"}`, true
	case "agent.list":
		reg.mu.Lock()
		out := `{"count":` + itoa(int64(len(reg.order))) + `,"agents":[`
		for i, id := range reg.order {
			if i > 0 {
				out += ","
			}
			a := reg.agents[id]
			out += `{"id":` + itoa(int64(id)) + `,"name":"` + esc(a.Name) + `","state":"idle"}`
		}
		out += `]}`
		reg.mu.Unlock()
		return out, true
	case "agent.send":
		id, ok1 := num("id")
		text, ok2 := str("text")
		if !ok1 || !ok2 {
			return setErr("agent.send: params need integer id and string text")
		}
		reg.mu.Lock()
		a, ex := reg.agents[int(id)]
		reg.mu.Unlock()
		if !ex {
			return setErr("agent.send: no agent id=" + itoa(id))
		}
		a.box = append(a.box, text) // 宿主 IPC 串行进入 → 单 agent 无并发切片
		return `{"queued":` + itoa(int64(len(a.box))) + `}`, true
	case "agent.poll":
		id, ok := num("id")
		if !ok {
			return setErr("agent.poll: params need integer id")
		}
		reg.mu.Lock()
		a, ex := reg.agents[int(id)]
		reg.mu.Unlock()
		if !ex {
			return setErr("agent.poll: no agent id=" + itoa(id))
		}
		box := a.box
		a.box = nil
		out := `{"messages":[`
		for i, v := range box {
			if i > 0 {
				out += ","
			}
			out += `"` + esc(v) + `"`
		}
		out += `],"drained":` + itoa(int64(len(box))) + `}`
		return out, true
	case "agent.kill":
		id, ok := num("id")
		if !ok {
			return setErr("agent.kill: params need integer id")
		}
		reg.mu.Lock()
		a, ex := reg.agents[int(id)]
		if ex {
			delete(reg.agents, int(id))
			for i, x := range reg.order {
				if x == int(id) {
					reg.order = append(reg.order[:i], reg.order[i+1:]...)
					break
				}
			}
		}
		reg.mu.Unlock()
		if !ex {
			return setErr("agent.kill: no agent id=" + itoa(id))
		}
		return `{"killed":"` + esc(a.Name) + `"}`, true
	case "agent.submit":
		aid, ok1 := num("id")
		kind, ok2 := str("kind")
		if !ok1 || !ok2 {
			return setErr("agent.submit: params need integer id and string kind")
		}
		if kind != "fib" && kind != "echo" {
			return setErr("agent.submit: kind must be fib or echo, got " + kind)
		}
		n, _ := num("n")
		text, _ := str("text")
		if kind == "fib" && (n < 0 || n > 40) {
			return setErr("agent.submit: n out of range [0,40], got " + itoa(n))
		}
		reg.mu.Lock()
		_, ex := reg.agents[int(aid)]
		reg.mu.Unlock()
		if !ex {
			return setErr("agent.submit: no agent id=" + itoa(aid))
		}
		j := &Job{kind: kind, n: int(n), text: text}
		jobs.mu.Lock()
		jobs.next++
		jid := jobs.next
		jobs.jobs[jid] = j
		jobs.mu.Unlock()
		go func() { // 协作取消：领取检查 state==0→2（mutex——int 位宽安全）
			j.mu.Lock()
			if j.state != 0 {
				j.mu.Unlock()
				return // 已 cancelled——作废
			}
			j.state = 2
			j.mu.Unlock()
			j.start = monoNs()
			if j.kind == "fib" {
				j.value = fibN(j.n)
			} else {
				j.out = j.text
			}
			j.end = monoNs()
			j.mu.Lock()
			j.state = 1
			j.mu.Unlock()
			jobs.mu.Lock()
			jobs.doneOr = append(jobs.doneOr, jid)
			jobs.mu.Unlock()
		}()
		return `{"jobId":` + itoa(int64(jid)) + `,"state":"pending"}`, true
	case "agent.result":
		jid, ok := num("jobId")
		if !ok {
			return setErr("agent.result: params need integer jobId")
		}
		jobs.mu.Lock()
		j, ex := jobs.jobs[int(jid)]
		jobs.mu.Unlock()
		if !ex {
			return setErr("agent.result: no job id=" + itoa(jid))
		}
		switch stateOf(j) {
		case 1:
			if j.kind == "fib" {
				return `{"state":"done","value":` + itoa(j.value) + `}`, true
			}
			return `{"state":"done","text":"` + esc(j.out) + `"}`, true
		case 3:
			return `{"state":"cancelled"}`, true
		default:
			return `{"state":"pending"}`, true
		}
	case "agent.cancel":
		jid, ok := num("jobId")
		if !ok {
			return setErr("agent.cancel: params need integer jobId")
		}
		jobs.mu.Lock()
		j, ex := jobs.jobs[int(jid)]
		jobs.mu.Unlock()
		if !ex {
			return setErr("agent.cancel: no job id=" + itoa(jid))
		}
		j.mu.Lock()
		if j.state == 0 {
			j.state = 3
			j.mu.Unlock()
			return `{"cancelled":"pending"}`, true
		}
		st := j.state
		j.mu.Unlock()
		switch st {
		case 3:
			return `{"cancelled":"pending"}`, true
		case 1:
			return `{"cancelled":"none","state":"done"}`, true
		default:
			return `{"cancelled":"none","state":"in-flight"}`, true
		}
	case "session.get": // Reasonix：注册表条目查询（lifecycle + generation）
		id, ok := num("id")
		if !ok {
			return setErr("session.get: params need integer id")
		}
		reg.mu.Lock()
		a, ex := reg.agents[int(id)]
		reg.mu.Unlock()
		if !ex {
			return setErr("session.get: no agent id=" + itoa(id))
		}
		return `{"lifecycle":"` + a.Lifecycle + `","generation":` + itoa(int64(a.Generation)) + `}`, true
	case "session.set": // Reasonix：Generation CAS 状态变更（lifecycle.go:100 模式）
		id, ok1 := num("id")
		lc, ok2 := str("lifecycle")
		gen, hasGen := num("generation")
		if !ok1 || !ok2 || !hasGen {
			return setErr("session.set: params need integer id, string lifecycle and integer generation")
		}
		if lc != "active" && lc != "archived" && lc != "deleted" {
			return setErr("session.set: bad lifecycle " + lc + " (want active|archived|deleted)")
		}
		reg.mu.Lock()
		a, ex := reg.agents[int(id)]
		if !ex {
			reg.mu.Unlock()
			return setErr("session.set: no agent id=" + itoa(id))
		}
		if a.Lifecycle == "deleted" {
			reg.mu.Unlock()
			return setErr("session.set: deleted is terminal")
		}
		if int64(a.Generation) != gen {
			have, want := a.Generation, gen
			reg.mu.Unlock()
			return setErr("session.set: generation conflict (have " + itoa(int64(have)) +
				", expected " + itoa(want) + ")")
		}
		a.Lifecycle = lc
		a.Generation++
		newGen := a.Generation
		reg.mu.Unlock()
		return `{"lifecycle":"` + lc + `","generation":` + itoa(int64(newGen)) + `}`, true
	case "agent.timings":
		jobs.mu.Lock()
		out := `{"n":` + itoa(int64(len(jobs.doneOr))) + `,"t":[`
		for i, jid := range jobs.doneOr {
			if i > 0 {
				out += ","
			}
			j := jobs.jobs[jid]
			out += "[" + itoa(j.start) + "," + itoa(j.end) + "]"
		}
		out += `]}`
		jobs.mu.Unlock()
		return out, true
	}
	return setErr("unknown method: " + m)
}

// ── C ABI 六核心 + typed + 版本 ─────────────────────────────────────────────────

// reset_state：内核内部重置——【纪律】导出名不自引用（坑 108：RTLD_GLOBAL 下
// 单语言内核的自引用可能经动态绑定跳进别的内核；Go 当前编译器是模块内直接
// 绑定安全，但不依赖跨编译器行为——与 C 的 static do_init 同纪律）
func reset_state() {
	reg.mu.Lock()
	reg.agents = map[int]*Agent{}
	reg.order = nil
	reg.next = 0
	reg.mu.Unlock()
	jobs.mu.Lock()
	jobs.jobs = map[int]*Job{}
	jobs.next = 0
	jobs.doneOr = nil
	jobs.mu.Unlock()
	lastErr.Store("")
}

//export kernel_init
func kernel_init(config *C.char) C.int {
	reset_state()
	return 0
}

//export kernel_shutdown
func kernel_shutdown() C.int {
	reset_state()
	return 0
}

//export kernel_ping
func kernel_ping() C.int { return 0 }

//export kernel_call
func kernel_call(method, params *C.char) *C.char {
	out, ok := dispatch(C.GoString(method), C.GoString(params))
	if !ok {
		return nil
	}
	return C.CString(out) // C.CString=libc malloc → 宿主 kernel_free（契约）
}

//export kernel_free
func kernel_free(ptr unsafe.Pointer) {
	if ptr != nil {
		C.free(ptr)
	}
}

//export kernel_last_error
func kernel_last_error() *C.char { return C.CString(getErr()) }

//export kernel_abi_version
func kernel_abi_version() C.int {
	return 10001 // 六核心 + typed（无调度符号——goroutine 自调度）
}

//export kernel_add
func kernel_add(a, b C.longlong) C.longlong { return a + b }

//export kernel_echo
func kernel_echo(input *C.char) *C.char { return C.CString(C.GoString(input)) }

func main() {}
