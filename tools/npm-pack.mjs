#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// npm 发行打包（R160.4）——把运行时变成二方项目可安装的 npm 包。
//
// 包契约（对外稳定面）：
//   · runtime/ 三件产物（浏览器 <script> 直挂；build-runtime/gen-components 生成物
//     + ohos-shims 手写件）——引擎本体
//   · tools/extract.mjs + test/vendor/typescript-4.9.5-r4.lib.cjs——ViewPU 中间
//     产物 → 浏览器可跑 JS module 的编译器（.ets→ViewPU 前端是官方 hvigorw 链，
//     不在本包射程——术语口径见 docs/DEVICE-DIFF.md 头注）
//   · bin/arkui-extract.mjs——编译器 CLI 入口（npm bin 链接用）
//   · LICENSE（MIT）/ THIRD-PARTY-NOTICES.md（vendor TS Apache-2.0）
//
// 版本：--version 或 env ARKUI_NPM_VERSION > git describe 最新 tag（当前 1.0.0）。
//
// 用法：
//   node tools/npm-pack.mjs                  # 产出 dist-npm/*.tgz
//   node tools/npm-pack.mjs --version 1.0.1
//   node tools/npm-smoke.mjs                 # 消费者端到端冒烟（依赖本脚本产物）
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const TMP = process.env.ARKUI_PKG_TMP || '/data/tmp';

// ── 版本 ──
let version = argOf('--version', process.env.ARKUI_NPM_VERSION || '');
if (!version) {
  version = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf8' }).trim();
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`❌ 版本不是 semver：${version}`);
  process.exit(2);
}

const NAME = '@clearnature/arkui-dom-runtime';
const OUT = path.join(ROOT, 'dist-npm');
const S = path.join(TMP, 'arkui-npm-staging');

const step = (m) => console.log('══ ' + m);

step(`npm 打包（${NAME}@${version}）`);
fs.rmSync(S, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ── staging ──
for (const d of ['runtime', 'tools', 'test/vendor', 'bin']) fs.mkdirSync(path.join(S, d), { recursive: true });
for (const f of ['arkui-dom-runtime.js', 'generated-components.js', 'ohos-shims.js']) {
  fs.copyFileSync(path.join(ROOT, 'runtime', f), path.join(S, 'runtime', f));
}
fs.copyFileSync(path.join(ROOT, 'tools', 'extract.mjs'), path.join(S, 'tools', 'extract.mjs'));
// 优化器 v1.1：extract.mjs 默认开启（!--no-optimize），必须随包——首跑冒烟实锤
fs.copyFileSync(path.join(ROOT, 'tools', 'arkui-optimizer.mjs'), path.join(S, 'tools', 'arkui-optimizer.mjs'));
fs.copyFileSync(path.join(ROOT, 'test/vendor/typescript-4.9.5-r4.lib.cjs'), path.join(S, 'test/vendor/typescript-4.9.5-r4.lib.cjs'));
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(S, 'LICENSE'));
fs.copyFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), path.join(S, 'THIRD-PARTY-NOTICES.md'));
// 消费者 README（仓库根 README 是开发向；包内文档=接入向）
fs.copyFileSync(path.join(ROOT, 'docs', 'NPM-DISTRIBUTION.md'), path.join(S, 'README.md'));

// CLI 入口：转手给 tools/extract.mjs（argv 原样透传；extract 内部按自身路径解析 vendor TS）
fs.writeFileSync(path.join(S, 'bin', 'arkui-extract.mjs'), `#!/usr/bin/env node\n// @clearnature/arkui-dom-runtime 编译器 CLI（ViewPU 中间产物 → 浏览器 JS module）\nawait import('../tools/extract.mjs');\n`);

const pkg = {
  name: NAME,
  version,
  description: 'ArkTS/ArkUI on DOM: 浏览器/Electron 可跑的 ArkUI 运行时（ets-loader 产物 ViewPU → JS）+ 编译器 CLI',
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/clearnature/arkui-dom-runtime.git' },
  bin: { 'arkui-extract': 'bin/arkui-extract.mjs' },
  files: ['runtime/', 'tools/', 'test/vendor/', 'bin/', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
  engines: { node: '>=18' },
  keywords: ['arkts', 'arkui', 'harmonyos', 'electron', 'runtime', 'dom'],
};
fs.writeFileSync(path.join(S, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// ── npm pack ──
step('npm pack');
const out = execSync(`npm pack ${JSON.stringify(S)} --pack-destination ${JSON.stringify(OUT)}`, {
  cwd: S, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
const tgz = path.join(OUT, out.trim().split('\n').pop() + '');
const size = (fs.statSync(tgz).size / 1024).toFixed(1);
console.log(`✅ ${tgz}（${size}KB）`);

// 内容清单留痕（包里到底有什么——回归时可 diff）
execSync(`tar -tzf ${JSON.stringify(tgz)} > ${JSON.stringify(path.join(OUT, 'CONTENTS.txt'))}`);
const n = fs.readFileSync(path.join(OUT, 'CONTENTS.txt'), 'utf8').trim().split('\n').length;
console.log(`   内容 ${n} 项（CONTENTS.txt）`);
console.log(`   下一步：node tools/npm-smoke.mjs（消费者端到端冒烟）`);
