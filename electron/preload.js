/*
 * Electron preload：把 Node 的真实文件系统经 contextBridge 暴露给渲染进程。
 *
 * 为什么需要它：浏览器/渲染进程本身没有 fs，而 `@ohos:file.fs` 的语义是【落盘持久化】。
 * 用内存 Map 冒充 file.fs 会导致进程退出数据即丢——那不是文件系统。
 * 这里把应用侧的虚拟路径（/vfs/files/x）映射到本目录下的真实目录，写的就是磁盘文件。
 *
 * 渲染进程侧拿到的是 __arkui_dom_nodeFs，由 runtime/ohos-shims.js 的 file.fs 后端使用。
 * 返回/入参都是可结构化克隆的原始类型，符合 contextBridge 限制。
 */
const { contextBridge } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'data');            // 真实落盘根目录（项目内，便于外部核验）
const toReal = (vpath) => path.join(ROOT, String(vpath).replace(/^\/vfs\/?/, ''));

const ensureDir = (real) => fs.mkdirSync(path.dirname(real), { recursive: true });

contextBridge.exposeInMainWorld('__arkui_dom_nodeFs', {
  kind: 'node-fs',
  root: ROOT,
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
