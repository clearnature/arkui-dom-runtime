/*
 * Electron 主进程：加载与浏览器验证完全相同的断言页，读回 #result，截图，按结果退出。
 *
 * 关键点：不复制任何测试代码——Electron 加载的就是 test/<name>.html 本体，
 * 所以"同一套断言在 Chrome headless 与 Electron 里都通过"这件事本身就是证据。
 *
 * 用法: ARKUI_TEST=layout ./runtime/electron --no-sandbox --disable-gpu .
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const testName = process.env.ARKUI_TEST || 'layout';
const pageUrl = process.env.ARKUI_PAGE_URL || '';        // 由 electron/run.sh 起本地服务后传入
const pagePath = path.resolve(__dirname, '..', 'test', `${testName}.html`);
const outPng = path.resolve(__dirname, '..', 'build', `electron-${testName}.png`);
const WAIT_MS = Number(process.env.ARKUI_WAIT_MS || 20000);

// 本机 Mesa 被 ROCm 改过（见 memory: rocm-mesa-sigtrap），Electron GPU 进程易崩 → 强制软件渲染
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer-fallback');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  if (!pageUrl && !fs.existsSync(pagePath)) {
    console.error(`页面不存在: ${pagePath}`);
    app.exit(2);
    return;
  }

  const useOffscreen = process.env.ARKUI_OFFSCREEN === '1';
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
    },
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
