/*
 * Electron preload：把 Node 的真实文件系统经 contextBridge 暴露给渲染进程。
 *
 * 为什么需要它：浏览器/渲染进程本身没有 fs，而 `@ohos:file.fs` 的语义是【落盘持久化】。
 * 用内存 Map 冒充 file.fs 会导致进程退出数据即丢——那不是文件系统。
 * 这里把应用侧的虚拟路径（/vfs/files/x）映射到本目录下的真实目录，写的就是磁盘文件。
 *
 * 渲染进程侧拿到的是 __arkui_dom_nodeFs，由 runtime/ohos-shims.js 的 file.fs 后端使用。
 * 返回/入参都是可结构化克隆的原始类型，符合 contextBridge 限制。
 *
 * R74 落盘根按打包态条件化：
 *   · 未打包（app.isPackaged === false，开发/测试态）→ 维持 <electron>/data/ 不变。
 *     run.sh 的 verify_disk 外部核验与 `rm -rf "$HERE/data"` 都依赖这个确定位置，不能动。
 *   · 打包态 → 安装位置只读，落盘根切到 userData/data。
 * preload 拿不到 app，落盘根由主进程决定，经两条通道拿到（同一来源，两条都免疫失败）：
 *   ① 同步：main 用 webPreferences.additionalArguments 把终值根带进 process.argv
 *      （runtime/ohos-shims.js 在模块加载时快照 nodeFs.root 作自报，invoke 回包晚于页面
 *      脚本会自报旧根——打包态实测复现过，所以初值必须在 preload 里就同步就位）；
 *   ② 异步：ipcRenderer.invoke('arkui:getUserDataRoot') 向主进程再取一次并缓存
 *      （main.js ipcMain.handle 回答；这是本项目第一个 IPC 能力桥，dialog/wifi 等照此模式接）。
 * 任何失败（无处理器/异常/两路都没给值）都维持默认根——fs 桥初始化绝不能失败。
 */
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let ROOT = path.join(__dirname, 'data');            // 默认/回退根：项目内 electron/data（外部核验依赖）
// ① 同步初值：main 打包态随 additionalArguments 下发 `--arkui-fs-root=<userData>/data`，
//    在本脚本第一行之前就位 → ROOT 从一开始就是终值，页面自报与实际落盘一致；
//    dev 态 main 不下发该参数 → 维持默认根，路径确定，测试确定性不变。
const fromArgv = (process.argv.find((a) => a.startsWith('--arkui-fs-root=')) || '').replace('--arkui-fs-root=', '');
if (fromArgv) ROOT = fromArgv;
// ② 异步复核：启动取一次并缓存。dev 态主进程回 null → 维持现状；打包态回 userData → 拼 /data。
//    与 ① 同源，正常情况两者一致；①缺失时这里兜底补正。
ipcRenderer
  .invoke('arkui:getUserDataRoot')
  .then((userDataRoot) => {
    if (typeof userDataRoot === 'string' && userDataRoot) ROOT = path.join(userDataRoot, 'data');
  })
  .catch(() => { /* 回退：维持当前根，绝不让 fs 桥初始化失败 */ });

const toReal = (vpath) => path.join(ROOT, String(vpath).replace(/^\/vfs\/?/, ''));

const ensureDir = (real) => fs.mkdirSync(path.dirname(real), { recursive: true });

contextBridge.exposeInMainWorld('__arkui_dom_nodeFs', {
  kind: 'node-fs',
  // getter：跨桥按访问时机求值，ROOT 被 IPC 结果覆盖后这里给的是当前根（ohos-shims 快照的也是最新值）
  get root() { return ROOT; },
  existsSync: (p) => fs.existsSync(toReal(p)),
  readTextSync: (p) => fs.readFileSync(toReal(p), 'utf8'),
  writeTextSync: (p, c) => { ensureDir(toReal(p)); fs.writeFileSync(toReal(p), String(c)); return String(c).length; },
  appendTextSync: (p, c) => { ensureDir(toReal(p)); fs.appendFileSync(toReal(p), String(c)); return String(c).length; },
  truncateSync: (p) => { ensureDir(toReal(p)); fs.writeFileSync(toReal(p), ''); },
  mkdirSync: (p) => { fs.mkdirSync(toReal(p), { recursive: true }); },
  unlinkSync: (p) => { fs.unlinkSync(toReal(p)); },
  statSync: (p) => {
    const s = fs.statSync(toReal(p));
    return { size: s.size, isDirectory: s.isDirectory(), isFile: s.isFile() };
  },
  listSync: (p) => fs.readdirSync(toReal(p)),
  // 仅供测试核验：返回根目录的真实路径
  realPathOf: (p) => toReal(p),
});

// ── 窗口能力桥（R80，@ohos:window 的 Electron 侧）──
// 与 fs 桥同约定：可结构化克隆入参/返回，失败免疫（invoke 拒绝时返回 false，渲染侧记 warning）。
// 事件（windowSizeChange）走主进程 push：main 在 'resize' 里 webContents.send，这里转发给页面。
contextBridge.exposeInMainWorld('electronAPI', {
  /** @param {string} op @param {...any} args */
  windowOp: async (op, ...args) => {
    try { return await ipcRenderer.invoke('arkui:window:op', op, ...args); }
    catch (e) { return false; }
  },
  onWindowSizeChange: (cb) => {
    ipcRenderer.on('arkui:window:resized', (_e, size) => { try { cb(size); } catch (err) {} });
  },
  // R82：文件对话框（@ohos:file.picker 的 Electron 侧）。可结构化克隆 options/返回，
  // 失败免疫（catch 返回 {canceled:true}——与真机"用户取消"语义同形，渲染侧无需区分错误）。
  fileDialog: async (kind, options) => {
    try { return await ipcRenderer.invoke('arkui:dialog:' + kind, options); }
    catch (e) { return { canceled: true, filePaths: [], uri: null }; }
  },
});
