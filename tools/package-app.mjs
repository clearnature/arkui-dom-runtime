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
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const MODE = flag('--mode', 'packager');
const OUT = flag('--out', '/data/tmp/arkui-pkg-out');
const PAGE = flag('--page', 'perfdemo');
const ELECTRON_VERSION = '44.2.0';
const APP_NAME = 'arkui-dom-electron';
const PRODUCT = 'arkui-dom-desktop';

// R113：临时区 /data/tmp（/tmp tmpfs inode 打满曾致门禁假红）
const TMP = '/data/tmp';

const step = (m) => console.log('══ ' + m);

// ── 0) 前提检查 ──
step('前提检查');
const cache = path.join(process.env.HOME, '.cache/electron');
const zipName = fs.existsSync(cache)
  ? (fs.readdirSync(cache).find((d) => d.startsWith(`electron-v${ELECTRON_VERSION}-linux-x64.zip`)) || '')
  : '';
const zipCandidate = zipName ? path.join(cache, zipName) : '';
// 必须是【文件】——只判 existsSync 会把 cache 目录本身当 zip（R109 实测：
// cache 清空后 basename 变成 "electron"、软链指向目录，packager 报 zip 不存在）
const hasZip = !!zipCandidate && fs.existsSync(zipCandidate) && fs.statSync(zipCandidate).isFile();
const electronBin = path.join(ROOT, 'electron/runtime/electron');
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
for (const d of ['electron', 'test', 'build', 'runtime', 'bridge/napi', 'data/kernel']) fs.mkdirSync(path.join(S, d), { recursive: true });
for (const f of ['main.js', 'preload.js']) fs.copyFileSync(path.join(ROOT, 'electron', f), path.join(S, 'electron', f));
fs.cpSync(path.join(ROOT, 'runtime'), path.join(S, 'runtime'), { recursive: true });
// 全部测试页 + 全部页面模块（分发包要能跑整个用例矩阵，不只冒烟页）
for (const f of fs.readdirSync(path.join(ROOT, 'test'))) if (f.endsWith('.html')) fs.copyFileSync(path.join(ROOT, 'test', f), path.join(S, 'test', f));
for (const f of fs.readdirSync(path.join(ROOT, 'build'))) if (f.endsWith('.js') && !f.endsWith('.result.txt')) fs.copyFileSync(path.join(ROOT, 'build', f), path.join(S, 'build', f));

// ── R109：仓颉内核分发集 ──
// data/kernel/ 平铺：libkernel.so（RPATH=$ORIGIN）+ 仓颉运行时全部 .so——
// 打包态主进程零 LD_LIBRARY_PATH 加载（内核 RPATH 链式覆盖二层依赖）。
// addon .node 必须随包（main.js require('../bridge/napi/…')）。
fs.copyFileSync(path.join(ROOT, 'bridge/napi/cjk_napi.node'), path.join(S, 'bridge/napi/cjk_napi.node'));
const rtDir = process.env.CANGJIE_RT_LIB ||
  '/data/work/compiler/cangjie/Nightly/cangjie-nightly-current/runtime/lib/linux_x86_64_cjnative';
const kernelSo = path.join(ROOT, 'kernel/cangjie/libkernel.so');
let cjkPacked = false;
if (fs.existsSync(kernelSo) && fs.existsSync(path.join(rtDir, 'libcangjie-runtime.so'))) {
  fs.copyFileSync(kernelSo, path.join(S, 'data/kernel/libkernel.so'));
  for (const f of fs.readdirSync(rtDir)) if (f.endsWith('.so')) {
    fs.copyFileSync(path.join(rtDir, f), path.join(S, 'data/kernel', f));
  }
  cjkPacked = true;
  console.log(`  cjk 分发集: libkernel.so + ${fs.readdirSync(rtDir).filter((f) => f.endsWith('.so')).length} 个运行时 .so（31MB）`);
} else {
  console.log('  ⚠️ 未找到仓颉运行时/内核——cjk 用例在包内将降级（其余不受影响）');
}
fs.writeFileSync(path.join(S, 'package.json'), JSON.stringify({
  name: APP_NAME, productName: PRODUCT, version: '0.1.0',
  description: 'ArkTS->DOM runtime desktop', main: 'electron/main.js',
  private: true, author: 'arkui-dom-runtime',
}, null, 2));
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
    fs.symlinkSync(zipCandidate, link);          // packager 只认目录里的 zip；软链零拷贝
  }
  execSync(`cd ${TMP} && npx --yes @electron/packager ${S} ${APP_NAME} ` +
    `--platform=linux --arch=x64 --electron-version=${ELECTRON_VERSION} ` +
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
  const sub = fs.readdirSync(dir).find((d) => d.endsWith('-linux-x64'));
  return sub ? path.join(dir, sub, APP_NAME) : null;
};
const bin = findBin(OUT);
if (!bin) { console.error('❌ 打包产物里没找到可执行文件'); process.exit(1); }
if (PAGE === 'cjk' && !cjkPacked) {
  console.error('❌ --page cjk 需要 cjk 分发集（CANGJIE_RT_LIB 指向运行时库目录后重跑）');
  process.exit(1);
}

const isAppImage = bin.endsWith('.AppImage');
const runArgs = (isAppImage ? '--appimage-extract-and-run ' : '') + '--no-sandbox --disable-gpu';
const cwd = isAppImage ? path.dirname(bin) : path.dirname(bin);
// R109 零依赖冒烟：清空仓颉环境（CANGJIE_RT_LIB/ARKUI_KERNEL_LIB/LD_LIBRARY_PATH），
// 模拟无 SDK 机器——cjk 用例必须靠包内 data/kernel/（内核 RPATH=$ORIGIN）通过
const smokeEnv = { ...process.env, ARKUI_TEST: PAGE, ARKUI_OFFSCREEN: '1' };
delete smokeEnv.CANGJIE_RT_LIB;
delete smokeEnv.ARKUI_KERNEL_LIB;
delete smokeEnv.LD_LIBRARY_PATH;
let result = '';
try {
  result = execSync(`cd ${cwd} && ${JSON.stringify(bin)} ${runArgs} .`, {
    env: smokeEnv,
    encoding: 'utf8', timeout: 180000,
  });
} catch (e) { result = (e.stdout || '') + (e.stderr || ''); }

console.log(result.split('\n').filter((l) => /PASS|FAIL|ELECTRON_RESULT/.test(l)).slice(-6).join('\n'));
const ok = /ELECTRON_RESULT: PASS/.test(result);
if (!ok) { console.error('❌ 冒烟未通过'); process.exit(1); }
const passLine = (result.match(/=== ALL PASS \((\d+)\) ===/) || [])[1];
console.log(`✅ 打包+冒烟通过：${bin}`);
console.log(`   （${passLine ? passLine + ' 断言' : 'PASS'}；运行：cd ${path.dirname(bin)} && ${path.basename(bin)}` +
  `${isAppImage ? ' --appimage-extract-and-run' : ''} --no-sandbox）`);
