/*
 * R114：Haskell 内核（trha 数据面）端到端测试
 * 序列：RTS LAZY → ghc-internal NOW → hs_init → dlopen 内核 → kernel_init →
 *       数据面（spawn/send/poll/kill）+ trha 状态机（五分支/自环/非法态）
 * 编译：gcc hs_contract_test.c -o hs_contract_test -ldl
 * 运行：./hs_contract_test <GHC-libdir> <libkernel_hs.so>
 */
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

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
    void *hsi = dlsym(RTLD_DEFAULT, "hs_init");
    check(hsi != NULL, "hs_init 可见");
    if (hsi) ((void (*)(int *, char ***))hsi)(NULL, NULL);
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
    check(kshutdown() == 0 && kinit("{}") == 0, "shutdown+init 重置");
    r = Kcall ? Kcall("agent.list", "{}") : NULL;
    check(r && strstr(r, "\"count\":0"), "重置后注册表清零");
    if (r) Kfree(r);

    if (fails == 0) printf("ALL PASS\n");
    else printf("%d FAILURES\n", fails);
    return fails == 0 ? 0 : 1;
}
