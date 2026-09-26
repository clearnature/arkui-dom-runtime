# R72 spike：桌面引擎产物打成分发包 + 进程模型决策

> 2026-09-25。回答一个问题：`electron/` 宿主 + ArkTS→DOM 运行时能不能打成分发包、进程模型怎么定。
> 结论先行：**能**。@electron/packager 与 electron-builder 两条路都打出了 linux x64 分发包，
> 打包后零源码改动，perfdemo 断言页 `ELECTRON_RESULT: PASS`（exit 0）。
> 打包工具全部经 `npx` 临时使用，未写进任何 package.json 依赖（项目纪律不变）。
> 环境仓库：Electron v44.2.0（`~/.cache/electron/<hash>/electron-v44.2.0-linux-x64.zip`，122,996,717 B），node v26.9.0，npm registry = npmmirror（npx 可用）。

## 1. 现状进程模型（读 electron/main.js / preload.js / package.json）

| 层 | 文件 | 职责 | 关键事实 |
|---|---|---|---|
| 主进程 | `electron/main.js` | 窗口生命周期 + 驱动断言页 | 命令行开关（`disable-gpu`、`disable-software-rasterizer-fallback`、`autoplay-policy=no-user-gesture-required`、`app.disableHardwareAcceleration()`）；加载页面（默认 `loadFile(../test/<ARKUI_TEST>.html)`，`ARKUI_PAGE_URL` 时 `loadURL`）；轮询 `executeJavaScript('#result')` 到出 `ALL PASS`；截图（capturePage 或 offscreen paint 帧重试取非白占比最高帧）落 `../build/electron-<name>.png`；`ELECTRON_RESULT: PASS/FAIL` 决定退出码。R72 时**没有任何 `ipcMain` 处理器**——主进程只是"测试驱动器"；R74 起新增 1 个（`arkui:getUserDataRoot`，见 §6），也是后续能力桥的模板 |
| preload | `electron/preload.js` | 真 fs 桥 | `contextIsolation:true` + `sandbox:false`（preload 里 `require('node:fs')`）。`contextBridge.exposeInMainWorld('__arkui_dom_nodeFs', {...})`：`kind/root` 元数据 + 9 个**同步**方法（exists/readText/writeText/appendText/truncate/mkdir/unlink/stat/list）+ `realPathOf`（供外部核验）。虚拟路径 `/vfs/x` → `<app>/electron/data/`。**fs 操作全部发生在渲染进程侧的特权上下文，没有走 IPC** |
| 渲染进程 | `test/*.html` + `runtime/*.js` + `build/*.js` | ArkUI→DOM 运行时本体 | 页面相对引用 `../runtime/{generated-components,arkui-dom-runtime,ohos-shims}.js` 与 `../build/<page>-module.js`；`@ohos:file.fs` 垫片消费 `window.__arkui_dom_nodeFs` |
| env 驱动 | run.sh 注入 | 驱动面 | `ARKUI_TEST`（页面名，默认 layout）、`ARKUI_PAGE_URL`（http 模式）、`ARKUI_WAIT_MS`、`ARKUI_CAPTURE_MS`、`ARKUI_OFFSCREEN` |

## 2. 打包适配调查：main.js 需要改吗？

**不需要。** 逐条核对路径来源：

- `pagePath`/`outPng`/`preload` 全部基于 `__dirname` 解析（`../test`、`../build`、同目录 preload）；
- 页面对 `../runtime/*.js`、`../build/*-module.js` 的引用是相对页面自身的；
- preload 落盘根 `electron/data` 也是 `__dirname` 相对。

所以只要打包时保持这份相对布局即可。实测验证（打包产物内）：`file://` 默认模式与 `ARKUI_PAGE_URL` http 模式**都** PASS，env 驱动在打包后原样可用。
一个无害差异记录：`file://` 模式下 perfdemo 的 `performance.getEntriesByType('resource')` 为空（`eval_runtime_ms=-1.0`，无 resource timing），断言不受影响——与 run.sh 选 http 模式的理由同源。

## 3. 打包 spike（staging 全在 /tmp，不污染仓库）

staging 布局（`/tmp/arkui-pkg-staging`，应用体积仅 **2.1M**，Electron 二进制由打包工具注入）：

```
staging/
  package.json        {"name":"arkui-dom-electron","main":"electron/main.js","author":...}
  electron/main.js    electron/preload.js          # 原样复制，零改动
  test/perfdemo.html  test/index.html              # 按需带用例页
  runtime/                                         # 整目录 2.1M（含 vendor/ QRCode 编码器）
  build/perfdemo-module.js  build/app.js           # tools/extract.mjs 的产物
```

### 3.1 三条路径对比

| 路径 | 命令要点 | 产物 | 大小 | perfdemo 验证 |
|---|---|---|---|---|
| ① `@electron/packager` 20.3.0（npx） | `--electron-version=44.2.0 --electron-zip-dir=<本地zip目录> --asar=false` | `arkui-dom-electron-linux-x64/` 目录 | 285M（tar.gz 后 118M） | **PASS，exit 0**（file:// 与 URL 双模式） |
| ② `electron-builder`（npx）`--dir` | 必须加 `-c.directories.buildResources=<别的目录>`，见下方踩坑 | `dist/linux-unpacked/` | 285M | 首次 **FAIL**（见踩坑），修正后 **PASS，exit 0** |
| ②b electron-builder AppImage | 同上 + `--linux AppImage --publish never` | `arkui-dom-desktop-0.1.0.AppImage` 单文件 | 125,625,275 B（约 120M） | 本机无 libfuse2 直跑报 `dlopen libfuse.so.2` 失败；`--appimage-extract-and-run` **PASS，exit 0** |
| ③ 便携 tar（退级方案） | npx 可用所以未启用；对 ① 的产物 `tar czf` | 自包含 tar.gz | 118M | 同 ①（同一目录树） |

体积结论：分发包 = Electron 二进制（283M 解包 / ~117M 压缩）+ 应用 2.1M。压缩后 **118–120M** 是这条线分发包的现实下限。

### 3.2 踩坑记录（证据）

1. **electron-builder 默认吞掉 `build/` 目录**：它把 `build/` 保留为自己的 buildResources 目录并从应用载荷里排除 → 包内没有 `../build/perfdemo-module.js` → 页面 `<script>` 404 → perfdemo 卡在 `running…` → `ELECTRON_RESULT: FAIL`（实测复现：主输出 `running…` + 截图落盘 ENOENT）。修正：`-c.directories.buildResources=no-such-dir -c.files='**/*'`。**对本仓库是实质冲突**：我们的构建产物目录恰好叫 `build/`，走 electron-builder 必须带这两个参数。
2. **packager 的 `--asar=false` 触发警告**（v20 默认 asar=true）：`WARNING: asar parameter set to an invalid value (false), ignoring and disabling asar`——效果等价于关掉 asar（包内是明文 `resources/app/`），但规范写法是 `--no-asar`。
3. **本地 zip 缓存复用**：packager 用 `--electron-zip-dir` 指向一个含 `electron-v44.2.0-linux-x64.zip` 的目录即可零下载打包（本机 zip 在 `~/.cache/electron/<sha>/` 下，做个软链即可）；electron-builder 用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 走国内镜像下载成功。
4. **chrome-sandbox**：打包出的目录与手工解包一样，`chrome-sandbox` 没有 root:4755 → 必须带 `--no-sandbox` 启动（与 `electron/run.sh` 现状一致）。正式分发要么 postinst 设 setuid，要么明确文档化 `--no-sandbox`。
5. **AppImage 需要 FUSE**：本机无 libfuse2，直跑失败；`--appimage-extract-and-run` 可跑通（解压自运行，失去单文件免解压优势）。目标机器需装 libfuse2 或统一用 `--appimage-extract-and-run`。

### 3.3 可工作方案复现命令

```bash
# 0) staging（/tmp，不污染仓库）
R=/data/training/cli/arkui-dom-runtime; S=/tmp/arkui-pkg-staging
mkdir -p $S/electron $S/test $S/build
cp $R/electron/main.js $R/electron/preload.js $S/electron/
cp $R/test/perfdemo.html $R/test/index.html $S/test/
cp -r $R/runtime $S/runtime
cp $R/build/perfdemo-module.js $R/build/app.js $S/build/
cat > $S/package.json <<'EOF'
{"name":"arkui-dom-electron","productName":"arkui-dom-desktop","version":"0.1.0",
 "description":"ArkTS->DOM runtime desktop","main":"electron/main.js",
 "private":true,"author":"arkui-dom-runtime spike"}
EOF

# 1) packager 路（零下载：把缓存里的 zip 软链进一个目录）
mkdir -p /tmp/arkui-electron-zips
ln -sf ~/.cache/electron/e71119b693128a03929bf5e755df56603f029607147c8d8c878eaab9ab75093c/electron-v44.2.0-linux-x64.zip \
       /tmp/arkui-electron-zips/electron-v44.2.0-linux-x64.zip
cd /tmp && npx --yes @electron/packager $S arkui-dom-electron \
  --platform=linux --arch=x64 --electron-version=44.2.0 \
  --electron-zip-dir=/tmp/arkui-electron-zips --asar=false \
  --out=/tmp/arkui-pkg-out --overwrite

# 2) 启动验证（env 驱动打包后原样可用）
cd /tmp/arkui-pkg-out/arkui-dom-electron-linux-x64
ARKUI_TEST=perfdemo ARKUI_OFFSCREEN=1 ./arkui-dom-electron --no-sandbox --disable-gpu
#  → === ALL PASS (3) === … ELECTRON_RESULT: PASS（exit 0）
```

electron-builder 路只需把第 1 步换成：

```bash
cd $S && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  npx --yes electron-builder --linux --dir \
  -c.electronVersion=44.2.0 -c.appId=dev.arkui.desktop -c.productName=arkui-dom-desktop \
  -c.asar=false -c.directories.buildResources=no-such-dir -c.files='**/*'
# AppImage：把 --dir 换成 --linux AppImage --publish never（产物 ~120M，运行加 --appimage-extract-and-run）
```

## 4. 进程模型决策建议

已定并保持：**`@ohos.file.fs` 走 preload 真 fs 桥**（同步语义 + 真落盘 + 可外部核验，本 spike 证明它随包分发无障碍）。
分类清单（后续 @ohos 能力接进来时按此定方向，未实现）：

**A. 必须走 IPC（主进程执行）**

- 特权/系统能力：wifi、蓝牙、剪贴板写、窗口全屏/托盘/全局快捷键/开机自启；
- `@ohos.file.picker` 类文件选择 → 主进程 `dialog.showOpenDialog`；
- 任意路径的 fs（越出当前 `electron/data` 虚拟根的）→ 必须挪主进程做路径校验，不能让渲染进程裸持 fs；
- `@ohos.process`/子进程类 → `child_process` 只应在主进程（preload 技术上能 require，但纪律上不走）；
- 需要进程级生命周期的：`@ohos.app.ability` 的 ability 生命周期 → 映射主进程 `app` 事件后经 IPC 通知渲染侧。

**B. 留在渲染进程（现状 preload 桥或纯 Web 能力即可）**

- `file.fs` 当前形态：同步、小文件、限定虚拟根——preload 桥语义最贴合 ArkTS 同步 API，不动；
- `preferences`（已落盘到 fs 桥之上）、`@ohos.net.http`（fetch 同源即可，http 模式下与浏览器一致）、canvas/媒体/动画等 DOM 能力。

**C. 安全边界注意（随分发包成立而变重要）**

- `sandbox:false` 是 fs 桥的前提（preload 要 `require('node:fs')`），等于放弃渲染进程沙箱；包分发后建议：页面来源收敛为应用自带文件（不加载远程内容），asar 开启（packager v20/builder 默认）防篡改；
- 可写位置适配：**fs 落盘根已实现（R74）**——未打包（`app.isPackaged === false`，开发/测试态）维持 `electron/data/` 不变（`verify_disk` 外部核验与 `rm -rf "$HERE/data"` 语义原样保留，这是测试确定性的底线）；打包态切到 `app.getPath('userData')/data`。preload 拿不到 app，经 `ipcMain.handle('arkui:getUserDataRoot')` + `additionalArguments` 同步下发取根，实现要点与模板见 §6。打包态实测：realfs / netfile 两阶段全 PASS，写入落在 `~/.config/<productName>/data/`，包内不再产生 `electron/data`。`outPng`（`../build/` 截图）仍写应用目录——它只服务测试驱动，不随断言页分发，暂不动。

## 5. 本 spike 产物清单

- 分发包（/tmp，未入库）：`/tmp/arkui-pkg-out/arkui-dom-electron-linux-x64/`（packager，285M）、`/tmp/arkui-pkg-staging/dist/linux-unpacked/`（builder，285M）、`/tmp/arkui-pkg-staging/dist/arkui-dom-desktop-0.1.0.AppImage`（120M）、`/tmp/arkui-dom-desktop-linux-x64.tar.gz`（118M）。
- 仓库内新增：仅本文档。未改 runtime/ 源码，未改 package.json 依赖，未 commit。
- 退级方案 tools/package-app.sh 未启用（npx 网络可用；如需离线打包，对 §3.3 第 1 步产物 tar 即可，见 §3.1 ③）。

## 6. R74：fs 落盘根 userData 化（已实现）+ IPC 参考实现模式

> §4-C"可写位置适配"落地记录。改动只有 `electron/main.js` 与 `electron/preload.js` 两个文件；
> 测试页（test/realfs.html、test/netfile.html）、electron/run.sh、runtime/ 全部零改动，未打包态回归全绿。

### 6.1 行为定义

| 运行态 | fs 落盘根（`/vfs/x` 映射到哪） | 依据 |
|---|---|---|
| 未打包（开发/测试态，`app.isPackaged === false`） | `<repo>/electron/data/`（与 R74 之前完全一致） | `verify_disk` 外部核验、`rm -rf "$HERE/data"` 从干净态起步的语义、断言计数守门都锚定这个确定路径，不能动 |
| 打包态（`app.isPackaged === true`） | `app.getPath('userData')/data`（Linux 即 `~/.config/<productName>/data`） | 安装位置（如 `/opt`）只读，userData 是 OS 保证可写的归宿 |

### 6.2 改动点

- **main.js**：`ipcMain.handle('arkui:getUserDataRoot', () => app.isPackaged ? app.getPath('userData') : null)`（回 `null` = "维持渲染侧内置默认"）；创建窗口时把终值根随 `webPreferences.additionalArguments` 以 `--arkui-fs-root=<userData>/data` 下发（仅打包态带此参数）。
- **preload.js**：`ROOT` 默认仍是 `path.join(__dirname, 'data')`；①同步读 `process.argv` 里的 `--arkui-fs-root=`，有则立为初值；②`ipcRenderer.invoke('arkui:getUserDataRoot')` 启动取一次并缓存（回非空字符串才覆盖，`null`/异常一律维持现状）；暴露的 `root` 改成 getter，跨桥按访问时机求值，反映当前根。

### 6.3 为什么是两条通道（打包态实测踩出来的）

只走 `invoke` 时有个真实缺陷：`runtime/ohos-shims.js` 在**模块加载时**把 `nodeFs.root` 快照进后端自报（`describe()` 的 root 字段），而 invoke 回包晚于页面脚本执行——打包态实测复现：自报 `root=<包内>/electron/data`（旧）、`realPathOf` 已是 userData（新），写盘落 userData 但自报还是旧根，破坏 realfs 页"自报与实际行为一致"的契约（runtime/ 是禁改区，只能在 preload 侧解决）。`additionalArguments` 在 preload 第一行之前就位，根从起点就是终值，自报与落盘一致；`invoke` 仍保留为运行期正典查询通道（两者同源，一致时无感，缺一时互补）。

### 6.4 IPC 模板（后续 dialog/wifi/picker 等照此接）

1. 主进程：`ipcMain.handle('arkui:<能力>', handler)`，返回可结构化克隆值；未打包/打包差异在 handler 内部消化（回 `null` 表示"维持渲染侧默认行为"）。
2. 渲染侧：`ipcRenderer.invoke('arkui:<能力>')` 取一次并缓存；**对失败免疫**——`.catch` 后走内置回退，渲染侧任何初始化绝不能因 IPC 失败而失败。
3. 需要"渲染进程启动前就生效"的配置：用 `webPreferences.additionalArguments` 同步下发，`invoke` 作为运行期正典通道（见 §6.3）。

### 6.5 实测证据

- 打包态（packager，staging 含 realfs/netfile 页，`~/.cache/electron` 本地 zip 零下载）：
  - `ARKUI_TEST=realfs ./arkui-dom-electron --no-sandbox --disable-gpu` → `ALL PASS`、exit 0，自报 `root=` 与 `realPathOf` 一致为 `~/.config/arkui-dom-desktop/data`；
  - 两阶段 netfile（进程 A `?phase=1` 写盘退出 → 全新进程 B `?phase=2` 读回）双 PASS：`demo.txt`=`hello from arkts`、`pref_persist_probe.json`=`{"marker":"m1"}` 都落在 userData；包内 `resources/app/electron/` 不再出现 `data/`。
- 未打包态回归（R74 改动后）：`electron/run.sh realfs`、`electron/run.sh netfile`（两阶段 + `verify_disk`）零改动全 PASS，根仍是 `electron/data`；浏览器端 `run.sh realfs`、`run.sh persist` 不受影响（不加载 electron/ 任何文件）。
