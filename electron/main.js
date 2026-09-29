/*
 * Electron 主进程：加载与浏览器验证完全相同的断言页，读回 #result，截图，按结果退出。
 *
 * 关键点：不复制任何测试代码——Electron 加载的就是 test/<name>.html 本体，
 * 所以"同一套断言在 Chrome headless 与 Electron 里都通过"这件事本身就是证据。
 *
 * 用法: ARKUI_TEST=layout ./runtime/electron --no-sandbox --disable-gpu .
 */
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// R74：fs 落盘根查询——本项目第一个 IPC 能力桥（参考实现）。
// preload 在渲染侧拿不到 app，而 fs 落盘根取决于"是否打包"：
//   · 未打包（app.isPackaged === false，开发/测试态）→ 回 null：preload 维持内置默认
//     <electron>/data/ 不变，run.sh 的 verify_disk 外部核验与 `rm -rf "$HERE/data"`
//     语义原样保留（测试确定性的底线）；
//   · 打包态 → 安装位置只读，回 userData，由 preload 拼成 userData/data。
// 模式约定（后续 dialog/wifi 等主进程能力照此接）：
//   主进程 ipcMain.handle('arkui:<能力>') 返回可结构化克隆值；渲染侧 invoke 一次并缓存；
//   渲染侧对失败免疫（catch 后走内置回退），初始化绝不能因 IPC 失败而失败。
ipcMain.handle('arkui:getUserDataRoot', () => {
  if (!app.isPackaged) return null;              // 开发/测试态：维持 electron/data 现状
  return app.getPath('userData');                // 打包态：可写根（Linux 即 ~/.config/<name>）
});

// 同步通道：把最终落盘根随渲染进程启动参数下发（additionalArguments → preload 的 process.argv）。
// 为什么 invoke 之外还要它：runtime/ohos-shims.js 在【模块加载时】快照 nodeFs.root 作自报，
// 而 invoke 回包晚于页面脚本执行（打包态实测复现：自报还是旧根、realPathOf 已是新根——
// "自报与实际行为一致"被打破）。additionalArguments 在 preload 执行前就位，根从第一行起就是终值。
const fsRootForRenderer = () =>
  app.isPackaged ? path.join(app.getPath('userData'), 'data') : null;

const testName = process.env.ARKUI_TEST || 'layout';
const pageUrl = process.env.ARKUI_PAGE_URL || '';        // 由 electron/run.sh 起本地服务后传入
const pagePath = path.resolve(__dirname, '..', 'test', `${testName}.html`);
const outPng = path.resolve(__dirname, '..', 'build', `electron-${testName}.png`);
const WAIT_MS = Number(process.env.ARKUI_WAIT_MS || 20000);

// 本机 Mesa 被 ROCm 改过（见 memory: rocm-mesa-sigtrap），Electron GPU 进程易崩 → 强制软件渲染
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer-fallback');
// R35：媒体垫片的 audio.play() 走 muted 降级，Electron 仍可能因 autoplay 政策拒——
// 测试页面（无真实手势）显式放行
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // ── E0-5：CSP 注入（供应链安全，只新增不改既有逻辑）──
  // 对 http/https 响应统一追加 Content-Security-Policy。必须赶在首次 loadURL/loadFile
  // 之前注册，主文档响应才带得上策略头，所以放在 whenReady 回调的最前面。
  // 策略说明（照 E0-5 规定原文）：
  //   · script-src 保留 'unsafe-eval' 是【已知的收紧项】：本项目的页面模块是 CommonJS
  //     仿真（runtime 用 eval/new Function 装载 ets-loader 转换产物），去掉它整站脚本
  //     无法执行；'unsafe-eval' 同时是 WebAssembly 编译的兜底（runtime/vendor 里的
  //     arkui-qrcodegen 内嵌 WASM 依赖它）。后续把模块装载改成非 eval 形态后再收紧。
  //   · script-src 'unsafe-inline' 同为已知项（R130 实测抓的）：47 个测试页的驱动脚本
  //     全部是内联 <script>，没有它页面整页脚本被静默拦掉（症状：#result 停在
  //     'running…'、console-message 无报错——CSP 违规只在 DevTools 可见）。正式分发
  //     走外链化改造后移除。
  //   · style-src 'unsafe-inline'：运行时大量内联 style 属性/样式标签，暂不设防。
  // 覆盖面：主路径是 electron/run.sh 起本地服务（tools/serve.py）后经 ARKUI_PAGE_URL
  // 走 http://127.0.0.1:…，钩子全量覆盖；file://（不设 ARKUI_PAGE_URL 时的 loadFile
  // 兜底）响应不经过网络栈，onHeadersReceived 拿不到头、无法注入 —— 该路径暂不设防，
  // 如后续要覆盖，需改走 webContents 的 executeJavaScript 注入 <meta> 或自定义协议。
  const CSP_POLICY =
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;";
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (/^https?:\/\//.test(details.url)) {
      // 追加而非覆盖：目标服务已带 CSP 时叠加（多份 CSP 取交集，只会更严不会更松）
      const headers = Object.assign({}, details.responseHeaders);
      headers['Content-Security-Policy'] =
        (headers['Content-Security-Policy'] || []).concat([CSP_POLICY]);
      callback({ responseHeaders: headers });
      return;
    }
    callback({});   // 非 http/https（如 file://，本就到不了这里）原样放行
  });
  console.error('[csp] 注入完成');

  if (!pageUrl && !fs.existsSync(pagePath)) {
    console.error(`页面不存在: ${pagePath}`);
    app.exit(2);
    return;
  }

  const useOffscreen = process.env.ARKUI_OFFSCREEN === '1';
  const fsRoot = fsRootForRenderer();
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    show: false,                       // 不打扰桌面
    webPreferences: {
      backgroundThrottling: false,
      offscreen: useOffscreen,         // offscreen 模式会持续产生 paint 帧（可用于截图）
      // 注入真文件系统桥：@ohos:file.fs 需要真实落盘，不能拿内存冒充
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,                  // preload 里要 require('node:fs')
      // 打包态把终值落盘根同步带给 preload（dev 态为 null → preload 维持默认根）
      additionalArguments: fsRoot ? [`--arkui-fs-root=${fsRoot}`] : [],
    },
  });

  // ── @ohos:window 的主进程执行端（R80，桌面线）──
  // 渲染侧 @ohos:window 垫片经 preload 的 windowOp 调到这里，操作 BrowserWindow 本体。
  // v1 能力面：setBackgroundColor/setSize/setPosition/show/minimize/destroy + resize 事件 push。
  // destroy 仅在【非测试驱动】下放行：测试 harness 靠窗口退出收结果，误销毁会让用例假死。
  const isTestDrive = !!(process.env.ARKUI_TEST || process.env.ARKUI_PAGE_URL);
  ipcMain.handle('arkui:window:op', (_e, op, ...args) => {
    switch (op) {
      case 'setBackgroundColor': win.setBackgroundColor(String(args[0] || '#FFFFFF')); return true;
      case 'setSize': win.setSize(Number(args[0]) || 480, Number(args[1]) || 400); return true;
      case 'setPosition': win.setPosition(Number(args[0]) || 0, Number(args[1]) || 0); return true;
      case 'show': win.show(); return true;
      case 'minimize': win.minimize(); return true;
      case 'destroy': if (isTestDrive) return false; win.destroy(); return true;
      // R83 v2：全屏/常亮/属性查询
      case 'setFullScreen': win.setFullScreen(!!args[0]); return true;
      case 'setKeepScreenOn': win.setAlwaysOnTop(!!args[0]); return true;   // 桌面无屏幕常亮语义，降级为置顶
      case 'maximize': win.maximize(); return true;
      case 'restore': win.restore(); return true;
      case 'isFocused': return win.isFocused();
      case 'getProperties': {
        const [w, h] = win.getSize();
        const [x, y] = win.getPosition();
        return { width: w, height: h, x, y, isFullScreen: win.isFullScreen(), isMaximized: win.isMaximized() };
      }
      default: return false;
    }
  });
  // BrowserWindow resize → 渲染侧 windowSizeChange 监听器（preload 转发）
  win.on('resize', () => {
    const [w, h] = win.getSize();
    if (!win.webContents.isDestroyed()) win.webContents.send('arkui:window:resized', { width: w, height: h });
  });
  // R91：2in1 窗口生命周期 → WindowEventType 数值（@ohos.window.d.ts:2954-2986：
  // SHOWN=1/ACTIVE=2/INACTIVE=3/HIDDEN=4/DESTROYED=7）。maximize/unmaximize 不是
  // WindowEventType（是 WindowMode 域），由 getProperties().isMaximized 回读覆盖。
  const sendWinEvent = (type) => {
    if (!win.webContents.isDestroyed()) win.webContents.send('arkui:window:event', { type });
  };
  win.on('show', () => sendWinEvent(1));
  win.on('hide', () => sendWinEvent(4));
  win.on('minimize', () => sendWinEvent(4));   // Linux 上 minimize 不一定派发 hide——补发 HIDDEN
  win.on('focus', () => sendWinEvent(2));
  win.on('blur', () => sendWinEvent(3));

  // ── @ohos:file.picker 的主进程执行端（R82，桌面线）──
  // 渲染侧垫片（DocumentViewPicker/PhotoViewPicker）经 preload 的 fileDialog 调到这里。
  // 测试驱动下（ARKUI_TEST/ARKUI_PAGE_URL）对话框会阻塞无人点击 → 自动注入确定性结果：
  //   select → 取 ARKUI_PICK_FILES（逗号分隔路径）或默认 vfs 内 demo.txt；save → ARKUI_PICK_SAVE。
  // 返回形与真机 d.ts 对齐：select → Array<string>（uri 数组）；save → Array<string>；
  // 取消 → 空数组（Document 形）。PhotoViewPicker 的 photoUris 包装在渲染侧垫片做。
  const pickDefaults = () => {
    const rootDir = fsRootForRenderer() || path.join(__dirname, 'data');
    fs.mkdirSync(rootDir, { recursive: true });
    const demo = path.join(rootDir, 'demo.txt');
    if (!fs.existsSync(demo)) fs.writeFileSync(demo, 'hello from arkts');
    return demo;
  };
  ipcMain.handle('arkui:dialog:select', async (_e, options) => {
    if (isTestDrive) {
      const list = String(process.env.ARKUI_PICK_FILES || pickDefaults()).split(',').filter(Boolean);
      return list.map((p) => 'file://' + p);
    }
    const filters = (options && options.fileSuffixFilters)
      ? { name: '匹配类型', extensions: options.fileSuffixFilters.map((s) => String(s).replace(/^\./, '')) }
      : undefined;
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections', 'treatPackageAsDirectory'],
      filters,
    });
    return r.canceled ? [] : r.filePaths.map((p) => 'file://' + p);
  });
  ipcMain.handle('arkui:dialog:save', async (_e, options) => {
    if (isTestDrive) {
      const rootDir = fsRootForRenderer() || path.join(__dirname, 'data');
      return [process.env.ARKUI_PICK_SAVE || path.join(rootDir, 'saved.txt')].map((p) => 'file://' + p);
    }
    const r = await dialog.showSaveDialog(win, {
      defaultPath: (options && options.newFileNames && options.newFileNames[0]) || undefined,
    });
    return (r.canceled || !r.filePath) ? [] : ['file://' + r.filePath];
  });

  // ── @ohos:ability 的桌面语义执行端（R88）──
  // startAbilityForResult(desktopPage) → 开【真第二 BrowserWindow】装载 callee 页；
  // callee 页 terminateSelfWithResult → 结果转发回 caller webContents + 关 callee 窗口。
  let callerWC = null;
  let abilityWin = null;
  // R89：pasteboard 的主进程执行端（Electron 44 clipboard 仅主进程可用）
  ipcMain.handle('arkui:clip:read', () => clipboard.readText());
  ipcMain.handle('arkui:clip:write', (_e, t) => { clipboard.writeText(String(t)); return true; });

  // ── @ohos:cjk 的主进程执行端（R98，进程内仓颉内核）──
  // 渲染侧 @ohos:cjk 垫片 → preload cjk 桥 → 这里 → NAPI addon（bridge/napi/cjk_napi.node）
  // → dlopen 仓颉运行时 + 内核 .so（挂载序列与实测约束见 addon 头注与 kernel/c-abi.h）。
  // 初始化惰性：首个 cjk 调用才加载（其余测试页零开销、零依赖）；
  // 环境要求：CANGJIE_RT_LIB 指向 <SDK>/runtime/lib/linux_x86_64_cjnative，且
  // LD_LIBRARY_PATH 含同一目录（std-core 无 DT_SONAME，只能走搜索路径——run.sh 负责导出）。
  let cjkAddon = null;
  let cjkReady = false;
  // R127 勘误：cjkInitK('hs',…) 挂的是【'hs' 槽】，而无 K 后缀的旧 API=cjkInitK('default')——
  // 槽名错位会让所有调用打出"内核未初始化"（node 冒烟用 K 变体所以从未暴露）。
  // 活动槽名随 kind 记录，handler 一律走 K 变体。
  let cjkSlot = 'default';
  let cjkErr = '仓颉 SDK 未找到（CANGJIE_RT_LIB 未设置）';
  const cjkEnsure = () => {
    if (cjkReady) return true;
    if (cjkAddon) return false;            // 已试过且失败：错误保持 cjkErr
    // R111 单内核路线：换内核 = 换 .so 路径（ARKUI_KERNEL_LIB 覆盖；默认仓颉内核）。
    // R127：ARKUI_KERNEL_KIND=hs 切 Haskell 内核——打包态用包内 data/kernel/hs/
    //（GHC 闭包 + 全员 RPATH=$ORIGIN，零 LD_LIBRARY_PATH）；dev 态 GHC_LIB_DIR 指向
    // GHC libdir + 仓库内核（与 smoke 的 GHC_LIB_DIR_TEST 同源）。
    const kind = process.env.ARKUI_KERNEL_KIND === 'hs' ? 'hs' : 'cangjie';
    let initArgs;
    if (kind === 'hs') {
      const packedHs = app.isPackaged ? path.resolve(__dirname, '..', 'data', 'kernel', 'hs') : null;
      const ghcDir = process.env.GHC_LIB_DIR || packedHs || '';
      const kernelLib = process.env.ARKUI_KERNEL_LIB ||
        (packedHs ? path.join(packedHs, 'libkernel_hs.so')
                  : path.resolve(__dirname, '..', 'kernel', 'hs', 'libkernel_hs.so'));
      if (!ghcDir || !fs.existsSync(ghcDir) || !fs.existsSync(kernelLib)) {
        cjkErr = 'hs 内核不可用（GHC_LIB_DIR 未设置且非打包态，或文件缺失）';
        return false;
      }
      initArgs = [ghcDir, kernelLib, '{}'];
    } else {
      // R109 打包态：data/kernel/ 平铺内核+仓颉运行时 .so 集（内核带 RPATH=$ORIGIN，
      // 零 LD_LIBRARY_PATH）；dev 态沿 env（run.sh 探测 nightly）+ 仓库内核。
      const packedKernelDir = app.isPackaged ? path.resolve(__dirname, '..', 'data', 'kernel') : null;
      const rtLib = process.env.CANGJIE_RT_LIB || packedKernelDir || '';
      const kernelLib = process.env.ARKUI_KERNEL_LIB ||
        (packedKernelDir
          ? path.join(packedKernelDir, 'libkernel.so')
          : path.resolve(__dirname, '..', 'kernel', 'cangjie', 'libkernel.so'));
      if (!rtLib || !fs.existsSync(rtLib) || !fs.existsSync(kernelLib)) return false;
      initArgs = [path.join(rtLib, 'libcangjie-runtime.so'), kernelLib, '{}'];
    }
    try {
      // 字面量路径：相对 main.js 解析（electron/../bridge/…），且便于静态审计
      cjkAddon = require('../bridge/napi/cjk_napi.node');
      // R127：init 返回 false（如 RTS 变体不对）不再静默——读 lastError 进 cjkErr，
      // 让页面/冒烟看到真实原因（此前 initK 失败仍置 ready 的路不存在，但 false 会被当成功）
      // R127 勘误续：cangjie 分支也走 K 统一路径（cjkInit=「default」槽；此前 cjkSlot
      // 记 'cangjie' 而 init 落在 'default'——槽名查空，全 handler 打「内核未初始化」）
      const slotName = kind === 'hs' ? 'hs' : 'default';
      const okInit = cjkAddon.cjkInitK(slotName, initArgs[0], initArgs[1], initArgs[2]);
      if (!okInit) {
        cjkErr = '内核初始化失败：' + String(cjkAddon.cjkLastError() || '（无 lastError）');
        console.error('[cjk] ' + cjkErr);      // 主进程日志可见（打包态冒烟诊断面）
        cjkAddon = null;
        return false;
      }
      cjkSlot = slotName;
      cjkReady = true;
      return true;
    } catch (e) {
      cjkErr = String(e && e.message || e);
      console.error('[cjk] init 异常: ' + cjkErr + '（kind=' + kind + '）');
      return false;
    }
  };
  ipcMain.handle('arkui:cjk:init', () => (cjkEnsure() ? { ok: true } : { error: cjkErr }));
  ipcMain.handle('arkui:cjk:ping', () => {
    const ok = cjkEnsure();
    if (!ok) return -1;
    try {
      return cjkAddon.cjkPingK(cjkSlot);
    } catch (e) {
      console.error('[cjk:ping] slot=' + cjkSlot + ' ready=' + cjkReady + ' addon=' + !!cjkAddon +
        ' err=' + (e && e.message));
      throw e;
    }
  });
  ipcMain.handle('arkui:cjk:call', (_e, method, paramsJson) => {
    if (!cjkEnsure()) return null;
    try { return cjkAddon.cjkCallK(cjkSlot, String(method), String(paramsJson)); }
    catch (e) { cjkErr = String(e && e.message || e); return null; }
  });
  ipcMain.handle('arkui:cjk:lastError', () => {
    if (cjkReady) return String(cjkAddon.cjkLastErrorK(cjkSlot) || '');
    return cjkErr;
  });
  // R112 类型化直调：内核未导出 kernel_add/kernel_echo 时返回 null（垫片回落 JSON 口）
  ipcMain.handle('arkui:cjk:add', (_e, a, b) => {
    if (!cjkEnsure() || typeof cjkAddon.cjkAddK !== 'function') return null;
    try { return cjkAddon.cjkAddK(cjkSlot, Number(a) || 0, Number(b) || 0); }
    catch (e) { cjkErr = String(e && e.message || e); return null; }
  });
  ipcMain.handle('arkui:cjk:echo', (_e, txt) => {
    if (!cjkEnsure() || typeof cjkAddon.cjkEchoK !== 'function') return null;
    try { return cjkAddon.cjkEchoK(cjkSlot, String(txt)); }
    catch (e) { cjkErr = String(e && e.message || e); return null; }
  });

  ipcMain.handle('arkui:ability:startForResult', (e, payload) => {
    callerWC = e.sender;
    if (abilityWin && !abilityWin.isDestroyed()) abilityWin.close();  // 顺序启动：上一窗已让位
    abilityWin = new BrowserWindow({
      width: 420, height: 360, show: false,
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: false,
        additionalArguments: fsRoot ? [`--arkui-fs-root=${fsRoot}`] : [],
      },
    });
    const url = String(payload && payload.pageUrl || '');
    abilityWin.loadURL(url + (url.includes('?') ? '&' : '?') + '__arkui_ability=1');
    abilityWin.on('closed', () => { abilityWin = null; });
    return { started: true };
  });
  ipcMain.handle('arkui:ability:terminateWithResult', (_e, result) => {
    if (callerWC && !callerWC.isDestroyed()) callerWC.send('arkui:ability:result', result);
    if (abilityWin && !abilityWin.isDestroyed()) abilityWin.close();
    return true;
  });

  // offscreen 模式下用 paint 事件的最后一帧当截图（隐藏窗口的合成器不产帧，capturePage 会挂）
  let lastFrame = null;
  let paintCount = 0;
  if (useOffscreen) {
    win.webContents.on('paint', (_e, _dirty, image) => { lastFrame = image; paintCount++; });
  }

  // 判断截图像不像"真的渲染了内容"：统计非白像素占比与采样颜色数
  function imageStats(image) {
    const bmp = image.toBitmap();            // BGRA
    let nonWhite = 0;
    const seen = new Set();
    for (let i = 0; i + 3 < bmp.length; i += 4) {
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      if (!(r === 255 && g === 255 && b === 255)) nonWhite++;
      if (seen.size < 256) seen.add((r << 16) | (g << 8) | b);
    }
    return { pixels: Math.floor(bmp.length / 4), nonWhite, distinct: seen.size };
  }

  const errors = [];
  // Electron 44 起 console-message 的事件对象直接带 level/message（旧的三参签名已废弃）
  win.webContents.on('console-message', (e) => {
    const msg = e && e.message ? e.message : '';
    const level = e && typeof e.level === 'number' ? e.level : 0;
    if (level >= 2 && !/Security Warning|Content-Security-Policy/.test(msg)) errors.push(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push('渲染进程退出: ' + JSON.stringify(d));
  });

  try {
    // 走 http:// 而非 file://：这样页面里的 fetch 是同源，net.http 等平台能力才与浏览器侧一致
    if (pageUrl) await win.loadURL(pageUrl);
    else await win.loadFile(pagePath);

    const deadline = Date.now() + WAIT_MS;
    let result = '';
    while (Date.now() < deadline) {
      result = await win.webContents.executeJavaScript(
        "(() => { const e = document.getElementById('result'); return e ? e.textContent : ''; })()"
      ).catch((e) => '读取失败: ' + e.message);
      if (result && !result.includes('running')) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log('──── 渲染进程内的断言输出（与浏览器同一份页面）────');
    console.log(result || '（空）');
    if (errors.length) console.log('──── 页面报错 ────\n' + errors.join('\n'));

    // 隐藏窗口下 capturePage 可能永不 resolve（合成器不产帧）→ 必须设超时，否则整轮卡死
    const CAPTURE_MS = Number(process.env.ARKUI_CAPTURE_MS || 6000);
    try {
      let img = null;
      let ratio = 0;
      let attempts = 0;
      if (useOffscreen) {
        // offscreen 取帧时机不稳：可能拿到内容渲染前的空白帧（实测同一用例一会儿"有内容"一会儿"疑似空白"）。
        // 所以要【重试直到非白占比达标】，并把最好的那一帧留下。
        let best = null, bestRatio = -1;
        while (attempts < 5) {
          attempts++;
          const before = paintCount;
          win.webContents.invalidate();
          const waitUntil = Date.now() + 1500;
          while (Date.now() < waitUntil && paintCount === before) {
            await new Promise((r) => setTimeout(r, 100));
          }
          await new Promise((r) => setTimeout(r, 250));   // 让这一帧落定
          if (!lastFrame) continue;
          const st = imageStats(lastFrame);
          const r = st.nonWhite / st.pixels;
          if (r > bestRatio) { best = lastFrame; bestRatio = r; }
          if (r > 0.005) break;                            // 达标即停
        }
        img = best;
        ratio = bestRatio;
      } else {
        img = await Promise.race([
          win.webContents.capturePage(),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`超时 ${CAPTURE_MS}ms`)), CAPTURE_MS)),
        ]);
        ratio = imageStats(img).nonWhite / imageStats(img).pixels;
      }
      if (!img) throw new Error('没有可用帧');

      fs.writeFileSync(outPng, img.toPNG());
      const size = img.getSize();
      console.log(`截图: ${outPng} (${size.width}x${size.height}) 来源=${useOffscreen ? 'offscreen-paint' : 'capturePage'} 尝试=${attempts}`);
      console.log(`      非白像素占比 = ${(ratio * 100).toFixed(2)}%`);
      // isEmpty() 只表示"有位图"，纯白图它也返回 false → 必须按像素判定，否则是假阳性
      console.log(ratio > 0.005
        ? '      截图判定: 有内容 ✅'
        : '      截图判定: 疑似空白 ⚠️（不要把它当作渲染成功的证据）');
    } catch (e) {
      console.log('截图跳过: ' + e.message + '（不影响断言判定）');
    }

    const ok = /ALL PASS/.test(result);
    console.log(ok ? 'ELECTRON_RESULT: PASS' : 'ELECTRON_RESULT: FAIL');
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('加载失败: ' + (e && e.stack ? e.stack : e));
    app.exit(3);
  }
});
