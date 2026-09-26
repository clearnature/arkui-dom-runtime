/*
 * @ohos:* 平台模块别名层（④⑤⑥）
 *
 * 转换产物里的 `import X from "@ohos:xxx"` 经 CommonJS 转译后变成
 * `require("@ohos:xxx").default`。本文件把这些平台模块按需实现出来。
 *
 * 依赖：必须先加载 runtime/arkui-dom-runtime.js（提供 __arkui_dom_defineOhosModule）。
 * 日志统一记到 __arkui_dom_logs，便于断言与排查。
 *
 * 【持久化原则】文件与偏好必须真实落盘，不能用内存冒充：
 *   · Electron：preload 注入 window.__arkui_dom_nodeFs（Node 真 fs）→ 写的是磁盘文件
 *   · 浏览器：localStorage 后端（同步、跨会话保留）—— 非真实路径，但断电不丢
 */
(function (global) {
  'use strict';

  const logs = (global.__arkui_dom_logs = global.__arkui_dom_logs || []);
  const define = global.__arkui_dom_defineOhosModule;
  if (typeof define !== 'function') {
    throw new Error('请先加载 arkui-dom-runtime.js（缺少 __arkui_dom_defineOhosModule）');
  }

  // ────────── 持久化后端（按优先级）：Node 真 fs（Electron）→ OPFS（浏览器）→ localStorage（兜底） ──────────
  //
  // 为什么浏览器不能用 OPFS 的同步 API：`createSyncAccessHandle()` 只在 Web Worker 内可用，
  // 而主线程又不能 `Atomics.wait` 阻塞 → 无法给同步的 fileIo 提供"同步落盘"。
  // 因此 OPFS 后端采用【写穿镜像 + 异步落盘队列】：
  //   · 启动时异步水合（hydrate）OPFS → 内存镜像
  //   · 同步 API 读写镜像，同时把变更排进落盘队列
  //   · backend.ready 表示水合完成；backend.pending() 可等待落盘队列排空（断言/退出前用）
  const nodeFs = global.__arkui_dom_nodeFs;          // 由 electron/preload.js 注入
  const LS_KEY = 'arkui_vfs_v1';

  function fsErr(code, message) { return Object.assign(new Error(message), { code }); }

  // (1) Electron：Node 真 fs（真磁盘、真路径、同步）
  const nodeBackend = nodeFs
    ? {
        kind: 'node-fs',
        root: nodeFs.root,
        ready: Promise.resolve(),
        pending: () => Promise.resolve(),
        exists: (p) => nodeFs.existsSync(p),
        read: (p) => nodeFs.readTextSync(p),
        write: (p, c) => nodeFs.writeTextSync(p, c),
        append: (p, c) => nodeFs.appendTextSync(p, c),
        mkdir: (p) => nodeFs.mkdirSync(p),
        unlink: (p) => nodeFs.unlinkSync(p),
        stat: (p) => nodeFs.statSync(p),
        list: (p) => nodeFs.listSync(p),
        realPath: (p) => nodeFs.realPathOf(p),
      }
    : null;

  // (2) 浏览器：OPFS（真文件系统存储，落在浏览器管理的磁盘上）
  //
  // 实测坑：在本机 headless Chrome(153) 里 `navigator.storage.getDirectory()` **永不 resolve**
  // （API 存在、isSecureContext 也是 true，但调用挂住）。所以这里必须：
  //   · 水合全程加超时看门狗，绝不把调用方无限挂住
  //   · 超时/失败时【自动降级】到 localStorage，并把原因写进日志
  function makeOpfsBackend(onFail) {
    const files = new Map();                       // vpath -> text（镜像）
    const dirs = new Set(['/vfs', '/vfs/files', '/vfs/cache', '/vfs/temp']);
    let queue = Promise.resolve();
    let readyResolve;
    const ready = new Promise((r) => (readyResolve = r));
    let hydrated = false;

    const parts = (vpath) => vpath.replace(/^\/vfs\/?/, '').split('/').filter(Boolean);
    const leaf = (vpath) => parts(vpath).pop();
    const dirParts = (vpath) => parts(vpath).slice(0, -1);
    const join = (a, b) => (a.endsWith('/') ? a + b : a + '/' + b);
    const getDir = async (ps, create) => {
      let d = await global.navigator.storage.getDirectory();
      for (const p of ps) d = await d.getDirectoryHandle(p, { create: !!create });
      return d;
    };
    const withTimeout = (p, ms, what) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} 超时 ${ms}ms`)), ms)),
    ]);

    (async function hydrate() {
      const HYD_MS = Number(global.__arkui_dom_opfs_timeout_ms || 2500);
      try {
        const walk = async (dir, prefix) => {
          for await (const [name, h] of dir.entries()) {
            const vp = join(prefix, name);
            if (h.kind === 'file') files.set(vp, await (await h.getFile()).text());
            else { dirs.add(vp); await walk(h, vp); }
          }
        };
        const root = await withTimeout(global.navigator.storage.getDirectory(), HYD_MS, 'getDirectory()');
        await withTimeout(walk(root, '/vfs'), HYD_MS, 'walk()');
        hydrated = true;
        logs.push({ t: 'fs.hydrated', backend: 'opfs', files: files.size, dirs: dirs.size });
      } catch (e) {
        logs.push({ t: 'fs.hydrateFailed', backend: 'opfs', message: e.message });
        if (typeof onFail === 'function') onFail(e.message);
      } finally {
        readyResolve();                            // 无论如何都要解除等待，不能挂住调用方
      }
    })();

    const enqueue = (fn) => {
      queue = queue.then(fn).catch((e) => logs.push({ t: 'fs.persistFailed', message: e.message }));
      return queue;
    };
    const persist = (vpath, text) => enqueue(async () => {
      const d = await getDir(dirParts(vpath), true);
      const fh = await d.getFileHandle(leaf(vpath), { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    });
    const removeEntry = (vpath) => enqueue(async () => {
      try { const d = await getDir(dirParts(vpath), false); await d.removeEntry(leaf(vpath)); } catch (_) { /* 已不存在 */ }
    });

    return {
      kind: 'opfs',
      root: 'opfs://<origin>/vfs',
      ready,
      pending: () => queue,
      hydrated: () => hydrated,
      exists: (p) => files.has(p) || dirs.has(p),
      read(p) { if (!files.has(p)) throw fsErr(13900002, `No such file: ${p}`); return files.get(p); },
      write(p, c) { const t = String(c); files.set(p, t); persist(p, t); return t.length; },
      append(p, c) { const t = (files.get(p) || '') + String(c); files.set(p, t); persist(p, t); return String(c).length; },
      mkdir(p) { dirs.add(p); },
      unlink(p) { files.delete(p); removeEntry(p); },
      stat(p) {
        if (files.has(p)) return { size: files.get(p).length, isDirectory: () => false, isFile: () => true };
        if (dirs.has(p)) return { size: 0, isDirectory: () => true, isFile: () => false };
        throw fsErr(13900002, `No such file: ${p}`);
      },
      list(p) {
        const pre = p.replace(/\/$/, '') + '/';
        return [...files.keys()].filter((k) => k.startsWith(pre));
      },
      realPath: (p) => `opfs://<origin>${p}`,
    };
  }

  // (3) 兜底：localStorage（同步、跨会话；仅字符串、有配额）
  function makeLsBackend() {
    const lsRead = () => {
      try { return JSON.parse(global.localStorage.getItem(LS_KEY) || '') || { files: {}, dirs: [] }; }
      catch (_) { return { files: {}, dirs: [] }; }
    };
    const lsWrite = (db) => {
      try { global.localStorage.setItem(LS_KEY, JSON.stringify(db)); }
      catch (e) { logs.push({ t: 'fs.persistFailed', message: e.message }); }
    };
    return {
      kind: 'localStorage',
      root: '(localStorage)',
      ready: Promise.resolve(),
      pending: () => Promise.resolve(),
      exists(p) { const db = lsRead(); return Object.prototype.hasOwnProperty.call(db.files, p) || db.dirs.includes(p); },
      read(p) {
        const db = lsRead();
        if (!Object.prototype.hasOwnProperty.call(db.files, p)) throw fsErr(13900002, `No such file: ${p}`);
        return db.files[p];
      },
      write(p, c) { const db = lsRead(); db.files[p] = String(c); lsWrite(db); return String(c).length; },
      append(p, c) { const db = lsRead(); db.files[p] = (db.files[p] || '') + String(c); lsWrite(db); return String(c).length; },
      mkdir(p) { const db = lsRead(); if (!db.dirs.includes(p)) db.dirs.push(p); lsWrite(db); },
      unlink(p) { const db = lsRead(); delete db.files[p]; lsWrite(db); },
      stat(p) {
        const db = lsRead();
        if (Object.prototype.hasOwnProperty.call(db.files, p)) {
          return { size: db.files[p].length, isDirectory: () => false, isFile: () => true };
        }
        if (db.dirs.includes(p)) return { size: 0, isDirectory: () => true, isFile: () => false };
        throw fsErr(13900002, `No such file: ${p}`);
      },
      list(p) {
        const db = lsRead();
        return Object.keys(db.files).filter((k) => k.startsWith(p.replace(/\/$/, '') + '/'));
      },
      realPath: () => '(localStorage 无真实路径)',
    };
  }

  const hasOpfs = !!(global.navigator && global.navigator.storage && global.navigator.storage.getDirectory);
  // backend 必须是可变绑定：file.fs 的方法通过它取用（可见重赋值）
  let backend;

  // 【确定性选择】—— 不让后端在两次运行之间跳变
  //
  // 为什么默认不启用 OPFS：实测本机 headless Chrome(153) 上 OPFS 的异步链**逐级不稳**
  //   · 全新 profile：getDirectory() OK，但 getFileHandle() 挂住
  //   · 复用 profile：getDirectory()/getFileHandle() OK，但 createWritable() 挂住
  // 若"先试 OPFS、失败降级 localStorage"，就会出现 phase1 落 localStorage、phase2 落 OPFS →
  // 两个后端互不可见 → 跨进程持久化看起来失效（实测踩到）。所以这里改成：
  //   · 默认浏览器后端 = localStorage（同步、确定性、跨会话）
  //   · 想用 OPFS 需显式开启（global.__arkui_dom_force_backend = 'opfs'）
  // 在 OPFS 正常的宿主（真实有头浏览器/特定 flag）里可显式启用。
  const forced = global.__arkui_dom_force_backend || null;
  const opfsRequested = forced === 'opfs' || global.__arkui_dom_enable_opfs === true;
  const switchToLocalStorage = (reason) => {
    backend = makeLsBackend();
    logs.push({ t: 'fs.backendSwitched', to: 'localStorage', reason });
  };

  if (nodeBackend && forced !== 'localStorage') {
    backend = nodeBackend;                                     // Electron：真文件系统，最优
  } else if (opfsRequested && hasOpfs) {
    backend = makeOpfsBackend(switchToLocalStorage);           // 显式启用 OPFS
  } else {
    backend = makeLsBackend();                                 // 浏览器默认
    logs.push({
      t: 'fs.backendSelected', backend: 'localStorage', opfsAvailable: hasOpfs,
      opfsSkipped: hasOpfs && !opfsRequested ? '默认不启用（本机 headless Chrome 实测 OPFS 会挂）' : undefined,
    });
  }

  // ── @ohos:hilog —— 记录日志（支持 %{public}s/%{public}d 的极简替换） ──
  const fmt = (format, args) => {
    let i = 0;
    return String(format).replace(/%\{public\}[sd]/g, () =>
      args && i < args.length ? String(args[i++]) : '');
  };
  const record = (level) => (domain, tag, format, ...args) => {
    logs.push({ t: 'hilog', level, domain, tag, message: fmt(format, args) });
  };
  define('hilog', {
    info: record('info'), error: record('error'), warn: record('warn'),
    debug: record('debug'), fatal: record('fatal'),
    isLoggable: () => true,
  });

  // ── @ohos:app.ability.* ──
  define('app.ability.ConfigurationConstant', {
    ColorMode: { COLOR_MODE_NOT_SET: -1, COLOR_MODE_DARK: 0, COLOR_MODE_LIGHT: 1 },
    Direction: { DIRECTION_NOT_SET: -1, DIRECTION_VERTICAL: 0, DIRECTION_HORIZONTAL: 1 },
  });

  class UIAbility {
    constructor(context) { this.context = context; }
    onCreate(want, launchParam) {}
    onDestroy() {}
    onWindowStageCreate(windowStage) {}
    onWindowStageDestroy() {}
    onForeground() {}
    onBackground() {}
  }
  define('app.ability.UIAbility', UIAbility);
  define('app.ability.AbilityConstant', {
    LaunchReason: { UNKNOWN: 0, START_ABILITY: 1 },
    LastExitReason: { UNKNOWN: 0, NORMAL: 1 },
  });
  define('app.ability.Want', class Want {});

  // ── @ohos:window —— 窗口管理 v1（R80，桌面线）──
  //
  // 权威语义来自 `<CLT>/.../ets/api/@ohos.window.d.ts`（9978 行；本垫片只收桌面主目标的
  // 常用子集）。能力面按 R74 IPC 模板分两侧：
  //   · Electron 主进程：ipcMain.handle('arkui:window:*') 操作 BrowserWindow
  //     （背景色/resize/moveTo/show/hide/destroy/尺寸事件）；
  //   · 渲染进程 preload：ipcRenderer invoke 封装 + 事件用主进程 push（webContents.send）。
  //   · 浏览器端：无主进程 → 探测式降级（R21 先例），方法存在但操作无效并记 warning。
  // 未覆盖 API（setFullScreen/avoidArea/子窗/模态等）按需增补，不预造空壳。
  const windowSizeListeners = new Set();
  let winIpcAvailable = null;   // null=未探测

  const winWarn = (m) => { try { console.warn('[arkui-dom] window.' + m + '：当前宿主不支持（无 Electron 主进程桥）'); } catch (e) {} };

  /** @returns {Promise<boolean>} 主进程窗口桥是否可用（只探测一次） */
  async function probeWindowBridge() {
    if (winIpcAvailable !== null) return winIpcAvailable;
    try {
      winIpcAvailable = !!(globalThis.__arkui_dom_nodeFs && // Electron 形态才有 preload
        typeof globalThis.electronAPI !== 'undefined');
    } catch (e) { winIpcAvailable = false; }
    return winIpcAvailable;
  }

  class WindowShim {
    constructor(id) { this.__winId = id; }
    async setWindowBackgroundColor(color) {
      if (!(await probeWindowBridge())) { winWarn('setWindowBackgroundColor'); return; }
      // css 颜色直传；'#RRGGBBAA' → Electron setBackgroundColor 支持 css 颜色串
      await globalThis.electronAPI.windowOp('setBackgroundColor', color);
    }
    async resize(w, h) {
      if (!(await probeWindowBridge())) { winWarn('resize'); return; }
      await globalThis.electronAPI.windowOp('setSize', Math.round(Number(w) || 0), Math.round(Number(h) || 0));
    }
    async moveTo(x, y) {
      if (!(await probeWindowBridge())) { winWarn('moveTo'); return; }
      await globalThis.electronAPI.windowOp('setPosition', Math.round(Number(x) || 0), Math.round(Number(y) || 0));
    }
    async showWindow() { if (await probeWindowBridge()) await globalThis.electronAPI.windowOp('show'); else winWarn('showWindow'); }
    async minimize() { if (await probeWindowBridge()) await globalThis.electronAPI.windowOp('minimize'); else winWarn('minimize'); }
    async destroy() { if (await probeWindowBridge()) await globalThis.electronAPI.windowOp('destroy'); else winWarn('destroy'); }
    on(type, cb) {
      if (type !== 'windowSizeChange') { winWarn("on('" + type + "')—— v1 只支持 windowSizeChange"); return; }
      windowSizeListeners.add(cb);
    }
    off(type, cb) {
      if (type !== 'windowSizeChange') return;
      windowSizeListeners.delete(cb);
    }
  }

  // 主进程把 resize 事件 push 到渲染侧（preload 转发）；浏览器端永不触发
  if (globalThis.electronAPI && globalThis.electronAPI.onWindowSizeChange) {
    globalThis.electronAPI.onWindowSizeChange((size) => {
      const ev = { type: 'windowSizeChange', width: size.width, height: size.height };
      for (const cb of [...windowSizeListeners]) { try { cb(ev); } catch (e) {} }
    });
  }

  define('window', {
    WindowStage: class WindowStage {},
    Window: WindowShim,
    /** getLastWindow(): Promise<Window> —— 单窗形态恒返回同一实例（Electron 主窗） */
    getLastWindow: async () => new WindowShim('main'),
    /** findWindow(id)：v1 单窗，忽略 id */
    findWindow: async () => new WindowShim('main'),
    /** getTopWindow / getMainWindow 同收敛到主窗 */
    getTopWindow: async () => new WindowShim('main'),
    getMainWindow: async () => new WindowShim('main'),
  });

  // ── @ohos:measure —— 文本测量（R15） ──
  //
  // 权威语义来自 `@ohos.measure.d.ts` 的 JSDoc：
  //   measureText(options): number        —— 【总是量单行】；constraintWidth / maxLines 等布局约束
  //                                          **不影响结果**（原文："Layout constraints in options
  //                                          (constraintWidth, maxLines, and more) do not affect results"）
  //   measureTextSize(options): SizeOptions —— 受约束的宽高，**单位 px**
  //
  // 实现取向：**让浏览器自己做换行，再用 `Range.getClientRects()` 数行数** ——
  // 即"测量真实布局"而不是"按字符宽度累加的模拟"。模拟会和真实渲染分叉（字距、字体回退、
  // 禁则处理都算不准），而这条 API 的用途恰恰是"预算尺寸"，分叉了就白测。
  const measureWarn = (msg) => {
    const w = global.__arkui_dom_layout_warnings;
    if (w && !w.includes(msg)) w.push(msg);
  };
  const dimPx = (v, dflt) => {
    if (v === undefined || v === null) return dflt;
    if (typeof v === 'number') return v;
    const s = String(v);
    if (/^\$r\(|^\{.*id.*\}$/.test(s)) {                 // Resource 引用：没有资源管线
      measureWarn(`@ohos:measure 收到资源引用（${s.slice(0, 24)}…），无法解析，已按默认值处理`);
      return dflt;
    }
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return dflt;
    if (s.trim().endsWith('%')) measureWarn('@ohos:measure 的尺寸/约束收到百分比：离屏测量没有父容器，按像素处理');
    return n;                                            // px 与 vp 一律按 px（与本项目其它地方一致）
  };
  // 离屏宿主：不能用 display:none（那样没有布局，量出来全是 0）
  const measureHost = () => {
    let host = document.getElementById('__arkui_measure_host');
    if (!host) {
      host = document.createElement('div');
      host.id = '__arkui_measure_host';
      host.style.position = 'absolute';
      host.style.left = '-100000px';
      host.style.top = '0';
      host.style.visibility = 'hidden';
      host.style.pointerEvents = 'none';
      document.body.appendChild(host);
    }
    return host;
  };
  const FONT_STYLE = { 0: 'normal', 1: 'italic' };
  const FONT_WEIGHT = { 0: 'lighter', 1: 'normal', 2: 'normal', 3: 'normal', 4: 'normal', 5: '500', 6: '600', 7: 'bold', 8: 'bolder', 9: 'bold' };
  const fontCssOf = (o) => {
    const size = dimPx(o.fontSize, 16);
    let weight = o.fontWeight === undefined ? 'normal' : (typeof o.fontWeight === 'number' ? (FONT_WEIGHT[o.fontWeight] || String(o.fontWeight)) : String(o.fontWeight));
    const style = typeof o.fontStyle === 'number' ? (FONT_STYLE[o.fontStyle] || 'normal') : (o.fontStyle || 'normal');
    const family = o.fontFamily ? String(o.fontFamily) : 'sans-serif';
    return `${style} ${weight} ${size}px ${family}`;
  };
  // 行数：Range 的 client rect 每行一个（复杂情况下同一行会有多段）→ 按 top 去重
  const countLines = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.height > 0);
    if (!rects.length) return 0;
    return new Set(rects.map((r) => Math.round(r.top))).size;
  };
  // 自省：直接暴露"数行"这个原始测量函数（与 measureTextSize 内部用的是同一个）。
  // 为什么需要它：measureTextSize 只回 width/height，而 height = 行数 × 单行高，
  // 【行数在算式里会被约掉】—— 只从高度反推无法验证"数行"本身是否正确。（实测踩过：
  // 把数行改成恒返回 1，从高度反推的行数依然是 4，相关断言全过。）所以要能直接断言行数。
  global.__arkui_dom_countLines = (el) => countLines(el || document.body);
  const buildMeasureEl = (o, singleLine) => {
    const el = document.createElement('div');
    el.style.font = fontCssOf(o);
    el.style.lineHeight = o.lineHeight !== undefined ? dimPx(o.lineHeight, 0) + 'px' : 'normal';
    el.style.letterSpacing = o.letterSpacing !== undefined ? dimPx(o.letterSpacing, 0) + 'px' : 'normal';
    el.style.textIndent = o.textIndent !== undefined ? dimPx(o.textIndent, 0) + 'px' : '';
    el.style.boxSizing = 'content-box';
    el.style.margin = el.style.padding = el.style.border = '0';
    el.style.display = 'block';
    el.style.whiteSpace = singleLine ? 'nowrap' : 'normal';
    // wordBreak：BREAK_ALL → break-all；BREAK_WORD → break-word
    el.style.wordBreak = o.wordBreak === 2 ? 'break-all' : (o.wordBreak === 1 ? 'break-word' : 'normal');
    if (!singleLine && o.constraintWidth !== undefined) el.style.width = dimPx(o.constraintWidth, 0) + 'px';
    const content = o.textContent === undefined || o.textContent === null ? '' : o.textContent;
    if (typeof content !== 'string') {
      measureWarn('@ohos:measure 的 textContent 不是字符串（可能是资源引用），已按空串处理');
      el.textContent = '';
    } else {
      el.textContent = content;
    }
    return el;
  };
  const MeasureText = class MeasureText {
    static measureText(options) {
      const o = options || {};
      const host = measureHost();
      const el = buildMeasureEl(o, true);                // 单行：nowrap + 不限宽
      host.appendChild(el);
      const w = el.getBoundingClientRect().width;
      host.removeChild(el);
      return w;
    }
    static measureTextSize(options) {
      const o = options || {};
      const host = measureHost();
      const el = buildMeasureEl(o, false);
      host.appendChild(el);
      const rect = el.getBoundingClientRect();
      const lines = countLines(el);
      const contentW = Math.max(...[...el.getClientRects()].map((r) => r.width), 0);
      const lineH = lines > 0 ? rect.height / lines : 0;  // 单行高（由真实布局反推）
      const maxLines = o.maxLines === undefined ? Infinity : Number(o.maxLines);
      const kept = Math.min(lines, maxLines);
      const height = kept * lineH;
      host.removeChild(el);
      const cw = o.constraintWidth === undefined ? contentW : dimPx(o.constraintWidth, contentW);
      return { width: Math.min(contentW || cw, cw), height };   // 单位 px（JSDoc 明确）
    }
  };
  define('measure', MeasureText);

  // ── @ohos.multimedia.image —— 图像信息（R18） ──
  //
  // 权威来源 `@ohos.multimedia.image.d.ts`：
  //   createImageSource(uri: string): ImageSource
  //   ImageSource.getImageInfo(): Promise<ImageInfo> / getImageInfo(cb) / getImageInfoSync(): ImageInfo
  //   ImageInfo { size: Size, density, stride, pixelFormat, alphaType, mimeType, isHdr }；Size { width, height }
  //
  // 实现取向与 R15 的文本测量一致：**让浏览器真解码**（fetch + createImageBitmap），
  // 而不是自己解析 PNG/JPEG 头 —— 宽高来自真实解码器，mimeType 来自真实响应的 Content-Type。
  const resolveImageUrl = (uri) => {
    const s = String(uri);
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;                 // http(s):/data:/file: 等绝对形式
    const base = (global.location && global.location.origin) || '';
    return base + (s.startsWith('/') ? s : '/' + s);             // 相对路径按页面 origin 解析
  };
  // mimeType 的权威语义是【解码后的真实格式】：JSDoc 原话 "Actual image format (MIME type)"。
  // 所以不能拿 HTTP 响应的 Content-Type 充数（文件改名或服务端配置错时两者会不一致）——
  // 这里按**真实字节的魔数**判断。这不等于自己写解码器：解码仍交给浏览器，只看文件头定格式。
  const sniffImageFormat = (bytes) => {
    if (!bytes || bytes.length < 4) return '';
    const b = bytes;
    const ascii = (i, n) => String.fromCharCode.apply(null, Array.from(b.slice(i, i + n)));
    if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (ascii(0, 4) === 'GIF8') return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    if (ascii(4, 4) === 'ftyp' && /heic|heix|hevc|mif1|msf1/.test(ascii(8, 4))) return 'image/heif';
    const head = ascii(0, Math.min(100, b.length)).trim().toLowerCase();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
    return '';
  };
  class ImageSource {
    constructor(uri) {
      this.uri = String(uri);
      this._info = null;
      this._pending = null;
    }
    getImageInfo(cb) {
      if (!this._pending) {
        this._pending = (async () => {
          const url = resolveImageUrl(this.uri);
          let res;
          try {
            res = await fetch(url);
          } catch (e) {
            throw fsErr(62980103, `读取图像失败（网络错误）：${url} —— ${e && e.message}`);
          }
          if (!res.ok) {
            throw fsErr(62980103, `读取图像失败：HTTP ${res.status} ${res.statusText}（${url}）`);
          }
          const blob = await res.blob();
          if (typeof global.createImageBitmap !== 'function') {
            throw fsErr(62980103, `本环境没有 createImageBitmap，无法解码图像（${url}）`);
          }
          const buf = new Uint8Array(await blob.arrayBuffer());
          const bmp = await global.createImageBitmap(blob);        // ← 真实解码
          const w = bmp.width, h = bmp.height;
          if (typeof bmp.close === 'function') bmp.close();
          let mimeType = sniffImageFormat(buf);
          if (!mimeType) {
            // 认不出来就退回响应头 —— 但要出声（否则会把"没识别"伪装成"识别对了"）
            mimeType = blob.type || '';
            const w0 = global.__arkui_dom_layout_warnings;
            const msg = `image.getImageInfo: 未能从字节识别图像格式（${url}），已退回响应头 '${mimeType}'`;
            if (w0 && !w0.includes(msg)) w0.push(msg);
          }
          this._info = {
            size: { width: w, height: h },
            density: 0,
            stride: w * 4,
            pixelFormat: 0,
            alphaType: 0,
            mimeType,
            isHdr: false,
          };
          return this._info;
        })();
      }
      if (typeof cb === 'function') {
        // 成功时也要传 BusinessError 形状的对象（code: 0）—— 产物里是 `if (err.code)`，传 null 会 TypeError
        this._pending.then((v) => cb({ code: 0, message: '' }, v), (e) => cb(e));
        return undefined;
      }
      return this._pending;
    }
    getImageInfoSync() {
      if (this._info) return this._info;
      // 同步 API 无法等待解码 —— 响亮失败，绝不编一个尺寸出来
      throw fsErr(62980103,
        `getImageInfoSync 无法同步解码（${this.uri}）：本实现只回【已解码】的缓存，请先 await getImageInfo()`);
    }
    release() {
      this._info = null;
      this._pending = null;
      return Promise.resolve();
    }
  }
  define('multimedia.image', {
    createImageSource: (uri) => new ImageSource(uri),
    ImageSource,
    AlphaType: { UNKNOWN: 0, OPAQUE: 1, PREMUL: 2, UNPREMUL: 3 },
    PixelMapFormat: { UNKNOWN: 0, RGB_565: 2, RGBA_8888: 3, BGRA_8888: 4, RGB_888: 5 },
  });

  // ── @ohos:router ──
  const paramsByUrl = new Map();
  const normUrl = (o) => (typeof o === 'string' ? o : (o && o.url) || '');
  const okRes = () => ({ code: 0, message: '' });
  const failRes = (e) => ({ code: 1, message: e.message });
  const currentUrl = () => {
    const st = global.__arkui_dom_pageStack;
    return st.length ? st[st.length - 1] : '';
  };
  define('router', {
    pushUrl(options, cb) {
      const url = normUrl(options);
      if (options && typeof options === 'object' && options.params) paramsByUrl.set(url, options.params);
      try {
        global.__arkui_dom_navigate(url);
        logs.push({ t: 'router.pushUrl', url });
        if (typeof cb === 'function') cb(okRes());
        return Promise.resolve();
      } catch (e) {
        logs.push({ t: 'router.pushUrlError', url, message: e.message });
        if (typeof cb === 'function') cb(failRes(e));
        return Promise.reject(e);
      }
    },
    replaceUrl(options, cb) {
      global.__arkui_dom_back();
      return this.pushUrl(options, cb);
    },
    back(options, cb) {
      logs.push({ t: 'router.back' });
      try {
        global.__arkui_dom_back();
        if (typeof cb === 'function') cb(okRes());
        return Promise.resolve();
      } catch (e) {
        if (typeof cb === 'function') cb(failRes(e));
        return Promise.reject(e);
      }
    },
    clear() { logs.push({ t: 'router.clear' }); },
    getParams() { return paramsByUrl.get(currentUrl()) || undefined; },
    getLength() { return global.__arkui_dom_pageStack.length; },
    getState() { return { index: global.__arkui_dom_pageStack.length - 1, name: currentUrl() }; },
  });

  // ── @ohos:data.preferences —— 键值持久化（落盘为 JSON 文件） ──
  const PREF_DIR = '/vfs/files';
  const prefPath = (name) => `${PREF_DIR}/pref_${name}.json`;
  const prefStores = new Map();

  function loadPrefs(name) {
    const data = new Map();
    try {
      const raw = backend.read(prefPath(name));            // 从真实存储读回
      for (const [k, v] of Object.entries(JSON.parse(raw))) data.set(k, v);
      logs.push({ t: 'preferences.loaded', name, keys: [...data.keys()] });
    } catch (_) { /* 首次运行：文件不存在，属正常 */ }
    return data;
  }

  function makePrefStore(name) {
    const data = loadPrefs(name);
    return {
      name,
      get: async (key, def) => (data.has(key) ? data.get(key) : def),
      getSync: (key, def) => (data.has(key) ? data.get(key) : def),
      put: async (key, value) => { data.set(key, value); },
      putSync: (key, value) => { data.set(key, value); },
      has: async (key) => data.has(key),
      hasSync: (key) => data.has(key),
      delete: async (key) => { data.delete(key); },
      clear: async () => { data.clear(); },
      flush: async () => {
        const obj = Object.fromEntries(data);
        const n = backend.write(prefPath(name), JSON.stringify(obj));   // ← 落盘
        logs.push({ t: 'preferences.flush', name, keys: [...data.keys()], bytes: n, backend: backend.kind });
      },
    };
  }
  define('data.preferences', {
    getPreferences(_context, name) {
      const key = name || 'default';
      if (!prefStores.has(key)) prefStores.set(key, makePrefStore(key));
      logs.push({ t: 'preferences.getPreferences', name: key });
      return Promise.resolve(prefStores.get(key));
    },
    deletePreferences(_context, name) { try { backend.unlink(prefPath(name)); } catch (_) {} prefStores.delete(name); return Promise.resolve(); },
    removePreferencesFromCache(_context, name) { prefStores.delete(name); return Promise.resolve(); },
  });

  // ── 全局 getContext(component) ──
  global.getContext = function getContext(_component) {
    if (!global.__arkui_dom_context) {
      const appContext = {
        setColorMode(mode) { logs.push({ t: 'setColorMode', mode }); },
        getApplicationContext() { return appContext; },
      };
      global.__arkui_dom_context = {
        filesDir: PREF_DIR,
        cacheDir: '/vfs/cache',
        tempDir: '/vfs/temp',
        getApplicationContext: () => appContext,
        resourceManager: { getStringSync: (k) => k, getStringByNameSync: (k) => k },
      };
    }
    return global.__arkui_dom_context;
  };

  // ── @ohos:file.fs —— 真实落盘的同步 API ──
  const OpenMode = { READ_ONLY: 0, WRITE_ONLY: 1, READ_WRITE: 2, CREATE: 64, TRUNC: 512, APPEND: 1024 };
  const handles = new Map();                            // fd -> {path, append}
  let fdSeq = 3;

  const fsShim = {
    OpenMode,
    openSync(path, mode) {
      const create = (mode & OpenMode.CREATE) !== 0;
      const trunc = (mode & OpenMode.TRUNC) !== 0;
      const append = (mode & OpenMode.APPEND) !== 0;
      if (!backend.exists(path)) {
        if (!create) throw fsErr(13900002, `No such file: ${path}`);
        backend.write(path, '');
      }
      if (trunc) backend.write(path, '');
      const fd = fdSeq++;
      handles.set(fd, { path, append });
      logs.push({ t: 'file.open', path, fd, mode, backend: backend.kind });
      return { fd };
    },
    // 语义：新开文件偏移为 0 → 覆盖写；带 APPEND 模式则追加
    writeSync(fd, content) {
      const h = handles.get(fd);
      if (!h) throw fsErr(13900008, `Bad file descriptor: ${fd}`);
      const text = String(content);
      const n = h.append ? backend.append(h.path, text) : backend.write(h.path, text);
      logs.push({ t: 'file.write', path: h.path, bytes: text.length, persisted: true });
      return n;
    },
    readTextSync(path) {
      const text = backend.read(path);                 // 文件不存在会抛 code=13900002
      logs.push({ t: 'file.readText', path, bytes: text.length });
      return text;
    },
    readSync() { throw fsErr(13900004, 'readSync(buffer) 尚未实现（当前产物未使用）'); },
    closeSync(file) {
      const fd = typeof file === 'object' ? file.fd : file;
      handles.delete(fd);
      logs.push({ t: 'file.close', fd });
    },
    accessSync(path) { if (!backend.exists(path)) throw fsErr(13900002, `No such file: ${path}`); },
    mkdirSync(path) { backend.mkdir(path); logs.push({ t: 'file.mkdir', path }); },
    unlinkSync(path) { backend.unlink(path); logs.push({ t: 'file.unlink', path }); },
    statSync(path) { return backend.stat(path); },
    listFileSync(path) { return backend.list(path); },

    // ── 异步 API（Promise 风格，产物里的 fs.open/write/readText/close 用的就是这套）──
    // 差异：写操作会 await 落盘队列 —— 于是"Promise resolve"意味着【已落盘】，
    // 而同步 API 是 write-behind（不等落盘）。这是刻意区分的语义。
    async open(path, mode) { return fsShim.openSync(path, mode); },
    async write(fd, content) {
      const n = fsShim.writeSync(fd, content);
      await backend.pending();
      return n;
    },
    async readText(path) { return fsShim.readTextSync(path); },
    async close(file) { return fsShim.closeSync(file); },
    async access(path) { return fsShim.accessSync(path); },
    async mkdir(path) { return fsShim.mkdirSync(path); },
    async unlink(path) { return fsShim.unlinkSync(path); },
    async stat(path) { return fsShim.statSync(path); },
    async listFile(path) { return fsShim.listFileSync(path); },
    async truncate(path) { backend.write(path, ''); await backend.pending(); },
  };
  define('file.fs', fsShim);

  // ── @ohos:net.http —— 真 fetch 实现 ──
  const RequestMethod = {
    OPTIONS: 'OPTIONS', GET: 'GET', HEAD: 'HEAD', POST: 'POST',
    PUT: 'PUT', DELETE: 'DELETE', TRACE: 'TRACE', CONNECT: 'CONNECT',
  };
  const absUrl = (u) => (u.startsWith('/') && global.location ? global.location.origin + u : u);
  define('net.http', {
    RequestMethod,
    ResponseCode: { OK: 200, CREATED: 201, NO_CONTENT: 204, BAD_REQUEST: 400, NOT_FOUND: 404, INTERNAL_ERROR: 500 },
    HttpDataType: { STRING: 0, OBJECT: 1, ARRAY_BUFFER: 2 },
    createHttp() {
      let destroyed = false;
      return {
        async request(url, options) {
          const opt = options || {};
          const target = absUrl(url);
          const method = opt.method || RequestMethod.GET;
          if (destroyed) throw fsErr(2300035, 'Http request is destroyed');

          // 超时：官方用 connectTimeout/readTimeout(ms)，这里用 AbortController 实现
          const ms = Number(opt.readTimeout || opt.connectTimeout || 0);
          const ctrl = ms > 0 && global.AbortController ? new global.AbortController() : null;
          let timer = null;
          if (ctrl) timer = setTimeout(() => ctrl.abort(), ms);

          let res;
          try {
            res = await fetch(target, {
              method,
              headers: opt.header || opt.headers || {},
              body: opt.extraData !== undefined ? opt.extraData : undefined,
              signal: ctrl ? ctrl.signal : undefined,
            });
          } catch (e) {
            const isAbort = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
            logs.push({ t: 'http.requestFailed', url: target, method, message: e.message, timedOut: isAbort });
            throw fsErr(isAbort ? 2300028 : 2300007,
              isAbort ? `Timeout: ${ms}ms` : `Could not connect to server: ${e.message}`);
          } finally {
            if (timer) clearTimeout(timer);
          }

          // expectDataType: 0=STRING 1=OBJECT 2=ARRAY_BUFFER
          const wantBuf = opt.expectDataType === 2;
          const buf = wantBuf ? await res.arrayBuffer() : null;
          const text = wantBuf ? '' : await res.text();
          logs.push({
            t: 'http.request', url: target, method, code: res.status,
            bytes: wantBuf ? buf.byteLength : text.length,
            hasBody: opt.extraData !== undefined,
            headerKeys: Object.keys(opt.header || opt.headers || {}),
          });
          return { responseCode: res.status, result: wantBuf ? buf : text, header: {} };
        },
        destroy() { destroyed = true; logs.push({ t: 'http.destroy' }); },
        on() { return this; },
        off() { return this; },
      };
    },
  });

  // ── @ohos:notificationManager —— 通知（R19） ──
  //
  // 权威来源 @ohos.notificationManager.d.ts：
  //   publish(request: NotificationRequest): Promise<void>      // 另有 (request, AsyncCallback<void>) 重载
  //   cancel(id: number): Promise<void>   cancelAll(): Promise<void>
  //   ContentType: NOTIFICATION_CONTENT_BASIC_TEXT / LONG_TEXT / PICTURE / CONVERSATION / MULTILINE / SYSTEM_LIVE_VIEW
  //
  // 现实：DOM 里没有"系统通知"这一层。能做且必须做的是两件事——
  //   ① 如实【记录】调用与 payload（__arkui_dom_logs + __arkui_dom_notifications() 自省）：测试与排障的依据；
  //   ② 尽力投给【宿主】的通知能力（Electron/浏览器都是 HTML5 Notification），并如实标注
  //      走了哪条路（via）与没走成的原因（reason）—— 让"看起来发出去了"无处藏身。
  // 降级本身不总是缺陷：浏览器没有系统通知是预期，只写日志；但 Electron 里注入过 nodeFs
  // 说明期望真通知，此时"没送达"要进 layout_warnings（否则用户看不到通知又无从察觉）。
  const notifStore = (global.__arkui_dom_notifStore = global.__arkui_dom_notifStore
    || { active: [], history: [], hostCreated: 0 });

  // title/text 允许 string | Resource；DOM 侧没有资源表 → 如实标记，不假装解析成功
  const notifStr = (v) => {
    if (typeof v === 'string') return v;
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return '[资源引用未解析]';
    return String(v);
  };

  // 从 content 推断"拿哪一段显示"：basic text 优先，其次 longText / multiLine。
  // 只有 picture / conversation 的内容无法在 DOM 里表达 → 都不认，交给调用方响亮失败。
  function notifTextOf(content) {
    if (!content || typeof content !== 'object') return { kind: '', title: '', text: '' };
    const { normal, longText, multiLine } = content;
    if (normal && typeof normal === 'object') {
      return { kind: 'normal', title: notifStr(normal.title), text: notifStr(normal.text) };
    }
    if (longText && typeof longText === 'object') {
      return { kind: 'longText', title: notifStr(longText.title), text: notifStr(longText.longText) };
    }
    if (multiLine && typeof multiLine === 'object') {
      return { kind: 'multiLine', title: notifStr(multiLine.title), text: notifStr(multiLine.text) };
    }
    return { kind: '', title: '', text: '' };
  }

  // 投递路径是三档，不是两档 —— 中间的"对象建了但不保证弹"必须如实说出来，
  // 否则 permission=default（未授权）时会被当成"已送达"。
  function notifTryHost(title, text, id) {
    const N = global.Notification;
    if (typeof N !== 'function') {
      return { via: 'record-only', reason: '本环境没有 HTML5 Notification API', hostPermission: 'n/a' };
    }
    const perm = N.permission;
    if (perm === 'denied') return { via: 'record-only', reason: '宿主通知权限为 denied', hostPermission: perm };
    try {
      const n = new N(title || '(无标题)', { body: text || '', tag: 'arkui-' + id });
      if (typeof n.show === 'function') n.show();   // Electron 需 show()，浏览器构造即显示
      notifStore.hostCreated++;
      return {
        via: 'host-Notification',
        reason: perm === 'granted' ? '' : `宿主通知权限为 ${perm}（已创建通知对象，是否真的弹出由宿主决定）`,
        hostPermission: perm,
      };
    } catch (e) {
      return { via: 'record-only', reason: '宿主 Notification 构造失败：' + (e && e.message), hostPermission: perm };
    }
  }

  const notifWarnIfElectron = (reason) => {
    if (!nodeFs) return;                            // 浏览器降级是预期行为，不进 warnings
    const w = global.__arkui_dom_layout_warnings;
    const msg = `[notification] 通知未送达系统：${reason}`;
    if (w && !w.includes(msg)) w.push(msg);
  };

  // 把 promise / callback 两种重载收敛到一处；callback 路径也异步回调，与真实实现语义一致
  function notifCall(run, cb) {
    if (typeof cb === 'function') {
      Promise.resolve()
        .then(run)
        .then((v) => cb(okRes(), v), (e) => cb(failRes(e)));
      return undefined;
    }
    return Promise.resolve().then(run);
  }

  const notificationManager = {
    ContentType: {
      NOTIFICATION_CONTENT_BASIC_TEXT: 0,
      NOTIFICATION_CONTENT_LONG_TEXT: 1,
      NOTIFICATION_CONTENT_PICTURE: 2,
      NOTIFICATION_CONTENT_CONVERSATION: 3,
      NOTIFICATION_CONTENT_MULTILINE: 4,
      NOTIFICATION_CONTENT_SYSTEM_LIVE_VIEW: 5,
    },
    publish(request, cb) {
      return notifCall(() => {
        if (!request || typeof request !== 'object' || request.id === undefined || request.id === null) {
          throw fsErr(401, 'notificationManager.publish: 缺少必填字段 id（NotificationRequest.id 是 number）');
        }
        const id = Number(request.id);
        const { kind, title, text } = notifTextOf(request.content);
        if (!kind) {
          throw fsErr(401, `notificationManager.publish(id=${id}): content 里没有可显示内容 — `
            + '需要 normal{title,text} / longText / multiLine 之一（本实现不渲染 picture/conversation，图片类请自行降级为文本）');
        }
        const host = notifTryHost(title, text, id);
        const rec = {
          op: 'publish', id, kind, title, text,
          via: host.via, reason: host.reason, hostPermission: host.hostPermission,
        };
        notifStore.history.push(rec);
        notifStore.active = notifStore.active.filter((x) => x.id !== id);
        notifStore.active.push(rec);
        logs.push(`[notification] publish id=${id} kind=${kind} title='${title}' text='${text}' `
          + `via=${host.via} permission=${host.hostPermission}${host.reason ? ' reason=' + host.reason : ''}`);
        if (host.via !== 'host-Notification') notifWarnIfElectron(host.reason);
        return undefined;
      }, cb);
    },
    cancel(id, cb) {
      return notifCall(() => {
        const n = Number(id);
        if (!Number.isFinite(n)) {
          throw fsErr(401, `notificationManager.cancel: id 必须是 number（收到 ${JSON.stringify(id)}）`);
        }
        const before = notifStore.active.length;
        notifStore.active = notifStore.active.filter((x) => x.id !== n);
        const found = before !== notifStore.active.length;
        notifStore.history.push({ op: 'cancel', id: n, found });
        logs.push(`[notification] cancel id=${n} ${found ? '已移除活动通知' : '无匹配的活动通知（系统语义下不算失败）'}`);
        return undefined;
      }, cb);
    },
    cancelAll(cb) {
      return notifCall(() => {
        const cleared = notifStore.active.length;
        notifStore.active = [];
        notifStore.history.push({ op: 'cancelAll', cleared });
        logs.push(`[notification] cancelAll 清除 ${cleared} 条活动通知`);
        return undefined;
      }, cb);
    },
    isNotificationEnabled(cb) {
      return notifCall(() => {
        const N = global.Notification;
        return typeof N === 'function' && N.permission !== 'denied';
      }, cb);
    },
  };
  define('notificationManager', notificationManager);

  // 供测试/宿主核验：返回快照（逐条浅拷贝），避免调用方改到内部状态
  global.__arkui_dom_notifications = () => ({
    active: notifStore.active.map((x) => Object.assign({}, x)),
    history: notifStore.history.map((x) => Object.assign({}, x)),
    hostCreated: notifStore.hostCreated,
  });

  // ── @ohos:promptAction —— 轻提示与对话框（R20） ──
  //
  // 权威来源 @ohos.promptAction.d.ts：
  //   function showToast(options: ShowToastOptions): void        // 返回 void
  //   function showDialog(options: ShowDialogOptions): Promise<ShowDialogSuccessResponse>
  //   function showDialog(options, callback: AsyncCallback<ShowDialogSuccessResponse>): void
  //   ShowDialogSuccessResponse { index } —— 被点按钮在 buttons 里的下标（从 0 起）
  //   ShowToastOptions.duration：默认 1500；范围 [1500, 10000]；<1500 用默认值、>10000 取上限
  //   ShowToastOptions.message / ShowDialogOptions.title|message|buttons —— message 是必填
  //   两者的 401 errcode 都是 "Mandatory parameters are left unspecified"
  //   自 API 18 起这两个全局函数 deprecated，@useinstead UIContext.PromptAction#showToast/showDialog
  //
  // 抛 vs 拒是【实测】出来的：编译器对 showToast（void 版）警告
  // "Function may throw exceptions. Special handling is required."，对 showDialog（Promise 版）不警告
  // → void 版【同步抛】、Promise 版走【reject】。（fixture 里 try/catch 与 .catch 各接一条。）
  //
  // 挂载点：toast/对话框都挂 document.body（不挂进页面根），这样页面重渲染不会把它们清掉；
  // 真机上它们属于窗口而不是页面。z-index 高于 ability 窗口（20）。
  const promptState = { toasts: [], dialogs: [], lastToast: null, lastDialog: null };

  const promptStr = (v) => {
    if (typeof v === 'string') return v;
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return '[资源引用未解析]';   // string | Resource；DOM 侧没有资源表
    return String(v);
  };
  const TOAST_MIN_MS = 1500;
  const TOAST_MAX_MS = 10000;
  const promptParamErr = (api, field) => fsErr(401,
    `promptAction.${api}: ${field} 未指定（BusinessError 401 — Mandatory parameters are left unspecified）`);

  function showToast(options) {
    if (!options || typeof options !== 'object') throw promptParamErr('showToast', 'options');
    if (options.message === undefined || options.message === null) throw promptParamErr('showToast', 'message');
    const raw = options.duration;
    // .d.ts：默认 1500；<1500（含未设置）用默认值；>10000 取上限。两个值都留下，便于自省与断言
    const effective = (typeof raw === 'number' && raw >= TOAST_MIN_MS)
      ? Math.min(raw, TOAST_MAX_MS)
      : TOAST_MIN_MS;
    const el = document.createElement('div');
    el.setAttribute('data-arkui-toast', '');
    el.setAttribute('style', 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);'
      + 'max-width:70%;padding:8px 14px;border-radius:16px;background:rgba(0,0,0,0.75);color:#fff;'
      + 'font:14px system-ui,sans-serif;z-index:40');
    el.textContent = promptStr(options.message);
    document.body.appendChild(el);
    const rec = {
      message: promptStr(options.message),
      durationRaw: (typeof raw === 'number') ? raw : null,
      effectiveDuration: effective,
      el,
    };
    promptState.toasts.push(rec);
    promptState.lastToast = rec;
    logs.push(`[promptAction] showToast message='${rec.message}' duration=${rec.durationRaw} → ${effective}ms`);
    rec.timer = setTimeout(() => {
      el.remove();
      const i = promptState.toasts.indexOf(rec);
      if (i >= 0) promptState.toasts.splice(i, 1);
      logs.push(`[promptAction] showToast 到期移除 message='${rec.message}'`);
    }, effective);
  }

  function showDialog(options) {
    return new Promise((resolve, reject) => {
      if (!options || typeof options !== 'object') {
        reject(promptParamErr('showDialog', 'options'));
        return;
      }
      const rawButtons = Array.isArray(options.buttons) ? options.buttons : [];
      const btns = rawButtons.filter((b) => b && typeof b === 'object');
      if (btns.length === 0) {
        // 不造"永远点不掉"的假对话框：没有按钮就结束不了，而"点遮罩结束"的语义
        // .d.ts 没规定（autoCancel 默认 true 但没说结束时的 index）→ 响亮失败
        reject(fsErr(401, 'promptAction.showDialog: buttons 不能为空 —— 本实现不渲染"没有按钮的'
          + '对话框"（那种对话框只能靠点遮罩结束，而结束时的 index 语义 .d.ts 未规定）；'
          + '请传 buttons: [{text, color}]'));
        return;
      }
      const overlay = document.createElement('div');
      overlay.setAttribute('data-arkui-dialog', '');
      overlay.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;'
        + 'background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:30');
      const box = document.createElement('div');
      box.setAttribute('data-arkui-dialog-box', '');
      box.setAttribute('style', 'min-width:200px;max-width:80%;background:#fff;border-radius:12px;'
        + 'padding:16px;font:14px system-ui,sans-serif;color:#182431');
      if (options.title !== undefined) {
        const t = document.createElement('div');
        t.setAttribute('data-arkui-dialog-title', '');
        t.setAttribute('style', 'font-size:16px;font-weight:600;margin-bottom:8px');
        t.textContent = promptStr(options.title);
        box.appendChild(t);
      }
      if (options.message !== undefined) {
        const m = document.createElement('div');
        m.setAttribute('data-arkui-dialog-message', '');
        m.textContent = promptStr(options.message);
        box.appendChild(m);
      }
      const row = document.createElement('div');
      row.setAttribute('style', 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px');
      const rec = {
        title: promptStr(options.title), message: promptStr(options.message),
        buttons: btns.map((b) => promptStr(b.text)), index: null, el: overlay,
      };
      const settle = (index) => {
        if (rec.index !== null) return;              // 幂等：连点两次只结算一次
        rec.index = index;
        overlay.remove();
        const i = promptState.dialogs.indexOf(rec);
        if (i >= 0) promptState.dialogs.splice(i, 1);
        logs.push(`[promptAction] showDialog 关闭 index=${index}`);
        resolve({ index });
      };
      btns.forEach((b, i) => {
        const el = document.createElement('button');
        el.setAttribute('data-arkui-dialog-btn', String(i));
        el.setAttribute('style', 'border:none;background:transparent;font:inherit;padding:6px 10px;'
          + `cursor:pointer;color:${promptStr(b.color) || '#007DFF'}`);
        el.textContent = promptStr(b.text);
        el.addEventListener('click', () => settle(i));
        row.appendChild(el);
      });
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      promptState.dialogs.push(rec);
      promptState.lastDialog = rec;
      logs.push(`[promptAction] showDialog title='${rec.title}' buttons=${JSON.stringify(rec.buttons)}`);
    });
  }

  // showDialog 的 401 走 reject（不是同步抛）——见上面的实测依据
  define('promptAction', {
    showToast,
    showDialog(options, cb) {
      const p = showDialog(options);
      if (typeof cb === 'function') {
        // AsyncCallback：异步回调（同 R19：回调不在调用栈内触发）
        p.then((v) => Promise.resolve().then(() => cb(okRes(), v)),
          (e) => Promise.resolve().then(() => cb({ code: e.code || 1, message: e.message })));
        return undefined;
      }
      return p;
    },
  });

  // 供测试/宿主核验：当前打开的 toast / 对话框快照（含 duration 的原始值与生效值）
  global.__arkui_dom_prompt = () => ({
    openToasts: promptState.toasts.map((t) => ({
      message: t.message, durationRaw: t.durationRaw, effectiveDuration: t.effectiveDuration,
    })),
    openDialogs: promptState.dialogs.map((d) => ({
      title: d.title, message: d.message, buttons: d.buttons, index: d.index,
    })),
    lastToast: promptState.lastToast ? {
      message: promptState.lastToast.message,
      durationRaw: promptState.lastToast.durationRaw,
      effectiveDuration: promptState.lastToast.effectiveDuration,
    } : null,
    lastDialog: promptState.lastDialog ? {
      title: promptState.lastDialog.title, buttons: promptState.lastDialog.buttons,
    } : null,
  });

  // ── 文件系统后端的探测与【如实自报】（R21） ──
  //
  // 「能持久化」和「落到了文件系统」是两件事。localStorage 也能跨会话持久化，但它没有路径、
  // 没有目录、有配额、清站点数据就消失 —— 把它说成"文件系统"就是撒谎。所以这里做两件事：
  //
  //   ① 【探测】真的去 OPFS 里走一遍（getDirectory → getFileHandle → createWritable → 读回 → 清理），
  //      每一步带超时，结论记录"在哪一步失败、花了多少毫秒"。不是把注释里那句"本机会挂"当结论 ——
  //      注释会过期，探测不会。
  //   ② 【如实自报】后端名 + 是否文件系统 + 是否有 OS 可见路径 + 一句人话；
  //      并且严格区分【实测不可用】与【可用，但本项目默认不启用（为了两次运行选到同一后端）】——
  //      "我们没启用"绝不能说成"不可用"。
  const FS_TRUTH = {
    'node-fs': {
      isFileSystem: true, osVisiblePath: true,
      text: '真文件系统（Node fs：真磁盘、OS 可见路径）',
    },
    'opfs': {
      isFileSystem: true, osVisiblePath: false,
      text: '文件系统（OPFS：浏览器管理的文件系统，无 OS 可见路径）',
    },
    'localStorage': {
      isFileSystem: false, osVisiblePath: false,
      text: '非真文件系统（localStorage：键值存储，无路径、有配额、清站点数据即失效）',
    },
  };
  const OPFS_PROBE_NAME = '__arkui_dom_probe__.txt';
  let opfsProbeResult = null;

  async function probeOpfs(timeoutMs) {
    const budget = Number(timeoutMs || global.__arkui_dom_opfs_timeout_ms || 1200);
    const t0 = Date.now();
    const steps = [];
    if (!(global.navigator && global.navigator.storage && global.navigator.storage.getDirectory)) {
      return {
        ok: false, timeoutMs: budget, ms: 0, steps,
        failedAt: 'navigator.storage.getDirectory 不存在',
        error: '本环境没有提供 OPFS API',
      };
    }
    const withTimeout = (p, what) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} 超时 ${budget}ms`)), budget)),
    ]);
    const step = async (name, fn) => {
      const s = Date.now();
      try {
        const v = await withTimeout(fn(), name);
        steps.push({ name, ok: true, ms: Date.now() - s });
        return v;
      } catch (e) {
        steps.push({ name, ok: false, ms: Date.now() - s, error: e.message });
        throw Object.assign(new Error(e.message), { failedAt: name });
      }
    };
    const cleanup = () => {
      // 【不 await】清理必须也是"有界"的：失败路径上 getDirectory() 可能永远不 resolve，
      // 早先这里 await 了它，结果把探测耗时从 200ms 撑到 2172ms（实测踩到）。
      withTimeout(global.navigator.storage.getDirectory()
        .then((r) => r.removeEntry(OPFS_PROBE_NAME)), 'cleanup')
        .catch(() => { /* 尽力而为 */ });
    };
    try {
      const root = await step('getDirectory()', () => global.navigator.storage.getDirectory());
      const fh = await step('getFileHandle(create)', () => root.getFileHandle(OPFS_PROBE_NAME, { create: true }));
      const w = await step('createWritable()', () => fh.createWritable());
      await step('write+close', async () => { await w.write('probe'); await w.close(); });
      const back = await step('读回', async () => {
        const f = await (await root.getFileHandle(OPFS_PROBE_NAME)).getFile();
        return f.text();
      });
      await step('清理', () => root.removeEntry(OPFS_PROBE_NAME));
      const ok = back === 'probe';
      return {
        ok, timeoutMs: budget, ms: Date.now() - t0, steps,
        failedAt: ok ? null : '读回内容不符', error: ok ? null : `读回 '${back}'`,
      };
    } catch (e) {
      await cleanup();
      return {
        ok: false, timeoutMs: budget, ms: Date.now() - t0, steps,
        failedAt: e.failedAt || '未知', error: e.message,
      };
    }
  }

  function describeFs() {
    const kind = backend.kind;
    const truth = FS_TRUTH[kind] || { isFileSystem: false, osVisiblePath: false, text: `未知后端 ${kind}` };
    const notes = [];
    if (kind === 'node-fs') {
      notes.push('Electron 注入了 __arkui_dom_nodeFs，直接用 Node 真 fs（不探测 OPFS）');
    } else if (kind === 'localStorage') {
      if (!hasOpfs) {
        notes.push('本环境没有 navigator.storage.getDirectory → OPFS 无从谈起');
      } else if (opfsProbeResult && opfsProbeResult.ok) {
        notes.push(`OPFS 实测【可用】（${opfsProbeResult.ms}ms，含 ${opfsProbeResult.steps.length} 步），`
          + '但本项目默认不启用它 —— 两次运行必须选到同一个后端（跨阶段互不可见会伪装成"持久化失效"）');
      } else if (opfsProbeResult) {
        notes.push(`OPFS 实测【不可用】：卡在 ${opfsProbeResult.failedAt}（${opfsProbeResult.error}），`
          + `预算 ${opfsProbeResult.timeoutMs}ms/步，实测 ${opfsProbeResult.ms}ms`);
      } else {
        notes.push('OPFS 尚未探测');
      }
    } else if (kind === 'opfs') {
      notes.push('OPFS 由 __arkui_dom_force_backend/__arkui_dom_enable_opfs 显式启用；水合失败会切到 localStorage');
    }
    const probe = nodeBackend
      ? { skipped: 'Electron 用 Node 真 fs' }
      : (opfsProbeResult || { skipped: hasOpfs ? '尚未探测' : '本环境没有 OPFS API' });
    const text = `FS backend=${kind} isFileSystem=${truth.isFileSystem} `
      + `osVisiblePath=${truth.osVisiblePath} root=${backend.root}`
      + (opfsProbeResult
        ? ` | OPFS 探测 ok=${opfsProbeResult.ok}${opfsProbeResult.failedAt ? ` 卡在=${opfsProbeResult.failedAt}` : ''}`
          + ` ${opfsProbeResult.ms}ms`
        : ' | OPFS 探测：未做');
    return {
      backend: kind,
      isFileSystem: truth.isFileSystem,
      osVisiblePath: truth.osVisiblePath,
      root: backend.root,
      text,
      describeText: truth.text,
      notes,
      probe,
      forced: forced || null,
      opfsAvailable: hasOpfs,
    };
  }

  // 启动时自动探测一次（浏览器侧；Electron 用真 fs，不需要）。fire-and-forget，不阻塞任何同步 API；
  // 把 Promise 暴露出去（startupProbe）是为了让测试能【等】它 —— 否则"启动探测有没有留痕"会变成竞态。
  let startupProbe = null;
  if (!nodeBackend && hasOpfs) {
    startupProbe = probeOpfs().then((r) => {
      opfsProbeResult = r;
      logs.push({
        t: 'fs.opfsProbe', ok: r.ok, failedAt: r.failedAt, error: r.error,
        ms: r.ms, timeoutMs: r.timeoutMs, steps: r.steps,
      });
      return r;
    });
  }

  // 供测试/宿主核验：后端类型、根、读取、真实路径，以及就绪/落盘完成的等待点。
  // 用 getter 而不是快照值：OPFS 失败降级后这里要能反映"当前"后端。
  global.__arkui_dom_fs = {
    get backend() { return backend.kind; },
    get root() { return backend.root; },
    get ready() { return backend.ready; },       // 水合完成（OPFS 需要）；其余后端立即 resolve
    pending: (...a) => backend.pending(...a),    // 等待落盘队列排空
    hydrated: () => (backend.hydrated ? backend.hydrated() : true),
    readTextSync: (p) => backend.read(p),
    existsSync: (p) => backend.exists(p),
    realPathOf: (p) => backend.realPath(p),
    // R21：如实自报 + 现场探测
    describe: () => describeFs(),
    text: () => describeFs().text,
    probeOpfs: (timeoutMs) => probeOpfs(timeoutMs).then((r) => { opfsProbeResult = r; return r; }),
    opfsProbe: () => opfsProbeResult,
    get startupProbe() { return startupProbe; },   // 可 await：避免"启动探测有没有留痕"变成竞态
  };

  // ── @ohos:multimedia.media（R35 收官）──
  // AVPlayer → HTMLAudioElement 的状态机垫片。语义锚点（@ohos.multimedia.media.d.ts）：
  //   url 赋值 → 'initialized'；prepare() → 'prepared'；play() → 'playing'；pause() → 'paused'；
  //   seek(ms) 移动播放位置；duration/currentTime 随真实播放时钟推进（headless 探明：
  //   Chromium 无输出设备时 audio 时钟仍推进）；on('stateChange', (state, reason) => …)。
  define('multimedia.media', {
    createAVPlayer() {
      return new Promise((resolve, reject) => {
        try {
          const audio = new Audio();
          const listeners = { stateChange: [], firstFrame: [] };
          let state = 'idle';
          const setState = (s) => {
            state = s;
            listeners.stateChange.forEach((cb) => {
              try { cb(s); }
              catch (e) { console.debug('[media 垫片] stateChange 回调抛错：' + (e && e.message)); }
            });
          };
          audio.addEventListener('loadedmetadata', () => {
            if (state === 'initialized') { state = 'prepared'; setState('prepared'); }
          });
          audio.addEventListener('play', () => setState('playing'));
          audio.addEventListener('pause', () => { if (state === 'playing') setState('paused'); });
          audio.addEventListener('ended', () => setState('completed'));
          // currentTime 的来源（DOM 化映射，取舍已记录）：data URI 的短音频真实解码时长
          // 为 0（首跑实测时钟不推进）——垫片记录 play 起点的真实挂钟，playing 期间按墙钟推进，
          // pause 时冻结。语义真实（"播放了多久"），但不来自音频解码。
          let playStartedAt = 0;
          let pausedAt = 0;
          const player = {
            get state() { return state; },
            set url(v) {
              state = 'initialized';
              setState('initialized');
              audio.src = String(v);      // 垫片独立于 runtime 的 resolveResource（shims 先加载）
            },
            get duration() { return Number.isFinite(audio.duration) ? audio.duration : -1; },
            get currentTime() {
              if (state === 'playing' && playStartedAt > 0) return (Date.now() - playStartedAt) / 1000;
              if (state === 'paused' && pausedAt > 0) return pausedAt / 1000;
              return 0;
            },
            prepare() { return Promise.resolve().then(() => { if (state === 'initialized') { state = 'prepared'; setState('prepared'); } }); },
            play() {
              playStartedAt = Date.now() - (pausedAt || 0);   // 暂停恢复从冻结点续走
              // ⚠️ autoplay 政策：合成 click（dispatchEvent）不算真实手势，Chromium 会拒
              // audio.play()——垫片如实降级：muted + catch 后照走状态机（headless 无真实
              // 音频输出，状态机语义是断言主体；真实解码/发声无 DOM 对应，取舍已记录）
              audio.muted = true;
              return audio.play().catch(() => {}).then(() => { if (state !== 'playing') { state = 'playing'; setState('playing'); } });
            },
            pause() { audio.pause(); pausedAt = Date.now() - playStartedAt; state = 'paused'; setState('paused'); return Promise.resolve(); },
            stop() { audio.pause(); audio.currentTime = 0; state = 'stopped'; setState('stopped'); return Promise.resolve(); },
            seek(ms) { audio.currentTime = ms / 1000; return Promise.resolve(); },
            release() { audio.pause(); state = 'released'; setState('released'); return Promise.resolve(); },
            on(ev, cb) {
              // stateChange 是 (state, reason) 双参签名：reason DOM 无对应（恒空）
              listeners.stateChange.push((s) => cb(s, ''));
            },
            off(ev) { listeners.stateChange = []; },
          };
          resolve(player);
        } catch (e) { reject(e); }
      });
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
