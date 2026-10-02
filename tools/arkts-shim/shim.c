/*
 * libshared_libz.so 垫片 —— 补齐 HarmonyOS CLT 里 previewer/ark 工具缺失的库
 * （vendor 自 /data/training/cli/arkts-shim/shim.c，逐字节同源；R159.3 起 AOT
 *   编译检查在 CI 使用，见 .github/workflows/ubuntu-ohos.yml 的 AOT 步）
 *
 * 背景：CLT 26.0.0.821 的 previewer/common/bin 与 ets-loader/bin/ark/build/bin 下的
 * 大量 .so 依赖名为 libshared_libz.so 的库，但该文件在 CLT 中根本不存在。
 * 分析符号后确认它 = zlib + minizip 的合并库（宿主 Linux 版）。
 *
 * 做法：本垫片自身不需要实现 zlib/minizip 的主体 API，只需
 *   1) 链接系统 libz.so.1 与 libminizip.so.1（作为 NEEDED 载入进程全局符号域，
 *      这样消费者未定义的 inflate/unzOpen/... 即可解析）；
 *   2) 补上系统 libminizip 没有的 3 个符号，转发到经典 minizip 的同义函数。
 *
 * 编译（CI runner 同款）：
 *   gcc -shared -fPIC -o libshared_libz.so shim.c \
 *       -L/usr/lib/x86_64-linux-gnu -Wl,--no-as-needed \
 *       -l:libz.so.1 -l:libminizip.so.1
 *   （需要 apt install libminizip1 提供 libminizip.so.1；libz.so.1 基座自带）
 */

typedef void *unzFile;

extern unzFile unzOpen(const char *path);
extern int unzClose(unzFile file);
extern int unzLocateFile(unzFile file, const char *szFileName, int iCaseSensitivity);

/* minizip-ng 风格：按文件名打开 zip */
unzFile unzOpenFile(const char *path) {
    return unzOpen(path);
}

/* minizip-ng 风格：关闭 zip */
int unzCloseFile(unzFile file) {
    return unzClose(file);
}

/* minizip-ng 风格：按名字定位条目（带大小写敏感开关） */
int unzLocateFile2(unzFile file, const char *szFileName, int iCaseSensitivity) {
    return unzLocateFile(file, szFileName, iCaseSensitivity);
}
