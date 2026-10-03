#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// npm 包消费者端到端冒烟（R160.4）——模拟一个二方项目从安装到渲染的全流程：
//
//   npm install <tgz> → 手写 ViewPU 中间产物 Page.ts → 包内 arkui-extract 编译
//   → node_modules 里的 runtime 三件 <script> 直挂 → headless Chrome 渲染断言
//
// 这条链验证的是【包的对外契约】（README 承诺的接入方式），不是引擎内部
// （引擎回归=仓库五端矩阵）。CI：package-npm.yml 在 ubuntu-26.04 跑本脚本。
// ─────────────────────────────────────────────────────────────────────────────
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = process.env.ARKUI_PKG_TMP || '/data/tmp';
const OUT = path.join(ROOT, 'dist-npm');
const CONSUMER = path.join(TMP, 'arkui-npm-consumer');

const step = (m) => console.log('══ ' + m);
const tgz = fs.readdirSync(OUT).find((f) => f.endsWith('.tgz'));
if (!tgz) { console.error('❌ dist-npm/ 里没有 tgz——先跑 node tools/npm-pack.mjs'); process.exit(2); }

// ── Chrome 探测（与 run.sh 同链；CI 26.04 预装 /usr/bin/google-chrome）──
let CHROME = process.env.CHROME || '';
if (!CHROME) {
  for (const c of ['google-chrome', 'chrome']) {
    try { CHROME = execSync(`command -v ${c}`, { encoding: 'utf8' }).trim(); if (CHROME) break; } catch {}
  }
}
if (!CHROME) CHROME = '/opt/google/chrome/chrome';
if (!fs.existsSync(CHROME)) { console.error(`❌ 找不到 Chrome（${CHROME}）`); process.exit(2); }
// TIMEOUT_BIN 垫层（System32 timeout.exe 劫持坑——同 run.sh）。
// 探测失败【硬失败】而非裸 'timeout' 兜底：Git Bash 下裸 timeout 正中劫持坑
// （参数语义完全不同，会静默跑错）——同 run.sh 的显式报错纪律。
let TIMEOUT_BIN = process.env.TIMEOUT_BIN || '';
if (!TIMEOUT_BIN) {
  try { execSync('timeout --version >/dev/null 2>&1'); TIMEOUT_BIN = execSync('command -v timeout', { encoding: 'utf8' }).trim(); } catch {}
}
if (!TIMEOUT_BIN) {
  console.error('❌ 找不到 GNU coreutils timeout（Windows Git Bash 会命中 System32 劫持坑）');
  console.error('   请设 TIMEOUT_BIN=/usr/bin/timeout 后重跑');
  process.exit(2);
}

step(`消费者安装（${tgz}）`);
fs.rmSync(CONSUMER, { recursive: true, force: true });
fs.mkdirSync(CONSUMER, { recursive: true });
fs.writeFileSync(path.join(CONSUMER, 'package.json'), JSON.stringify({ name: 'smoke-consumer', private: true }, null, 2));
execSync(`npm install --no-audit --no-fund --loglevel=error ${JSON.stringify(path.join(OUT, tgz))}`, {
  cwd: CONSUMER, encoding: 'utf8', stdio: 'inherit',
});
const pkgDir = path.join(CONSUMER, 'node_modules', '@clearnature', 'arkui-dom-runtime');
for (const f of ['runtime/arkui-dom-runtime.js', 'runtime/generated-components.js', 'runtime/ohos-shims.js', 'bin/arkui-extract.mjs']) {
  if (!fs.existsSync(path.join(pkgDir, f))) { console.error(`❌ 包内缺 ${f}`); process.exit(1); }
}

step('手写 ViewPU 中间产物（消费者的 .ets 经官方 hvigorw 得到同形态 .ts）');
fs.writeFileSync(path.join(CONSUMER, 'Page.ts'), `if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface SmokePage_Params {
}
class SmokePage extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SmokePage_Params) {
    }
    updateStateVars(params: SmokePage_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.id('smoke-root');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('npm smoke ok');
            Text.id('smoke-text');
        }, Text);
        Text.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "SmokePage";
    }
}
registerNamedRoute(() => new SmokePage(undefined, {}), "", { bundleName: "com.example.smoke", moduleName: "entry", pagePath: "pages/SmokePage", pageFullPath: "entry/src/main/ets/pages/SmokePage", integratedHsp: "false", moduleType: "followWithHap" });
`);

step('包内编译器 CLI（bin/arkui-extract）');
execSync(`node node_modules/@clearnature/arkui-dom-runtime/bin/arkui-extract.mjs Page.ts build/page-module.js --cjs --register SmokePage`, {
  cwd: CONSUMER, encoding: 'utf8', stdio: 'inherit',
});
if (!fs.existsSync(path.join(CONSUMER, 'build/page-module.js'))) {
  console.error('❌ 编译器没产出 page-module.js');
  process.exit(1);
}

step('宿主页（runtime 三件 <script> 直挂 + 编译产物）');
const R = 'node_modules/@clearnature/arkui-dom-runtime/runtime';
fs.writeFileSync(path.join(CONSUMER, 'index.html'), `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>smoke</title></head>
<body>
  <div id="root"></div>
  <div id="result">running…</div>
  <script src="${R}/arkui-dom-runtime.js"></script>
  <script src="${R}/generated-components.js"></script>
  <script src="${R}/ohos-shims.js"></script>
  <script src="build/page-module.js"></script>
  <script>
  (async function () {
    __arkui_dom_requireModule('SmokePage');
    __arkui_dom_loadRoute('pages/SmokePage', document.getElementById('root'));
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const t = document.getElementById('smoke-text');
      if (t && t.textContent === 'npm smoke ok') break;
    }
    const t = document.getElementById('smoke-text');
    document.getElementById('result').textContent =
      (t && t.textContent === 'npm smoke ok') ? 'PASS smoke 文本渲染' : 'FAIL smoke 文本未渲染';
  })();
  </script>
</body></html>
`);

step('headless Chrome 渲染断言');
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(ROOT, 'tools', 'serve.py'), '0'], {
  cwd: CONSUMER, stdio: ['ignore', 'pipe', 'inherit'],
});
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += d; });
let port = '';
for (let i = 0; i < 50 && !port; i++) {
  port = (serverOut.match(/http:\/\/127\.0\.0\.1:(\d+)/) || [])[1] || '';
  if (!port) await new Promise((r) => setTimeout(r, 100));
}
if (!port) { console.error('❌ 本地服务未启动'); process.exit(1); }

const profdir = path.join(TMP, 'arkui-npm-smoke-profile');
fs.rmSync(profdir, { recursive: true, force: true });
let dom = '';
try {
  dom = execSync(
    `${JSON.stringify(TIMEOUT_BIN || 'timeout')} 60 ${JSON.stringify(CHROME)} --headless --disable-gpu --no-sandbox ` +
    `--user-data-dir=${JSON.stringify(profdir)} --virtual-time-budget=8000 --dump-dom ` +
    `"http://127.0.0.1:${port}/index.html" 2>/dev/null`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) { dom = e.stdout || ''; }
server.kill();

const m = dom.match(/<div id="result"[^>]*>([\s\S]*?)<\/div>/);
const result = m ? m[1].trim() : '（未取到 result 节点）';
console.log('  #result = ' + result);
if (!/^PASS/.test(result)) {
  console.error('❌ npm 包消费者冒烟未通过');
  process.exit(1);
}
console.log(`✅ npm 包消费者端到端冒烟通过（安装→编译→渲染）`);
