#include <HsFFI.h>
#if defined(__cplusplus)
extern "C" {
#endif
extern HsInt32 kernel_init(HsPtr a1);
extern HsInt32 kernel_shutdown(void);
extern HsInt32 kernel_ping(void);
extern HsPtr kernel_call(HsPtr a1, HsPtr a2);
extern void kernel_free(HsPtr a1);
extern HsPtr kernel_last_error(void);
extern HsInt64 kernel_add(HsInt64 a1, HsInt64 a2);
extern HsPtr kernel_echo(HsPtr a1);
extern HsInt32 kernel_abi_version(void);
#if defined(__cplusplus)
}
#endif

