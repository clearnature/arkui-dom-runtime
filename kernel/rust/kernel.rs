// =====================================================================================
// kernel/rust/kernel.rs — Rust 内核：kernel_abi.h 契约（R117，第五语言）
//
// 数据面对齐 /data/training/cli/claurst（Explore 报告确定后的方法分支见文内标注）。
// 方法面 = 与仓颉/纯C/Haskell/Go 同构的可测子集（echo/add/fib/error + agent 五件 +
// 作业面），形状与 kernel_abi.h 一致 → 同一份 C 契约测试可跑（第五语言实证）。
//
// 与前四语言的形态差异：
//   · rustc --crate-type=cdylib：Rust 运行时静态链进 .so（依赖仅 libgcc_s+libc）
//     → 与 Go 同级的干净分发；dlopen 直调（无仓颉 InitCJRuntime/GHC hs_init）
//   · 零外部 crate（仓库零依赖纪律）：JSON 手写（仓颉/Haskell 同风格）
//   · 严格求值（无 Haskell 惰性 thunk 坑——R115 对照）
//   · std::thread 作业（宿主零驱动，同 Go goroutine 模式）
//
// 锁设计（死锁安全证明）：全局单锁 G（registry+jobs 合一，串行 IPC 下固定获取）
// + 每 Job 一把 state 锁。锁序恒为 G → job.state；worker 线程持 job.state 期间
// 【绝不获取 G】（写状态在 G 之前、done_or 推送在 state 解锁之后）→ 无环。
//
// 构建：bash kernel/rust/build.sh（= rustc --crate-type=cdylib -O）
// =====================================================================================
use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::os::raw::{c_int, c_longlong, c_void};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ── 错误缓冲 ────────────────────────────────────────────────────────────────────

static LAST_ERR: Mutex<String> = Mutex::new(String::new());

fn set_err(msg: &str) -> (String, bool) {
    *LAST_ERR.lock().unwrap() = msg.to_string();
    (String::new(), false)
}

fn get_err() -> String {
    LAST_ERR.lock().unwrap().clone()
}

// ── 可测子集 ────────────────────────────────────────────────────────────────────

fn fib_n(n: i64) -> i64 {
    if n <= 1 {
        return n;
    }
    fib_n(n - 1) + fib_n(n - 2)
}

/// 输出转义（与仓颉/Haskell/Go 同集——跨内核互通：引号 反斜杠 换行 SOH）
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\u{1}' => out.push_str("\\u0001"),
            _ => out.push(c),
        }
    }
    out
}

fn mono_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as i64
}

// ── JSON 轻量解析（滑动搜索，仓颉同边界） ──────────────────────────────────────

fn json_int(src: &str, key: &str) -> Option<i64> {
    let pat = format!("\"{}\":", key);
    let b = src.as_bytes();
    let p = pat.as_bytes();
    let mut i = 0usize;
    while i + p.len() <= b.len() {
        if &b[i..i + p.len()] == p {
            let mut k = i + p.len();
            let neg = k < b.len() && b[k] == b'-';
            if neg {
                k += 1;
            }
            let start = k;
            while k < b.len() && b[k].is_ascii_digit() {
                k += 1;
            }
            if k == start {
                return None;
            }
            let v: i64 = src[start..k].parse().ok()?;
            return Some(if neg { -v } else { v });
        }
        i += 1;
    }
    None
}

fn json_str(src: &str, key: &str) -> Option<String> {
    let pat = format!("\"{}\":\"", key);
    let b = src.as_bytes();
    let p = pat.as_bytes();
    let mut i = 0usize;
    while i + p.len() <= b.len() {
        if &b[i..i + p.len()] == p {
            let mut k = i + p.len();
            let mut out: Vec<u8> = Vec::new();
            while k < b.len() {
                match b[k] {
                    b'"' => return Some(String::from_utf8_lossy(&out).into_owned()),
                    b'\\' if k + 1 < b.len() => {
                        k += 1;
                        match b[k] {
                            b'"' => out.push(b'"'),
                            b'\\' => out.push(b'\\'),
                            b'n' => out.push(b'\n'),
                            _ => out.push(b[k]),
                        }
                    }
                    c => out.push(c),
                }
                k += 1;
            }
            return None;
        }
        i += 1;
    }
    None
}

// ── 全局状态（单锁——锁序见头注） ──────────────────────────────────────────────

struct Agent {
    name: String,
    // claurst AgentDefinition 对齐（crates/core/src/lib.rs:753-773 的精简二字段：
    // 完整还有 description/prompt/access/visible/color——元数据面按需增补）
    model: String,
    max_turns: i64,
    // claurst 状态守卫语义（update_status 终态不回流 / TaskStop 守卫）——
    // lifecycle 三态 + Generation CAS（与 Go 段同构的乐观并发模式）
    lifecycle: String, // active|archived|deleted
    generation: u64,
    r#box: Vec<String>,
}

struct JobData {
    value: i64,
    out: String,
    start: i64,
    end: i64,
}

struct Job {
    state: Mutex<i32>, // 0=pending 2=claimed 1=done 3=cancelled
    kind: &'static str,
    n: i64,
    text: String,
    data: Mutex<JobData>, // 值发布通道：worker 算完锁它写（与 G 无嵌套）
}

struct State {
    agents: HashMap<i64, Agent>,
    order: Vec<i64>,
    next_agent: i64,
    jobs: HashMap<i64, Arc<Job>>,
    next_job: i64,
    done_or: Vec<i64>,
}

impl State {
    fn new() -> Self {
        State {
            agents: HashMap::new(),
            order: Vec::new(),
            next_agent: 0,
            jobs: HashMap::new(),
            next_job: 0,
            done_or: Vec::new(),
        }
    }
}

fn global() -> &'static Mutex<State> {
    static G: OnceLock<Mutex<State>> = OnceLock::new();
    G.get_or_init(|| Mutex::new(State::new()))
}

// ── dispatch（全部在单锁内——worker 的锁序不相交，见头注） ──────────────────────

fn dispatch(m: &str, p: &str) -> (String, bool) {
    if m == "echo" {
        return (p.to_string(), true);
    }
    let mut g = global().lock().unwrap();

    match m {
        "add" => {
            let (Some(a), Some(b)) = (json_int(p, "a"), json_int(p, "b")) else {
                return set_err("add: params need integer fields a and b");
            };
            (format!("{{\"sum\":{}}}", a + b), true)
        }
        "fib" => {
            let Some(n) = json_int(p, "n") else {
                return set_err("fib: params need integer field n");
            };
            if !(0..=40).contains(&n) {
                return set_err(&format!("fib: n out of range [0,40], got {}", n));
            }
            (format!("{{\"result\":{}}}", fib_n(n)), true)
        }
        "error" => set_err("error: forced failure for testing"),
        "agent.spawn" => {
            let name = json_str(p, "name").unwrap_or_default();
            let model = json_str(p, "model").unwrap_or_else(|| "default".into());
            let max_turns = json_int(p, "maxTurns").unwrap_or(0);
            g.next_agent += 1;
            let id = g.next_agent;
            let nm = if name.is_empty() {
                format!("agent-{}", id)
            } else {
                name
            };
            g.agents.insert(
                id,
                Agent {
                    name: nm.clone(),
                    model: model.clone(),
                    max_turns,
                    lifecycle: "active".into(),
                    generation: 0,
                    r#box: Vec::new(),
                },
            );
            g.order.push(id);
            (
                // spawn 返回形与其余四内核同形（契约互通）；元数据走 agent.info 查询
                format!("{{\"id\":{},\"name\":\"{}\",\"state\":\"idle\"}}", id, esc(&nm)),
                true,
            )
        }
        "agent.list" => {
            let mut out = format!("{{\"count\":{},\"agents\":[", g.order.len());
            for (i, id) in g.order.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if let Some(a) = g.agents.get(id) {
                    out.push_str(&format!(
                        "{{\"id\":{},\"name\":\"{}\",\"state\":\"idle\"}}",
                        id,
                        esc(&a.name)
                    ));
                }
            }
            out.push_str("]}");
            (out, true)
        }
        "agent.send" => {
            let (Some(id), Some(text)) = (json_int(p, "id"), json_str(p, "text")) else {
                return set_err("agent.send: params need integer id and string text");
            };
            let Some(a) = g.agents.get_mut(&id) else {
                return set_err(&format!("agent.send: no agent id={}", id));
            };
            a.r#box.push(text);
            let n = a.r#box.len();
            (format!("{{\"queued\":{}}}", n), true)
        }
        "agent.poll" => {
            let Some(id) = json_int(p, "id") else {
                return set_err("agent.poll: params need integer id");
            };
            let Some(a) = g.agents.get_mut(&id) else {
                return set_err(&format!("agent.poll: no agent id={}", id));
            };
            let msgs = std::mem::take(&mut a.r#box);
            let mut out = String::from("{\"messages\":[");
            for (i, v) in msgs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push('"');
                out.push_str(&esc(v));
                out.push('"');
            }
            out.push_str(&format!("],\"drained\":{}}}", msgs.len()));
            (out, true)
        }
        "agent.kill" => {
            let Some(id) = json_int(p, "id") else {
                return set_err("agent.kill: params need integer id");
            };
            let Some(a) = g.agents.remove(&id) else {
                return set_err(&format!("agent.kill: no agent id={}", id));
            };
            g.order.retain(|x| *x != id);
            (format!("{{\"killed\":\"{}\"}}", esc(&a.name)), true)
        }
        "agent.submit" => {
            let (Some(aid), Some(kind)) = (json_int(p, "id"), json_str(p, "kind")) else {
                return set_err("agent.submit: params need integer id and string kind");
            };
            if kind != "fib" && kind != "echo" {
                return set_err(&format!(
                    "agent.submit: kind must be fib or echo, got {}",
                    kind
                ));
            }
            let n = json_int(p, "n").unwrap_or(0);
            let text = json_str(p, "text").unwrap_or_default();
            if kind == "fib" && !(0..=40).contains(&n) {
                return set_err(&format!("agent.submit: n out of range [0,40], got {}", n));
            }
            if !g.agents.contains_key(&aid) {
                return set_err(&format!("agent.submit: no agent id={}", aid));
            }
            let kind_owned: &'static str = if kind == "fib" { "fib" } else { "echo" };
            let job = Arc::new(Job {
                state: Mutex::new(0),
                kind: kind_owned,
                n,
                text: text.clone(),
                data: Mutex::new(JobData {
                    value: 0,
                    out: String::new(),
                    start: 0,
                    end: 0,
                }),
            });
            g.next_job += 1;
            let jid = g.next_job;
            g.jobs.insert(jid, job.clone());
            // worker：持 state 期间不取 G（锁序证明见头注）；完成后回 G 发布
            std::thread::spawn(move || {
                {
                    let mut st = job.state.lock().unwrap();
                    if *st != 0 {
                        return; // 已 cancelled——作废
                    }
                    *st = 2;
                }
                let s = mono_ns();
                let (val, o) = if job.kind == "fib" {
                    (fib_n(job.n), String::new())
                } else {
                    (0, job.text.clone())
                };
                let e = mono_ns();
                {
                    let mut d = job.data.lock().unwrap(); // 值发布锁 data（与 G 无嵌套）
                    d.value = val;
                    d.out = o;
                    d.start = s;
                    d.end = e;
                }
                *job.state.lock().unwrap() = 1; // state=1 在数据发布【之后】
                global().lock().unwrap().done_or.push(jid);
            });
            (format!("{{\"jobId\":{},\"state\":\"pending\"}}", jid), true)
        }
        "agent.result" => {
            let Some(jid) = json_int(p, "jobId") else {
                return set_err("agent.result: params need integer jobId");
            };
            let Some(job) = g.jobs.get(&jid).cloned() else {
                return set_err(&format!("agent.result: no job id={}", jid));
            };
            let st = *job.state.lock().unwrap();
            match st {
                1 => {
                    let d = job.data.lock().unwrap(); // worker 序：state=1 在 data 发布后
                    if job.kind == "fib" {
                        (
                            format!("{{\"state\":\"done\",\"value\":{}}}", d.value),
                            true,
                        )
                    } else {
                        (
                            format!("{{\"state\":\"done\",\"text\":\"{}\"}}", esc(&d.out)),
                            true,
                        )
                    }
                }
                3 => ("{\"state\":\"cancelled\"}".into(), true),
                _ => ("{\"state\":\"pending\"}".into(), true),
            }
        }
        "agent.cancel" => {
            let Some(jid) = json_int(p, "jobId") else {
                return set_err("agent.cancel: params need integer jobId");
            };
            let Some(job) = g.jobs.get(&jid).cloned() else {
                return set_err(&format!("agent.cancel: no job id={}", jid));
            };
            let won = {
                let mut st = job.state.lock().unwrap();
                if *st == 0 {
                    *st = 3;
                    true
                } else {
                    false
                }
            };
            if won {
                return ("{\"cancelled\":\"pending\"}".into(), true);
            }
            let st2 = *job.state.lock().unwrap();
            match st2 {
                3 => ("{\"cancelled\":\"pending\"}".into(), true),
                1 => ("{\"cancelled\":\"none\",\"state\":\"done\"}".into(), true),
                _ => ("{\"cancelled\":\"none\",\"state\":\"in-flight\"}".into(), true),
            }
        }
        "agent.timings" => {
            let mut out = format!("{{\"n\":{},\"t\":[", g.done_or.len());
            for (i, jid) in g.done_or.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if let Some(job) = g.jobs.get(jid) {
                    let d = job.data.lock().unwrap();
                    out.push_str(&format!("[{},{}]", d.start, d.end));
                }
            }
            out.push_str("]}");
            (out, true)
        }
        "agent.info" => {
            // claurst AgentDefinition 元数据 + lifecycle/generation（消费既有字段）
            let Some(id) = json_int(p, "id") else {
                return set_err("agent.info: params need integer id");
            };
            let Some(a) = g.agents.get(&id) else {
                return set_err(&format!("agent.info: no agent id={}", id));
            };
            (
                format!(
                    "{{\"id\":{},\"name\":\"{}\",\"model\":\"{}\",\"maxTurns\":{},\"lifecycle\":\"{}\",\"generation\":{}}}",
                    id,
                    esc(&a.name),
                    esc(&a.model),
                    a.max_turns,
                    a.lifecycle,
                    a.generation
                ),
                true,
            )
        }
        "session.get" => {
            let Some(id) = json_int(p, "id") else {
                return set_err("session.get: params need integer id");
            };
            let Some(a) = g.agents.get(&id) else {
                return set_err(&format!("session.get: no agent id={}", id));
            };
            (
                format!(
                    "{{\"lifecycle\":\"{}\",\"generation\":{}}}",
                    a.lifecycle, a.generation
                ),
                true,
            )
        }
        "session.set" => {
            // Generation CAS（claurst TaskRegistry::update_status 终态不回流同义）
            let (Some(id), Some(lc), Some(gen)) = (
                json_int(p, "id"),
                json_str(p, "lifecycle"),
                json_int(p, "generation"),
            ) else {
                return set_err(
                    "session.set: params need integer id, string lifecycle and integer generation",
                );
            };
            if lc != "active" && lc != "archived" && lc != "deleted" {
                return set_err(&format!("session.set: bad lifecycle {} (want active|archived|deleted)", lc));
            }
            let Some(a) = g.agents.get_mut(&id) else {
                return set_err(&format!("session.set: no agent id={}", id));
            };
            if a.lifecycle == "deleted" {
                return set_err("session.set: deleted is terminal"); // 终态不回流
            }
            if a.generation != gen as u64 {
                return set_err(&format!(
                    "session.set: generation conflict (have {}, expected {})",
                    a.generation, gen
                ));
            }
            a.lifecycle = lc.clone();
            a.generation += 1;
            (format!("{{\"lifecycle\":\"{}\",\"generation\":{}}}", lc, a.generation), true)
        }
        _ => set_err(&format!("unknown method: {}", m)),
    }
}

// ── C ABI 六核心 + typed + 版本 ─────────────────────────────────────────────────

fn reset_state() {
    let mut g = global().lock().unwrap();
    *g = State::new();
    *LAST_ERR.lock().unwrap() = String::new();
}

#[no_mangle]
pub extern "C" fn kernel_init(_config: *const c_char) -> c_int {
    reset_state();
    0
}

#[no_mangle]
pub extern "C" fn kernel_shutdown() -> c_int {
    reset_state();
    0
}

#[no_mangle]
pub extern "C" fn kernel_ping() -> c_int {
    0
}

#[no_mangle]
pub extern "C" fn kernel_call(method: *const c_char, params: *const c_char) -> *mut c_char {
    let m = unsafe { CStr::from_ptr(method) }.to_string_lossy().into_owned();
    let p = unsafe { CStr::from_ptr(params) }.to_string_lossy().into_owned();
    let (out, ok) = dispatch(&m, &p);
    if !ok {
        return std::ptr::null_mut();
    }
    CString::new(out).unwrap().into_raw() // libc malloc → 宿主 kernel_free（契约）
}

#[no_mangle]
pub extern "C" fn kernel_free(ptr: *mut c_void) {
    if !ptr.is_null() {
        unsafe {
            drop(CString::from_raw(ptr as *mut c_char));
        }
    }
}

#[no_mangle]
pub extern "C" fn kernel_last_error() -> *mut c_char {
    CString::new(get_err()).unwrap().into_raw()
}

#[no_mangle]
pub extern "C" fn kernel_abi_version() -> c_int {
    10001 // 六核心 + typed（无调度符号——std::thread 自调度）
}

#[no_mangle]
pub extern "C" fn kernel_add(a: c_longlong, b: c_longlong) -> c_longlong {
    a + b
}

#[no_mangle]
pub extern "C" fn kernel_echo(input: *const c_char) -> *mut c_char {
    let s = unsafe { CStr::from_ptr(input) }.to_string_lossy().into_owned();
    CString::new(s).unwrap().into_raw()
}
