/*
 * kernel/contract_common.c — R119：五内核统一契约套件（跨语言等价性的同一套测试）
 *
 * 用法：contract_common <mode> <kernel.so> [rts-dir]
 *   mode=cangjie  <kernel.so> [<rt-dir>]  仓颉序列：dlopen libcangjie-runtime +
 *                                         InitCJRuntime（需 LD_LIBRARY_PATH 含运行时库）
 *   mode=ghc      <kernel.so> <libdir>    GHC 序列：RTS LAZY → ghc-internal → hs_init
 *   mode=direct   <kernel.so>             C/Go/Rust：零宿主序直接 dlopen
 *
 * 覆盖 = 五内核【共同 12 方法】（echo/add/error + agent 五件 + 作业四）+ 共同错误
 * 矩阵 + re-init 隔离 + typed 直调 + 版本握手 + 作业收敛/取消宽容形。
 * 各内核扩展方法（upper/snapshot/transition/session 系/rev 等）仍由各自 smoke 段覆盖——
 * 本套件的使命是【同一套断言证明五语言的契约等价】。
 *
 * 错误文案跨内核不统一（合理——契约只要求 NULL+last_error 非空），本套件只断言
 * 形状；文案由各内核自己的测试精确断言。
 *
 * 编译：gcc -O2 -o contract_common contract_common.c -ldl [-D_GNU_SOURCE]
 * 运行：见 kernel/run-contract.sh
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef int (*i_cstr_fn)(const char *);
typedef int (*v_fn)(void);
typedef char *(*call_fn)(const char *, const char *);
typedef void (*free_fn)(void *);
typedef const char *(*err_fn)(void);

static int fails = 0;
static void check(int cond, const char *m) {
    printf("%s %s\n", cond ? "PASS " : "FAIL ", m);
    if (!cond) fails++;
}

static call_fn Kcall = NULL;
static free_fn Kfree = NULL;
/* 仓颉泵驱动（mode=cangjie 时生效——仓颉作业需要宿主 RunCJTask+RunUIScheduler，
 * 坑 104；其余内核自调度零驱动） */
static void (*runTask)(void *(*)(void *), void *) = NULL;
static int (*runUISched)(unsigned long long) = NULL;
static int (*kpending)(void) = NULL;
static int (*kdraining)(void) = NULL;
static void *(*kdrainEntry)(void *) = NULL;

static void drive_if_cangjie(void) {
    if (!runTask || !runUISched || !kpending || !kdraining || !kdrainEntry) return;
    int pend = kpending();
    int dr = kdraining();
    int want = pend < 4 ? pend : 4;
    for (int i = dr; i < want; i++) runTask((void *(*)(void *))kdrainEntry, NULL);
    if (pend > 0 || dr > 0) runUISched(2);
}

/* 共同期望：调用并比对返回字节形（NULL 即期望 NULL） */
static void expect_call(const char *method, const char *params, const char *want, const char *m) {
    char buf[640];
    if (!Kcall) { check(0, m); return; }
    char *r = Kcall(method, params);
    if (want == NULL) {
        check(r == NULL, m);
    } else {
        int eq = r && strcmp(r, want) == 0;
        snprintf(buf, sizeof(buf), "%s → %s（期望 %s）", m, r ? r : "(null)", want);
        check(eq, buf);
    }
    if (r && Kfree) Kfree(r);
}

/* 错误形状：NULL + last_error 非空（文案不作断言——契约只要求形状） */
static err_fn Kerr = NULL;
static void expect_err_shape(const char *method, const char *params, const char *m) {
    if (!Kcall || !Kerr) { check(0, m); return; }
    char *r = Kcall(method, params);
    const char *e = Kerr();
    char buf[320];
    snprintf(buf, sizeof(buf), "%s（err=%s）", m, e ? e : "(空)");
    check(r == NULL && e && e[0], buf);
    if (r && Kfree) Kfree(r);
}

static void yield_ms(int ms) {
    usleep(ms * 1000);
}

int main(int argc, char *argv[]) {
    const char *mode = (argc > 1) ? argv[1] : "direct";
    const char *kpath = (argc > 2) ? argv[2] : "";
    const char *rtsdir = (argc > 3) ? argv[3] : "";
    void *k = NULL;

    /* ── 挂载序列（三模式） ── */
    if (strcmp(mode, "cangjie") == 0) {
        void *rt = dlopen("libcangjie-runtime.so", RTLD_NOW | RTLD_GLOBAL);
        if (!rt) { printf("FAIL dlopen runtime: %s\n", dlerror()); return 1; }
        static char param[4096] = {0};   /* logLevel 段零内存=VERBOSE——填 ERR=5 */
        param[44 * 4] = 0;               /* placeholder：结构体首段 HeapParam 保持 0 */
        /* LogParam.logLevel=5 需要精确定位——用 RuntimeParam 全零（噪声接受，R104
         * 语义在 addon 侧实现；套件容忍 stderr 噪声） */
        int rc = ((int (*)(const void *))dlsym(rt, "InitCJRuntime"))(param);
        if (rc != 0) { printf("FAIL InitCJRuntime=%d\n", rc); return 1; }
        runTask = (void (*)(void *(*)(void *), void *))dlsym(rt, "RunCJTask");
        runUISched = (int (*)(unsigned long long))dlsym(rt, "RunUIScheduler");
        printf("MOUNT cangjie: InitCJRuntime ok\n");
    } else if (strcmp(mode, "ghc") == 0) {
        char p[1024];
        snprintf(p, sizeof(p), "%s/libHSrts-1.0.3-ghc9.14.1.so", rtsdir);
        void *rts = dlopen(p, RTLD_LAZY | RTLD_GLOBAL);
        if (!rts) { printf("FAIL dlopen rts: %s\n", dlerror()); return 1; }
        snprintf(p, sizeof(p), "%s/libHSghc-internal-9.1401.0-inplace-ghc9.14.1.so", rtsdir);
        void *gi = dlopen(p, RTLD_NOW | RTLD_GLOBAL);
        if (!gi) { printf("FAIL dlopen ghc-internal: %s\n", dlerror()); return 1; }
        snprintf(p, sizeof(p), "%s/libHSghc-prim-0.13.1-inplace-ghc9.14.1.so", rtsdir);
        dlopen(p, RTLD_NOW | RTLD_GLOBAL);
        snprintf(p, sizeof(p), "%s/libHSbase-4.22.0.0-inplace-ghc9.14.1.so", rtsdir);
        dlopen(p, RTLD_NOW | RTLD_GLOBAL);
        void *hsi = dlsym(RTLD_DEFAULT, "hs_init");
        if (!hsi) { printf("FAIL hs_init\n"); return 1; }
        ((void (*)(int *, char ***))hsi)(NULL, NULL);
        printf("MOUNT ghc: rts+hs_init ok\n");
    } else {
        printf("MOUNT direct: zero host sequence\n");
    }

    k = dlopen(kpath, RTLD_NOW | RTLD_GLOBAL);
    if (!k) { printf("FAIL dlopen kernel: %s\n", dlerror()); return 1; }

    i_cstr_fn kinit = (i_cstr_fn)dlsym(k, "kernel_init");
    v_fn kshutdown = (v_fn)dlsym(k, "kernel_shutdown");
    v_fn kping = (v_fn)dlsym(k, "kernel_ping");
    Kcall = (call_fn)dlsym(k, "kernel_call");
    Kfree = (free_fn)dlsym(k, "kernel_free");
    Kerr = (err_fn)dlsym(k, "kernel_last_error");
    int (*kver)(void) = (int (*)(void))dlsym(k, "kernel_abi_version");
    kpending = (int (*)(void))dlsym(k, "kernel_pending");
    kdraining = (int (*)(void))dlsym(k, "kernel_draining");
    kdrainEntry = (void *(*)(void *))dlsym(k, "kernel_drain_entry");
    check(kinit && kshutdown && kping && Kcall && Kfree && Kerr, "dlsym 6 核心符号");
    if (!kinit || !kshutdown || !kping || !Kcall || !Kfree || !Kerr) return 1;

    /* ── 契约基座 ── */
    check(kver && kver() == 10001, "kernel_abi_version=10001（五内核统一版本）");
    check(kinit("{}") == 0, "kernel_init");
    check(kping() == 0, "kernel_ping=0");

    /* ── 共同 12 方法：echo/add/error ── */
    expect_call("echo", "{\"x\":1}", "{\"x\":1}", "echo 原样直通");
    expect_call("echo", "{\"text\":\"直通\"}", "{\"text\":\"直通\"}", "echo UTF-8 直通");
    expect_call("add", "{\"a\":20,\"b\":22}", "{\"sum\":42}", "add");
    expect_call("add", "{\"a\":-7,\"b\":3}", "{\"sum\":-4}", "add 负数");
    expect_err_shape("error", "{}", "error 强制失败（NULL+last_error）");

    /* ── 共同：agent 五件 ── */
    expect_call("agent.spawn", "{\"name\":\"alice\"}",
                "{\"id\":1,\"name\":\"alice\",\"state\":\"idle\"}", "spawn");
    expect_call("agent.spawn", "{}",
                "{\"id\":2,\"name\":\"agent-2\",\"state\":\"idle\"}", "spawn 缺省名");
    expect_call("agent.list", "{}",
                "{\"count\":2,\"agents\":[{\"id\":1,\"name\":\"alice\",\"state\":\"idle\"},"
                "{\"id\":2,\"name\":\"agent-2\",\"state\":\"idle\"}]}", "list 按 spawn 序");
    expect_call("agent.send", "{\"id\":1,\"text\":\"任务甲\"}", "{\"queued\":1}", "send 计数");
    expect_call("agent.send", "{\"id\":1,\"text\":\"第二封\"}", "{\"queued\":2}", "send 再计");
    expect_call("agent.poll", "{\"id\":1}",
                "{\"messages\":[\"任务甲\",\"第二封\"],\"drained\":2}", "poll FIFO 排空");
    expect_call("agent.poll", "{\"id\":1}",
                "{\"messages\":[],\"drained\":0}", "poll 再空");
    expect_call("agent.kill", "{\"id\":2}", "{\"killed\":\"agent-2\"}", "kill");
    {
        char *r = Kcall ? Kcall("agent.list", "{}") : NULL;
        check(r && strstr(r, "\"count\":1") && strstr(r, "alice") && !strstr(r, "agent-2"),
              "kill 后 list 收敛");
        if (r && Kfree) Kfree(r);
    }
    expect_err_shape("agent.send", "{\"id\":99,\"text\":\"x\"}", "send 未知 id → 错误形状");
    expect_err_shape("agent.poll", "{}", "poll 缺 id → 错误形状");
    expect_err_shape("agent.kill", "{\"id\":99}", "kill 未知 id → 错误形状");

    /* ── 共同：作业四（宿主零驱动轮询；universally 从 jobId=1 起） ── */
    expect_call("agent.submit", "{\"id\":1,\"kind\":\"fib\",\"n\":30}",
                "{\"jobId\":1,\"state\":\"pending\"}", "submit fib(30) → jobId=1");
    expect_call("agent.submit", "{\"id\":1,\"kind\":\"echo\",\"text\":\"回声\"}",
                "{\"jobId\":2,\"state\":\"pending\"}", "submit echo → jobId=2");
    expect_err_shape("agent.submit", "{\"id\":1,\"kind\":\"nope\"}", "submit 坏 kind → 错误形状");
    expect_err_shape("agent.submit", "{\"id\":99,\"kind\":\"fib\",\"n\":5}", "submit 未知 agent → 错误形状");
    expect_err_shape("agent.result", "{\"jobId\":99}", "result 未知 job → 错误形状");
    expect_err_shape("agent.cancel", "{\"jobId\":99}", "cancel 未知 job → 错误形状");

    /* 等两作业 done（带让步——五内核作业时序各异） */
    {
        int done = 0;
        for (int i = 0; i < 500 && !done; i++) {
            done = 1;
            for (int j = 1; j <= 2; j++) {
                char q[64];
                snprintf(q, sizeof(q), "{\"jobId\":%d}", j);
                char *r = Kcall ? Kcall("agent.result", q) : NULL;
                if (!r || !strstr(r, "\"done\"")) done = 0;
                if (r && Kfree) Kfree(r);
            }
            if (!done) { drive_if_cangjie(); yield_ms(5); }
        }
        check(done, "两作业收敛 done（fib(30)=832040 + echo）");
        int vals = 1;
        for (int j = 1; j <= 2; j++) {
            char q[64];
            snprintf(q, sizeof(q), "{\"jobId\":%d}", j);
            char *r = Kcall ? Kcall("agent.result", q) : NULL;
            if (j == 1 && (!r || !strstr(r, "832040"))) vals = 0;
            if (j == 2 && (!r || !strstr(r, "回声"))) vals = 0;
            if (r && Kfree) Kfree(r);
        }
        check(vals, "作业值正确（fib(30)=832040 / echo 回声）");
    }
    /* timings 时间窗 */
    {
        char *r = Kcall ? Kcall("agent.timings", "{}") : NULL;
        int good = r != NULL;
        if (r) {
            /* 解析两对窗口：end>start */
            long long v[64] = {0};
            int n = 0;
            for (const char *q = r; *q && n < 64; q++) {
                if (*q >= '0' && *q <= '9') {
                    long long x = 0;
                    while (*q >= '0' && *q <= '9') { x = x * 10 + (*q - '0'); q++; }
                    v[n++] = x;
                }
            }
            /* v[0]=count 值，窗口从 v[1] 起两两配对（v1,v2 | v3,v4 | …）——
             * 首版从 i=0 配对把 count 与 start1 比、又把 end1 与 start2 比（串行时
             * 恰好成立纯属巧合——R119 修正为奇数位起配对） */
            if (n < 5) good = 0;
            for (int i = 1; i + 1 < n && good; i += 2) {
                if (v[i + 1] <= v[i]) good = 0;   /* end > start 才有效 */
            }
            Kfree(r);
        }
        check(good, "timings 时间窗有效（n=2 且 end>start）");
    }
    /* cancel 宽容形（驱动时序不定——pending/in-flight/done 三路径） */
    {
        char *r1 = Kcall ? Kcall("agent.submit", "{\"id\":1,\"kind\":\"fib\",\"n\":30}") : NULL;
        int jid3 = 0;
        if (r1) { sscanf(r1, "{\"jobId\":%d", &jid3); Kfree(r1); }
        check(jid3 > 0, "cancel 场景 submit → jobId");
        if (jid3 > 0) {
            char q[64];
            snprintf(q, sizeof(q), "{\"jobId\":%d}", jid3);
            char *rc = Kcall ? Kcall("agent.cancel", q) : NULL;
            int legal = rc && (strstr(rc, "\"pending\"") ||
                               (strstr(rc, "\"none\"") && (strstr(rc, "done") || strstr(rc, "in-flight"))));
            char buf[160];
            snprintf(buf, sizeof(buf), "cancel 返回形合法（%s）", rc ? rc : "(null)");
            check(legal, buf);
            if (rc && Kfree) Kfree(rc);
            /* 收敛：cancelled 或 done 都是合法终态 */
            int conv = 0;
            for (int i = 0; i < 500 && !conv; i++) {
                char *rr = Kcall ? Kcall("agent.result", q) : NULL;
                if (rr && (strstr(rr, "cancelled") || strstr(rr, "done"))) conv = 1;
                if (rr && Kfree) Kfree(rr);
                if (!conv) { drive_if_cangjie(); yield_ms(5); }
            }
            check(conv, "取消后收敛终态（cancelled 或 done——宽容判据）");
        }
    }

    /* ── 共同：typed 直调 + 未知方法 ── */
    {
        long long (*kadd)(long long, long long) =
            (long long (*)(long long, long long))dlsym(k, "kernel_add");
        const char *(*kecho)(const char *) =
            (const char *(*)(const char *))dlsym(k, "kernel_echo");
        check(kadd && kadd(20, 22) == 42, "kernel_add typed 直调=42");
        check(kecho && strcmp(kecho("typed"), "typed") == 0, "kernel_echo typed 直调");
        if (kecho && Kfree) Kfree((void *)kecho("free-me"));
    }
    expect_err_shape("no_such_method", "{}", "未知方法 → 错误形状");

    /* ── re-init 隔离：注册表/作业清零 ── */
    check(kshutdown() == 0, "kernel_shutdown");
    check(kinit("{}") == 0, "kernel_init（re-init）");
    {
        char *r = Kcall ? Kcall("agent.list", "{}") : NULL;
        check(r && strstr(r, "\"count\":0"), "re-init 后注册表清零");
        if (r && Kfree) Kfree(r);
        r = Kcall ? Kcall("agent.result", "{\"jobId\":1}") : NULL;
        check(r == NULL, "re-init 后旧作业消失（NULL）");
        if (r && Kfree) Kfree(r);
    }
    check(kping() == 0, "re-init 后 ping=0");

    if (fails == 0) printf("ALL PASS\n");
    else printf("%d FAILURES\n", fails);
    return fails == 0 ? 0 : 1;
}
