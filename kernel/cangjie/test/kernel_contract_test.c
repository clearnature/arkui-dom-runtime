/*
 * R98：C 测试器——完整 c-abi 契约验证（test_kernel.c 的 v2 版）
 * 序列：dlopen 运行时 → InitCJRuntime → dlopen 内核 → dlsym 符号 →
 *       ping/init/call(...)/错误路径/last_error/free/shutdown/ping
 * R104：InitCJRuntime 改用显式 RuntimeParam（logLevel=ERROR，灭启动日志噪声；
 *       heap/gc/co 字段保持 0 = 各字段文档默认）。
 * 编译：gcc kernel_contract_test.c -o kernel_contract_test -ldl -I../../c-abi
 * 运行：LD_LIBRARY_PATH=<SDK>/runtime/lib/linux_x86_64_cjnative ./kernel_contract_test
 */
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "Cangjie.h"

typedef int (*init_rt_fn)(const void *);
typedef int (*i_cstr_fn)(const char *);
typedef int (*v_fn)(void);
typedef char *(*call_fn)(const char *, const char *);
typedef void (*free_fn)(void *);
typedef const char *(*err_fn)(void);

static int fails = 0;
static void check(int cond, const char *m) {
    printf("%s %s\n", cond ? "PASS" : "FAIL", m);
    if (!cond) fails++;
}

int main(int argc, char *argv[]) {
    const char *kernel_path = (argc > 1) ? argv[1] : "../libkernel.so";
    void *rt = dlopen("libcangjie-runtime.so", RTLD_NOW | RTLD_GLOBAL);
    if (!rt) { printf("FAIL dlopen runtime: %s\n", dlerror()); return 1; }
    /* R104：显式 RuntimeParam（logLevel=ERROR）；heap/gc/co 字段 0 = 文档默认 */
    static struct RuntimeParam param;
    memset(&param, 0, sizeof(param));
    param.logParam.logLevel = RTLOG_ERROR;
    int rc = ((init_rt_fn)dlsym(rt, "InitCJRuntime"))(&param);
    check(rc == 0, "InitCJRuntime(RuntimeParam, logLevel=ERROR)");

    void *k = dlopen(kernel_path, RTLD_NOW);
    if (!k) { printf("FAIL dlopen kernel: %s\n", dlerror()); return 1; }
    i_cstr_fn kinit = (i_cstr_fn)dlsym(k, "kernel_init");
    v_fn kshutdown = (v_fn)dlsym(k, "kernel_shutdown");
    v_fn kping = (v_fn)dlsym(k, "kernel_ping");
    call_fn kcall = (call_fn)dlsym(k, "kernel_call");
    free_fn kfree = (free_fn)dlsym(k, "kernel_free");
    err_fn kerr = (err_fn)dlsym(k, "kernel_last_error");
    check(kinit && kshutdown && kping && kcall && kfree && kerr, "dlsym 6 契约符号");

    /* R102：ABI 版本握手（可选符号） */
    {
        int (*abiver)(void) = (int (*)(void))dlsym(k, "kernel_abi_version");
        check(abiver && abiver() == 10001, "kernel_abi_version=10001（v1.1）");
    }

    check(kping() == -1, "未初始化时 ping=-1");
    check(kerr() == NULL || strlen(kerr()) == 0, "初始 last_error 为空");
    check(kinit("{}") == 0, "kernel_init(\\\"{}\\\")=0");
    check(kping() == 0, "初始化后 ping=0");

    /* echo：字符串往返 */
    char *r = kcall("echo", "{\"hello\":\"仓颉\"}");
    check(r && strcmp(r, "{\"hello\":\"仓颉\"}") == 0, "call(echo) JSON 直通往返");
    if (r) kfree(r);

    /* add：JSON 解析 + 计算 */
    r = kcall("add", "{\"a\":20,\"b\":22}");
    check(r && strcmp(r, "{\"sum\":42}") == 0, "call(add 20,22)={\"sum\":42}");
    if (r) kfree(r);
    r = kcall("add", "{\"a\":-7,\"b\":3}");
    check(r && strcmp(r, "{\"sum\":-4}") == 0, "call(add -7,3)={\"sum\":-4}（负数）");
    if (r) kfree(r);

    /* fib：递归真算力 */
    r = kcall("fib", "{\"n\":10}");
    check(r && strcmp(r, "{\"result\":55}") == 0, "call(fib 10)={\"result\":55}");
    if (r) kfree(r);
    r = kcall("fib", "{\"n\":24}");
    check(r && strcmp(r, "{\"result\":46368}") == 0, "call(fib 24)={\"result\":46368}");
    if (r) kfree(r);

    /* upper：字符串处理 */
    r = kcall("upper", "{\"text\":\"cangjie kernel\"}");
    check(r && strcmp(r, "{\"text\":\"CANGJIE KERNEL\"}") == 0, "call(upper) ASCII 大写");
    if (r) kfree(r);

    /* 错误路径：未知方法 → NULL + last_error */
    r = kcall("nope", "{}");
    check(r == NULL, "call(未知方法)=NULL");
    const char *e = kerr();
    check(e && strstr(e, "unknown method") != NULL, "last_error 报 unknown method");
    if (r) kfree(r);

    /* 错误路径：强制失败 */
    r = kcall("error", "{\"x\":1}");
    check(r == NULL, "call(error)=NULL");
    e = kerr();
    check(e && strstr(e, "forced failure") != NULL, "last_error 报 forced failure");

    /* 错误路径：参数缺失 */
    r = kcall("add", "{\"b\":1}");
    check(r == NULL, "call(add 缺 a)=NULL");
    check(strstr(kerr(), "a and b") != NULL, "last_error 提示缺 a/b");

    /* ── agent 调度原语（R99，注册表+邮箱，跨调用持久）── */
    r = kcall("agent.spawn", "{\"name\":\"alice\"}");
    check(r && strcmp(r, "{\"id\":1,\"name\":\"alice\",\"state\":\"idle\"}") == 0,
      "agent.spawn #1 → id=1");
    if (r) kfree(r);
    r = kcall("agent.spawn", "{\"name\":\"bob\"}");
    check(r && strcmp(r, "{\"id\":2,\"name\":\"bob\",\"state\":\"idle\"}") == 0,
      "agent.spawn #2 → id=2（单调）");
    if (r) kfree(r);
    r = kcall("agent.spawn", "{}");
    check(r && strcmp(r, "{\"id\":3,\"name\":\"agent-3\",\"state\":\"idle\"}") == 0,
      "agent.spawn 无名 → 缺省名 agent-3");
    if (r) kfree(r);

    r = kcall("agent.list", "{}");
    check(r && strcmp(r,
      "{\"count\":3,\"agents\":[{\"id\":1,\"name\":\"alice\",\"state\":\"idle\"},"
      "{\"id\":2,\"name\":\"bob\",\"state\":\"idle\"},"
      "{\"id\":3,\"name\":\"agent-3\",\"state\":\"idle\"}]}") == 0,
      "agent.list 按 spawn 序全量（count=3）");
    if (r) kfree(r);

    /* 邮箱：两次入队 → 一次排空 → 再排空为空 */
    r = kcall("agent.send", "{\"id\":1,\"text\":\"任务甲\"}");
    check(r && strcmp(r, "{\"queued\":1}") == 0, "agent.send #1 → queued=1");
    if (r) kfree(r);
    r = kcall("agent.send", "{\"id\":1,\"text\":\"任务乙\"}");
    check(r && strcmp(r, "{\"queued\":2}") == 0, "agent.send #2 → queued=2");
    if (r) kfree(r);
    r = kcall("agent.poll", "{\"id\":1}");
    check(r && strcmp(r, "{\"messages\":[\"任务甲\",\"任务乙\"],\"drained\":2}") == 0,
      "agent.poll 按序排空两条（FIFO+drained=2）");
    if (r) kfree(r);
    r = kcall("agent.poll", "{\"id\":1}");
    check(r && strcmp(r, "{\"messages\":[],\"drained\":0}") == 0,
      "agent.poll 再排空为空（排空语义）");
    if (r) kfree(r);

    /* 邮箱隔离：bob 的邮箱不受 alice 排空影响 */
    r = kcall("agent.send", "{\"id\":2,\"text\":\"bob 的\"}");
    if (r) kfree(r);
    r = kcall("agent.poll", "{\"id\":2}");
    check(r && strcmp(r, "{\"messages\":[\"bob 的\"],\"drained\":1}") == 0,
      "agent 邮箱按 id 隔离");
    if (r) kfree(r);

    /* kill：从注册表摘除，list 同步收敛 */
    r = kcall("agent.kill", "{\"id\":2}");
    check(r && strcmp(r, "{\"killed\":\"bob\"}") == 0, "agent.kill → killed=bob");
    if (r) kfree(r);
    r = kcall("agent.list", "{}");
    check(r && strstr(r, "\"count\":2") && strstr(r, "bob") == NULL,
      "agent.list kill 后 count=2 且无 bob");
    if (r) kfree(r);

    /* 未知 id 三条错误路径 */
    r = kcall("agent.send", "{\"id\":99,\"text\":\"x\"}");
    check(r == NULL && strstr(kerr(), "no agent id=99") != NULL, "agent.send 未知 id → NULL+报因");
    if (r) kfree(r);
    r = kcall("agent.poll", "{\"id\":99}");
    check(r == NULL && strstr(kerr(), "agent.poll") != NULL, "agent.poll 未知 id → NULL");
    if (r) kfree(r);
    r = kcall("agent.kill", "{\"id\":99}");
    check(r == NULL && strstr(kerr(), "agent.kill") != NULL, "agent.kill 未知 id → NULL");
    if (r) kfree(r);

    /* shutdown 后注册表仍活着吗？——重新 init 即全新内核（agent 清零、id 归位） */
    check(kshutdown() == 0, "kernel_shutdown=0");
    check(kinit("{}") == 0, "再次 kernel_init（全新内核）");
    r = kcall("agent.list", "{}");
    check(r && strcmp(r, "{\"count\":0,\"agents\":[]}") == 0,
      "re-init 后 agent 注册表清零（测试隔离语义）");
    if (r) kfree(r);
    r = kcall("agent.spawn", "{\"name\":\"fresh\"}");
    check(r && strcmp(r, "{\"id\":1,\"name\":\"fresh\",\"state\":\"idle\"}") == 0,
      "re-init 后 id 计数器归 1");
    if (r) kfree(r);

    /* ── R100：异步作业（C 宿主自驱动：RunCJTask + RunUIScheduler 泵）── */
    void *(*runTask)(void *(*)(void *), void *) = (void *(*)(void *(*)(void *), void *))dlsym(rt, "RunCJTask");
    int (*pump)(unsigned long long) = (int (*)(unsigned long long))dlsym(rt, "RunUIScheduler");
    void *(*drain)(void *) = (void *(*)(void *))dlsym(k, "kernel_drain_entry");
    int (*pend)(void) = (int (*)(void))dlsym(k, "kernel_pending");
    check(runTask && pump && drain && pend, "dlsym 调度符号（RunCJTask/RunUIScheduler/drain_entry/pending）");
    r = kcall("agent.submit", "{\"id\":1,\"kind\":\"fib\",\"n\":20}");
    check(r && strcmp(r, "{\"jobId\":1,\"state\":\"pending\"}") == 0,
      "submit(fib 20) → jobId=1 pending");
    if (r) kfree(r);
    r = kcall("agent.result", "{\"jobId\":1}");
    check(r && strcmp(r, "{\"state\":\"pending\"}") == 0, "未驱动时 result 仍 pending");
    if (r) kfree(r);
    {
        int done20 = 0;
        for (int i = 0; i < 200 && !done20; i++) {
            if (pend() > 0) runTask(drain, NULL);
            pump(2);
            r = kcall("agent.result", "{\"jobId\":1}");
            if (r && strstr(r, "\"done\"")) done20 = 1;
            if (r) kfree(r);
        }
        check(done20, "C 宿主自驱动 drain → cjthread 算完（pending→done）");
        r = kcall("agent.result", "{\"jobId\":1}");
        check(r && strcmp(r, "{\"state\":\"done\",\"value\":6765}") == 0,
          "fib(20)=6765（drainer cjthread 真算）");
        if (r) kfree(r);
    }
    r = kcall("agent.submit", "{\"id\":1,\"kind\":\"echo\",\"text\":\"异步回声C\"}");
    check(r && strcmp(r, "{\"jobId\":2,\"state\":\"pending\"}") == 0, "submit(echo) → jobId=2 pending");
    if (r) kfree(r);
    {
        int doneEcho = 0;
        for (int i = 0; i < 200 && !doneEcho; i++) {
            if (pend() > 0) runTask(drain, NULL);
            pump(2);
            r = kcall("agent.result", "{\"jobId\":2}");
            if (r && strstr(r, "\"done\"")) doneEcho = 1;
            if (r) kfree(r);
        }
        r = kcall("agent.result", "{\"jobId\":2}");
        check(r && strcmp(r, "{\"state\":\"done\",\"text\":\"异步回声C\"}") == 0,
          "echo 作业结果（UTF-8 保真）");
        if (r) kfree(r);
    }
    r = kcall("agent.submit", "{\"id\":1,\"kind\":\"nope\"}");
    check(r == NULL && strstr(kerr(), "kind must be") != NULL, "submit 未知 kind → NULL+报因");
    if (r) kfree(r);
    r = kcall("agent.submit", "{\"id\":99,\"kind\":\"fib\",\"n\":1}");
    check(r == NULL && strstr(kerr(), "no agent id=99") != NULL, "submit 未知 agent → NULL");
    if (r) kfree(r);

    /* ── R105：多 worker 并行（时间戳重叠证据）── */
    for (int i = 0; i < 4; i++) {
        r = kcall("agent.submit", "{\"id\":1,\"kind\":\"fib\",\"n\":28}");
        check(r != NULL, "并行批 submit");
        if (r) kfree(r);
    }
    {
        /* 手动拉起 2 支 worker + 泵至全 done */
        for (int i = 0; i < 2; i++) runTask(drain, NULL);
        int allDone = 0, guard = 0;
        while (!allDone && guard < 2000) {
            allDone = 1; guard++;
            for (int j = 3; j <= 6; j++) {
                char q[64];
                snprintf(q, sizeof(q), "{\"jobId\":%d}", j);
                r = kcall("agent.result", q);
                if (!r || !strstr(r, "\"done\"")) allDone = 0;
                if (r) kfree(r);
            }
            pump(2);
        }
        check(allDone, "2 worker 并行清空 4×fib(28)");
        /* 值正确性 */
        int valsOk = 1;
        for (int j = 3; j <= 6 && valsOk; j++) {
            char q[64];
            snprintf(q, sizeof(q), "{\"jobId\":%d}", j);
            r = kcall("agent.result", q);
            if (!r || !strstr(r, "317811")) valsOk = 0;
            if (r) kfree(r);
        }
        check(valsOk, "并行批 4 值全部 = 317811");
        /* 时间戳重叠：取 agent.timings 的全部整数，两两判重叠 */
        r = kcall("agent.timings", "{}");
        check(r != NULL, "agent.timings 可读");
        if (r) {
            long long v[64] = {0};
            int n = 0;
            const char *p = r;
            while (*p && n < 64) {
                if (*p >= '0' && *p <= '9') {
                    long long x = 0;
                    while (*p >= '0' && *p <= '9') { x = x * 10 + (*p - '0'); p++; }
                    v[n++] = x;
                } else p++;
            }
            /* v = [n?, s0,e0, s1,e1, ...]：首个数字是 "n":4（kv 对），其余为两两窗口 */
            int pairs = (n - 1) / 2;
            int overlaps = 0;
            for (int a = 0; a < pairs; a++)
                for (int b = a + 1; b < pairs; b++) {
                    long long s1 = v[1 + a * 2], e1 = v[2 + a * 2];
                    long long s2 = v[1 + b * 2], e2 = v[2 + b * 2];
                    if (s1 < e2 && s2 < e1) overlaps++;
                }
            check(overlaps > 0, "时间戳重叠 >0 对（真并发，非协作串行）");
        }
        if (r) kfree(r);
    }

    /* ── R106：状态快照/恢复（真重启路径：shutdown→init→restore）── */
    r = kcall("agent.spawn", "{\"name\":\"bob\"}");
    if (r) kfree(r);
    r = kcall("agent.send", "{\"id\":1,\"text\":\"快照甲\"}");
    if (r) kfree(r);
    r = kcall("agent.send", "{\"id\":1,\"text\":\"快照乙\"}");
    if (r) kfree(r);
    r = kcall("sys.snapshot", "{}");
    check(r != NULL && strstr(r, "\"v\":1") != NULL, "sys.snapshot 可快照（v1）");
    char *snap = r ? strdup(r) : NULL;      /* 宿主持久化快照的等价动作 */
    if (r) kfree(r);
    check(snap != NULL, "快照已留存宿主侧");
    /* 破坏现场：杀 1、另立新 agent */
    r = kcall("agent.kill", "{\"id\":1}");
    if (r) kfree(r);
    r = kcall("agent.spawn", "{\"name\":\"carol\"}");
    if (r) kfree(r);
    /* 真重启：shutdown → init → restore */
    check(kshutdown() == 0 && kinit("{}") == 0, "R106 shutdown+init（模拟进程重启）");
    /* 重启后 re-init 使 agent 清零，重新构造快照前状态：先 spawn fresh/bob 不可行——
     * restore 本身整体替换状态，直接恢复快照 */
    r = kcall("sys.restore", snap);
    check(r && strcmp(r, "{\"restored\":2}") == 0, "sys.restore → restored=2");
    if (r) kfree(r);
    r = kcall("agent.list", "{}");
    check(r && strstr(r, "\"count\":2") && strstr(r, "fresh") != NULL &&
      strstr(r, "bob") != NULL && strstr(r, "carol") == NULL,
      "restore 后注册表等价（fresh+bob，无 carol）");
    if (r) kfree(r);
    r = kcall("agent.poll", "{\"id\":1}");
    check(r && strcmp(r, "{\"messages\":[\"快照甲\",\"快照乙\"],\"drained\":2}") == 0,
      "restore 后邮箱 FIFO 保序（UTF-8）");
    if (r) kfree(r);
    r = kcall("agent.spawn", "{}");
    check(r && strcmp(r, "{\"id\":3,\"name\":\"agent-3\",\"state\":\"idle\"}") == 0,
      "restore 后 id 续号（nextId 随快照恢复）");
    if (r) kfree(r);
    /* 作业不快照（文档化边界）：restore 后 submit 从 jobId=1 重新计 */
    r = kcall("agent.submit", "{\"id\":1,\"kind\":\"fib\",\"n\":5}");
    check(r && strcmp(r, "{\"jobId\":1,\"state\":\"pending\"}") == 0,
      "restore 后作业计数器归位（作业不快照）");
    if (r) kfree(r);
    /* 清掉这支作业驱动到 done，避免影响后续 shutdown 断言语义 */
    {
        for (int i = 0; i < 2 && pend() > 0; i++) { runTask(drain, NULL); pump(2); }
    }
    r = kcall("sys.restore", "{\"v\":9}");
    check(r == NULL && strstr(kerr(), "bad snapshot") != NULL, "坏版本快照 → NULL+报因");
    if (r) kfree(r);
    free(snap);

    /* shutdown 后 ping 失败、call 拒绝 */
    check(kshutdown() == 0, "kernel_shutdown=0");
    check(kping() == -1, "shutdown 后 ping=-1");
    r = kcall("echo", "x");
    check(r == NULL, "shutdown 后 call=NULL");
    check(strstr(kerr(), "not initialized") != NULL, "last_error 报 not initialized");

    if (fails == 0) printf("ALL PASS\n");
    else printf("%d FAILURES\n", fails);
    return fails == 0 ? 0 : 1;
}
