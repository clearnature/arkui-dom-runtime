/*
 * securec 兼容实现（glue，非 Huawei 原件）。
 *
 * memset_s / memcpy_s / memmove_s 的 securec 语义：目标缓冲上限 destMax 单独传入，
 * count 越界或 dest/src 为空时不出错不写入、返回错误码（编码器调用点对返回值取
 * (void)，但入参全部来自内部已校验的分配结果；这里按规范"越界即拒绝并返回 EINVAL"，
 * 保证最坏情况是"没拷/没清"而不是"越界写"）。
 */
#include "securec.h"

extern "C" {

errno_t memset_s(void *dest, size_t destMax, int c, size_t count)
{
    if (dest == nullptr || destMax == 0) {
        return 22; /* EINVAL */
    }
    if (count > destMax) {
        return 22; /* EINVAL：越界拒绝，不写 */
    }
    unsigned char *p = (unsigned char *)dest;
    for (size_t i = 0; i < count; i++) {
        p[i] = (unsigned char)c;
    }
    return 0;
}

errno_t memcpy_s(void *dest, size_t destMax, const void *src, size_t count)
{
    if (dest == nullptr || src == nullptr || destMax == 0) {
        return 22; /* EINVAL */
    }
    if (count > destMax) {
        return 22; /* EINVAL：越界拒绝，不写 */
    }
    unsigned char *d = (unsigned char *)dest;
    const unsigned char *s = (const unsigned char *)src;
    for (size_t i = 0; i < count; i++) {
        d[i] = s[i];
    }
    return 0;
}

errno_t memmove_s(void *dest, size_t destMax, const void *src, size_t count)
{
    if (dest == nullptr || src == nullptr || destMax == 0) {
        return 22; /* EINVAL */
    }
    if (count > destMax) {
        return 22; /* EINVAL：越界拒绝，不写 */
    }
    unsigned char *d = (unsigned char *)dest;
    const unsigned char *s = (const unsigned char *)src;
    if (d < s) {
        for (size_t i = 0; i < count; i++) {
            d[i] = s[i];
        }
    } else {
        for (size_t i = count; i > 0; i--) {
            d[i - 1] = s[i - 1];
        }
    }
    return 0;
}

} /* extern "C" */
