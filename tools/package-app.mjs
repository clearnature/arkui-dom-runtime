#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// R81：桌面分发包固化工具——把 R72 spike 的验证路径变成可重复命令。
//
// 产物形态（二选一，--mode）：
//   packager  @electron/packager 目录分发（~285M；tar.gz 后 ~118M）——默认，最稳
//   appimage  electron-builder AppImage 单文件（~120M；本机需 --appimage-extract-and-run）
//
// 打包后自动冒烟：PAGE 页 ELECTRON_RESULT 必须 PASS，否则脚本报错退出 1。
//
// 已知坑（R72 实测，脚本内已处理）：
//   ① electron-builder 默认吞 build/ 目录（与本项目构建产物目录撞名）
//      → -c.directories.buildResources=no-such-dir -c.files='**/*'
//   ② AppImage 本机（无 libfuse2）需 --appimage-extract-and-run
//   ③ chrome-sandbox 未设 setuid → 启动必须 --no-sandbox
//
// 零依赖纪律：npx 临时使用，不写进任何 package.json。
//
// 用法：
//   node tools/package-app.mjs                    # packager 路 + 冒烟
//   node tools/package-app.mjs --mode appimage    # AppImage 路
//   node tools/package-app.mjs --out /tmp/myout   # 自定义输出目录
//   node tools/package-app.mjs --page perfdemo    # 冒烟页（默认 perfdemo）
// ─────────────────────────────────────────────────────────────────────────────
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath：.pathname 在 Windows 返回 /D:/...（盘符前带斜杠），join 出 \D:\ 死路径
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const MODE = flag('--mode', 'packager');
const OUT = flag('--out', '/data/tmp/arkui-pkg-out');
const PAGE = flag('--page', 'perfdemo');
// --platform linux|win（默认按宿主 OS 探测；CI 显式传）——win 产物 = win-unpacked
// 目录 + zip（Reasonix dist/ 清单形态）+ SHA256SUMS/artifacts.json（W3 收口）。
const PLATFORM = flag('--platform', process.platform === 'win32' ? 'win' : 'linux');
const ARCH = 'x64';
const PKG_TAG = PLATFORM === 'win' ? 'windows' : 'linux';   // 产物命名：arkui-dom-desktop-<tag>-x64
// Linux-only 分发集在 win 包降级：cjk/hs 内核是 ELF .so + dlopen 架构，Windows 形态
// （LoadLibrary/DLL）按 PLAN-WINDOWS-CI.md 三期裁定不做——包内 cjk 用例自动 SKIP 留痕
//（run.sh 既有机制），打包含义=纯 JS 运行时 + 测试矩阵，与 kernel-contract Windows SKIP 同口径。
const WANT_KERNEL_SETS = PLATFORM === 'linux';
const ELECTRON_VERSION = '44.2.0';
const APP_NAME = 'arkui-dom-electron';
const PRODUCT = 'arkui-dom-desktop';

// R113：临时区 /data/tmp（/tmp tmpfs inode 打满曾致门禁假红）
const TMP = process.env.ARKUI_PKG_TMP || '/data/tmp';   // R159.3：CI runner /data 不可写→env 覆盖

const step = (m) => console.log('══ ' + m);

// ── 0) 前提检查 ──
step('前提检查');
const cache = path.join(process.env.HOME, '.cache/electron');
const zipName = fs.existsSync(cache)
  ? (fs.readdirSync(cache).find((d) => d.startsWith(`electron-v${ELECTRON_VERSION}-${PLATFORM === 'win' ? 'win32' : 'linux'}-x64.zip`)) || '')
  : '';
const zipCandidate = zipName ? path.join(cache, zipName) : '';
// 必须是【文件】——只判 existsSync 会把 cache 目录本身当 zip（R109 实测：
// cache 清空后 basename 变成 "electron"、软链指向目录，packager 报 zip 不存在）
const hasZip = !!zipCandidate && fs.existsSync(zipCandidate) && fs.statSync(zipCandidate).isFile();
const electronBin = PLATFORM === 'win'
  ? path.join(ROOT, 'electron/node_modules/electron/dist/electron.exe')
  : path.join(ROOT, 'electron/runtime/electron');
if (!hasZip && !fs.existsSync(electronBin)) {
  console.error(`❌ 找不到 Electron v${ELECTRON_VERSION}（~/.cache/electron/ 的 zip 或 electron/runtime/ 解包）`);
  process.exit(2);
}
for (const f of ['electron/main.js', 'electron/preload.js', 'runtime/arkui-dom-runtime.js', 'build/app.js']) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.error(`❌ 缺 ${f}（先跑 npm run check 的构建步骤）`); process.exit(2); }
}
console.log('  zip=' + (hasZip ? zipCandidate : '（用本地解包）'));

// ── 1) staging ──
step('staging（/data/tmp，不污染仓库）');
const S = path.join(TMP, 'arkui-pkg-staging');
fs.rmSync(S, { recursive: true, force: true });
for (const d of ['electron', 'test', 'build', 'runtime', 'bridge/napi', 'data/kernel', 'harmony-proj/entry/src/main/resources'])
  fs.mkdirSync(path.join(S, d), { recursive: true });
for (const f of ['main.js', 'preload.js']) fs.copyFileSync(path.join(ROOT, 'electron', f), path.join(S, 'electron', f));
fs.mkdirSync(path.join(S, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'serve.py'), path.join(S, 'tools', 'serve.py'));
fs.cpSync(path.join(ROOT, 'runtime'), path.join(S, 'runtime'), { recursive: true });
// 全部测试页 + 全部页面模块（分发包要能跑整个用例矩阵，不只冒烟页）
for (const f of fs.readdirSync(path.join(ROOT, 'test'))) if (f.endsWith('.html')) fs.copyFileSync(path.join(ROOT, 'test', f), path.join(S, 'test', f));
for (const f of fs.readdirSync(path.join(ROOT, 'build'))) if (f.endsWith('.js') && !f.endsWith('.result.txt')) fs.copyFileSync(path.join(ROOT, 'build', f), path.join(S, 'build', f));

// ── R109：仓颉内核分发集 ──
// data/kernel/ 平铺：libkernel.so（RPATH=$ORIGIN）+ 仓颉运行时全部 .so——
// 打包态主进程零 LD_LIBRARY_PATH 加载（内核 RPATH 链式覆盖二层依赖）。
// addon .node 必须随包（main.js require('../bridge/napi/…')）。
// W3：cjk/hs 是 ELF .so + dlopen 架构——Windows 包跳过（LoadLibrary/DLL 按三期裁定
// 不做；run.sh 的 cjk 系 SKIP 留痕机制让包内用例矩阵自动降级，与 CI kernel-contract 同口径）。
if (WANT_KERNEL_SETS) fs.copyFileSync(path.join(ROOT, 'bridge/napi/cjk_napi.node'), path.join(S, 'bridge/napi/cjk_napi.node'));
const rtDir = process.env.CANGJIE_RT_LIB ||
  '/data/work/compiler/cangjie/Nightly/cangjie-nightly-current/runtime/lib/linux_x86_64_cjnative';
const kernelSo = path.join(ROOT, 'kernel/cangjie/libkernel.so');
let cjkPacked = false;
if (!WANT_KERNEL_SETS) {
  console.log('  ⏭  win 包：cjk/hs 内核分发集跳过（ELF .so 架构 Windows 化=三期裁定不做；包内 cjk 系 SKIP 留痕）');
} else if (fs.existsSync(kernelSo) && fs.existsSync(path.join(rtDir, 'libcangjie-runtime.so'))) {
  fs.copyFileSync(kernelSo, path.join(S, 'data/kernel/libkernel.so'));
  for (const f of fs.readdirSync(rtDir)) if (f.endsWith('.so')) {
    fs.copyFileSync(path.join(rtDir, f), path.join(S, 'data/kernel', f));
  }
  cjkPacked = true;
  console.log(`  cjk 分发集: libkernel.so + ${fs.readdirSync(rtDir).filter((f) => f.endsWith('.so')).length} 个运行时 .so（31MB）`);
} else {
  console.log('  ⚠️ 未找到仓颉运行时/内核——cjk 用例在包内将降级（其余不受影响）');
}

// ── R127：Haskell/GHC 内核分发集 ──
// data/kernel/hs/ 平铺：libkernel_hs.so + GHC 闭包（内核 NEEDED 传递闭包 + RTS + libffi）。
// 每个拷入的 .so 都 patchelf --set-rpath $ORIGIN —— GHC 链接时烙的绝对 libdir（dev 级）
// 在无 GHC 机器上是死路径；glibc 对 dlopen 链按【各对象自身】RUNPATH 解析（DT_RUNPATH 不像
// DT_RPATH 那样继承），所以必须逐个改。ldconfig 不认识 GHC（本机实测 0 条）——
// 打包态 ldd 全部落在包内即证零依赖闭包完整。
function ghcClosure() {
  // ldd 递归收集 GHC 目录下的依赖（内核 10 包 + ghc-internal 传递）+ RTS + libffi
  const G = '/usr/local/lib/ghc-9.14.1/lib/x86_64-linux-ghc-9.14.1-inplace';
  const seen = new Set();
  const out = [];
  const walk = (so) => {
    let text = '';
    try { text = execSync(`ldd ${JSON.stringify(so)}`, { encoding: 'utf8' }); }
    catch { return; }
    for (const m of text.matchAll(/=>\s*(\S+libHS[^\s)]+\.so|\S+libffi\.so\S*)\s*\(/g)) {
      const p = path.resolve(m[1]);   // ldd 输出可能带 /../（经 RUNPATH 未规范化）——先规范化
      if (seen.has(p)) continue;
      seen.add(p);
      if (p.startsWith(G) || p.includes('libffi.so')) { out.push(p); walk(p); }
    }
  };
  walk(path.join(ROOT, 'kernel/hs/libkernel_hs.so'));
  // R127：内核恒 -threaded → RTS 必须拷 **thr 变体**（非线程 RTS 会让
  // kernel_init 的 setNumCapabilities 直接败；addon 扫描同规则 thr 优先）
  const rts = fs.readdirSync(G).find((f) => f.startsWith('libHSrts-') && f.includes('_thr-') && !f.includes('_debug') && !f.includes('_p-'))
    || fs.readdirSync(G).find((f) => f.startsWith('libHSrts-') && !f.includes('_debug') && !f.includes('_p-'));
  if (rts) { const p = path.join(G, rts); if (!seen.has(p)) { seen.add(p); out.push(p); } }
  return { dir: G, libs: out };
}
const hsSo = path.join(ROOT, 'kernel/hs/libkernel_hs.so');
let hsPacked = false;
if (!WANT_KERNEL_SETS) {
  // win 包：cjk 分支已留痕，此处静默跳过
} else if (fs.existsSync(hsSo)) {
  const patchelf = process.env.PATCHELF || (process.env.HOME + '/.local/bin/patchelf');
  if (!fs.existsSync(patchelf)) {
    console.log('  ⚠️ patchelf 不可用（pip3 install --user --break-system-packages patchelf）——hs 分发集跳过');
  } else {
    const hsDir = path.join(S, 'data/kernel/hs');
    fs.mkdirSync(hsDir, { recursive: true });
    fs.copyFileSync(hsSo, path.join(hsDir, 'libkernel_hs.so'));
    const { libs } = ghcClosure();
    for (const p of libs) fs.copyFileSync(p, path.join(hsDir, path.basename(p)));
    for (const f of fs.readdirSync(hsDir)) {
      execSync(`${JSON.stringify(patchelf)} --set-rpath '$ORIGIN' ${JSON.stringify(path.join(hsDir, f))}`);
    }
    hsPacked = true;
    console.log(`  hs 分发集: libkernel_hs.so + ${libs.length} 个 GHC 闭包 .so（RPATH=$ORIGIN）`);
  }
} else {
  console.log('  ⚠️ 未找到 libkernel_hs.so（bash kernel/hs/build.sh）——hs 分发集跳过');
}
fs.writeFileSync(path.join(S, 'package.json'), JSON.stringify({
  name: APP_NAME, productName: PRODUCT, version: '0.1.0',
  description: 'ArkTS->DOM runtime desktop', main: 'electron/main.js',
  private: true, author: 'arkui-dom-runtime',
}, null, 2));
// R134：app 资源随包（$r/resourcemanager 打包态）——base 全目录平拷
if (fs.existsSync(path.join(ROOT, 'harmony-proj/entry/src/main/resources/base'))) {
  fs.cpSync(path.join(ROOT, 'harmony-proj/entry/src/main/resources/base'),
            path.join(S, 'harmony-proj/entry/src/main/resources/base'), { recursive: true });
  console.log('  app 资源集: harmony-proj resources/base 随包');
}
console.log(`  staged: ${fs.readdirSync(path.join(S, 'test')).length} pages, ${fs.readdirSync(path.join(S, 'build')).length} modules`);

// ── 2) 打包 ──
step('打包（--mode ' + MODE + '）');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
if (MODE === 'packager') {
  const zdir = path.join(TMP, 'arkui-electron-zips');
  if (hasZip) {
    fs.mkdirSync(zdir, { recursive: true });
    const link = path.join(zdir, path.basename(zipCandidate));
    fs.rmSync(link, { force: true });
    // 软链在 Windows 上要特权/开发者模式——win 路改真拷贝（一个 zip ~100MB，一次性成本）
    if (PLATFORM === 'win') fs.copyFileSync(zipCandidate, link);
    else fs.symlinkSync(zipCandidate, link);          // packager 只认目录里的 zip；软链零拷贝
  }
  execSync(`cd ${TMP} && npx --yes @electron/packager ${S} ${APP_NAME} ` +
    `--platform=${PLATFORM === 'win' ? 'win32' : 'linux'} --arch=${ARCH} --electron-version=${ELECTRON_VERSION} ` +
    (hasZip ? `--electron-zip-dir=${zdir} ` : '--download.mirror=https://npmmirror.com/mirrors/electron/ ') +
    `--asar=false --out=${OUT} --overwrite`, { stdio: 'inherit' });
} else if (MODE === 'appimage') {
  execSync(`cd ${S} && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ` +
    `npx --yes electron-builder --linux AppImage --publish never ` +
    `-c.electronVersion=${ELECTRON_VERSION} -c.appId=dev.arkui.desktop -c.productName=${PRODUCT} ` +
    `-c.asar=false -c.directories.buildResources=no-such-dir "-c.files=**/*" ` +
    `--config.directories.output=${OUT}`, { stdio: 'inherit' });
} else {
  console.error('❌ 未知 --mode：' + MODE + '（packager | appimage）');
  process.exit(2);
}

// ── 3) 冒烟验证 ──
step(`冒烟验证（${PAGE}，env 驱动原样可用）`);
const findBin = (dir) => {
  if (MODE === 'appimage') {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { const r = walk(full); if (r) return r; }
        else if (e.name.endsWith('.AppImage')) return full;
      }
      return null;
    };
    return walk(dir);
  }
  const suffix = PLATFORM === 'win' ? '-win32-x64' : '-linux-x64';
  const sub = fs.readdirSync(dir).find((d) => d.endsWith(suffix));
  if (!sub) return null;
  return path.join(dir, sub, PLATFORM === 'win' ? APP_NAME + '.exe' : APP_NAME);
};
const bin = findBin(OUT);
if (!bin) { console.error('❌ 打包产物里没找到可执行文件'); process.exit(1); }
if (PAGE === 'cjk' && !cjkPacked) {
  console.error('❌ --page cjk 需要 cjk 分发集（CANGJIE_RT_LIB 指向运行时库目录后重跑）');
  process.exit(1);
}
// R127：--kernel hs → 打包态整 app 跑 Haskell 内核（main.js ARKUI_KERNEL_KIND）
const KERNEL = flag('--kernel', 'cangjie');
if (KERNEL === 'hs') {
  if (!hsPacked) { console.error('❌ --kernel hs 需要 hs 分发集（先 bash kernel/hs/build.sh）'); process.exit(1); }
  // 零依赖静态证：staged 内核与其 GHC 闭包的 ldd 解析不得出现包外路径
  //（ldconfig 不认识 GHC——解析落在包内即证闭包完整；GHC 链接时烙的绝对 libdir 已被 $ORIGIN 覆盖）
  const staged = path.join(S, 'data/kernel/hs');
  const bad = [];
  const walkDeps = (so) => {
    let text = '';
    try { text = execSync(`ldd ${JSON.stringify(so)}`, { encoding: 'utf8' }); } catch { return; }
    for (const m of text.matchAll(/=>\s*(\/\S+)\s*\(/g)) {
      const p = path.resolve(m[1]);
      if (p.includes('libHS') || p.includes('libffi.so')) {
        if (!p.startsWith(staged)) bad.push(`${path.basename(so)} → ${p}`);
        else walkDeps(p);
      }
    }
  };
  walkDeps(path.join(staged, 'libkernel_hs.so'));
  if (bad.length) {
    console.error(`❌ hs 闭包泄漏包外路径（${bad.length}）：\n  ` + bad.slice(0, 5).join('\n  '));
    process.exit(1);
  }
  console.log(`  hs 零依赖静态证：闭包 ${(() => { let n = 0; const seen = new Set(); const w = (so) => { let t = ''; try { t = execSync(`ldd ${JSON.stringify(so)}`, { encoding: 'utf8' }); } catch { return; } for (const m of t.matchAll(/=>\s*(\/\S+)\s*\(/g)) { const p = m[1]; const p2 = path.resolve(m[1]); if ((p2.includes('libHS') || p2.includes('libffi.so')) && !seen.has(p2)) { seen.add(p2); if (p2.startsWith(staged)) w(p2); } } }; w(path.join(staged, 'libkernel_hs.so')); return seen.size; })()} 个 .so 全部解析于包内`);
}

const isAppImage = bin.endsWith('.AppImage');
// --ozone-platform=x11：Linux 专属（Windows 有真实显示栈，传了反而可能炸）——
// 与 run.sh 矩阵同口径（OZONE_ARGS 在 MSYS/Windows_NT 置空）
const isWin = PLATFORM === 'win';
const runArgs = (isAppImage ? '--appimage-extract-and-run ' : '') +
  (isWin ? '--no-sandbox --disable-gpu' : '--no-sandbox --disable-gpu --ozone-platform=x11');
const cwd = isAppImage ? path.dirname(bin) : path.dirname(bin);
// R109 零依赖冒烟：清空仓颉环境（CANGJIE_RT_LIB/ARKUI_KERNEL_LIB/LD_LIBRARY_PATH），
// 模拟无 SDK 机器——cjk 用例必须靠包内 data/kernel/（内核 RPATH=$ORIGIN）通过
// R127：--kernel hs 同证 GHC 侧（LD_LIBRARY_PATH 清空 + 不注入 GHC_LIB_DIR——
// main.js 只剩包内 data/kernel/hs 可用）
const smokeEnv = { ...process.env, ARKUI_TEST: PAGE, ARKUI_OFFSCREEN: '1' };
delete smokeEnv.CANGJIE_RT_LIB;
delete smokeEnv.ARKUI_KERNEL_LIB;
delete smokeEnv.LD_LIBRARY_PATH;
delete smokeEnv.GHC_LIB_DIR;
if (KERNEL === 'hs') smokeEnv.ARKUI_KERNEL_KIND = 'hs';
// 冒烟与 run.sh 矩阵同构走 http://：同一 runner 上矩阵（serve.py + ARKUI_PAGE_URL）
// perfdemo 绿、包内 file:// loadFile 红且页停 running…（rAF 零派发、无任何 JS 报错、
// invalidate/ozone=x11 均无效）——file://+OSR 是唯一活变量，不再走 loadFile 兜底。
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(S, 'tools', 'serve.py'), '0'], {
  cwd: S, stdio: ['ignore', 'pipe', 'inherit'],
});
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
let port = '';
for (let i = 0; i < 50 && !port; i++) {
  port = (serverOut.match(/http:\/\/127\.0\.0\.1:(\d+)/) || [])[1] || '';
  if (!port) await new Promise((r) => setTimeout(r, 100));
}
if (!port) { console.error('❌ 包内 http 服务未启动'); process.exit(1); }
smokeEnv.ARKUI_PAGE_URL = `http://127.0.0.1:${port}/test/${PAGE}.html`;
let result = '';
try {
  result = execSync(`cd ${cwd} && ${JSON.stringify(bin)} ${runArgs} .`, {
    env: smokeEnv,
    encoding: 'utf8', timeout: 180000,
  });
} catch (e) { result = (e.stdout || '') + (e.stderr || ''); }
finally { server.kill(); }

console.log(result.split('\n').filter((l) => /PASS|FAIL|ELECTRON_RESULT/.test(l)).slice(-6).join('\n'));
const ok = /ELECTRON_RESULT: PASS/.test(result);
if (!ok) {
  // 失败时全量输出（页面断言输出 + 渲染进程报错都在 stdout——只打过滤行会把根因吞掉）
  console.error('──── 冒烟失败：全量输出 ────\n' + result);
  console.error('❌ 冒烟未通过');
  process.exit(1);
}
const passLine = (result.match(/=== ALL PASS \((\d+)\) ===/) || [])[1];
console.log(`✅ 打包+冒烟通过：${bin}`);
console.log(`   （${passLine ? passLine + ' 断言' : 'PASS'}；运行：cd ${path.dirname(bin)} && ${path.basename(bin)}` +
  `${isAppImage ? ' --appimage-extract-and-run' : ''} --no-sandbox）`);

// ── W3：产物清单固化（Reasonix dist/ 形态）──
// zip 压目录（win 用 PowerShell Compress-Archive 免 tar 语义坑）+ SHA256SUMS +
// artifacts.json（清单一处可查：文件/字节/SHA256）。Linux 目录分发 tar.gz 由
// CI 工作流侧固化（本地已有）；win 包 zip 是主产物。
if (!args.includes('--no-archive')) {
  step('产物清单（zip + SHA256SUMS + artifacts.json）');
  const appDir = path.dirname(bin);
  const base = `arkui-dom-desktop-${PKG_TAG}-x64`;
  const files = [];
  if (PLATFORM === 'win') {
    const zipPath = path.join(OUT, `${base}.zip`);
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${appDir.replace(/'/g, "''")}/*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`, { stdio: 'inherit' });
    files.push({ file: `${base}.zip`, bytes: fs.statSync(zipPath).size });
  } else {
    execSync(`cd ${JSON.stringify(OUT)} && tar -czf ${JSON.stringify(`${base}.tar.gz`)} -C ${JSON.stringify(OUT)} ${JSON.stringify(path.basename(appDir))}`, { stdio: 'inherit' });
    files.push({ file: `${base}.tar.gz`, bytes: fs.statSync(path.join(OUT, `${base}.tar.gz`)).size });
  }
  // SHA256SUMS（sha1sum 输出格式：sha256sum 走 node crypto，跨平台免装 coreutils 差异）
  const { createHash } = await import('node:crypto');
  const sumLines = files.map((f) => {
    const h = createHash('sha256').update(fs.readFileSync(path.join(OUT, f.file))).digest('hex');
    return `${h}  ${f.file}`;
  });
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS'), sumLines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'artifacts.json'), JSON.stringify({
    platform: PLATFORM, arch: ARCH, electron: ELECTRON_VERSION, page: PAGE,
    kernelSets: cjkPacked || hsPacked ? 'bundled' : 'skipped（Windows 形态三期裁定不做）',
    artifacts: files, sha256: sumLines.map((l) => l.split('  ')),
  }, null, 2));
  console.log(files.map((f) => `  ${f.file}  ${(f.bytes / 1048576).toFixed(1)}MB`).join('\n'));
  console.log('  SHA256SUMS / artifacts.json 固化于 ' + OUT);
}
