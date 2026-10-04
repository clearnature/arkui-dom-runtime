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

// ────────────────── E0-2 崩溃/错误上报（主进程收集 + 本地落盘）──────────────────
//
// 落盘位置：userData/logs/crash-YYYYMMDD.jsonl（按日分文件，本地日期戳；目录不存在
// 则 mkdirSync recursive）。与渲染侧 runtime/src/errorboundary.js 的 __arkui_dom_errors
// 环形缓冲（内存、最多 50 条）配套：内存面管"最近发生了什么"，本 JSONL 管"跨进程留痕"。
// 行格式（每行一个 JSON 对象）：
//   {ts, kind, message, stack, extra}
//   · ts      —— ISO 时间戳（UTC，便于跨机对账）
//   · kind    —— 错误类别：'uncaughtException' | 'unhandledRejection' |
//                'render-process-gone' | 'renderer'（渲染侧错误缓冲尾部，经
//                arkui:report:error 桥进来）
//   · message —— 一行消息
//   · stack   —— 堆栈【首行】（与 errorboundary 的 normalizeCaughtErr 同口径：
//                日志面不留完整栈；完整栈在触发点的 console.error 里留痕）
//   · extra   —— 自由结构（渲染条目的 component/elmtId/where/seq、render-process-gone
//                的 details 等）
//
// 纪律：上报永不炸主流程 —— 落盘全程 try/catch，写失败只 console.error 一行，绝不向上抛。
//
// 节流状态说明（防日志洪水）：
//   crashLogThrottle: Map<kind, {minute, count}>
//   · key = 错误类别；minute = 当前「分钟桶」（epoch 分钟数）；count = 该桶内已写入条数；
//   · 同一 kind 同一分钟最多写 CRASH_LOG_MAX_PER_MINUTE(20) 条，超出直接丢弃。
//     丢弃是设计行为、不是写失败，故不 console.error（否则节流器自己就成了洪水源）；
//   · 跨分钟自动重置（minute 不等即换新桶）；不同 kind 互不影响；
//   · 状态只在内存，进程重启即清零——按日分文件 + 每分钟每类 20 条的量级足够诊断用。
const CRASH_LOG_MAX_PER_MINUTE = 20;
/** @type {Map<string, {minute: number, count: number}>} */
const crashLogThrottle = new Map();

/**
 * 追加一条崩溃/错误日志（E0-2 具名落盘函数）。
 * main.js 是 Electron 入口、无法被 require 后直跑单测，故把全部落盘逻辑收拢进本具名
 * 函数并对单测逻辑做静态确认（同构逻辑已用 node -e 实测 + 逐条静态核对）：
 *   ① 节流：同 kind 同一分钟连写 21 次 → 前 20 次返回 true、第 21 次返回 false；
 *   ② 跨分钟重置：桶 minute 过期后首条仍返回 true（计数从 1 重来）；
 *   ③ kind 隔离：A 类写满 20 条后，B 类首条不受影响仍返回 true；
 *   ④ 行格式：JSON.parse(行) 恰有 ts/kind/message/stack/extra 五键，stack 为堆栈首行；
 *   ⑤ 失败免疫：目录不可写 / extra 循环引用等任何异常 → 返回 false，只 console.error
 *      一行、绝不向上抛（上报通道自身不能成为新的崩溃源）。
 * @param {string} kind 错误类别（见上方 kind 枚举）
 * @param {string} message 一行消息
 * @param {any=} [extra] 附加信息；其中 extra.stack（如给）取首行进 stack 字段，
 *                       其余字段浅拷贝后进 extra（不改调用方对象）
 * @returns {boolean} 是否真正落盘（false = 被节流丢弃或写失败）
 */
function appendCrashLog(kind, message, extra) {
  try {
    // ── 节流判定（先于一切 IO：被限流时零系统调用）──
    const bucket = Math.floor(Date.now() / 60000);
    const st = crashLogThrottle.get(kind);
    if (st && st.minute === bucket && st.count >= CRASH_LOG_MAX_PER_MINUTE) return false;
    // ── 组装行对象 ──
    const src = (extra && typeof extra === 'object') ? extra : {};
    const rest = Object.assign({}, src);              // 浅拷贝：不污染调用方
    const fullStack = typeof rest.stack === 'string' ? rest.stack : '';
    delete rest.stack;                                 // stack 单列成字段，extra 里不重复
    const d = new Date();
    const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    const dir = path.join(app.getPath('userData'), 'logs');
    const file = path.join(dir, `crash-${stamp}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });            // 目录不存在则递归建
    const head = {
      ts: d.toISOString(),
      kind: String(kind || 'unknown'),
      message: String(message === undefined || message === null ? '' : message),
      stack: fullStack ? fullStack.split('\n', 1)[0] : '',
    };
    let line;
    try {
      line = JSON.stringify(Object.assign(head, { extra: rest }));
    } catch (se) {
      // extra 不可序列化（循环引用等）：extra 降级为占位串，ts/kind/message/stack 仍落盘
      line = JSON.stringify(Object.assign(head, { extra: `（不可序列化: ${se && se.message || se}）` }));
    }
    fs.appendFileSync(file, line + '\n');
    // ── 节流计数（写成功才计数：失败不计入限额，排障期不至于被失败写稀释掉真实量）──
    if (st && st.minute === bucket) st.count += 1;
    else crashLogThrottle.set(kind, { minute: bucket, count: 1 });
    return true;
  } catch (e) {
    // 写不进日志只留一行痕：上报永不炸主流程
    console.error('[crashlog] 落盘失败 kind=' + kind + ': ' + (e && e.message || e));
    return false;
  }
}

// 主进程自身崩溃兜底：uncaughtException / unhandledRejection → 追加写 JSONL。
// 语义注记：挂上处理器后 Node 默认的「打印并中止」被接管，这里选择记录 + console.error
// 后不主动退出——退出策略仍归业务流程（本文件的 app.exit 码）管；若异常源高频出现，
// 节流（每 kind 每分钟 20 条）保证日志不洪水。
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException: ' + ((err && err.stack) || err));
  appendCrashLog('uncaughtException',
    (err && err.message !== undefined) ? String(err.message) : String(err),
    { stack: (err && typeof err.stack === 'string') ? err.stack : '' });
});
process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message !== undefined) ? String(reason.message) : String(reason);
  console.error('[main] unhandledRejection: ' + ((reason && reason.stack) || msg));
  appendCrashLog('unhandledRejection', msg,
    { stack: (reason && typeof reason.stack === 'string') ? reason.stack : '' });
});

// 渲染侧错误上报桥（E0-2）：渲染进程把 __arkui_dom_errors 缓冲尾部交上来，写进同一个
// JSONL。载荷三种形态都收：条目数组 / {entries: [...]} / 单条条目。
// 条目形（errorboundary.js list() 快照）：{seq, time, component, elmtId, message, stack, where}
//   → 行映射：message→message、stack→stack（缓冲里本就只存首行，这里再防御性截一次）、
//     其余进 extra；kind 固定 'renderer'（节流按类计数）。
// 注意节流按【行】计：单次批量超 20 条时本分钟只落前 20 条，其余丢弃（渲染侧如需全量，
// 分批跨分钟上报）。与 arkui:getUserDataRoot 同款模块级能力桥：不依赖窗口，即注册即生效。
ipcMain.handle('arkui:report:error', (_e, payload) => {
  const entries = Array.isArray(payload) ? payload
    : (payload && Array.isArray(payload.entries)) ? payload.entries
    : (payload ? [payload] : []);
  let written = 0;
  for (const en of entries) {
    if (!en || typeof en !== 'object') continue;       // 非对象条目跳过（防御渲染侧脏数据）
    const ok = appendCrashLog('renderer', en.message, {
      stack: (typeof en.stack === 'string') ? en.stack : '',
      component: en.component, elmtId: en.elmtId, where: en.where,
      seq: en.seq, pageTime: en.time,
    });
    if (ok) written++;
  }
  return { written, received: entries.length };
});

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
// R159.3：渲染进程任务队列节流三件套——show:false + offscreen 的窗口会被
// Chromium 判为隐藏/遮挡，timer 与解码回调的投递被无限迟（实测：夜间锁屏后
// 本地全矩阵的红、CI electron 的 imageext 挂/measimage 迟/builtindemo 收口
// 轮转 flake，全部同源；backgroundThrottling:false 不覆盖遮挡跟踪路径）。
// 这是 Electron 无头测试的标准配方。
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'IntensiveWakeUpThrottling,CalculateNativeWinOcclusion');
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

  const useOffscreen = process.env.ARKUI_OFFSCREEN === '1'
    && process.env.ARKUI_PROFILE !== '1' && process.env.ARKUI_TRACE !== '1';
  // ARKUI_PROFILE=1 / ARKUI_TRACE=1 强制非 OSR：offscreen 与 webContents.debugger
  // 冲突（实测 attach 后页面挂死、"target closed while handling command"）——
  // 取证轮次牺牲截图（capturePage 有超时护栏），判定只认 #result 文本不受影响
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

  // ── E0-6：启动失败可诊断（白屏自证）──（只加不改：上方 IPC 区段与下方判定路径一律不碰）
  // 两条自证路径：
  //   ① did-fail-load（任何模式，含测试驱动——"加载失败时走"）→ 用 data: URL 渲染一张
  //      自包含诊断页（错误码/描述/失败地址/下一步：日志与截图路径），并打一行 [boot-fail] 摘要；
  //   ② did-finish-load 空壳探针（仅生产形态启用）：页面加载"成功"但 #root/#result 双双
  //      缺席且近空 → 注入诊断覆盖层（"加载成功却是空壳"的白屏自证）。
  // 与测试驱动的互不干扰：判定靠 #result 文本 + 退出码；①只在加载失败后发生（此时判定
  // 路径本就走 catch → exit(3)，见文件尾部 catch 的配套说明）；②只在生产形态启用——
  // run.sh 驱动测试时 ARKUI_TEST/ARKUI_PAGE_URL 两值同设（isTestDrive 与既有判定一致），
  // 且测试页必有 root/result 双 div，探针在测试页上永远走 'ok' 分支、零 DOM 注入。
  const bootFail = { rendered: false, promise: null };

  // 诊断信息里的"下一步去哪看"：日志目录（E0-2 的 crash-YYYYMMDD.jsonl 落点）与截图路径
  const bootFailLogPaths = () => {
    let logs = '<userData>/logs';
    try { logs = path.join(app.getPath('userData'), 'logs'); } catch (e) { /* 拿不到就留占位符 */ }
    const shotRel = path.relative(path.resolve(__dirname, '..'), outPng);
    return { logs, shot: (shotRel && !shotRel.startsWith('..')) ? shotRel : outPng };
  };

  // 诊断页 HTML：data: URL 自包含（不经网络栈，天然不受 CSP 注入影响），内联样式简单排版
  const bootFailPageHtml = (code, desc, url) => {
    const p = bootFailLogPaths();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>启动失败诊断</title></head>'
      + '<body style="margin:0;padding:20px;background:#1e1e1e;color:#eee;font:14px/1.6 system-ui,sans-serif;">'
      + '<h2 style="margin:0 0 12px;font-size:18px;color:#ffb74d;">启动失败 · ArkUI 桌面运行时诊断</h2>'
      + '<div style="background:#2a2a2a;border:1px solid #444;border-radius:6px;padding:12px 14px;">'
      + `<div><b>错误码</b>：<code style="color:#ff8a80;">${esc(code)}</code></div>`
      + `<div><b>描述</b>：${esc(desc || '（无）')}</div>`
      + `<div><b>失败地址</b>：<code style="color:#90caf9;word-break:break-all;">${esc(url || '（无）')}</code></div>`
      + '</div>'
      + '<h3 style="font-size:15px;margin:16px 0 6px;">验证建议</h3>'
      + '<ul style="margin:0;padding-left:20px;">'
      + `<li>日志目录：${esc(p.logs)}（错误日志 crash-YYYYMMDD.jsonl 按日分文件）</li>`
      + `<li>截图：${esc(p.shot)}（本诊断页由主进程自动留存一份）</li>`
      + '<li>复核：本地服务是否已启动（tools/serve.py）；用浏览器打开同一地址看是否可访问</li>'
      + '</ul>'
      + '<div id="boot-ua" style="margin-top:14px;color:#9e9e9e;font-size:12px;">UA: …</div>'
      + '<script>(function(){try{var b=window.electronAPI&&window.electronAPI.bootInfo?window.electronAPI.bootInfo():null;'
      + "document.getElementById('boot-ua').textContent='UA: '+(b&&b.ua?b.ua:'（bootInfo 不可用）');}catch(e){}})();</script>"
      + '</body></html>';
  };

  // 渲染诊断页 + 一行摘要日志（给人看：错误码 + URL + 下一步去哪看日志）。
  // 只走一次：诊断页（data: URL）自身再触发的 load 事件一律忽略，不递归。
  const showBootFailPage = (code, desc, url) => {
    if (bootFail.rendered) return;
    bootFail.rendered = true;
    const p = bootFailLogPaths();
    console.log(`[boot-fail] code=${code} ${desc} url=${url} 日志=${p.logs} 截图=${p.shot}`);
    bootFail.promise = win
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(bootFailPageHtml(code, desc, url)))
      .catch(() => {});   // 诊断页都加载不动就到此为止——原始失败原因才是重点
  };

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // 只处理主框架；-3(ERR_ABORTED) 是被后续导航打断，不算启动失败
    if (!isMainFrame || code === -3 || bootFail.rendered) return;
    showBootFailPage(code, desc || '', url || pageUrl || pagePath);
  });

  if (!isTestDrive) {
    // 空壳探针：生产形态专属。测试驱动模式绝不注入任何 DOM（判定只认 #result 文本）。
    const p6 = bootFailLogPaths();
    const nextStep = '日志目录：' + p6.logs + '；截图：' + p6.shot
      + '；用浏览器打开同一地址复核；加 --enable-logging 看控制台报错';
    const probeJs = `(function(){
try {
  if (document.getElementById('__arkui_boot_overlay')) return 'already';
  if (document.getElementById('root') || document.getElementById('result')) return 'ok';
  var body = document.body;
  if (!body) return 'no-body';
  var nodes = body.querySelectorAll('*').length;
  var text = (body.innerText || '').trim();
  if (nodes > 3 || text.length >= 30) return 'has-content';
  var ua = '';
  try {
    var bi = window.electronAPI && window.electronAPI.bootInfo ? window.electronAPI.bootInfo() : null;
    if (bi) ua = String(bi.ua || '');
  } catch (e) {}
  var ov = document.createElement('div');
  ov.id = '__arkui_boot_overlay';
  ov.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;'
    + 'background:#1e1e1e;color:#eee;padding:18px;overflow:auto;font:13px/1.6 system-ui,sans-serif;');
  var h = document.createElement('div');
  h.setAttribute('style', 'color:#ffb74d;font-size:16px;font-weight:700;margin-bottom:10px;');
  h.textContent = '启动诊断 · 页面加载成功但内容为空';
  ov.appendChild(h);
  var mk = function(label, value, color) {
    var d = document.createElement('div');
    d.setAttribute('style', 'margin:3px 0;word-break:break-all;');
    var b = document.createElement('b'); b.textContent = label + '：';
    var s = document.createElement('span'); s.textContent = value;
    if (color) s.setAttribute('style', 'color:' + color);
    d.appendChild(b); d.appendChild(s);
    ov.appendChild(d);
  };
  mk('页面地址', String(location.href), '#90caf9');
  mk('UA', ua || '（bootInfo 不可用）');
  mk('原因', '#root 与 #result 双双缺席且页面近空——运行时 boot 可能失败（模块加载异常/脚本未执行）');
  mk('下一步', ${JSON.stringify(nextStep)});
  document.body.appendChild(ov);
  return 'injected';
} catch (e) { return 'error:' + e.message; }
})()`;
    win.webContents.on('did-finish-load', () => {
      if (bootFail.rendered) return;   // 失败路径已由诊断页接管，探针让位
      win.webContents.executeJavaScript(probeJs).then((r) => {
        if (r === 'injected') {
          console.log('[boot-fail] 空壳页面（#root/#result 缺席且近空）→ 已注入诊断覆盖层');
        }
      }).catch(() => {});   // 探针失败免疫：绝不影响页面自身运行
    });
  }

  // ── E0-4：soak 采样器（ARKUI_SOAK_ROUNDS 设置时启用；非侵入，测试驱动同用）──
  // 每轮向渲染进程注入一段"组件 churn"脚本（建 20 个按钮再拆——页面挂 __arkui_soak_step
  // 钩子，soak.sh 采样 heapUsed/DOM 节点/elmtRecords 到 ARKUI_SOAK_OUT CSV）。
  // 断言不做（稳态是趋势判断，人工/报告判）；主进程崩溃上报通道独立（E0-2）。
  // 位置约束：【必须】在第一个 whenReady 闭包内（win 是该闭包的 const——挪到闭包外
  // executeJavaScript 会 ReferenceError 被 per-round catch 吞掉，CSV 只剩表头——R132 实测）。
  if (process.env.ARKUI_SOAK_ROUNDS && process.env.ARKUI_SOAK_OUT) {
    (async () => {
      const rounds = Math.max(1, Number(process.env.ARKUI_SOAK_ROUNDS) || 200);
      const soakOut = path.resolve(process.env.ARKUI_SOAK_OUT);
      const soakRoot = path.resolve(__dirname, '..');   // 输出限定在仓库根内（Mimosa 路径穿越守卫）
      if (!soakOut.startsWith(soakRoot)) {
        console.error('[soak] 输出路径越出仓库根，拒绝：' + soakOut);
      } else {
        await new Promise((r) => setTimeout(r, 5000));   // 等测试页跑完自身断言并落定
        try { fs.mkdirSync(path.dirname(soakOut), { recursive: true }); } catch (e) { /* 免疫 */ }
        fs.writeFileSync(soakOut, 'round,heapUsedMB,domNodes,elmtRecords\n');
        for (let i = 1; i <= rounds; i++) {
          try {
            const row = await win.webContents.executeJavaScript(
              '(async () => { globalThis.__arkui_soak_step && await globalThis.__arkui_soak_step();' +
              ' return [Math.round(performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0),' +
              ' document.querySelectorAll("*").length,' +
              ' (globalThis.__arkui_dom_elmtRecords ? globalThis.__arkui_dom_elmtRecords.size : 0)]; })()'
            );
            fs.appendFileSync(soakOut, `${i},${row[0]},${row[1]},${row[2]}\n`);
            if (i % 25 === 0) console.log('[soak] round=' + i + ' heap=' + row[0] + 'MB nodes=' + row[1] + ' recs=' + row[2]);
          } catch (e) {
            console.error('[soak] round=' + i + ' 采样失败: ' + (e && e.message));
          }
        }
        console.log('[soak] 完成：' + soakOut);
        app.exit(0);   // soak 模式下退出权在 sampler（见判定处的让渡注释）
      }
    })();
  }

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
    // E0-2：同时落盘（kind=render-process-gone）。d（{reason, exitCode, description}）
    // 无堆栈，整体进 extra；message 只留 reason/exitCode 一行，便于 grep。
    appendCrashLog('render-process-gone',
      '渲染进程退出 reason=' + (d && d.reason) + ' exitCode=' + (d && d.exitCode),
      { details: d });
  });

  try {
    // 走 http:// 而非 file://：这样页面里的 fetch 是同源，net.http 等平台能力才与浏览器侧一致
    // ARKUI_PROFILE=1（R161 profiling 切片）：CDP 采样 CPU profiler 包住页面执行——
    // loadURL 前启动、结果落定后停止，build/<页>.cpuprofile 供 tools/profile-report.mjs 分析
    // ARKUI_TRACE=1（R164 tracing 切片）：Tracing 域把 native (program) 拆到
    // style/layout/paint——build/<页>.trace.json 供 tools/trace-report.mjs 分析
    let profilerDbg = null;
    let traceBuf = null;
    const traceMode = process.env.ARKUI_TRACE === '1';
    if (process.env.ARKUI_PROFILE === '1' || traceMode) {
      try {
        profilerDbg = win.webContents.debugger;
        profilerDbg.attach('1.3');
        // Electron 44 实测 quirk：enable/start 的响应不回投（命令实际生效——
        // stop 照常拿到采样），所以这仨只等 1.5s 就放行，不因超时放弃 profiling
        const lenient = (cmd, params) => Promise.race([
          profilerDbg.sendCommand(cmd, params),
          new Promise((r) => setTimeout(() => r(null), 1500)),
        ]);
        if (process.env.ARKUI_PROFILE === '1') {
          await lenient('Profiler.enable');
          await lenient('Profiler.setSamplingInterval', { interval: 100 });
          await lenient('Profiler.start');
          console.log('[profile] 采样启动（100µs；enable/start 响应不回投为已知 quirk）');
        }
        if (traceMode) {
          traceBuf = { events: [], done: false, onDone: null };
          profilerDbg.on('message', (_ev, method, params) => {
            if (method === 'Tracing.dataCollected' && params && params.value) {
              traceBuf.events.push(...params.value);
            } else if (method === 'Tracing.tracingComplete') {
              traceBuf.done = true;               // 早于等待注册也要记（竞态）
              if (traceBuf.onDone) traceBuf.onDone();
            }
          });
          // 类别：devtools.timeline 给 Layout/Paint/RecalcStyles 主相，blink 补
          // 详细相，disabled-by-default 增补计数细节（体积可控——只截页面执行窗）
          await lenient('Tracing.start', {
            traceConfig: { includedCategories: ['devtools.timeline', 'blink',
              'disabled-by-default-devtools.timeline'] },
          });
          console.log('[trace] 采集启动');
        }
      } catch (e) { console.error('[profile/trace] 启动失败: ' + e.message); profilerDbg = null; }
    }
    if (pageUrl) await win.loadURL(pageUrl);
    else await win.loadFile(pagePath);

    // 取证陷阱：unhandledrejection/window.onerror 不一定走 console-message——
    // 页面驱动脚本若在 await 链上炸掉，这里兜住栈（R130 教训：CSP 类静默死
    // console 无报错；本陷阱是「页面到底跑没跑、死在哪」的直接证据）
    await win.webContents.executeJavaScript(
      "window.__ur=[];" +
      "window.addEventListener('unhandledrejection',function(e){window.__ur.push('rej: '+String(e.reason&&e.reason.stack||e.reason))});" +
      "window.addEventListener('error',function(e){window.__ur.push('err: '+String(e.error&&e.error.stack||e.message))});''"
    ).catch(() => {});

    const deadline = Date.now() + WAIT_MS;
    let result = '';
    let probeTick = 0;
    while (Date.now() < deadline) {
      result = await win.webContents.executeJavaScript(
        "(() => { const e = document.getElementById('result'); return e ? e.textContent : ''; })()"
      ).catch((e) => '读取失败: ' + e.message);
      if (result && !result.includes('running')) break;
      // 取证探针（每 ~2s 一次）：页面 rAF 是否在走、可见性状态——OSR 无帧疑难的
      // 关键证据（本地无法复现的 runner 卡死，靠它区分「rAF 停摆」与「页面卡他处」）
      if (useOffscreen && (++probeTick % 10 === 0)) {
        const probe = await win.webContents.executeJavaScript(
          "new Promise((res) => { let fired = false;" +
          " requestAnimationFrame(() => { fired = true; });" +
          " setTimeout(() => res('raf=' + (fired ? 'yes' : 'stalled') +" +
          " ' vis=' + document.visibilityState), 1500); })"
        ).catch((e) => 'probe 失败: ' + e.message);
        console.log('[probe] ' + probe);
      }
      // OSR（offscreen）下部分环境（无 GPU 的 CI runner）合成器不自发产帧——
      // 页面 await raf() 永不 resolve、#result 停在 running… 直到超时（本地 Xvfb
      // 正常、同码在 runner 卡死实测）。invalidate 强制产一帧，驱动 rAF 前进。
      if (useOffscreen) win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log('──── 渲染进程内的断言输出（与浏览器同一份页面）────');
    console.log(result || '（空）');
    // profiling/tracing 收口：结果落定即停（截图段时间不计入）
    if (profilerDbg) {
      if (process.env.ARKUI_PROFILE === '1') {
        try {
          const stopped = await Promise.race([
            profilerDbg.sendCommand('Profiler.stop'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('stop 5s 超时')), 5000)),
          ]);
          const profile = stopped && stopped.profile;
          const total = profile ? profile.nodes.reduce((a, n) => a + (n.hitCount || 0), 0) : 0;
          if (profile && total > 0) {
            const out = path.join(__dirname, '..', 'build', `${testName}.cpuprofile`);
            fs.writeFileSync(out, JSON.stringify(profile));
            console.log(`[profile] build/${testName}.cpuprofile（采样 ${total}，分析：node tools/profile-report.mjs build/${testName}.cpuprofile）`);
          } else {
            console.error('[profile] 停止返回空 profile（enable 未生效？）');
          }
        } catch (e) { console.error('[profile] 停止失败: ' + e.message); }
      }
      if (traceBuf) {
        try {
          // Tracing.end 响应可能不回投（同 Profiler quirk）——3s 放行后等
          // tracingComplete（8s 上限），dataCollected 应已到齐
          await Promise.race([
            profilerDbg.sendCommand('Tracing.end'),
            new Promise((r) => setTimeout(() => r(null), 3000)),
          ]);
          await new Promise((r) => {
            if (traceBuf.done) return r();
            const t = setTimeout(r, 8000);
            traceBuf.onDone = () => { clearTimeout(t); r(); };
          });
          const out = path.join(__dirname, '..', 'build', `${testName}.trace.json`);
          fs.writeFileSync(out, JSON.stringify({ traceEvents: traceBuf.events }));
          console.log(`[trace] build/${testName}.trace.json（事件 ${traceBuf.events.length}，分析：node tools/trace-report.mjs build/${testName}.trace.json）`);
        } catch (e) { console.error('[trace] 收口失败: ' + e.message); }
        traceBuf = null;
      }
      try { profilerDbg.detach(); } catch { /* 已分离 */ }
      profilerDbg = null;
    }
    // 页面状态快照：脚本加载件数（resource 条目）、路由渲染长度、陷阱捕获——
    // 「卡 running…」时区分【脚本根本没跑】与【跑了但死在 await 链上】
    try {
      const state = await win.webContents.executeJavaScript(
        "JSON.stringify({ur:(window.__ur||[]).length," +
        " rootLen:(document.getElementById('root')||{innerHTML:''}).innerHTML.length," +
        " res:performance.getEntriesByType('resource').length})"
      );
      console.log('[页面状态] ' + state);
      const ur0 = await win.webContents.executeJavaScript("(window.__ur||[])[0]||''");
      if (ur0) console.log('──── 陷阱捕获 ────\n' + ur0);
    } catch { /* 诊断失败不影响判定 */ }
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
    // E0-4：soak 模式退出权让渡——sampler（异步 IIFE）在测试判定后还要跑 N 轮采样，
    // 这里 app.exit 会抢在它前面把进程杀掉（CSV 只剩表头——R132 实测）。soak 完成
    // 后 sampler 自己 app.exit(0)。
    if (process.env.ARKUI_SOAK_ROUNDS && process.env.ARKUI_SOAK_OUT) return;
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('加载失败: ' + (e && e.stack ? e.stack : e));
    // E0-6 配套：加载失败时诊断页已由 did-fail-load 接管 → 等它渲染完补留一张截图
    //（E0-6 验收：诊断页截图非白）。offscreen 模式直接用 paint 帧；否则 capturePage 设
    // 超时（隐藏窗口合成器可能不产帧，同上方截图段的教训）。退出码维持 3：加载失败本就
    // 不产出 ELECTRON_RESULT，测试判定语义不变，仅新增诊断产物。
    if (bootFail.rendered) {
      try { if (bootFail.promise) await bootFail.promise; } catch (e2) { /* 不影响退出码 */ }
      await new Promise((r) => setTimeout(r, 400));   // 给诊断页一帧落定的时间
      try {
        let img = null;
        if (useOffscreen && lastFrame) img = lastFrame;
        else {
          img = await Promise.race([
            win.webContents.capturePage(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage 超时')), 3000)),
          ]);
        }
        if (img) {
          fs.writeFileSync(outPng, img.toPNG());
          console.log('[boot-fail] 诊断页截图已留存: ' + outPng);
        }
      } catch (capErr) {
        console.log('[boot-fail] 诊断页截图跳过: ' + (capErr && capErr.message) + '（不影响退出码）');
      }
    }
    app.exit(3);
  }
});

// ────────────────── E1-5：多窗口管理（arkui:win2:* 通道，只增不改既有 handler）──────────────────
//
// 与既有两条窗口通道互补（本节全部用新 channel 名，不碰 R80 'arkui:window:op' 与
// R88 'arkui:ability:*'）：
//   · R80 单窗操作面：操作 whenReady 闭包里的主窗（getLastWindow 那一侧）；
//   · R88 ability 让位式双窗：startForResult 专用（caller/callee 两方强耦合）；
//   · 本节：任意多 BrowserWindow 并存的通用管理面（建/销/聚焦/枚举 + 每窗焦点事件广播）。
//
// 位置约束：整节放【模块层】（whenReady 闭包之外、文件尾追加）——热点文件最小插入纪律。
// 可行性：窗表靠 app 的 'browser-window-created' 事件全量登记，本节注册先于 whenReady
// 回调执行，所以主窗（whenReady 里 new 的那个）也会被登记到，无需改动闭包内任何一行。
//
// 语义出处（@ohos.window.d.ts，SDK 26.0.0.821）：
//   · 事件值用 WindowEventType 数值（d.ts:2954-2989）：WINDOW_ACTIVE=2（JSDoc 原文
//     "The window gains focus."）/ WINDOW_INACTIVE=3（"The window loses focus."）/
//     WINDOW_DESTROYED=7（"The window is destroyed."）。
//   · windowId 沿用 Electron BrowserWindow.id（自 1 单调递增）——真机 windowId 语义
//     （d.ts 各 API 的 number windowId 入参）由"单调唯一 id"对齐，数值不跨端互通。
const win2Meta = new Map();            // windowId → { name: string|null, seq: number }
let win2Seq = 0;
// Win2 事件类型常量（WindowEventType 的 focus/destroy 子集，数值照 d.ts:2963/2972/2989）
const WIN2_EVENT_TYPE = { WINDOW_ACTIVE: 2, WINDOW_INACTIVE: 3, WINDOW_DESTROYED: 7 };
// 测试驱动判定（与 whenReady 里的 isTestDrive 同表达式、同含义）：测试 harness 靠主窗
// 退出收结果，主窗被误销毁会让用例假死（R80 destroy 守卫同一理由，这里只拦主窗——
// win2 自建的子窗本就是测试对象，销毁它们正是用例内容）。
const win2IsTestDrive = !!(process.env.ARKUI_TEST || process.env.ARKUI_PAGE_URL);

app.on('browser-window-created', (_e, bw) => {
  if (!bw || bw.isDestroyed()) return;
  const id = bw.id;
  win2Meta.set(id, { name: null, seq: ++win2Seq });   // name 由 win2:create 显式补
  // 任一窗 focus/blur/closed → WindowEventType 数值广播给【全部】存活窗（各窗收到的
  // 事件流相同，是否与己相关由订阅方按 ev.id 自判——多窗语义，与真机 on('windowEvent')
  // 的窗口级订阅不同源，这里选全局流 + 客户端过滤是 Electron 侧最简可靠形态）。
  const win2Broadcast = (type) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        if (!w.webContents.isDestroyed()) w.webContents.send('arkui:win2:event', { id, type });
      } catch (e) { /* 目标窗恰好死亡：跳过它，不阻断其余窗的投递 */ }
    }
  };
  bw.on('focus', () => win2Broadcast(WIN2_EVENT_TYPE.WINDOW_ACTIVE));
  bw.on('blur', () => win2Broadcast(WIN2_EVENT_TYPE.WINDOW_INACTIVE));
  // 'closed'（destroy() 亦保证派发）→ 广播 DESTROYED 并摘表；监听器随窗口对象一起回收
  bw.on('closed', () => { win2Broadcast(WIN2_EVENT_TYPE.WINDOW_DESTROYED); win2Meta.delete(id); });
});

// 窗名解析：win2:create 的显式名优先；未命名的首个窗口是 harness 主窗 → 'main'；
// 其余未命名窗口（如 R88 的 ability 让位窗）给稳定默认名，保证 list 永不出无名项。
const win2NameOf = (id) => {
  const m = win2Meta.get(id);
  if (!m) return '';
  return m.name || (m.seq === 1 ? 'main' : `window-${m.seq}`);
};

// 建窗（name/url/width/height）→ 返回 windowId。SDK 对照 @ohos.window.d.ts:1905
// `function createWindow(config: Configuration): Promise<Window>`（JSDoc 原文
// "Creates a child window or system window."，@since 9）——DOM 运行时持不住原生
// Window 句柄，投影为返回 number windowId 供 destroy/focus 以 id 寻址。
ipcMain.handle('arkui:win2:create', (_e, cfg) => {
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  const fsRoot = fsRootForRenderer();
  const bw = new BrowserWindow({
    width: Math.max(80, Number(c.width) || 360),
    height: Math.max(60, Number(c.height) || 280),
    show: false,                        // 先建后 show：webPreferences 全配齐再可见
    webPreferences: {                   // 形状照抄 R88 abilityWin：带桥、带落盘根
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      additionalArguments: fsRoot ? [`--arkui-fs-root=${fsRoot}`] : [],
    },
  });
  // 'browser-window-created' 已把窗表行建好（含 seq），这里只补显式名
  const m = win2Meta.get(bw.id);
  if (m) m.name = String(c.name || `window-${m.seq}`);
  // 焦点语义需要可见窗口（隐藏窗不参与系统焦点环）→ 建窗即 show；url 异步装载
  // 不阻塞建窗返回（装载失败只影响子窗内容，窗口本体与事件面照常可用，不静默回滚）
  bw.show();
  bw.loadURL(c.url ? String(c.url) : 'about:blank').catch((e) => {
    console.error('[win2] 子窗装载失败 id=' + bw.id + ' url=' + c.url + ': ' + (e && e.message));
  });
  return bw.id;
});

// 销窗（id）→ boolean。SDK 对照 d.ts:3478 `destroyWindow(): Promise<void>`（JSDoc 原文
// "Destroys this window."；旧名 destroy() @deprecated since 9 → @useinstead destroyWindow，
// d.ts:3438/3448）。主窗在测试驱动下一律拒绝（win2IsTestDrive 守卫，理由见上）。
ipcMain.handle('arkui:win2:destroy', (_e, id) => {
  const wid = Number(id);
  const bw = BrowserWindow.fromId(wid);
  if (!bw || bw.isDestroyed()) return false;
  const m = win2Meta.get(wid);
  if (m && m.seq === 1 && win2IsTestDrive) return false;   // 主窗不销毁：harness 靠它收结果
  bw.destroy();
  return true;
});

// 聚焦（id）→ boolean。本 SDK d.ts 无同名 focusWindow（近邻 shiftAppWindowFocus，
// d.ts:2135，JSDoc 原文 "Shifts the window focus from the source window to the target
// window in the same application."）；桌面语义以 Electron win.focus() 落地。
ipcMain.handle('arkui:win2:focus', (_e, id) => {
  const bw = BrowserWindow.fromId(Number(id));
  if (!bw || bw.isDestroyed()) return false;
  if (!bw.isVisible()) bw.show();       // 隐藏窗不参与焦点环：先可见再聚焦
  bw.focus();
  return true;
});

// 枚举 → [{id, name, focused, visible}]。本 SDK d.ts 无模块级 getWindows（近邻：
// getWindowsByCoordinate d.ts:2251 / getAllMainWindowInfo d.ts:2395）；此处枚举本应用
// 全部存活 BrowserWindow，四字段投影。focused/visible 是主进程此刻真值，不是缓存。
ipcMain.handle('arkui:win2:list', () => BrowserWindow.getAllWindows()
  .filter((w) => !w.isDestroyed())
  .map((w) => ({ id: w.id, name: win2NameOf(w.id), focused: w.isFocused(), visible: w.isVisible() })));
