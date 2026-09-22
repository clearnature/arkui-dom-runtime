/*
 * securec 兼容头（ glue，非 Huawei 原件）。
 *
 * arkui_qrcodegen 的源码按 OHOS 编码规范使用 securec 的 memset_s / memcpy_s。本运行时的
 * vendor 构建（见 ../build.sh）不在 OHOS libc 环境里，这里按 securec 的公开函数签名
 * （GB/T 32907 / Huawei securec 文档）提供同语义的最小兼容实现——只做参数搬运，不碰
 * 编码器算法；算法本体是 src/ 下逐字复制的真机源码。
 */
#ifndef __ARKUI_QRCODEGEN_SECUREC_H__
#define __ARKUI_QRCODEGEN_SECUREC_H__

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int errno_t;

errno_t memset_s(void *dest, size_t destMax, int c, size_t count);
errno_t memcpy_s(void *dest, size_t destMax, const void *src, size_t count);
errno_t memmove_s(void *dest, size_t destMax, const void *src, size_t count);

#ifdef __cplusplus
}
#endif

#endif /* __ARKUI_QRCODEGEN_SECUREC_H__ */
