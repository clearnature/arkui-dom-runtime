/*
 * kernel/c-sample/kernel.c — 纯 C 样例内核（R107；R112 增类型化直调符号）
 *
 * 目的：实证 kernel/shared/protocol/kernel_abi.h 的多语言声明——与仓颉内核
 * （kernel/cangjie/）实现同一契约、同进程共存、宿主零改动。它是「第二语言内核」
 * 的参考实现骨架。
 *
 * 方法面（刻意与仓颉内核不同，用于互不串扰验证）：
 *   rev  → {"text":"abc"} → {"text":"cba"}   字节反转（ASCII 域；多字节会乱序——
 *                                             样例内核不做 UTF-8 处理，边界如实）
 *   len  → {"text":"abc"} → {"len":3}        字节长度
 *
 * 类型化直调（R112 可选符号）：kernel_add(int64,int64) / kernel_echo(const char*)
 * 与仓颉内核同名同签名——三份实现符号表一致（nm -D 对比可见）。
 *
 * 编译：bash kernel/c-sample/build.sh（= gcc -shared -fPIC -O2）
 * 无任何运行时依赖（不 dlopen、不带 RT），宿主 cjkInitK 槽名+rtLib 传空串即可挂载。
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_init = 0;
static char g_err[256] = {0};

__attribute__((visibility("default")))
int kernel_init(const char *config) {
    (void)config;
    g_init = 1;
    g_err[0] = '\0';
    return 0;
}

__attribute__((visibility("default")))
int kernel_shutdown(void) {
    g_init = 0;
    return 0;
}

__attribute__((visibility("default")))
int kernel_ping(void) {
    return g_init ? 0 : -1;
}

__attribute__((visibility("default")))
const char *kernel_last_error(void) {
    return g_err;
}

__attribute__((visibility("default")))
void kernel_free(void *ptr) {
    free(ptr);
}

/* 反转字符串到新缓冲（含结尾 NUL） */
static char *rev_dup(const char *s) {
    size_t n = strlen(s);
    char *out = (char *)malloc(n + 1);
    if (!out) return NULL;
    for (size_t i = 0; i < n; i++) out[i] = s[n - 1 - i];
    out[n] = '\0';
    return out;
}

/* 极简 JSON 字符串值提取：找 "key":" 之后到下一个 '"'（样例级，不处理转义） */
static int json_str(const char *src, const char *key, char *out, size_t cap) {
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\":\"", key);
    const char *p = strstr(src, pat);
    if (!p) return 0;
    p += strlen(pat);
    size_t n = 0;
    while (*p && *p != '"' && n + 1 < cap) out[n++] = *p++;
    out[n] = '\0';
    return *p == '"';
}

__attribute__((visibility("default")))
const char *kernel_call(const char *method, const char *params) {
    if (!g_init) {
        snprintf(g_err, sizeof(g_err), "kernel not initialized (call kernel_init first)");
        return NULL;
    }
    if (strcmp(method, "rev") == 0 || strcmp(method, "len") == 0) {
        char text[4096];
        if (!json_str(params, "text", text, sizeof(text))) {
            snprintf(g_err, sizeof(g_err), "%s: params need string field text", method);
            return NULL;
        }
        static char out[8192];
        if (method[0] == 'r') {
            char *r = rev_dup(text);
            if (!r) { snprintf(g_err, sizeof(g_err), "OOM"); return NULL; }
            snprintf(out, sizeof(out), "{\"text\":\"%s\"}", r);
            free(r);
        } else {
            snprintf(out, sizeof(out), "{\"len\":%zu}", strlen(text));
        }
        return strdup(out);
    }
    snprintf(g_err, sizeof(g_err), "unknown method: %s", method);
    return NULL;
}

/* R112：类型化直调符号（与仓颉内核同名同签名；宿主 dlsym 探测，缺席回落 JSON 口） */
__attribute__((visibility("default")))
int64_t kernel_add(int64_t a, int64_t b) {
    return a + b;
}

__attribute__((visibility("default")))
const char *kernel_echo(const char *input) {
    size_t n = strlen(input);
    char *out = (char *)malloc(n + 1);
    if (!out) return NULL;
    memcpy(out, input, n + 1);
    return out;
}
