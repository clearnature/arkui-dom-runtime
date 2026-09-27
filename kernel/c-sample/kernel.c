/*
 * kernel/c-sample/kernel.c — 纯 C 内核：kernel_abi.h 契约（R107 起；R118 补全）
 *
 * 目的：实证 kernel/shared/protocol/kernel_abi.h 的多语言声明——与仓颉内核
 * （kernel/cangjie/）实现同一契约、同进程共存、宿主零改动。参考实现骨架。
 *
 * 方法面：
 *   R107 隔离验证件（刻意与其他内核不同——smoke "c 槽没有 fib" 断言的牙）：
 *     rev  → {"text":"abc"} → {"text":"cba"}   字节反转（ASCII 域）
 *     len  → {"text":"abc"} → {"len":3}        字节长度
 *   R118 补全（与其余四语言同构）：
 *     agent 五件 spawn/list/send/poll/kill + 作业面 submit/result/cancel/timings
 *     typed 直调 kernel_add/kernel_echo（R112）
 *
 * 并发（R118）：POSIX pthreads——**宿主零驱动**（同 Go/Rust 路线，不需要仓颉的
 * RunUIScheduler 泵——泵是坑 103/104 的仓颉嵌入特有）。单全局 mutex 保护
 * 注册表/作业表/发布（worker 与 dispatch 同锁 → 无锁序问题）；四态协作取消
 * （0=pending 2=claimed 1=done 3=cancelled，领取在锁内判）；时间戳 CLOCK_MONOTONIC。
 *
 * 编译：bash kernel/c-sample/build.sh（= gcc -O2 -pthread -shared -fPIC）
 * 无任何运行时依赖（不 dlopen、不带 RT），宿主 cjkInitK 槽名+rtLib 空串即可挂载。
 */
#define _POSIX_C_SOURCE 200809L
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_AGENTS 64
#define MAX_JOBS   64
#define BOX_CAP    64      /* 每 agent 邮箱上限（样例级；超限报错如实） */
#define NAME_CAP   64

static int g_init = 0;
static char g_err[512] = {0};
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;

/* ── agent 注册表 ──────────────────────────────────────────────────────────── */
typedef struct {
    int used;
    char name[NAME_CAP];
    char *box[BOX_CAP];
    int box_n;
} Agent;

typedef struct {
    int used;
    int kind_fib;                 /* 1=fib 0=echo */
    int64_t n;
    char *text;
    int state;                    /* 0=pending 2=claimed 1=done 3=cancelled */
    int64_t value;
    char *out;
    int64_t start_ns, end_ns;
} Job;

static Agent g_agents[MAX_AGENTS];   /* 下标 = id-1（id 从 1 起单调，kill 不复用） */
static int g_next_agent = 0;
static int g_order[MAX_AGENTS];      /* spawn 序（id 列表） */
static int g_order_n = 0;

static Job g_jobs[MAX_JOBS];
static int g_next_job = 0;
static int g_done_or[MAX_JOBS];
static int g_done_n = 0;

static int64_t mono_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

/* ── JSON 轻量工具（R118 起带转义——与仓颉/Haskell 同边界） ────────────────── */

/* 输出转义：引号/反斜杠/换行/SOH → \u0001（跨内核互通约定） */
static void esc_into(char *dst, size_t cap, const char *s) {
    size_t o = 0;
    for (; *s && o + 8 < cap; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"') { dst[o++] = '\\'; dst[o++] = '"'; }
        else if (c == '\\') { dst[o++] = '\\'; dst[o++] = '\\'; }
        else if (c == '\n') { dst[o++] = '\\'; dst[o++] = 'n'; }
        else if (c == 1) { memcpy(dst + o, "\\u0001", 6); o += 6; }
        else dst[o++] = (char)c;
    }
    dst[o] = 0;
}

/* 找 "key": 返回冒号后位置（NULL=未找到）；strstr 滑动即命中（键唯一假设——样例级） */
static const char *find_key(const char *src, const char *key) {
    static char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\":", key);
    const char *p = strstr(src, pat);
    return p ? p + strlen(pat) : NULL;
}

/* "key":<int> */
static int json_int(const char *src, const char *key, int64_t *out) {
    const char *p = find_key(src, key);
    if (!p) return 0;
    char *end = NULL;
    long long v = strtoll(p, &end, 10);
    if (end == p) return 0;
    *out = (int64_t)v;
    return 1;
}

/* "key":"<value>"（带 \" \\ 转义解码——R118 起，首版 takeWhile 截断同坑 107 系列） */
static int json_str(const char *src, const char *key, char *out, size_t cap) {
    static char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\":\"", key);
    const char *p = strstr(src, pat);
    if (!p) return 0;
    p += strlen(pat);
    size_t o = 0;
    while (*p && o + 1 < cap) {
        if (*p == '"') { out[o] = 0; return 1; }
        if (*p == '\\' && p[1]) {
            p++;
            if (*p == 'n') out[o++] = '\n';
            else out[o++] = *p;
            p++;
            continue;
        }
        out[o++] = *p++;
    }
    out[o] = 0;
    return 0; /* 未闭合 */
}

/* ── worker（pthread——宿主零驱动；同锁序：G 内领取与发布，计算在锁外） ─────── */

typedef struct { int jid; } WorkerArg;

static void *worker_main(void *argp) {
    int jid = *(int *)argp;
    free(argp);

    pthread_mutex_lock(&g_mu);
    Job *j = (jid >= 1 && jid <= g_next_job) ? &g_jobs[jid - 1] : NULL;
    if (!j || !j->used || j->state != 0) {      /* 领取检查（锁内——协作取消 3 拦截） */
        pthread_mutex_unlock(&g_mu);
        return NULL;
    }
    j->state = 2;
    j->start_ns = mono_ns();
    int kind_fib = j->kind_fib;
    int64_t n = j->n;
    char *txt = j->text ? strdup(j->text) : NULL;
    pthread_mutex_unlock(&g_mu);

    /* 锁外计算 */
    int64_t val = 0;
    char *out = NULL;
    if (kind_fib) {
        if (n <= 1) val = n;
        else {
            int64_t a = 0, b = 1;
            for (int64_t i = 1; i < n; i++) { int64_t c = a + b; a = b; b = c; }
            val = b;                          /* 迭代 fib——同结果（无递归爆栈风险） */
        }
    } else {
        out = txt ? strdup(txt) : strdup("");
    }
    int64_t end = mono_ns();

    pthread_mutex_lock(&g_mu);
    if (j->state == 2) {                      /* 未被取消才发布 */
        j->value = val;
        if (out) { free(j->out); j->out = out; } else if (txt) { free(j->out); j->out = NULL; }
        j->end_ns = end;
        j->state = 1;
        if (g_done_n < MAX_JOBS) g_done_or[g_done_n++] = jid;
    }
    pthread_mutex_unlock(&g_mu);
    free(txt);
    return NULL;
}

/* ── dispatch ──────────────────────────────────────────────────────────────── */

static int dispatch(const char *m, const char *p, char *out, size_t cap) {
    /* echo：原样直通（不解析） */
    if (strcmp(m, "echo") == 0) {
        snprintf(out, cap, "%s", p);
        return 1;
    }

    pthread_mutex_lock(&g_mu);

    int ok = 0;
    int64_t iv = 0;

    if (strcmp(m, "rev") == 0 || strcmp(m, "len") == 0) {
        /* R107 隔离验证件：方法面刻意与其他内核不同（smoke "没有 fib" 断言的牙） */
        char text[4096] = {0};
        if (!json_str(p, "text", text, sizeof(text))) {
            snprintf(g_err, sizeof(g_err), "%s: params need string field text", m);
        } else if (m[0] == 'r') {
            size_t n = strlen(text);
            char *r = malloc(n + 1);
            if (!r) snprintf(g_err, sizeof(g_err), "OOM");
            else {
                for (size_t i = 0; i < n; i++) r[i] = text[n - 1 - i];
                r[n] = 0;
                snprintf(out, cap, "{\"text\":\"%s\"}", r);
                free(r);
                ok = 1;
            }
        } else {
            snprintf(out, cap, "{\"len\":%zu}", strlen(text));
            ok = 1;
        }
    } else if (strcmp(m, "add") == 0) {
        int64_t a, b;
        if (json_int(p, "a", &a) && json_int(p, "b", &b)) {
            snprintf(out, cap, "{\"sum\":%lld", (long long)(a + b));
            strncat(out, "}", cap - strlen(out) - 1);
            ok = 1;
        } else snprintf(g_err, sizeof(g_err), "add: params need integer fields a and b");
    } else if (strcmp(m, "error") == 0) {
        snprintf(g_err, sizeof(g_err), "error: forced failure for testing");
    } else if (strcmp(m, "agent.spawn") == 0) {
        char name[NAME_CAP] = {0};
        int has = json_str(p, "name", name, sizeof(name));
        if (g_next_agent >= MAX_AGENTS) snprintf(g_err, sizeof(g_err), "agent.spawn: registry full (%d)", MAX_AGENTS);
        else {
            g_next_agent++;
            int id = g_next_agent;
            Agent *a = &g_agents[id - 1];
            memset(a, 0, sizeof(*a));
            a->used = 1;
            if (has && name[0]) snprintf(a->name, sizeof(a->name), "%s", name);
            else snprintf(a->name, sizeof(a->name), "agent-%d", id);
            g_order[g_order_n++] = id;
            char escn[NAME_CAP * 2];
            esc_into(escn, sizeof(escn), a->name);
            snprintf(out, cap, "{\"id\":%d,\"name\":\"%s\",\"state\":\"idle\"}", id, escn);
            ok = 1;
        }
    } else if (strcmp(m, "agent.list") == 0) {
        size_t o = (size_t)snprintf(out, cap, "{\"count\":%d,\"agents\":[", g_order_n);
        for (int i = 0; i < g_order_n; i++) {
            int id = g_order[i];
            char escn[NAME_CAP * 2];
            esc_into(escn, sizeof(escn), g_agents[id - 1].name);
            o += (size_t)snprintf(out + o, cap - o, "%s{\"id\":%d,\"name\":\"%s\",\"state\":\"idle\"}",
                                  i ? "," : "", id, escn);
        }
        snprintf(out + o, cap - o, "]}");
        ok = 1;
    } else if (strcmp(m, "agent.send") == 0) {
        int64_t id; char text[1024] = {0};
        if (!json_int(p, "id", &id)) snprintf(g_err, sizeof(g_err), "agent.send: params need integer id and string text");
        else if (!json_str(p, "text", text, sizeof(text))) snprintf(g_err, sizeof(g_err), "agent.send: params need integer id and string text");
        else if (id < 1 || id > g_next_agent || !g_agents[id - 1].used) snprintf(g_err, sizeof(g_err), "agent.send: no agent id=%lld", (long long)id);
        else {
            Agent *a = &g_agents[id - 1];
            if (a->box_n >= BOX_CAP) snprintf(g_err, sizeof(g_err), "agent.send: mailbox full (%d)", BOX_CAP);
            else {
                a->box[a->box_n++] = strdup(text);
                snprintf(out, cap, "{\"queued\":%d}", a->box_n);
                ok = 1;
            }
        }
    } else if (strcmp(m, "agent.poll") == 0) {
        int64_t id;
        if (!json_int(p, "id", &id)) snprintf(g_err, sizeof(g_err), "agent.poll: params need integer id");
        else if (id < 1 || id > g_next_agent || !g_agents[id - 1].used) snprintf(g_err, sizeof(g_err), "agent.poll: no agent id=%lld", (long long)id);
        else {
            Agent *a = &g_agents[id - 1];
            size_t o = (size_t)snprintf(out, cap, "{\"messages\":[");
            for (int i = 0; i < a->box_n; i++) {
                char escm[1024 * 2];
                esc_into(escm, sizeof(escm), a->box[i]);
                o += (size_t)snprintf(out + o, cap - o, "%s\"%s\"", i ? "," : "", escm);
                free(a->box[i]);
            }
            snprintf(out + o, cap - o, "],\"drained\":%d}", a->box_n);
            a->box_n = 0;
            ok = 1;
        }
    } else if (strcmp(m, "agent.kill") == 0) {
        int64_t id;
        if (!json_int(p, "id", &id)) snprintf(g_err, sizeof(g_err), "agent.kill: params need integer id");
        else if (id < 1 || id > g_next_agent || !g_agents[id - 1].used) snprintf(g_err, sizeof(g_err), "agent.kill: no agent id=%lld", (long long)id);
        else {
            char escn[NAME_CAP * 2];
            esc_into(escn, sizeof(escn), g_agents[id - 1].name);
            snprintf(out, cap, "{\"killed\":\"%s\"}", escn);
            /* 从 spawn 序移除 */
            int w = 0;
            for (int i = 0; i < g_order_n; i++) if (g_order[i] != (int)id) g_order[w++] = g_order[i];
            g_order_n = w;
            for (int b = 0; b < g_agents[id - 1].box_n; b++) free(g_agents[id - 1].box[b]);
            g_agents[id - 1].used = 0;
            ok = 1;
        }
    } else if (strcmp(m, "agent.submit") == 0) {
        int64_t id; char kind[16] = {0};
        if (!json_int(p, "id", &id) || !json_str(p, "kind", kind, sizeof(kind)))
            snprintf(g_err, sizeof(g_err), "agent.submit: params need integer id and string kind");
        else if (strcmp(kind, "fib") != 0 && strcmp(kind, "echo") != 0)
            snprintf(g_err, sizeof(g_err), "agent.submit: kind must be fib or echo, got %s", kind);
        else if (id < 1 || id > g_next_agent || !g_agents[id - 1].used)
            snprintf(g_err, sizeof(g_err), "agent.submit: no agent id=%lld", (long long)id);
        else {
            int64_t n = 0;
            json_int(p, "n", &n);
            char text[1024] = {0};
            json_str(p, "text", text, sizeof(text));
            if (strcmp(kind, "fib") == 0 && (n < 0 || n > 40))
                snprintf(g_err, sizeof(g_err), "agent.submit: n out of range [0,40], got %lld", (long long)n);
            else if (g_next_job >= MAX_JOBS) snprintf(g_err, sizeof(g_err), "agent.submit: job table full (%d)", MAX_JOBS);
            else {
                g_next_job++;
                Job *j = &g_jobs[g_next_job - 1];
                memset(j, 0, sizeof(*j));
                j->used = 1;
                j->kind_fib = strcmp(kind, "fib") == 0;
                j->n = n;
                j->text = strdup(text);
                j->state = 0;
                int *jid = malloc(sizeof(int));
                *jid = g_next_job;
                pthread_t th;
                if (pthread_create(&th, NULL, worker_main, jid) == 0) pthread_detach(th);
                else { free(jid); snprintf(g_err, sizeof(g_err), "agent.submit: pthread_create failed"); j->used = 0; g_next_job--; }
                if (j->used) {
                    snprintf(out, cap, "{\"jobId\":%d,\"state\":\"pending\"}", g_next_job);
                    ok = 1;
                }
            }
        }
    } else if (strcmp(m, "agent.result") == 0) {
        int64_t jid;
        if (!json_int(p, "jobId", &jid)) snprintf(g_err, sizeof(g_err), "agent.result: params need integer jobId");
        else if (jid < 1 || jid > g_next_job || !g_jobs[jid - 1].used) snprintf(g_err, sizeof(g_err), "agent.result: no job id=%lld", (long long)jid);
        else {
            Job *j = &g_jobs[jid - 1];
            if (j->state == 1) {                /* done——显式认领（坑 105 纪律） */
                if (j->kind_fib) snprintf(out, cap, "{\"state\":\"done\",\"value\":%lld}", (long long)j->value);
                else {
                    char escm[2048];
                    esc_into(escm, sizeof(escm), j->out ? j->out : "");
                    snprintf(out, cap, "{\"state\":\"done\",\"text\":\"%s\"}", escm);
                }
                ok = 1;
            } else if (j->state == 3) { snprintf(out, cap, "{\"state\":\"cancelled\"}"); ok = 1; }
            else { snprintf(out, cap, "{\"state\":\"pending\"}"); ok = 1; }
        }
    } else if (strcmp(m, "agent.cancel") == 0) {
        int64_t jid;
        if (!json_int(p, "jobId", &jid)) snprintf(g_err, sizeof(g_err), "agent.cancel: params need integer jobId");
        else if (jid < 1 || jid > g_next_job || !g_jobs[jid - 1].used) snprintf(g_err, sizeof(g_err), "agent.cancel: no job id=%lld", (long long)jid);
        else {
            Job *j = &g_jobs[jid - 1];
            if (j->state == 0) { j->state = 3; snprintf(out, cap, "{\"cancelled\":\"pending\"}"); ok = 1; }
            else if (j->state == 3) { snprintf(out, cap, "{\"cancelled\":\"pending\"}"); ok = 1; }
            else if (j->state == 1) { snprintf(out, cap, "{\"cancelled\":\"none\",\"state\":\"done\"}"); ok = 1; }
            else { snprintf(out, cap, "{\"cancelled\":\"none\",\"state\":\"in-flight\"}"); ok = 1; }
        }
    } else if (strcmp(m, "agent.timings") == 0) {
        size_t o = (size_t)snprintf(out, cap, "{\"n\":%d,\"t\":[", g_done_n);
        for (int i = 0; i < g_done_n; i++) {
            Job *j = &g_jobs[g_done_or[i] - 1];
            o += (size_t)snprintf(out + o, cap - o, "%s[%lld,%lld]", i ? "," : "",
                                  (long long)j->start_ns, (long long)j->end_ns);
        }
        snprintf(out + o, cap - o, "]}");
        ok = 1;
    } else {
        snprintf(g_err, sizeof(g_err), "unknown method: %s", m);
    }

    pthread_mutex_unlock(&g_mu);
    return ok;
}

/* ── C ABI 六核心 + typed + 版本 ───────────────────────────────────────────── */

static int do_init(const char *config) {
    (void)config;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < MAX_AGENTS; i++) {
        for (int b = 0; b < g_agents[i].box_n; b++) free(g_agents[i].box[b]);
        memset(&g_agents[i], 0, sizeof(Agent));
    }
    for (int i = 0; i < MAX_JOBS; i++) {
        if (g_jobs[i].text) free(g_jobs[i].text);
        if (g_jobs[i].out) free(g_jobs[i].out);
        memset(&g_jobs[i], 0, sizeof(Job));
    }
    g_next_agent = 0; g_order_n = 0;
    g_next_job = 0; g_done_n = 0;
    g_init = 1;
    g_err[0] = 0;
    pthread_mutex_unlock(&g_mu);
    return 0;
}

/* 坑 108（多内核同名符号）：shutdown 自引用必须走 static 绑定——RTLD_GLOBAL 下
 * 导出符号 kernel_init 在全局表中被后加载内核（仓颉）胜出，PLT 调用会跳进别人的
 * kernel_init(NULL) → SIGSEGV。static do_init = 本地绑定，不参与全局符号解析。 */
__attribute__((visibility("default")))
int kernel_init(const char *config) { return do_init(config); }

__attribute__((visibility("default")))
int kernel_shutdown(void) { return do_init(NULL); }

__attribute__((visibility("default")))
int kernel_ping(void) { return g_init ? 0 : -1; }

__attribute__((visibility("default")))
const char *kernel_call(const char *method, const char *params) {
    static char out[8192];
    if (!dispatch(method, params, out, sizeof(out))) return NULL;
    return strdup(out);        /* 内核分配（strdup=libc malloc）→ 宿主 kernel_free */
}

__attribute__((visibility("default")))
void kernel_free(void *ptr) { free(ptr); }

__attribute__((visibility("default")))
const char *kernel_last_error(void) { return g_err; }

__attribute__((visibility("default")))
int kernel_abi_version(void) { return 10001; }

__attribute__((visibility("default")))
int64_t kernel_add(int64_t a, int64_t b) { return a + b; }

__attribute__((visibility("default")))
const char *kernel_echo(const char *input) { return strdup(input); }
