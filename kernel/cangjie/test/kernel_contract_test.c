/*
 * R98：C 测试器——完整 c-abi 契约验证（test_kernel.c 的 v2 版）
 * 序列：dlopen 运行时 → InitCJRuntime → dlopen 内核 → dlsym 6 符号 →
 *       ping/init/call(echo,add,fib,upper)/错误路径/last_error/free/shutdown/ping
 * 编译：gcc kernel_contract_test.c -o kernel_contract_test -ldl
 * 运行：LD_LIBRARY_PATH=<SDK>/runtime/lib/linux_x86_64_cjnative ./kernel_contract_test
 */
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

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
    /* 零参默认（4096 字节零块）——与 R97 test_kernel.c 相同 */
    static char param[4096] = {0};
    int rc = ((init_rt_fn)dlsym(rt, "InitCJRuntime"))(param);
    check(rc == 0, "InitCJRuntime(零参默认)");

    void *k = dlopen(kernel_path, RTLD_NOW);
    if (!k) { printf("FAIL dlopen kernel: %s\n", dlerror()); return 1; }
    i_cstr_fn kinit = (i_cstr_fn)dlsym(k, "kernel_init");
    v_fn kshutdown = (v_fn)dlsym(k, "kernel_shutdown");
    v_fn kping = (v_fn)dlsym(k, "kernel_ping");
    call_fn kcall = (call_fn)dlsym(k, "kernel_call");
    free_fn kfree = (free_fn)dlsym(k, "kernel_free");
    err_fn kerr = (err_fn)dlsym(k, "kernel_last_error");
    check(kinit && kshutdown && kping && kcall && kfree && kerr, "dlsym 6 契约符号");

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
