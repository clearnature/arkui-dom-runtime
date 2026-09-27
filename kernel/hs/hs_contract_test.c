/*
 * R114：Haskell 内核（trha 数据面）端到端测试
 * 序列：RTS LAZY → ghc-internal NOW → hs_init → dlopen 内核 → kernel_init →
 *       数据面（spawn/send/poll/kill）+ trha 状态机（五分支/自环/非法态）
 * 编译：gcc hs_contract_test.c -o hs_contract_test -ldl
 * 运行：./hs_contract_test <GHC-libdir> <libkernel_hs.so>
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>

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

static call_fn Kcall = NULL;
static free_fn Kfree = NULL;

/* 调用并校验返回串（Kcall 判空防御——dlsym 失败不该走到这里，但显式兜底） */
static void expect_call(const char *method, const char *params, const char *want, const char *m) {
    char buf[512];
    if (!Kcall) { snprintf(buf, sizeof(buf), "%s → 跳过（Kcall 未就绪）", m); check(0, buf); return; }
    char *r = Kcall(method, params);
    snprintf(buf, sizeof(buf), "%s → %s（期望 %s）", m, r ? r : "(null)", want);
    check(r && strcmp(r, want) == 0, buf);
    if (r && Kfree) Kfree(r);
}

int main(int argc, char *argv[]) {
    const char *libdir = (argc > 1) ? argv[1] : "/nonexistent";
    const char *kernel = (argc > 2) ? argv[2] : "/nonexistent/libkernel_hs.so";
    char path[1024];

    /* ── GHC RTS 挂载（宿主方案 A，循环引用裁决序） ── */
    snprintf(path, sizeof(path), "%s/libHSrts-1.0.3-ghc9.14.1.so", libdir);
    void *rts = dlopen(path, RTLD_LAZY | RTLD_GLOBAL);
    check(rts != NULL, "dlopen RTS（LAZY——stg 数据待 ghc-internal）");
    snprintf(path, sizeof(path), "%s/libHSghc-internal-9.1401.0-inplace-ghc9.14.1.so", libdir);
    void *gi = dlopen(path, RTLD_NOW | RTLD_GLOBAL);
    check(gi != NULL, "dlopen ghc-internal（NOW——stg 由已载 RTS 补）");
    if (!rts || !gi) { printf("FAIL RTS 挂载，中止\n"); return 1; }   /* 静态分析防线：空指针即退 */
    /* 与 addon ensureRuntimeGhc 同序：ghc-prim/base 显式 GLOBAL 载入——
     * 只载 rts+ghc-internal 时 base 等由 RUNPATH 自动解析（LOCAL），实测
     * setNumCapabilities 失效（caps=1）；四步 GLOBAL 后 caps=8（与 node 对齐） */
    {
        const char *more[] = { "libHSghc-prim-0.13.1-inplace-ghc9.14.1.so",
                               "libHSbase-4.22.0.0-inplace-ghc9.14.1.so" };
        for (int i = 0; i < 2; i++) {
            snprintf(path, sizeof(path), "%s/%s", libdir, more[i]);
            void *h = dlopen(path, RTLD_NOW | RTLD_GLOBAL);
            if (!h) { printf("FAIL dlopen %s: %s\n", more[i], dlerror()); return 1; }
        }
        printf("PASS 补载 ghc-prim/base (GLOBAL)\n");
    }
    void *hsi = dlsym(RTLD_DEFAULT, "hs_init");
    check(hsi != NULL, "hs_init 可见");
    if (hsi) ((void (*)(int *, char ***))hsi)(NULL, NULL);   /* 能力数由内核 init 的 setNumCapabilities 设 */
    else { printf("FAIL hs_init 缺席，中止\n"); return 1; }

    void *k = dlopen(kernel, RTLD_NOW | RTLD_GLOBAL);
    if (!k) { printf("FAIL dlopen kernel: %s\n", dlerror()); return 1; }
    check(k != NULL, "dlopen libkernel_hs.so");

    i_cstr_fn kinit = (i_cstr_fn)dlsym(k, "kernel_init");
    v_fn kshutdown = (v_fn)dlsym(k, "kernel_shutdown");
    v_fn kping = (v_fn)dlsym(k, "kernel_ping");
    Kcall = (call_fn)dlsym(k, "kernel_call");
    Kfree = (free_fn)dlsym(k, "kernel_free");
    err_fn kerr = (err_fn)dlsym(k, "kernel_last_error");
    int (*kver)(void) = (int (*)(void))dlsym(k, "kernel_abi_version");
    check(kinit && kshutdown && kping && Kcall && Kfree && kerr, "dlsym 6 核心符号");
    if (!kinit || !kshutdown || !kping || !Kcall || !Kfree || !kerr) {
        printf("FAIL 契约符号不全，中止\n");   /* 静态分析防线：check 不阻断，这里补 */
        return 1;
    }
    check(kver && kver() == 10001, "kernel_abi_version=10001（v1.1，无调度符号）");

    check(kinit("{}") == 0, "kernel_init");
    check(kping() == 0, "kernel_ping=0");

    /* ── 可测子集（与仓颉内核同契约） ── */
    expect_call("echo", "{\"x\":1}", "{\"x\":1}", "echo 直通");
    expect_call("add", "{\"a\":20,\"b\":22}", "{\"sum\":42}", "add");
    expect_call("add", "{\"a\":-7,\"b\":3}", "{\"sum\":-4}", "add 负数");
    expect_call("fib", "{\"n\":10}", "{\"result\":55}", "fib(10)");
    char *r = Kcall ? Kcall("fib", "{\"n\":99}") : NULL;
    check(r == NULL, "fib 越界 → NULL");
    if (r) Kfree(r);
    r = Kcall ? Kcall("nope", "{}") : NULL;
    check(r == NULL && strstr(kerr(), "unknown method") != NULL, "未知方法 → NULL+last_error");
    if (r) Kfree(r);

    /* ── trha 数据面：注册表 + 邮箱（TQueue FIFO/排空） ── */
    expect_call("agent.spawn", "{\"name\":\"alice\"}",
                "{\"id\":1,\"name\":\"alice\",\"state\":\"idle\"}", "trha spawn");
    expect_call("agent.spawn", "{}",
                "{\"id\":2,\"name\":\"agent-2\",\"state\":\"idle\"}", "trha spawn 缺省名");
    expect_call("agent.send", "{\"id\":1,\"text\":\"任务甲\"}", "{\"queued\":1}", "send 入队");
    expect_call("agent.send", "{\"id\":1,\"text\":\"任务乙\"}", "{\"queued\":2}", "send 计数");
    expect_call("agent.poll", "{\"id\":1}",
                "{\"messages\":[\"任务甲\",\"任务乙\"],\"drained\":2}", "poll FIFO 排空");
    expect_call("agent.poll", "{\"id\":1}",
                "{\"messages\":[],\"drained\":0}", "poll 再排空为空");
    r = Kcall ? Kcall("agent.send", "{\"id\":9,\"text\":\"x\"}") : NULL;
    check(r == NULL && strstr(kerr(), "no agent id=9") != NULL, "send 未知 id → NULL");
    if (r) Kfree(r);
    expect_call("agent.kill", "{\"id\":2}", "{\"killed\":\"agent-2\"}", "kill");
    r = Kcall ? Kcall("agent.list", "{}") : NULL;
    check(r && strstr(r, "\"count\":1") && strstr(r, "alice") && !strstr(r, "agent-2"),
          "list kill 后收敛");
    if (r) Kfree(r);

    /* ── trha 状态机（StateMachine.hs:30-36 五分支 + 自环） ── */
    expect_call("agent.transition", "{\"id\":1,\"cmd\":\"start\"}",
                "{\"before\":{\"state\":\"Idle\"},\"after\":{\"state\":\"Processing\",\"step\":\"step-1\"}}",
                "FSM: Idle+start → Processing(step-1)");
    expect_call("agent.transition", "{\"id\":1,\"cmd\":\"toolCall\",\"callId\":\"c1\",\"tool\":\"search\"}",
                "{\"before\":{\"state\":\"Processing\",\"step\":\"step-1\"},\"after\":{\"state\":\"WaitingForTool\",\"callId\":\"c1\"}}",
                "FSM: Processing+toolCall → WaitingForTool(c1)");
    expect_call("agent.transition", "{\"id\":1,\"cmd\":\"toolResult\",\"result\":\"ok\"}",
                "{\"before\":{\"state\":\"WaitingForTool\",\"callId\":\"c1\"},\"after\":{\"state\":\"Processing\",\"step\":\"step-2\"}}",
                "FSM: WaitingForTool+toolResult → Processing(step-2)");
    expect_call("agent.transition", "{\"id\":1,\"cmd\":\"complete\",\"text\":\"done\"}",
                "{\"before\":{\"state\":\"Processing\",\"step\":\"step-2\"},\"after\":{\"state\":\"Completed\",\"text\":\"done\"}}",
                "FSM: Processing+complete → Completed");
    expect_call("agent.state", "{\"id\":1}",
                "{\"state\":\"Completed\",\"text\":\"done\"}", "state 查询");
    /* 自环：Completed + start（非法）保持原态——trha transition s _ = s */
    expect_call("agent.transition", "{\"id\":1,\"cmd\":\"start\"}",
                "{\"before\":{\"state\":\"Completed\",\"text\":\"done\"},\"after\":{\"state\":\"Completed\",\"text\":\"done\"}}",
                "FSM: 非法转移自环（Completed+start 保持）");
    /* Error 任意态可入（对新 spawn 的 bob——Idle 态验证；trha 规则：任意态+error → Error） */
    expect_call("agent.spawn", "{\"name\":\"bob\"}",
                "{\"id\":3,\"name\":\"bob\",\"state\":\"idle\"}", "spawn bob");
    expect_call("agent.transition", "{\"id\":3,\"cmd\":\"error\",\"error\":\"boom\"}",
                "{\"before\":{\"state\":\"Idle\"},\"after\":{\"state\":\"Error\",\"error\":\"boom\"}}",
                "FSM: 任意态+error → Error（trha 规则）");
    /* trha 原版：Error+start 走末行自环【保持 Error】（transition state _ = state）——
     * 与我实现一致；step 参数效应在合法路径（Idle+start）验证 */
    expect_call("agent.transition", "{\"id\":3,\"cmd\":\"start\",\"step\":\"step-9\"}",
                "{\"before\":{\"state\":\"Error\",\"error\":\"boom\"},\"after\":{\"state\":\"Error\",\"error\":\"boom\"}}",
                "FSM: Error+start 自环保持（trha transition state _ = state）");
    expect_call("agent.spawn", "{\"name\":\"carol\"}",
                "{\"id\":4,\"name\":\"carol\",\"state\":\"idle\"}", "spawn carol");
    expect_call("agent.transition", "{\"id\":4,\"cmd\":\"start\",\"step\":\"step-9\"}",
                "{\"before\":{\"state\":\"Idle\"},\"after\":{\"state\":\"Processing\",\"step\":\"step-9\"}}",
                "FSM: Idle+start(step-9 参数生效——trha 占位字面量的参数化)");
    r = Kcall ? Kcall("agent.transition", "{\"id\":9,\"cmd\":\"start\"}") : NULL;
    check(r == NULL && strstr(kerr(), "no agent id=9") != NULL, "transition 未知 id → NULL");
    if (r) Kfree(r);

    /* re-init = 全新内核（注册表清零） */
    /* ── R115-A：作业面（forkIO 真线程，宿主零驱动——不泵任何调度器） ──────────── */
    expect_call("agent.spawn", "{\"name\":\"worker\"}",
                "{\"id\":5,\"name\":\"worker\",\"state\":\"idle\"}", "作业面 spawn");
    /* 提交 4×fib(30)：只 usleep 轮询（C 宿主不做 RunCJTask——与仓颉模型对照） */
    for (int j = 0; j < 4; j++) {
        char q[96];
        snprintf(q, sizeof(q), "{\"id\":5,\"kind\":\"fib\",\"n\":30}");
        char *rr = Kcall ? Kcall("agent.submit", q) : NULL;
        char want[64];
        snprintf(want, sizeof(want), "{\"jobId\":%d,\"state\":\"pending\"}", 1 + j);
        char buf[160];
        snprintf(buf, sizeof(buf), "submit fib(30) #%d", j);
        check(rr && strcmp(rr, want) == 0, buf);
        if (rr && Kfree) Kfree(rr);
    }
    {
        int done = 0;
        for (int i = 0; i < 1500 && !done; i++) {   /* fib(30)≈83万次/支，GHC 数十 ms */
            done = 1;
            for (int j = 1; j <= 4; j++) {
                char q[64];
                snprintf(q, sizeof(q), "{\"jobId\":%d}", j);
                char *rr = Kcall ? Kcall("agent.result", q) : NULL;
                if (!rr || !strstr(rr, "\"done\"")) done = 0;
                if (rr && Kfree) Kfree(rr);
            }
            if (!done) usleep(20000);
        }
        check(done, "4×fib(30) 全部 done（零驱动轮询——forkIO 自跑）");
        int valsOk = 1;
        for (int j = 1; j <= 4; j++) {
            char q[64];
            snprintf(q, sizeof(q), "{\"jobId\":%d}", j);
            char *rr = Kcall ? Kcall("agent.result", q) : NULL;
            if (!rr || !strstr(rr, "832040")) valsOk = 0;
            if (rr && Kfree) Kfree(rr);
        }
        check(valsOk, "并行批 4 值全部 = 832040（fib(30)）");
    }
    /* timings 重叠 = forkIO 真并行（GHC 无泵，对比仓颉 RunUIScheduler 模型） */
    r = Kcall ? Kcall("agent.timings", "{}") : NULL;
    check(r != NULL, "agent.timings 可读");
    if (r) {
        long long v[64] = {0};
        int n = 0;
        for (const char *q = r; *q && n < 64; q++) {
            if (*q >= '0' && *q <= '9') {
                long long x = 0;
                while (*q >= '0' && *q <= '9') { x = x * 10 + (*q - '0'); q++; }
                v[n++] = x;
            }
        }
        int pairs = (n - 1) / 2, ov = 0;
        for (int a = 0; a < pairs; a++)
            for (int b = a + 1; b < pairs; b++)
                if (v[1 + a * 2] < v[2 + b * 2] && v[1 + b * 2] < v[2 + a * 2]) ov++;
        /* 环境条件断言（R115 实测记录）：C 原生嵌入宿主下 setNumCapabilities 无效
         * （atInit=1，node/N-API 宿主下=8 同 .so）——多核并行证据由 addon 层 smoke
         * 承载（重叠 6/6 稳定）；C 层在单能力环境下验证调度正确性（任务全部完成），
         * 环境差异如实打印而非假绿。 */
        { char *cc = Kcall ? Kcall("sys.caps", "{}") : NULL;
          int multi = cc && strstr(cc, "\"now\":1") == NULL;
          printf("CAPS-AT-TIMINGS %s multi=%d\n", cc ? cc : "?", multi);
          if (cc && Kfree) Kfree(cc);
          if (multi) check(ov > 0, "时间戳重叠 >0 对（forkIO 真并发——宿主零泵）");
          else printf("SKIP 时间戳重叠（C 嵌入宿主单能力——并行证据见 addon smoke R114 段）\n");
        }
    }
    if (r && Kfree) Kfree(r);
    /* 作业错误路径矩阵 */
    r = Kcall ? Kcall("agent.submit", "{\"id\":99,\"kind\":\"fib\",\"n\":5}") : NULL;
    check(r == NULL && strstr(kerr(), "no agent id=99") != NULL, "submit 未知 agent → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.submit", "{\"id\":5,\"kind\":\"nope\"}") : NULL;
    check(r == NULL && strstr(kerr(), "kind must be") != NULL, "submit 坏 kind → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.submit", "{\"id\":5,\"kind\":\"fib\",\"n\":99}") : NULL;
    check(r == NULL && strstr(kerr(), "n out of range") != NULL, "submit n 越界 → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.result", "{\"jobId\":999}") : NULL;
    check(r == NULL && strstr(kerr(), "no job id=999") != NULL, "result 未知 job → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.cancel", "{\"jobId\":999}") : NULL;
    check(r == NULL && strstr(kerr(), "no job id=999") != NULL, "cancel 未知 job → NULL");
    if (r && Kfree) Kfree(r);
    /* cancel(done) 幂等路径：对已完成 job 取消 → none/done */
    r = Kcall ? Kcall("agent.cancel", "{\"jobId\":1}") : NULL;
    check(r && strcmp(r, "{\"cancelled\":\"none\",\"state\":\"done\"}") == 0,
          "cancel(done) → none/done");
    if (r && Kfree) Kfree(r);

    /* ── R115-B：快照（与仓颉 sys.snapshot 同格式——跨语言互通的字节级断言） ───── */
    expect_call("agent.spawn", "{\"name\":\"快照\"}",
                "{\"id\":6,\"name\":\"快照\",\"state\":\"idle\"}", "快照场景 spawn");
    expect_call("agent.send", "{\"id\":6,\"text\":\"消息A\"}", "{\"queued\":1}", "入队 A");
    expect_call("agent.send", "{\"id\":6,\"text\":\"带\\\"引号\\\"的消息\"}",
                "{\"queued\":2}", "入队含转义");
    r = Kcall ? Kcall("sys.snapshot", "{}") : NULL;
    check(r != NULL && strstr(r, "\"v\":1") != NULL && strstr(r, "\"n\":5") != NULL
          && strstr(r, "\"nextId\":6") != NULL, "sys.snapshot 形状（v1/n5/nextId5）");
    if (r) {
        char snap[2048];
        snprintf(snap, sizeof(snap), "%s", r);
        Kfree(r);
        /* 破坏现场：kill 全部 → 恢复 → 等价 */
        for (int i = 1; i <= 6; i++) {
            char q[48];
            snprintf(q, sizeof(q), "{\"id\":%d}", i);
            char *kk = Kcall ? Kcall("agent.kill", q) : NULL;
            if (kk && Kfree) Kfree(kk);
        }
        r = Kcall ? Kcall("agent.list", "{}") : NULL;
        check(r && strstr(r, "\"count\":0"), "破坏：注册表清空");
        if (r && Kfree) Kfree(r);
        /* restore 直接把 snapshot 作为 p（sys.restore 期望自身形状的 JSON——
         * 快照本体就是 p；仓颉同约定） */
        r = Kcall ? Kcall("sys.restore", snap) : NULL;
        check(r && strcmp(r, "{\"restored\":5}") == 0, "sys.restore → restored=5");
        if (r && Kfree) Kfree(r);
        r = Kcall ? Kcall("agent.list", "{}") : NULL;
        check(r && strstr(r, "\"count\":5") && strstr(r, "alice")
              && strstr(r, "worker") && strstr(r, "快照"), "恢复后注册表等价（5 agents）");
        if (r && Kfree) Kfree(r);
        r = Kcall ? Kcall("agent.poll", "{\"id\":6}") : NULL;
        check(r && strstr(r, "消息A") && strstr(r, "引号") && strstr(r, "drained\":2"),
              "恢复后邮箱 FIFO + 转义往返（UTF-8/\\\" 反转义）");
        if (r && Kfree) Kfree(r);
    }
    r = Kcall ? Kcall("sys.restore", "{\"v\":9}") : NULL;
    check(r == NULL && strstr(kerr(), "bad snapshot") != NULL, "坏版本快照 → NULL+报因");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("sys.restore", "{\"v\":1,\"nextId\":x}") : NULL;
    check(r == NULL, "畸形快照 → NULL");
    if (r && Kfree) Kfree(r);

    /* ── R115-C：错误矩阵补齐（缺参三路） ───────────────────────────────────── */
    r = Kcall ? Kcall("agent.poll", "{}") : NULL;
    check(r == NULL && strstr(kerr(), "integer id") != NULL, "poll 缺 id → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.kill", "{}") : NULL;
    check(r == NULL && strstr(kerr(), "integer id") != NULL, "kill 缺 id → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.state", "{}") : NULL;
    check(r == NULL && strstr(kerr(), "integer id") != NULL, "state 缺 id → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.transition", "{\"id\":1}") : NULL;
    check(r == NULL && strstr(kerr(), "string cmd") != NULL, "transition 缺 cmd → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.transition", "{\"id\":1,\"cmd\":\"warp\"}") : NULL;
    check(r == NULL && strstr(kerr(), "unknown cmd") != NULL, "transition 坏 cmd → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.result", "{}") : NULL;
    check(r == NULL && strstr(kerr(), "integer jobId") != NULL, "result 缺 jobId → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.cancel", "{}") : NULL;
    check(r == NULL && strstr(kerr(), "integer jobId") != NULL, "cancel 缺 jobId → NULL");
    if (r && Kfree) Kfree(r);
    r = Kcall ? Kcall("agent.submit", "{\"id\":4}") : NULL;
    check(r == NULL && strstr(kerr(), "string kind") != NULL, "submit 缺 kind → NULL");
    if (r && Kfree) Kfree(r);

    /* ── R115-D：typed 直调（R112 双轨第三语言版） ──────────────────────────── */
    {
        long long (*kadd)(long long, long long) =
            (long long (*)(long long, long long))dlsym(k, "kernel_add");
        const char *(*kecho)(const char *) =
            (const char *(*)(const char *))dlsym(k, "kernel_echo");
        check(kadd != NULL && kadd(20, 22) == 42, "kernel_add 直调（hs typed）");
        check(kecho != NULL && strcmp(kecho("typed-hs"), "typed-hs") == 0,
              "kernel_echo 直调（hs typed）");
        if (kecho) Kfree((void *)kecho("free-me"));
    }

    check(kshutdown() == 0 && kinit("{}") == 0, "shutdown+init 重置");
    r = Kcall ? Kcall("agent.list", "{}") : NULL;
    check(r && strstr(r, "\"count\":0"), "重置后注册表清零");
    if (r) Kfree(r);

    if (fails == 0) printf("ALL PASS\n");
    else printf("%d FAILURES\n", fails);
    return fails == 0 ? 0 : 1;
}
