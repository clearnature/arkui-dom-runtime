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
  // ── @ohos:deviceInfo —— 设备信息（R89，能力长尾）──
  //
  // 权威语义来自 `@ohos.deviceInfo.d.ts`（readonly 字段面）。取值分两类、不造假：
  //   · 宿主真值：Electron 走 preload 的 __arkui_dom_sysInfo（node:os）；
  //     浏览器端走 navigator 派生（降级值，字段仍非空）。
  //   · SDK 对齐常量：sdkApiVersion/firstApiVersion = 26、osReleaseType/buildType = 'Release'
  //     ——取自本仓库编译所对 CLT 的 `<CLT>/sdk/default/openharmony/ets/oh-uni-package.json`
  //     （apiVersion "26" / platformVersion 26.0.0 / releaseType "Release"，引用见注释）。
  {
    const eapi = (/** @type {any} */ (global)).electronAPI || {};
    const sys = eapi.sysInfo;   // preload electronAPI.sysInfo（R89）
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    define('deviceInfo', {
      get osFullName() { return sys ? (sys.osType + ' ' + sys.osRelease) : ('Browser ' + ua.slice(0, 40)); },
      get marketName() { return sys ? sys.osType : 'browser'; },
      get productModel() { return sys ? sys.hostname : (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'); },
      get brand() { return sys ? sys.osType : 'browser'; },
      get hardwareModel() { return sys ? sys.arch : 'unknown'; },
      get softwareModel() { return sys ? (sys.osType + '-' + sys.arch) : 'browser'; },
      get deviceType() { return sys ? 'desktop' : 'browser'; },
      get displayVersion() { return sys ? sys.osRelease : ua.slice(0, 24); },
      // SDK 对齐常量（见上注释）：本运行时声明面所对 CLT 26
      sdkApiVersion: 26,
      firstApiVersion: 26,
      osReleaseType: 'Release',
      buildType: 'Release',
      get abiList() { return sys ? sys.arch : 'unknown'; },
    });
  }

  // ── @ohos:i18n —— 国际化（R89）──
  //
  // 权威语义来自 `@ohos.i18n.d.ts`：getSystemLanguage（如 'zh'）/ getSystemLocale（如
  // 'zh-Hans-CN'）/ getSystemRegion。实现走宿主 Intl（渲染进程与浏览器同源真值，零 IPC）。
  {
    const locale = () => {
      try { return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'; }
      catch (e) { return 'en-US'; }
    };
    // R135：i18n 真面移至 runtime/src/i18n.js 分片（Locale/Calendar/NumberFormat/isRTL/
    // unitConvert/setResourceLocale）——这里保留旧名转发（已消费方不受影响）
    define('i18n', {
      getSystemLanguage: () => ((/** @type {any} */ (global)).__arkui_dom_i18n
        ? (/** @type {any} */ (global)).__arkui_dom_i18n.System.getSystemLanguage()
        : locale().split('-')[0]),
      getSystemLocale: () => ((/** @type {any} */ (global)).__arkui_dom_i18n
        ? (/** @type {any} */ (global)).__arkui_dom_i18n.System.getSystemLocale()
        : locale()),
      getSystemRegion: () => ((/** @type {any} */ (global)).__arkui_dom_i18n
        ? (/** @type {any} */ (global)).__arkui_dom_i18n.System.getSystemRegion()
        : (locale().match(/[-]([A-Za-z]{2})$/) ? locale().match(/[-]([A-Za-z]{2})$/)[1].toUpperCase() : '')),
    });
  }

  // ── @ohos:pasteboard —— 剪贴板（R89，与 R84 PasteButton 配套）──
  //
  // 权威语义来自 `@ohos.pasteboard.d.ts`：getSystemPasteboard() → Pasteboard{ setData,
  // getData }，createData(mimeType, value) → PasteData{ getRecordAt, getMimeTypes }。
  // Electron：真系统剪贴板（preload __arkui_dom_clip = electron clipboard，text/plain 直通）；
  // 浏览器：headless 无剪贴板权限 → 进程内 Map 兜底（限制已记录，跨进程不共享）。
  {
    const eapi = (/** @type {any} */ (global)).electronAPI || {};   // 块级作用域：与本块 clip 引用配对
    const pbStore = { data: null };
    const makePasteData = (mimeType, text) => {
      const t = text == null ? '' : String(text);
      return {
        getMimeTypes: () => [mimeType],
        getPrimaryText: () => t,                      // d.ts:725 PasteData.getPrimaryText(): string
        getRecordAt: (/** @type {number} */ i) => (i === 0 ? { mimeType, text: t, getPrimaryText: () => t } : null),
      };
    };
    define('pasteboard', {
      MIMETYPE_TEXT_PLAIN: 'text/plain',
      createData(mimeType, value) {
        return makePasteData(String(mimeType), typeof value === 'string' ? value : '');
      },
      getSystemPasteboard() {
        const api = eapi.clip;      // preload electronAPI.clip（R89，真系统剪贴板）
        return {
          async setData(/** @type {any} */ data) {
            const rec = data && data.getRecordAt && data.getRecordAt(0);
            pbStore.data = rec ? makePasteData(rec.mimeType, rec.text) : data;
            if (api && rec && rec.mimeType === 'text/plain') await api.writeText(rec.text);
            return undefined;
          },
          async getData() {
            ((/** @type {any} */ (global)).__gdStacks = (/** @type {any} */ (global)).__gdStacks || []).push(String(new Error().stack).split('\n').slice(1, 10).join(' || '));
            if (api) {
              const t = await api.readText();
              if (t) return makePasteData('text/plain', t);
            }
            return pbStore.data || makePasteData('text/plain', '');
          },
        };
      },
    });
  }

  define('hilog', {
    info: record('info'), error: record('error'), warn: record('warn'),
    debug: record('debug'), fatal: record('fatal'),
    isLoggable: () => true,  });

  // ── @ohos:curves —— 插值曲线工厂（R156-B）──
  //
  // 权威语义来自 `<CLT>/.../ets/api/@ohos.curves.d.ts`：initCurve(:193)/stepsCurve(:220)/customCurve(:238)/
  // cubicBezierCurve(:268)/springCurve(:318)/springMotion(:371)/responsiveSpringMotion(:398)/interpolatingSpring(:438)
  // 返回 ICurve；deprecated since 9 别名 init(:205)/steps(:252)/cubicBezier(:284)/spring(:338) 返回【string】
  //（= 同参 *Curve 工厂写进 __curveString 的那串）。
  //
  // ICurve 形状照真机 jsi_curves_module.cpp ParseCurves（:402-449）：普通 JS 对象
  // `{ interpolate(fraction), __curveString }`（customCurve 另挂 `__curveCustomFunc`，真机同名属性 :434）。
  // __curveString 序列化照 C++ Curve::ToString() 族——std::to_string 6 位小数、无空格：
  //   · CubicCurve::ToString()  = 'cubic-bezier(x1,y1,x2,y2)'（cubic_curve.cpp:57-64，x 坐标已钳 [0,1]）
  //   · SpringCurve::ToString() = 'spring(velocity,mass,stiffness,damping)'（spring_curve.cpp:115-122）
  //   · InterpolatingSpring 同法 = 'interpolating-spring(v,m,s,d)'
  //   · 枚举曲线 = 'Curves.Ease' 驼峰（core/animation/curves.cpp:33-40 的 ToString 映射表【原样】；
  //     Rhythm 不在表内 → 落回其 CubicCurve::ToString 参数串，照真机缺表行为）；小写 kebab
  //     （'ease'/'fast-out-slow-in'/...，dom_type.cpp:292-304 的解析词汇）是另一端真机形态，
  //     parseTabsAnimCurve 两种都认（R155-C 简报）。
  //   · springMotion/responsiveSpringMotion 真机同为 ResponsiveSpringMotion 曲线（ani_curves.cpp
  //     :83-132/:241-278 均 MakeRefPtr<ResponsiveSpringMotion>）→ 串前缀 'responsive-spring-motion('。
  // interpolate 可用性按 d.ts 明文分家：
  //   · cubic-bezier/steps/枚举：JS 解析式实现（x(t) 求根牛顿+二分 / 分段跳变 / 等参 bezier）；
  //   · springCurve：d.ts 未禁 interpolate（时长由 animation 控制、时间可归一化）→ 解析弹簧解算
  //     近似（三模型解析解 + estimateDuration 二分，spring_model.cpp:104-176 与 spring_curve.cpp
  //     :61-104 的阈值 0.001/0.025、步距 1/100s、上限 1000s 同参）；
  //   · interpolatingSpring/springMotion/responsiveSpringMotion：d.ts :431-437/:355-365/:384-392 明文
  //     interpolate 不可用（物理弹簧时长不归一化）→ interpolate 为恒返 undefined 的函数成员。
  {
    /** std::to_string 对齐：双精度 6 位小数（非有限数按 0，照真机 IsNumber→ToDouble 的非数兜底） */
    const f6 = (/** @type {number} */ n) => {
      const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
      return x.toFixed(6);
    };
    /** d.ts NOTE：mass/stiffness/damping ≤0 一律取 1（CreateSpringCurve/CreateInterpolatingSpring 同） */
    const pos1 = (/** @type {number} */ n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1);
    /** 数参缺省（可选参未传/非数 → 缺省值） */
    const numOr = (/** @type {number|undefined} */ n, /** @type {number} */ def) =>
      (typeof n === 'number' && Number.isFinite(n) ? n : def);
    /** fraction 钳 [0,1]（d.ts ICurve.interpolate NOTE：<0 按 0、>1 按 1） */
    const clamp01 = (/** @type {number} */ f) => {
      const x = typeof f === 'number' && Number.isFinite(f) ? f : 0;
      return Math.min(1, Math.max(0, x));
    };
    /** x 坐标钳 [0,1]、非数按 0（d.ts cubicBezierCurve NOTE + ani_curves.cpp:58-80 NaN→0 同口径） */
    const ux = (/** @type {number} */ n) => clamp01(typeof n === 'number' && Number.isFinite(n) ? n : 0);

    /** cubic-bezier 求值器：x(t)=((ax·t+bx)t+cx)t 求根（牛顿 8 次 + 二分 24 次兜底，x1/x2∈[0,1] 保 x 单调） */
    const bezSolver = (/** @type {number} */ x1, /** @type {number} */ y1,
      /** @type {number} */ x2, /** @type {number} */ y2) => {
      const cx = 3 * x1;
      const bx = 3 * (x2 - x1) - cx;
      const ax = 1 - cx - bx;
      const cy = 3 * y1;
      const by = 3 * (y2 - y1) - cy;
      const ay = 1 - cy - by;
      const sampleX = (/** @type {number} */ t) => ((ax * t + bx) * t + cx) * t;
      const sampleY = (/** @type {number} */ t) => ((ay * t + by) * t + cy) * t;
      const sampleDX = (/** @type {number} */ t) => (3 * ax * t + 2 * bx) * t + cx;
      return (/** @type {number} */ fraction) => {
        const x = clamp01(fraction);
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let t = x;
        for (let i = 0; i < 8; i++) {
          const err = sampleX(t) - x;
          if (Math.abs(err) < 1e-6) return sampleY(t);
          const d = sampleDX(t);
          if (Math.abs(d) < 1e-6) break;
          t -= err / d;
        }
        let lo = 0;
        let hi = 1;
        t = x;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (sampleX(mid) < x) lo = mid; else hi = mid;
        }
        t = (lo + hi) / 2;
        return sampleY(t);
      };
    };

    // 解析弹簧解算（SpringCurve 近似，spring_model.cpp:104-176 同式：HIGH_RATIO=4/LOW_RATIO=2）。
    // 0→1 归一：distance = startPosition−endPosition = −1；estimateDuration 二分同 spring_curve.cpp
    // :61-102（位移阈值 0.001、速度阈值 0.001×25、步距 1/100s、上限 1000s、收敛取双 NearZero）。
    const springSolver = (/** @type {number} */ velocity, /** @type {number} */ mass,
      /** @type {number} */ stiffness, /** @type {number} */ damping) => {
      const m = pos1(mass);
      const k = pos1(stiffness);
      const c = pos1(damping);
      const v = typeof velocity === 'number' && Number.isFinite(velocity) ? velocity : 0;
      const dist = -1;
      const cmk = c * c - 4 * m * k;                  // 判型式同 SpringModel::Build（spring_model.cpp:79）
      let pos;
      let vel;
      if (Math.abs(cmk) < 1e-9) {
        const r = -c / (2 * m);
        const c2 = v / (r * dist);                    // CriticalDampedModel ctor（:98-100）
        pos = (/** @type {number} */ t) => (dist + c2 * t) * Math.exp(r * t);
        vel = (/** @type {number} */ t) => {
          const p = Math.exp(r * t);
          return r * (dist + c2 * t) * p + c2 * p;
        };
      } else if (cmk > 0) {
        const sq = Math.sqrt(cmk);
        const r1 = (-c - sq) / (2 * m);
        const r2 = (-c + sq) / (2 * m);
        const c2 = (v - r1 * dist) / (r2 - r1);       // OverdampedModel ctor（:121-130）
        const c1 = dist - c2;
        pos = (/** @type {number} */ t) => c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
        vel = (/** @type {number} */ t) => c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t);
      } else {
        const w = Math.sqrt(4 * m * k - c * c) / (2 * m);
        const r = -c / (2 * m);
        const c2 = (v - r * dist) / w;                // UnderdampedModel ctor（:152-161）
        pos = (/** @type {number} */ t) => Math.exp(r * t) * (dist * Math.cos(w * t) + c2 * Math.sin(w * t));
        vel = (/** @type {number} */ t) => {
          const p = Math.exp(r * t);
          const cs = Math.cos(w * t);
          const sn = Math.sin(w * t);
          return p * (c2 * w * cs - dist * w * sn) + r * p * (c2 * sn + dist * cs);
        };
      }
      let lo = 0;                                     // estimateDuration 二分（收敛时 hi=最小 settled 时长）
      let hi = 1000;
      while (hi - lo >= 0.01) {
        const mid = (lo + hi) / 2;
        if (Math.abs(pos(mid)) < 0.001 && Math.abs(vel(mid)) < 0.025) hi = mid; else lo = mid;
      }
      return (/** @type {number} */ fraction) => {
        const p = 1 + pos(clamp01(fraction) * hi);    // currentPosition = end + Position(t·estimate)
        return Math.abs(p - 1) < 0.001 ? 1 : p;       // NearEqual 收口 → 恰 1（MoveInternal 收尾语义）
      };
    };

    // steps 分段（t 先钳 [0,1]；step=floor(t·n)；START 且 step<n → +1；取 step/n——C 简报公式，
    // 与 CSS jump-end/jump-start 同构；d.ts stepsCurve(count, end) 双参签名口径为准，C++ argc=1
    // 省略 end 时缺省 START 的分歧已在此记录）
    const stepsSolver = (/** @type {number} */ count, /** @type {boolean} */ isEnd) => {
      const n = Math.max(1, Math.trunc(typeof count === 'number' && Number.isFinite(count) ? count : 1));
      return (/** @type {number} */ fraction) => {
        let step = Math.floor(clamp01(fraction) * n);
        if (!isEnd && step < n) step += 1;
        return step / n;
      };
    };

    // Curve 枚举 → 等参 cubic-bezier（core/animation/curves.cpp:22-40 全清单，C 简报核过；
    // Linear 恒等无参）。枚举序 = d.ts enum Curve 声明序（curve.d.ts）。
    const ENUM_PARAM = [
      null,                     // 0 Linear：恒等
      [0.25, 0.1, 0.25, 1],     // 1 Ease
      [0.42, 0, 1, 1],          // 2 EaseIn
      [0, 0, 0.58, 1],          // 3 EaseOut
      [0.42, 0, 0.58, 1],       // 4 EaseInOut
      [0.4, 0, 0.2, 1],         // 5 FastOutSlowIn
      [0, 0, 0.2, 1],           // 6 LinearOutSlowIn
      [0.4, 0, 1, 1],           // 7 FastOutLinearIn
      [0, 0, 0, 1],             // 8 ExtremeDeceleration
      [0.33, 0, 0.67, 1],       // 9 Sharp
      [0.7, 0, 0.2, 1],         // 10 Rhythm
      [0.4, 0, 0.4, 1],         // 11 Smooth
      [0.2, 0, 0.2, 1],         // 12 Friction
    ];
    // 枚举序 → __curveString：Curves::ToString 驼峰表【原样】（curves.cpp:33-40）；Rhythm 不在
    // 真机表内 → null=落回其参数串（照缺表行为）。
    const ENUM_STR = [
      'Curves.Linear', 'Curves.Ease', 'Curves.EaseIn', 'Curves.EaseOut', 'Curves.EaseInOut',
      'Curves.FastOutSlowIn', 'Curves.LinearOutSlowIn', 'Curves.FastOutLinearIn',
      'Curves.ExtremeDeceleration', 'Curves.Sharp', null, 'Curves.Smooth', 'Curves.Friction',
    ];

    /** ICurve 工厂：真机形状 { interpolate, __curveString }；interpolate 缺位 = d.ts 明文不可用
     *（属性仍存在、恒返 undefined——真机该成员是函数，语义按 d.ts 收敛） */
    const makeICurve = (/** @type {string} */ curveString, /** @type {((f: number) => number)|null} */ fn) => ({
      interpolate: fn
        ? (/** @type {number} */ f) => fn(clamp01(f))
        : (/** @type {number} */ _f) => undefined,
      __curveString: curveString,
    });

    const bezierStr = (/** @type {number} */ x1, /** @type {number} */ y1,
      /** @type {number} */ x2, /** @type {number} */ y2) =>
      `cubic-bezier(${[ux(x1), y1, ux(x2), y2].map(f6).join(',')})`;
    const springParams = (/** @type {any[]} */ a) => {
      const v = typeof a[0] === 'number' && Number.isFinite(a[0]) ? a[0] : 0;
      return [v, pos1(a[1]), pos1(a[2]), pos1(a[3])].map((n) => f6(n)).join(',');
    };
    const stepsStr = (/** @type {number} */ count, /** @type {boolean} */ end) => {
      const n = Math.max(1, Math.trunc(typeof count === 'number' && Number.isFinite(count) ? count : 1));
      return `steps(${n},${end ? 'end' : 'start'})`;
    };

    const initCurveImpl = (/** @type {number|undefined} */ curve) => {
      // d.ts:193 JSDoc：curve 缺省 Curve.Linear——真机无参存的是小写 'linear'
      //（jsi_curves_module.cpp:72 else curveString = "linear"）；显式枚举序数才走驼峰表
      if (curve === undefined) return makeICurve('linear', null);
      const ord = Math.trunc(curve);
      const param = ord >= 0 && ord < ENUM_PARAM.length ? ENUM_PARAM[ord] : null;
      const named = ord >= 0 && ord < ENUM_STR.length ? ENUM_STR[ord] : null;
      // 越界序数按缺省线性（真机 CreateCurve 未知串同落 linear）
      const str = named || (param ? bezierStr(param[0], param[1], param[2], param[3]) : 'linear');
      return makeICurve(str, param ? bezSolver(param[0], param[1], param[2], param[3]) : null);
    };

    define('curves', {
      // d.ts enum Curve（:32-160 声明序；编译产物侧 Curve.X 就是序数，此处照排供 require 方引用）
      Curve: {
        Linear: 0, Ease: 1, EaseIn: 2, EaseOut: 3, EaseInOut: 4, FastOutSlowIn: 5,
        LinearOutSlowIn: 6, FastOutLinearIn: 7, ExtremeDeceleration: 8, Sharp: 9,
        Rhythm: 10, Smooth: 11, Friction: 12,
      },
      initCurve(curve) {
        return initCurveImpl(typeof curve === 'number' ? curve : undefined);
      },
      stepsCurve(count, end) {
        return makeICurve(stepsStr(count, end !== false), stepsSolver(count, end !== false));
      },
      cubicBezierCurve(x1, y1, x2, y2) {
        return makeICurve(bezierStr(x1, y1, x2, y2), bezSolver(ux(x1), y1, ux(x2), y2));
      },
      springCurve(velocity, mass, stiffness, damping) {
        const p = [velocity, mass, stiffness, damping];
        const s = springParams(p);
        return makeICurve(`spring(${s})`,
          springSolver(p[0], pos1(p[1]), pos1(p[2]), pos1(p[3])));
      },
      interpolatingSpring(velocity, mass, stiffness, damping) {
        // d.ts:431-437 明文 interpolate 不可用 → undefined 成员；串照真机 InterpolatingSpring::ToString
        return makeICurve(`interpolating-spring(${springParams([velocity, mass, stiffness, damping])})`, null);
      },
      springMotion(response, dampingFraction, overlapDuration) {
        // 归一照 ani_curves.cpp:83-132（response ≤0→0.55；dampingFraction <0→0.825（0=无阻尼合法）；
        // overlapDuration <0→0）；真机串 = ResponsiveSpringMotion::ToString 前缀
        const r = numOr(response, 0.55) <= 0 ? 0.55 : numOr(response, 0.55);
        const d = numOr(dampingFraction, 0.825) < 0 ? 0.825 : numOr(dampingFraction, 0.825);
        const o = numOr(overlapDuration, 0) < 0 ? 0 : numOr(overlapDuration, 0);
        return makeICurve(`responsive-spring-motion(${[r, d, o].map((n) => f6(n)).join(',')})`, null);
      },
      responsiveSpringMotion(response, dampingFraction, overlapDuration) {
        // 缺省 0.15/0.86/0.25（d.ts:398 JSDoc）；真机与 springMotion 同为 ResponsiveSpringMotion 曲线
        const r = numOr(response, 0.15) <= 0 ? 0.15 : numOr(response, 0.15);
        const d = numOr(dampingFraction, 0.86) < 0 ? 0.86 : numOr(dampingFraction, 0.86);
        const o = numOr(overlapDuration, 0.25) < 0 ? 0.25 : numOr(overlapDuration, 0.25);
        return makeICurve(`responsive-spring-motion(${[r, d, o].map((n) => f6(n)).join(',')})`, null);
      },
      customCurve(interpolate) {
        // 真机 ParseCurves：回调非函数 → curveCreated=false → 返回 null（:426-434 同口径）；
        // 回调非数值返回 → 1.0（CurvesInterpolate 同式）；fraction 钳 [0,1] 在 makeICurve 层统一做
        if (typeof interpolate !== 'function') return null;
        const fn = /** @type {(f: number) => number} */ (interpolate);
        const curve = makeICurve('customCallback', (f) => {
          const r = fn(f);
          return typeof r === 'number' && Number.isFinite(r) ? r : 1;
        });
        curve.__curveCustomFunc = fn;    // 真机同名属性（jsi_curves_module.cpp:434）
        return curve;
      },
      // ── deprecated since 9 别名（d.ts 返回【string】：= 同参工厂的 __curveString 串）──
      init(curve) {
        return initCurveImpl(typeof curve === 'number' ? curve : undefined).__curveString;
      },
      steps(count, end) {
        return stepsStr(count, end !== false);
      },
      cubicBezier(x1, y1, x2, y2) {
        return bezierStr(x1, y1, x2, y2);
      },
      spring(velocity, mass, stiffness, damping) {
        return `spring(${springParams([velocity, mass, stiffness, damping])})`;
      },
    });
  }

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
    // ── v2（R83）：全屏/布局全屏/属性查询 ──
    // d.ts 实名：setFullScreen(isFullScreen) / setWindowLayoutFullScreen(isLayoutFullScreen)；
    // getWindowProperties() → WindowProperties{width,height,...,isFullScreen}。
    async setWindowFullScreen(isFullScreen) {
      if (!(await probeWindowBridge())) { winWarn('setWindowFullScreen'); return; }
      await globalThis.electronAPI.windowOp('setFullScreen', !!isFullScreen);
    }
    async setFullScreen(isFullScreen) { return this.setWindowFullScreen(isFullScreen); }
    async setWindowLayoutFullScreen(isLayoutFullScreen) {
      if (!(await probeWindowBridge())) { winWarn('setWindowLayoutFullScreen'); return; }
      await globalThis.electronAPI.windowOp('setFullScreen', !!isLayoutFullScreen);
    }
    async setKeepScreenOn(keepScreenOn) {
      if (!(await probeWindowBridge())) { winWarn('setKeepScreenOn'); return; }
      await globalThis.electronAPI.windowOp('setKeepScreenOn', !!keepScreenOn);
    }
    /** getWindowProperties：主窗尺寸真实值；浏览器降级返回文档化 stub（页面链上 p.isFullScreen 不断） */
    async getWindowProperties() {
      if (!(await probeWindowBridge())) {
        winWarn('getWindowProperties');
        return { width: 0, height: 0, x: 0, y: 0, isFullScreen: false, isMaximized: false };
      }
      return globalThis.electronAPI.windowOp('getProperties');
    }
    async getWindowAvoidArea(type) {
      logs.push(`[window] getWindowAvoidArea(type=${type})：桌面单窗无系统栏，返回全 0 区`);
      return { visibleRect: { left: 0, top: 0, right: 0, bottom: 0 }, boundingRect: { left: 0, top: 0, right: 0, bottom: 0 } };
    }
    // ── v3（R91）：2in1（鸿蒙 PC）窗口语义校准 ──
    // d.ts 实名：maximize(presentation?) / restore() / isFocused() / on('windowEvent')。
    // WindowEventType 数值照 @ohos.window.d.ts:2954-2986（SHOWN=1/ACTIVE=2/INACTIVE=3/HIDDEN=4/DESTROYED=7）。
    async maximize() { if (await probeWindowBridge()) await globalThis.electronAPI.windowOp('maximize'); else winWarn('maximize'); }
    async restore() { if (await probeWindowBridge()) await globalThis.electronAPI.windowOp('restore'); else winWarn('restore'); }
    async isFocused() {
      if (!(await probeWindowBridge())) return false;
      return globalThis.electronAPI.windowOp('isFocused');
    }
    on(type, cb) {
      if (type === 'windowSizeChange') { windowSizeListeners.add(cb); return; }
      if (type === 'windowEvent') { windowEventListeners.add(cb); return; }
      winWarn("on('" + type + "')—— 已支持 windowSizeChange/windowEvent（2in1 面）");
    }
    off(type, cb) {
      if (type === 'windowSizeChange') windowSizeListeners.delete(cb);
      if (type === 'windowEvent') windowEventListeners.delete(cb);
    }
  }

  // WindowEventType（@ohos.window.d.ts:2954-2986）——2in1 窗口生命周期数值，垫片暴露供页面/测试用
  const WINDOW_EVENT_TYPE = {
    WINDOW_SHOWN: 1, WINDOW_ACTIVE: 2, WINDOW_INACTIVE: 3, WINDOW_HIDDEN: 4, WINDOW_DESTROYED: 7,
  };
  const windowEventListeners = new Set();

  // 主进程把 resize 事件 push 到渲染侧（preload 转发）；浏览器端永不触发
  if (globalThis.electronAPI && globalThis.electronAPI.onWindowSizeChange) {
    globalThis.electronAPI.onWindowSizeChange((size) => {
      const ev = { type: 'windowSizeChange', width: size.width, height: size.height };
      for (const cb of [...windowSizeListeners]) { try { cb(ev); } catch (e) {} }
    });
  }
  // R91：窗口生命周期事件转发（WINDOW_SHOWN/ACTIVE/INACTIVE/HIDDEN 数值见 WINDOW_EVENT_TYPE）
  if (globalThis.electronAPI && globalThis.electronAPI.onWindowEvent) {
    globalThis.electronAPI.onWindowEvent((ev) => {
      for (const cb of [...windowEventListeners]) { try { cb({ type: ev.type }); } catch (e) {} }
    });
  }

  define('window', {
    WindowStage: class WindowStage {},
    Window: WindowShim,
    // R91：2in1 窗口生命周期数值（@ohos.window.d.ts:2954-2986），供页面/测试对齐断言
    WindowEventType: WINDOW_EVENT_TYPE,
    /** getLastWindow(): Promise<Window> —— 单窗形态恒返回同一实例（Electron 主窗） */
    getLastWindow: async () => new WindowShim('main'),
    /** findWindow(id)：v1 单窗，忽略 id */
    findWindow: async () => new WindowShim('main'),
    /** getTopWindow / getMainWindow 同收敛到主窗 */
    getTopWindow: async () => new WindowShim('main'),
    getMainWindow: async () => new WindowShim('main'),
  });

  // ── @ohos:file.picker —— 文件选择器 v1（R82，桌面线）──
  //
  // 权威语义来自 `@ohos.file.picker.d.ts`：DocumentViewPicker.select()/save()、
  // PhotoViewPicker.select()。Electron 侧走 fileDialog IPC（main 的 dialog.showOpen/SaveDialog），
  // IPC 返回形与 Document 形一致：Array<string>（uri 数组）。
  // 浏览器端探测式降级（R21 先例）：select/save 恒返回空数组。
  // PhotoSelectResult 形（photoUris）由本垫片包装（真机 Photo 形）。
  const fileDialog = (kind, options) => {
    if (globalThis.electronAPI && globalThis.electronAPI.fileDialog) {
      return globalThis.electronAPI.fileDialog(kind, options);
    }
    logs.push(`[file.picker] ${kind}：当前宿主无文件对话框桥（探测式降级 → 空数组）`);
    return Promise.resolve([]);
  };

  const commonPickerOptions = (op) => {
    if (!op || typeof op !== 'object') return {};
    // d.ts：maxSelectNumber 默认 1（Document）；fileSuffixFilters 形如 ['.txt','.md']
    return {
      maxSelectNumber: typeof op.maxSelectNumber === 'number' ? op.maxSelectNumber : 1,
      fileSuffixFilters: Array.isArray(op.fileSuffixFilters) ? op.fileSuffixFilters.map(String) : [],
      newFileNames: Array.isArray(op.newFileNames) ? op.newFileNames.map(String) : [],
    };
  };

  class DocumentViewPicker {
    select(op) { return fileDialog('select', commonPickerOptions(op)); }
    save(op) { return fileDialog('save', commonPickerOptions(op)); }
  }
  class PhotoViewPicker {
    // d.ts：PhotoViewPicker.select → Promise<PhotoSelectResult{ photoUris, ... }>；
    // IPC 返回 Array<string>（同 Document 形），这里包装成 photoUris 形。
    select(op) {
      return fileDialog('select', commonPickerOptions(op)).then((arr) => ({
        photoUris: Array.isArray(arr) ? arr : [],
      }));
    }
    save(op) { return fileDialog('save', commonPickerOptions(op)); }
  }
  class AudioViewPicker {
    select(op) { return fileDialog('select', commonPickerOptions(op)); }
  }
  define('file.picker', {
    DocumentViewPicker,
    PhotoViewPicker,
    AudioViewPicker,
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

  // ── @ohos.multimedia.image —— 图像信息（R18）+ 像素读取（R159-C） ──
  //
  // 权威来源 `@ohos.multimedia.image.d.ts`：
  //   createImageSource(uri: string): ImageSource
  //   ImageSource.getImageInfo(): Promise<ImageInfo> / getImageInfo(cb) / getImageInfoSync(): ImageInfo
  //   ImageSource.getImageProperty(key: PropertyKey, options?): Promise<string> / (key, cb) / (key, options, cb)
  //   ImageSource.createPixelMap(options?: DecodingOptions): Promise<PixelMap> / (cb) / (options, cb)
  //   image.createPixelMap(colors: ArrayBuffer, options: InitializationOptions): Promise<PixelMap> / (+cb)
  //     —— 旧 API（≤11）形状是 Array<number>（每项一个像素），两种都收（见 createPixelMapFromColors）
  //   PixelMap.getImageInfo() / getImageInfoSync() / getPixelBytesNumber() / getBytesNumberPerRow()
  //          / readPixelsToBuffer(dst): Promise<void> / (dst, cb) / readPixelsToBufferSync(dst)
  //   ImageInfo { size: Size, density, stride, pixelFormat, alphaType, mimeType, isHdr }；Size { width, height }
  //
  // 实现取向与 R15 的文本测量一致：**让浏览器真解码**（fetch + createImageBitmap），
  // 而不是自己解析 PNG/JPEG 头 —— 宽高来自真实解码器，mimeType 来自真实响应的 Content-Type。
  //
  // R159-C 像素语义（写透，防后人误改）：
  //   · 解码缓存：createImageBitmap 后再画到 OffscreenCanvas，getImageData 产出 Uint8ClampedArray。
  //     TypedArray 的字节序固定为 [R,G,B,A]（视图字节序与平台端序无关）——所以"真像素、端无关"。
  //   · PixelMap 按其声明的 pixelFormat 存字节：RGBA_8888 原生；BGRA_8888 在构造时换 R、B。
  //     readPixelsToBuffer 按 d.ts 语义"按 PixelMap 的像素格式写入 dst"＝原样拷贝缓存字节。
  //   · 格式取舍：Canvas 只出 RGBA/BGRA。desiredPixelFormat=RGB_565 不支持 → 记警告退回 RGBA_8888
  //     （不静默——否则调用方拿到的字节布局和它以为的不一致）。
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
  // image 段内共享：BusinessError 成功形状 + 警告通道（与 R18 段 dedupe 规则一致）
  const imgOk = () => ({ code: 0, message: '' });
  const imgWarn = (msg) => {
    const w0 = global.__arkui_dom_layout_warnings;
    if (w0 && !w0.includes(msg)) w0.push(msg);
  };
  // 交换每像素的 R、B 字节（RGBA↔BGRA 是同一个操作：交换是自逆的）
  const swizzleRB = (src) => {
    const out = new Uint8Array(src.length);
    for (let i = 0; i + 3 < src.length; i += 4) {
      out[i] = src[i + 2]; out[i + 1] = src[i + 1]; out[i + 2] = src[i]; out[i + 3] = src[i + 3];
    }
    return out;
  };
  // data:[mediatype][;base64],payload → Blob（不走 fetch：CSP connect-src 面零依赖，见
  // _ensureDecoded 内注释）。meta=base64 与 URL 编码两种载荷都支持。
  // mediatype 缺省时按魔数嗅探（与 mimeType 权威口径同源）；仍认不出才落 image/png 兜底
  // ——Blob 无类型会让 createImageBitmap 拒解。
  const dataUriToBlob = (url) => {
    const m = url.match(/^data:([^,]*),(.*)$/s);
    if (!m) throw fsErr(62980103, `无法解析的 data: URI：${url.slice(0, 64)}…`);
    const meta = m[1];
    let payload = m[2].replace(/\s/g, '');
    let bytes;
    if (/(^|;)base64$/i.test(meta)) {
      const bin = atob(payload);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      payload = decodeURIComponent(payload);
      bytes = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i++) bytes[i] = payload.charCodeAt(i) & 0xff;
    }
    let mime = meta.split(';')[0].trim();
    if (!mime) mime = sniffImageFormat(bytes) || 'image/png';
    return new Blob([bytes], { type: mime });
  };
  // 经典解码回退：Blob → objectURL → <img> onload（width/height=natural，drawImage 直吃）
  // ——无解码服务依赖，createImageBitmap 看门狗超时后的备用通路（见 _ensureDecoded 内注释）
  const decodeViaImgElement = (blob) => new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(objUrl); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(objUrl); reject(fsErr(62980103, '<img> 回退解码失败（字节非可解码图像？）')); };
    im.src = objUrl;
  });
  // 输入按 RGBA 顺序 → 输出按 format 排列（拷贝，不改输入）
  const rgbaToFormat = (rgba, format) =>
    format === 4 /* BGRA_8888 */ ? swizzleRB(rgba) : new Uint8Array(rgba);
  class ImageSource {
    constructor(uri) {
      this.uri = String(uri);
      this._info = null;
      this._pending = null;
      this._pixels = null;   // R159-C：解码结果的 RGBA 像素缓存（Uint8ClampedArray），OffscreenCanvas 不可用时为 null
    }
    _ensureDecoded() {
      if (!this._pending) {
        this._pending = (async () => {
          const url = resolveImageUrl(this.uri);
          let blob;
          if (url.startsWith('data:')) {
            // data: URI 直接解码、不走 fetch——Electron 注入的 CSP 没有 connect-src，
            // fetch(data:) 被 default-src 'self' 拦下（浏览器无 CSP 的端看不到这个差异，
            // electron imageext 首跑抓出）。meta=base64 与 URL 编码两种载荷都支持。
            blob = dataUriToBlob(url);
          } else {
            let res;
            try {
              res = await fetch(url);
            } catch (e) {
              throw fsErr(62980103, `读取图像失败（网络错误）：${url} —— ${e && e.message}`);
            }
            if (!res.ok) {
              throw fsErr(62980103, `读取图像失败：HTTP ${res.status} ${res.statusText}（${url}）`);
            }
            blob = await res.blob();
          }
          if (typeof global.createImageBitmap !== 'function') {
            throw fsErr(62980103, `本环境没有 createImageBitmap，无法解码图像（${url}）`);
          }
          const buf = new Uint8Array(await blob.arrayBuffer());
          // createImageBitmap 带 3s 看门狗：GitHub runner 的 headless Chrome 实测过
          // 该调用永不 resolve（imageext CI 三跑双腿 0 条 running…，本地 154 同版
          // 正常）——超时回退 <img> + 常规 canvas 解码（经典通路，无解码服务依赖）。
          // 回退不改变对外行为：宽高/像素语义一致，只多一条 imgWarn 留痕（不静默）。
          const bmp = await Promise.race([
            global.createImageBitmap(blob),
            new Promise((res) => setTimeout(res, 3000, null)),
          ]).then((b) => {
            if (b) return b;
            imgWarn(`image: createImageBitmap 3s 未返回（疑似无头环境解码服务缺位，${url}）——回退 <img> 解码`);
            return decodeViaImgElement(blob);
          });
          const w = bmp.width, h = bmp.height;
          // R159-C：栅格化缓存真像素（供 createPixelMap）。getImageInfo 的对外行为不变。
          if (typeof global.OffscreenCanvas === 'function') {
            try {
              const oc = new global.OffscreenCanvas(w, h);
              const ctx = oc.getContext('2d');
              ctx.drawImage(bmp, 0, 0);
              this._pixels = ctx.getImageData(0, 0, w, h).data;    // RGBA 顺序，端无关（见段首说明）
            } catch (e) {
              this._pixels = null;
              imgWarn(`image: OffscreenCanvas 栅格化失败（${url}）：${e && e.message} —— createPixelMap 将不可用`);
            }
          }
          if (typeof bmp.close === 'function') bmp.close();
          let mimeType = sniffImageFormat(buf);
          if (!mimeType) {
            // 认不出来就退回响应头 —— 但要出声（否则会把"没识别"伪装成"识别对了"）
            mimeType = blob.type || '';
            imgWarn(`image.getImageInfo: 未能从字节识别图像格式（${url}），已退回响应头 '${mimeType}'`);
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
      return this._pending;
    }
    getImageInfo(cb) {
      const p = this._ensureDecoded();
      if (typeof cb === 'function') {
        // 成功时也要传 BusinessError 形状的对象（code: 0）—— 产物里是 `if (err.code)`，传 null 会 TypeError
        p.then((v) => cb(imgOk(), v), (e) => cb(e));
        return undefined;
      }
      return p;
    }
    getImageInfoSync() {
      if (this._info) return this._info;
      // 同步 API 无法等待解码 —— 响亮失败，绝不编一个尺寸出来
      throw fsErr(62980103,
        `getImageInfoSync 无法同步解码（${this.uri}）：本实现只回【已解码】的缓存，请先 await getImageInfo()`);
    }
    // R159-C：EXIF 属性面。d.ts PropertyKey 的值域是字符串（'ImageWidth'/'ImageLength'/…），
    // 现行签名 getImageProperty(key): Promise<string>（旧版还有 (key, cb)/(key, options, cb)）。
    getImageProperty(key, options, cb) {
      // 重载归一：getImageProperty(key, cb) / (key, options, cb)
      if (typeof options === 'function') { cb = options; options = undefined; }
      const k = String(key);
      const p = this._ensureDecoded().then((info) => {
        if (k === 'ImageWidth') return String(info.size.width);
        // 'ImageLength' 是 d.ts 枚举里"高"的真名（EXIF 语义）；'ImageHeight' 不在枚举里，
        // 但任务面要求它可用 —— 作为宽容别名一并支持，注释在此声明这不是枚举值。
        if (k === 'ImageLength' || k === 'ImageHeight') return String(info.size.height);
        // 其余 EXIF 属性（Orientation/GPS*/ExposureTime/…）：DOM 侧没有 EXIF 解码能力，
        // 出声记警告 + 返回 ''（绝不编一个看似合法的值）。
        imgWarn(`image.getImageProperty: 属性 '${k}' 在 DOM 运行时不可得（无 EXIF 读取能力），返回 ''`);
        return '';
      });
      if (typeof cb === 'function') { p.then((v) => cb(imgOk(), v), (e) => cb(e)); return undefined; }
      return p;
    }
    // R159-C：解码为像素数据。options.desiredPixelFormat 默认 RGBA_8888（Canvas 原生）。
    createPixelMap(options, cb) {
      // 重载归一：createPixelMap(cb) / (options) / (options, cb)
      if (typeof options === 'function') { cb = options; options = undefined; }
      const pf = options && options.desiredPixelFormat !== undefined
        ? Number(options.desiredPixelFormat) : 3 /* RGBA_8888 */;
      const p = this._ensureDecoded().then((info) => {
        if (!this._pixels) {
          throw fsErr(62980103,
            `createPixelMap 无法取像素（${this.uri}）：本环境没有可用的 OffscreenCanvas/getImageData`);
        }
        if (pf !== 3 && pf !== 4) {
          imgWarn(`image.ImageSource.createPixelMap: desiredPixelFormat=${pf} 不支持（Canvas 只出 RGBA_8888/BGRA_8888），已退回 RGBA_8888`);
        }
        const fmt = pf === 4 ? 4 : 3;
        return new PixelMap(rgbaToFormat(this._pixels, fmt), info.size.width, info.size.height, fmt);
      });
      if (typeof cb === 'function') { p.then((v) => cb(imgOk(), v), (e) => cb(e)); return undefined; }
      return p;
    }
    release() {
      this._info = null;
      this._pending = null;
      this._pixels = null;
      return Promise.resolve();
    }
  }
  // R159-C：PixelMap —— 已解码像素的句柄。字节按构造时声明的 format 排列，
  // readPixelsToBuffer 原样拷贝（d.ts："based on the PixelMap's pixel format"）。
  class PixelMap {
    constructor(bytes, w, h, format) {
      this._bytes = bytes;
      this._info = {
        size: { width: w, height: h },
        density: 0,
        stride: w * 4,
        pixelFormat: format,
        alphaType: 0,
        mimeType: '',
        isHdr: false,
      };
    }
    getImageInfo(cb) {
      const p = Promise.resolve(this._info);
      if (typeof cb === 'function') { p.then((v) => cb(imgOk(), v), (e) => cb(e)); return undefined; }
      return p;
    }
    getImageInfoSync() { return this._info; }
    getBytesNumberPerRow() { return this._info.stride; }
    getPixelBytesNumber() { return this._bytes ? this._bytes.byteLength : 0; }
    getDensity() { return this._info.density; }
    _readToBuffer(dst) {
      return Promise.resolve().then(() => {
        if (!this._bytes) throw fsErr(7600105, 'readPixelsToBuffer：PixelMap 已 release，无法再读像素');
        if (!(dst instanceof ArrayBuffer)) {
          throw fsErr(401, `readPixelsToBuffer 的 dst 必须是 ArrayBuffer（得到 ${
            dst === null ? 'null' : typeof dst === 'object' ? (dst.constructor && dst.constructor.name) || 'object' : typeof dst}）`);
        }
        if (dst.byteLength < this._bytes.byteLength) {
          throw fsErr(7600206,
            `readPixelsToBuffer 的 dst 太小：需要 ${this._bytes.byteLength} 字节，得到 ${dst.byteLength}（用 getPixelBytesNumber() 取正确大小）`);
        }
        new Uint8Array(dst, 0, this._bytes.byteLength).set(this._bytes);
      });
    }
    readPixelsToBuffer(dst, cb) {
      const p = this._readToBuffer(dst);
      if (typeof cb === 'function') { p.then(() => cb(imgOk()), (e) => cb(e)); return undefined; }
      return p;
    }
    readPixelsToBufferSync(dst) {
      if (!this._bytes) throw fsErr(7600105, 'readPixelsToBufferSync：PixelMap 已 release，无法再读像素');
      if (!(dst instanceof ArrayBuffer)) throw fsErr(401, 'readPixelsToBufferSync 的 dst 必须是 ArrayBuffer');
      if (dst.byteLength < this._bytes.byteLength) {
        throw fsErr(7600206,
          `readPixelsToBufferSync 的 dst 太小：需要 ${this._bytes.byteLength} 字节，得到 ${dst.byteLength}`);
      }
      new Uint8Array(dst, 0, this._bytes.byteLength).set(this._bytes);
    }
    release() { this._bytes = null; return Promise.resolve(); }
  }
  // image.createPixelMap(colors, options)：现行 d.ts 的 colors 是 ArrayBuffer
  // （字节按 options.srcPixelFormat，默认 BGRA_8888）；旧 API（≤11）形状是 Array<number>
  // （每项一个像素，0xRRGGBBAA —— 低 8 位 alpha）。两种都收；产出 PixelMap 的格式取
  // options.pixelFormat（默认 RGBA_8888）。纯 JS 填 buffer，端无关（字节布局手工固定）。
  const createPixelMapFromColors = (colors, options) => (async () => {
    const size = options && options.size;
    const w = size && Math.floor(Number(size.width));
    const h = size && Math.floor(Number(size.height));
    if (!(w > 0) || !(h > 0)) {
      throw fsErr(401, `createPixelMap 需要 options.size = { width > 0, height > 0 }（得到 ${JSON.stringify(size)}）`);
    }
    const count = w * h;
    const srcFormat = options && options.srcPixelFormat !== undefined ? Number(options.srcPixelFormat) : 4;
    const dstFormat = options && options.pixelFormat !== undefined ? Number(options.pixelFormat) : 3;
    if (dstFormat !== 3 && dstFormat !== 4) {
      imgWarn(`image.createPixelMap: pixelFormat=${dstFormat} 不支持（只出 RGBA_8888/BGRA_8888），已退回 RGBA_8888`);
    }
    let rgba;
    if (colors instanceof ArrayBuffer) {
      if (srcFormat !== 3 && srcFormat !== 4) {
        throw fsErr(401, `createPixelMap 的 srcPixelFormat=${srcFormat} 不支持（支持 RGBA_8888/BGRA_8888）`);
      }
      if (colors.byteLength < count * 4) {
        throw fsErr(401, `createPixelMap 的 colors 太小：需要 ${count * 4} 字节（${w}×${h}×4），得到 ${colors.byteLength}`);
      }
      const src = new Uint8Array(colors, 0, count * 4);
      rgba = srcFormat === 4 ? swizzleRB(src) : new Uint8Array(src);
    } else if (Array.isArray(colors)) {
      if (colors.length < count) {
        throw fsErr(401, `createPixelMap 的 colors 元素不足：需要 ${count} 个（每项一个像素），得到 ${colors.length}`);
      }
      rgba = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        const c = Number(colors[i]) >>> 0;
        rgba[i * 4] = (c >>> 24) & 0xff;      // R
        rgba[i * 4 + 1] = (c >>> 16) & 0xff;  // G
        rgba[i * 4 + 2] = (c >>> 8) & 0xff;   // B
        rgba[i * 4 + 3] = c & 0xff;           // A（旧 API 文档语义 0xRRGGBBAA）
      }
    } else {
      throw fsErr(401, 'createPixelMap 的 colors 必须是 ArrayBuffer（现行 d.ts）或 Array<number>（旧 API 形状）');
    }
    return new PixelMap(rgbaToFormat(rgba, dstFormat), w, h, dstFormat);
  })();
  define('multimedia.image', {
    createImageSource: (uri) => new ImageSource(uri),
    // 双 Promise 风格：createPixelMap(colors, options) / (colors, options, cb)
    createPixelMap: (colors, options, cb) => {
      if (typeof cb !== 'function' && typeof options === 'function') { cb = options; options = undefined; }
      const p = createPixelMapFromColors(colors, options);
      if (typeof cb === 'function') { p.then((v) => cb(imgOk(), v), (e) => cb(e)); return undefined; }
      return p;
    },
    ImageSource,
    PixelMap,
    AlphaType: { UNKNOWN: 0, OPAQUE: 1, PREMUL: 2, UNPREMUL: 3 },
    PixelMapFormat: { UNKNOWN: 0, RGB_565: 2, RGBA_8888: 3, BGRA_8888: 4, RGB_888: 5 },
    // PropertyKey：EXIF 属性名值域（现行 d.ts 枚举；值是字符串）。列常用项，
    // 全量枚举见 @ohos.multimedia.image.d.ts 的 enum PropertyKey。
    PropertyKey: {
      BITS_PER_SAMPLE: 'BitsPerSample',
      ORIENTATION: 'Orientation',
      IMAGE_LENGTH: 'ImageLength',
      IMAGE_WIDTH: 'ImageWidth',
      GPS_LATITUDE: 'GPSLatitude',
      GPS_LONGITUDE: 'GPSLongitude',
      GPS_LATITUDE_REF: 'GPSLatitudeRef',
      GPS_LONGITUDE_REF: 'GPSLongitudeRef',
      DATE_TIME_ORIGINAL: 'DateTimeOriginal',
      EXPOSURE_TIME: 'ExposureTime',
      SCENE_TYPE: 'SceneType',
      ISO_SPEED_RATINGS: 'ISOSpeedRatings',
      F_NUMBER: 'FNumber',
      DATE_TIME: 'DateTime',
      IMAGE_DESCRIPTION: 'ImageDescription',
      MAKE: 'Make',
      MODEL: 'Model',
      APERTURE_VALUE: 'ApertureValue',
      EXPOSURE_BIAS_VALUE: 'ExposureBiasValue',
      METERING_MODE: 'MeteringMode',
      LIGHT_SOURCE: 'LightSource',
      FLASH: 'Flash',
      FOCAL_LENGTH: 'FocalLength',
      USER_COMMENT: 'UserComment',
      PIXEL_X_DIMENSION: 'PixelXDimension',
      PIXEL_Y_DIMENSION: 'PixelYDimension',
      WHITE_BALANCE: 'WhiteBalance',
    },
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
  // R128：@ohos:resourceManager（类型命名空间——产物 import type 也会生成 require，
  // 运行时值面只有 ResourceManager 占位类；真 API 在 getContext().resourceManager）
  define('resourceManager', { ResourceManager: class ResourceManager {} });
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
      // R128：resourceManager 真实现。app 表由 runtime/src/generated-app-resources.js
      // 生成（byId↔type/name + values + media 路径）；媒体字节由 runtime 预热
      // （__arkui_app_media_bytes）。颜色 number = 0xAARRGGBB（alpha FF，ArkUI 口径）。
      const resManagerReal = () => {
        const app = /** @type {any} */ (global).__arkui_app_res || null;
        const bytes = /** @type {any} */ (global).__arkui_app_media_bytes || {};
        const strByResource = (r) => {
          if (typeof r === 'string') return r;
          const rec = app && app.byId[r && r.id];
          if (!rec || rec.type !== 'string') { warnRes(r); return String(r && r.name || r); }
          return app.values.string[rec.name] !== undefined ? app.values.string[rec.name] : rec.name;
        };
        const warnRes = (r) => { try { logs.push({ t: 'resFallback', r: String(r) }); } catch (e) { /* 免疫 */ } };
        const colorToNum = (hex) => {
          const h = String(hex).replace('#', '');
          const rgb = parseInt(h.slice(-6), 16);
          return 0xff000000 + rgb;
        };
        return {
          getStringSync(r) { return strByResource(r); },
          getStringByNameSync(name) {
            if (app && app.values.string[name] !== undefined) return app.values.string[name];
            warnRes(name); return name;
          },
          getColorSync(r) {
            const rec = app && app.byId[r && r.id];
            const hex = rec && rec.type === 'color' ? app.values.color[rec.name]
              : (typeof r === 'string' && app ? app.values.color[r] : undefined);
            if (hex === undefined) { warnRes(r); return 0; }
            return colorToNum(hex);
          },
          getColorByNameSync(name) {
            const hex = app && app.values.color[name];
            if (hex === undefined) { warnRes(name); return 0; }
            return colorToNum(hex);
          },
          getMediaContentSync(r) {
            const rec = app && app.byId[r && r.id];
            const name = rec && rec.type === 'media' ? rec.name
              : (typeof r === 'string' ? r : undefined);
            const b = name ? bytes[name] : undefined;
            if (!b) { warnRes(name || r); return new Uint8Array(0); }
            return b;
          },
          getMediaByNameSync(name) {
            const b = app && app.media[name] ? bytes[name] : undefined;
            if (!b) { warnRes(name); return new Uint8Array(0); }
            return b;
          },
        };
      };
      const appContext = {
        setColorMode(mode) { logs.push({ t: 'setColorMode', mode }); },
        getApplicationContext() { return appContext; },
      };
      global.__arkui_dom_context = {
        filesDir: PREF_DIR,
        cacheDir: '/vfs/cache',
        tempDir: '/vfs/temp',
        getApplicationContext: () => appContext,
        // R128：resourceManager 真实现（背 __arkui_app_res 生成表 + 预热媒体字节）——
        // 表缺席时回落"名字进名字出"（旧兜底语义，标警告不静默）
        resourceManager: resManagerReal(),
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

          // R133：retry（E1-1 企业面）——{maxRetry, backoffMs}（本项目扩展形状，SDK 无此字段；
          // 语义：5xx/网络层失败时重试，退避=backoffMs*已重试次数，最多 maxRetry 次）
          const maxRetry = (opt.retry && Number(opt.retry.maxRetry)) || 0;
          const backoffMs = (opt.retry && Number(opt.retry.backoffMs)) || 200;

          // 超时：官方用 connectTimeout/readTimeout(ms)，这里用 AbortController 实现。
          // R133：整体超时覆盖【含重试退避】的完整窗口（企业语义：给调用方的总时限承诺）
          const ms = Number(opt.readTimeout || opt.connectTimeout || 0);
          const ctrl = ms > 0 && global.AbortController ? new global.AbortController() : null;
          let timer = null;
          if (ctrl) timer = setTimeout(() => ctrl.abort(), ms);

          /** 单次尝试：网络层异常/5xx → null（可重试）；其余返回 Response */
          const attempt = async () => {
            try {
              const res = await fetch(target, {
                method,
                headers: opt.header || opt.headers || {},
                body: opt.extraData !== undefined ? opt.extraData : undefined,
                signal: ctrl ? ctrl.signal : undefined,
              });
              return res.status >= 500 ? null : res;
            } catch (e) {
              const isAbort = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
              if (isAbort) throw fsErr(2300028, `Timeout: ${ms}ms`);
              return null;                        // 网络层失败 → 可重试
            }
          };

          let res = null;
          let retriedCount = 0;
          try {
            for (let tried = 0; tried <= maxRetry; tried++) {
              if (tried > 0 && backoffMs > 0) {
                await new Promise((r) => setTimeout(r, backoffMs * tried));
              }
              try {
                res = await attempt();
              } catch (e) {
                // 超时等终局异常：留痕后原样上抛（R128 前旧版行为，async.html 断言依赖）
                logs.push({ t: 'http.requestFailed', url: target, method, message: e.message, timedOut: /Timeout/.test(e.message || '') });
                throw e;
              }
              if (res !== null) break;
              retriedCount = tried + 1;
              logs.push({ t: 'http.retry', url: target, attempt: tried + 1, of: maxRetry + 1 });
            }
            if (res === null) {
              // 重试耗尽仍失败：统一按连接失败报（重试日志已留痕）
              logs.push({ t: 'http.requestFailed', url: target, method, message: 'retries exhausted', timedOut: false });
              throw fsErr(2300007, `Could not connect to server (retried ${maxRetry + 1} times): ${target}`);
            }
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
            // R133：企业面属性如实记录（真语义/记录面的分界见各属性注释）
            usingProxy: opt.usingProxy !== undefined ? (typeof opt.usingProxy === 'boolean' ? opt.usingProxy : 'HttpProxy') : undefined,
            usingCache: opt.usingCache,
            maxLimit: opt.maxLimit,
            retried: retriedCount,
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

  // ── @ohos:multimedia.media（R35 收官；R152-A 时钟跨端贯通）──
  // AVPlayer → HTMLAudioElement 的状态机垫片。语义锚点（@ohos.multimedia.media.d.ts）：
  //   url 赋值 → 'initialized'；prepare() → 'prepared'；play() → 'playing'；pause() → 'paused'；
  //   seek(ms) 移动播放位置；duration/currentTime 随播放推进；on('stateChange', (state, reason) => …)。
  //
  // 时钟来源（R152-A 定案）：currentTime 是【纯墙钟】——play 起点记 Date.now()，playing 期间
  // 按 (now−起点) 推进，pause 冻结，seek 移动基点，暂停续播从冻结点续走。不读 audio.currentTime、
  // 不用 rAF、不碰解码管线 → 对宿主时钟（headless Chrome 虚拟时钟 / Electron offscreen 真实时钟）
  // 数学上同构，双端 MEDIA log 逐字节相同（mediademo ③ 组直连面断言在两端把守这一事实）。
  // R35 曾记"Electron 时钟未打通、断言分端"——实情是墙钟垫片与分端断言同批落地后，
  // Electron 只复核了放宽后的状态机断言、T 值从未在 Electron 验过（R35 提交信息
  // "Electron 状态机绿（时钟分端）"）；R152-A 实测双端 T3 一致，分端断言就此合并。
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
          // duration 对 data URI 的真实来源（R152-A）：data:audio/wav 的 RIFF 头是自描述的——
          // data 块字节数 / byteRate = 秒数，纯 JS 可解析、端无关。audio.duration 对 data URI
          // 是 NaN（解码元数据不出）——这就是 R35"恒 -1"的来源。R152-A 起 WAV data URI 返回
          // 头里的真实声明时长（含 fixture 空 WAV 的 0——它是"声明了 0 秒音频"，不是"未知"）。
          // 非 WAV data URI（mp3/aac 盒式头无通用轻量解析器，超出垫片已知信息）与 http/file
          // URL（有真实解码元数据）不在此解析 → 回退 audio.duration / -1。
          const wavDataUriDuration = (src) => {
            try {
              const m = /^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/.exec(String(src));
              if (!m) return null;
              const bin = atob(m[1]);
              if (bin.length < 44 || bin.slice(0, 4) !== 'RIFF' || bin.slice(8, 12) !== 'WAVE') return null;
              const u32 = (o) => (bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) |
                (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24)) >>> 0;
              let off = 12;                        // 跳过 RIFF 头 12 字节，顺 chunk 链走
              let byteRate = 0;
              while (off + 8 <= bin.length) {
                const id = bin.slice(off, off + 4);
                const size = u32(off + 4);
                if (id === 'fmt ' && off + 24 <= bin.length) byteRate = u32(off + 16); // fmt 块 +8 起
                if (id === 'data') return byteRate > 0 ? size / byteRate : null;  // 声明值就是 size（off+4 处已读）
                off += 8 + size + (size % 2);      // RIFF chunk 按 2 字节对齐
              }
              return null;
            } catch (e) { return null; }
          };
          audio.addEventListener('loadedmetadata', () => {
            if (state === 'initialized') { state = 'prepared'; setState('prepared'); }
          });
          audio.addEventListener('play', () => setState('playing'));
          audio.addEventListener('pause', () => { if (state === 'playing') setState('paused'); });
          audio.addEventListener('ended', () => {
            // completed 的墙钟定格：真解码管线才可能走到（data URI 空/短媒体在双端实测都不触发）。
            // 若不接住，completed 态会掉进 currentTime 的兜底 0——时钟断言的潜在竞态红点
            if (playStartedAt > 0) endedElapsed = (Date.now() - playStartedAt) / 1000;
            setState('completed');
          });
          // currentTime 的来源（DOM 化映射，取舍已记录）：data URI 的短音频真实解码时长
          // 为 0（首跑实测时钟不推进）——垫片记录 play 起点的真实挂钟，playing 期间按墙钟推进，
          // pause 时冻结。语义真实（"播放了多久"），但不来自音频解码。
          let playStartedAt = 0;
          let pausedAt = 0;
          let parsedDuration = null;    // set url 时解析一次；null = 不可解析 → 回退 audio.duration
          let endedElapsed = 0;
          const player = {
            get state() { return state; },
            set url(v) {
              state = 'initialized';
              parsedDuration = wavDataUriDuration(v);
              setState('initialized');
              audio.src = String(v);      // 垫片独立于 runtime 的 resolveResource（shims 先加载）
            },
            get duration() {
              if (parsedDuration !== null) return parsedDuration;
              return Number.isFinite(audio.duration) ? audio.duration : -1;
            },
            get currentTime() {
              if (state === 'playing' && playStartedAt > 0) return (Date.now() - playStartedAt) / 1000;
              if (state === 'completed' && playStartedAt > 0) return endedElapsed;
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
            // pause 未曾 play 过时（playStartedAt=0）不产生垃圾冻结点：否则 pausedAt=墙钟大值，
            // 之后 play() 会从"假装播了很久"的位置续走
            pause() { audio.pause(); pausedAt = playStartedAt > 0 ? Date.now() - playStartedAt : 0; state = 'paused'; setState('paused'); return Promise.resolve(); },
            stop() { audio.pause(); audio.currentTime = 0; state = 'stopped'; setState('stopped'); return Promise.resolve(); },
            // seek 移动【墙钟基点】（R152-A）：此前 seek 只写 audio.currentTime（data URI 下
            // 被钳 0），currentTime 读数纹丝不动——垫片时钟面对 seek 失明。现在 playing 态改写
            // play 起点、其余态改写冻结点（play() 的 pausedAt 续走逻辑自动衔接），与
            // d.ts "seek(ms) 移动播放位置" 语义对齐
            seek(ms) {
              const base = Math.max(0, Number(ms) || 0);   // 负偏移钳 0
              audio.currentTime = base / 1000;
              if (state === 'playing' && playStartedAt > 0) playStartedAt = Date.now() - base;
              else pausedAt = base;
              return Promise.resolve();
            },
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

  // ── @ohos:arkui.node —— NodeContent（R118：ContentSlot 的命令式内容持有者）──
  // d.ts 原文面（api/arkui/NodeContent.d.ts）：constructor() / addFrameNode(node) /
  // removeFrameNode(node)，extends Content（抽象基占位）。R120 判定 partial 的
  // 缺口半边：真机的 ArkUI_NodeHandle 节点图与句柄注册表在浏览器无对应——
  // 本 shim 的"原生侧内容"由宿主用 DOM 节点模拟（_bindHost 是与 ContentSlot
  // 组件的内部协作接口，非 d.ts API）。抢占式 detach 对齐 content_slot_node.h:49-66。
  define('arkui.node', {
    Content: class { },
    NodeContent: class {
      constructor() {
        this._children = [];   // 宿主 DOM 节点（模拟原生 FrameNode）
        this._host = null;
      }
      addFrameNode(node) {
        this._children.push(node);
        if (this._host && node && node.parentNode !== this._host) this._host.appendChild(node);
      }
      removeFrameNode(node) {
        const i = this._children.indexOf(node);
        if (i >= 0) this._children.splice(i, 1);
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
      /** 内部协作：ContentSlot.create 时抢占式绑定挂载点（旧 host 先摘净） */
      _bindHost(el) {
        if (this._host && this._host !== el) {
          this._children.forEach((c) => { if (c.parentNode === this._host) this._host.removeChild(c); });
        }
        this._host = el;
        this._children.forEach((c) => { if (c.parentNode !== el) el.appendChild(c); });
      }
    },
  });

  // ── @ohos:cjk —— 进程内仓颉内核（R98，桌面线）──
  //
  // 形态沿 @ohos.hilog 一类的"静态能力对象"：方法名分派（kernel/c-abi.h 契约的渲染侧投影）。
  // 链路：垫片 → preload electronAPI.cjk → main ipcMain.handle('arkui:cjk:*') →
  // NAPI addon → dlopen 仓颉运行时 + kernel/cangjie/libkernel.so → dlsym 直调。
  // 浏览器端：无主进程桥 → 探测式降级（R21 先例）：call 返回 null + isAvailable()=false，
  // 断言页按端分流（桌面真调内核，浏览器只断言降级面不崩）。
  const cjkEapi = ((/** @type {any} */ (global)).electronAPI || {});
  const cjkWarn = (m) => { try { console.warn('[arkui-dom] cjk.' + m + '：当前宿主不支持（无 Electron 主进程桥）'); } catch (e) {} };
  define('cjk', {
    /** 一次探测：init 成功与否缓存（主进程幂等，重复 init 无副作用） */
    async isAvailable() {
      if (!cjkEapi.cjk) return false;
      const r = await cjkEapi.cjk.init();
      return !!(r && r.ok);
    },
    /**
     * 万能调用口（c-abi kernel_call 投影）。params 为 JS 对象，内部序列化为 JSON；
     * 返回解析后的 JSON 对象；内核拒绝（null）→ 返回 null，原因走 lastError()。
     * @param {string} method @param {object} params
     */
    async call(method, params) {
      if (!cjkEapi.cjk) { cjkWarn('call'); return null; }
      const raw = await cjkEapi.cjk.call(String(method), JSON.stringify(params == null ? {} : params));
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (e) { return raw; }   // 非 JSON 返回按原文透传
    },
    /**
     * 类型化直调（R112 kernel_add 投影；宿主未导出 kernel_add 时回落 JSON 口 add，
     * 语义一致——见 kernel_abi.h 双轨声明）。
     * @param {number} a @param {number} b
     */
    async add(a, b) {
      if (!cjkEapi.cjk) { cjkWarn('add'); return 0; }
      const typed = await cjkEapi.cjk.add(Number(a) || 0, Number(b) || 0);
      if (typeof typed === 'number') return typed;
      const r = await this.call('add', { a: Number(a) || 0, b: Number(b) || 0 });
      return (r && typeof r.sum === 'number') ? r.sum : 0;
    },
    /**
     * 类型化直调 echo（R112 kernel_echo 投影；同 add 的回落纪律）。
     * @param {string} input
     */
    async echo(input) {
      if (!cjkEapi.cjk) { cjkWarn('echo'); return ''; }
      const t = await cjkEapi.cjk.echo(String(input == null ? '' : input));
      if (typeof t === 'string') return t;
      const r = await this.call('echo', { s: String(input == null ? '' : input) });
      return (r && typeof r.v === 'string') ? r.v : '';
    },
    /** 内核视角最近一次错误（c-abi kernel_last_error 投影） */
    async lastError() {
      if (!cjkEapi.cjk) { cjkWarn('lastError'); return ''; }
      return String(await cjkEapi.cjk.lastError() || '');
    },
    /** 健康检查（c-abi kernel_ping 投影）：0=正常，-1=不可用 */
    async ping() {
      if (!cjkEapi.cjk) return -1;
      return Number(await cjkEapi.cjk.ping());
    },
  });

  // ── @ohos:window.multi —— 多窗口命名空间（E1-5，桌面线）──
  //
  // 'window.multi' 是本项目约定的扩展模块名（真机 SDK 无此模块；真机等价面是
  // window.createWindow + Window.destroyWindow + Window.on('windowEvent')，桌面线以
  // Electron 多 BrowserWindow 并存落地，链路：本垫片 → preload electronAPI.win2 →
  // main ipcMain.handle('arkui:win2:*')）。
  // 与上方 define('window', …)（R80/R91 单窗段——【未改动】）的分工：v1 管"主窗自身"
  // （getLastWindow/setBackgroundColor/resize/windowSizeChange…），本命名空间管
  // "多窗并存"（建/销/聚焦/枚举 + 焦点事件流）。
  // 降级取向（不静默失败）：Promise 面（createWindow/destroyWindow/focusWindow/getWindows）
  // 在无桥宿主【拒绝】并给可操作错误（BusinessError 形：code=801，d.ts 原文
  // "801 - Capability not supported."）——浏览器装不出第二个真窗口，假装成功只会让上层
  // 把假窗当真窗用；订阅面 onWindowFocusChange 沿 v1 on() 先例（可订阅、事件不来 + 一次
  // 可操作 warning）。
  // 桥探测取【调用时】而非装载时快照：contextBridge 注入先于页面脚本，两者等价；调用时
  // 探测额外允许宿主晚接桥、并让测试页能真验证降级分支（摘桥 → 801 → 还桥）。
  const winMultiWarn = (m) => { try { console.warn('[arkui-dom] window.multi.' + m + '：当前宿主不支持（无 electronAPI.win2 桥，需 Electron 桌面形态）'); } catch (e) {} };
  /** @returns {any} electronAPI.win2 桥（无则 null）——每次调用现取，不缓存 */
  const probeWinMulti = () => {
    const api = (/** @type {any} */ (global)).electronAPI;
    return (api && api.win2) ? api.win2 : null;
  };
  /** 可操作错误（BusinessError 形）：code=801 对齐 d.ts "Capability not supported." */
  const winMultiUnavailable = (apiName) => Object.assign(
    new Error(`[arkui-dom] window.multi.${apiName}：当前宿主无 Electron 多窗桥（globalThis.electronAPI.win2 缺席）。` +
      '多窗是桌面专属能力，需在 Electron 形态运行；浏览器请按 err.code===801 分流降级。'),
    { code: 801 });
  // WindowEventType 数值（@ohos.window.d.ts:2954-2989，JSDoc 原文）：SHOWN=1
  // "The window is running in the foreground." / ACTIVE=2 "The window gains focus." /
  // INACTIVE=3 "The window loses focus." / HIDDEN=4 "The window is running in the
  // background." / DESTROYED=7 "The window is destroyed."
  const WIN_MULTI_EVENT_TYPE = {
    WINDOW_SHOWN: 1, WINDOW_ACTIVE: 2, WINDOW_INACTIVE: 3, WINDOW_HIDDEN: 4, WINDOW_DESTROYED: 7,
  };
  // 焦点事件流订阅表 + 主进程推送接线（惰性：首个订阅者出现且桥在位时接一次）。
  // 事件是【全局广播】（任一窗 focus/blur 都到达，载荷 {id, type}），是否与己相关由
  // 订阅方按 ev.id 自判——与 main 侧广播注释同口径。
  const winMultiFocusListeners = new Set();
  let winMultiEventWired = false;
  const winMultiWireEvents = () => {
    if (winMultiEventWired) return;
    const api = probeWinMulti();
    if (api && typeof api.onEvent === 'function') {
      api.onEvent((ev) => {
        // 只投递 focus 域（ACTIVE=2 / INACTIVE=3）；SHOWN/HIDDEN/DESTROYED 不在本订阅面
        if (!ev || (ev.type !== WIN_MULTI_EVENT_TYPE.WINDOW_ACTIVE &&
                    ev.type !== WIN_MULTI_EVENT_TYPE.WINDOW_INACTIVE)) return;
        for (const cb of [...winMultiFocusListeners]) { try { cb(ev); } catch (e) {} }
      });
      winMultiEventWired = true;
    }
  };
  define('window.multi', {
    /** WindowEventType 数值（d.ts:2954-2989），供页面/测试对齐断言 */
    WindowEventType: WIN_MULTI_EVENT_TYPE,
    /**
     * createWindow(config): Promise<number windowId>
     * SDK 对照 @ohos.window.d.ts:1905 `function createWindow(config: Configuration):
     * Promise<Window>`（JSDoc 原文 "Creates a child window or system window."，@since 9）。
     * 投影差异：DOM 运行时持不住原生 Window 句柄 → 返回 number windowId 供后续
     * destroyWindow/focusWindow 以 id 寻址；config 收 {name, url, width, height} 子集。
     */
    async createWindow(config) {
      if (!probeWinMulti()) throw winMultiUnavailable('createWindow');
      const c = (config && typeof config === 'object') ? config : {};
      const id = await probeWinMulti().create({
        name: c.name !== undefined ? String(c.name) : `window-${Date.now()}`,
        url: c.url ? String(c.url) : 'about:blank',
        width: Number(c.width) || 360,
        height: Number(c.height) || 280,
      });
      if (!(typeof id === 'number' && id > 0)) {
        // 1300002 对齐 d.ts createWindow 的 "This window state is abnormal." 域（建窗未成功）
        throw Object.assign(new Error(`[arkui-dom] window.multi.createWindow：主进程建窗失败（windowId=${id}）`),
          { code: 1300002 });
      }
      return id;
    },
    /**
     * destroyWindow(id): Promise<boolean>
     * SDK 对照 @ohos.window.d.ts:3478 `destroyWindow(): Promise<void>`（实例方法，JSDoc 原文
     * "Destroys this window."；旧名 destroy() @deprecated since 9 → @useinstead destroyWindow，
     * d.ts:3438/3448）。投影差异：以 id 寻址；主窗在测试驱动下被 main 拒绝 → 返回 false
     * （不抛：electronAPI 桥的失败免疫约定，调用方按 false 处理）。
     */
    async destroyWindow(id) {
      if (!probeWinMulti()) throw winMultiUnavailable('destroyWindow');
      return !!(await probeWinMulti().destroy(Number(id)));
    },
    /**
     * focusWindow(id): Promise<boolean>
     * 本 SDK d.ts 无同名 API（近邻：模块级 shiftAppWindowFocus(sourceWindowId, targetWindowId)，
     * d.ts:2135，JSDoc 原文 "Shifts the window focus from the source window to the target
     * window in the same application."）；桌面语义以 Electron win.focus() 落地（隐藏窗
     * 先 show 再聚焦，主进程侧完成）。
     */
    async focusWindow(id) {
      if (!probeWinMulti()) throw winMultiUnavailable('focusWindow');
      return !!(await probeWinMulti().focus(Number(id)));
    },
    /**
     * getWindows(): Promise<Array<{id, name, focused, visible}>>
     * 本 SDK d.ts 无模块级 getWindows（近邻：getWindowsByCoordinate d.ts:2251 /
     * getAllMainWindowInfo d.ts:2395）；桌面线枚举本应用全部存活窗口，条目为四字段投影
     * （focused/visible 是主进程此刻真值）。
     */
    async getWindows() {
      if (!probeWinMulti()) throw winMultiUnavailable('getWindows');
      const arr = await probeWinMulti().list();
      return Array.isArray(arr) ? arr : [];
    },
    /**
     * onWindowFocusChange(cb): () => void —— 订阅焦点事件流（载荷 {id, type}），返回退订函数。
     * SDK 对照 Window.on('windowEvent', Callback<WindowEventType>)（d.ts:5962，JSDoc 原文
     * "Subscribes to the window lifecycle change event."）的 focus 子集便利封装：type 只会是
     * WINDOW_ACTIVE(2, "The window gains focus.") / WINDOW_INACTIVE(3, "The window loses
     * focus.")。浏览器无桥：订阅照收（不炸、事件不来）+ 一次 warning（v1 on() 先例）。
     * @param {(ev: {id: number, type: number}) => void} cb
     */
    onWindowFocusChange(cb) {
      if (typeof cb !== 'function') return () => {};
      if (!probeWinMulti()) winMultiWarn('onWindowFocusChange');
      winMultiFocusListeners.add(cb);
      winMultiWireEvents();
      return () => { winMultiFocusListeners.delete(cb); };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
