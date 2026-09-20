/*
 * 环境 preflight：把"外部依赖是否存在/可用"一次性查清。
 *
 * 为什么需要它：run.sh / electron/run.sh 里这些路径是硬编码的。缺 CLT、缺 Chrome、
 * 缺 Electron、或脚本丢了可执行位时，失败会发生在很久之后且信息含糊（典型症状是
 * "找不到输入文件"或"权限不够"，看不出真实原因）。这里提前、明确地报出来。
 *
 * 可执行位那条不是多余的：曾经交付的 run.sh 忘了 chmod +x，用户敲 ./run.sh 得到
 * "权限不够"，被报成"无法运行"。这条检查就是为了让那种问题在 preflight 就暴露。
 *
 * 用法: node tools/preflight.mjs
 * 退出码: 0 全部就绪；1 有缺失
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLT = '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools';
const ETS_LOADER = path.join(CLT, 'sdk/default/openharmony/ets/build-tools/ets-loader');

const failures = [];
const notes = [];

const ok = (label, detail) => console.log(`  ✅ ${label}${detail ? `  ${detail}` : ''}`);
const bad = (label, detail) => { failures.push(`${label}${detail ? `：${detail}` : ''}`); console.log(`  ❌ ${label}${detail ? `  ${detail}` : ''}`); };
const note = (label, detail) => { notes.push(label); console.log(`  ⚠️  ${label}${detail ? `  ${detail}` : ''}`); };

const isExec = (p) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
};

console.log('== 工具链 ==');
const nodeBin = process.execPath;
ok('当前 node', `${process.version}  ${nodeBin}`);

const cltNode = path.join(CLT, 'tool/node/bin/node');
if (fs.existsSync(cltNode) && isExec(cltNode)) ok('CLT node', cltNode);
else bad('CLT node 不存在或不可执行', cltNode);

const tsDir = path.join(ETS_LOADER, 'node_modules/typescript');
if (fs.existsSync(path.join(tsDir, 'package.json'))) {
  const v = JSON.parse(fs.readFileSync(path.join(tsDir, 'package.json'), 'utf8')).version;
  ok('ets-loader 自带 TypeScript', `v${v}  ${tsDir}`);
} else bad('ets-loader 的 TypeScript 不存在', tsDir);

const compDir = path.join(ETS_LOADER, 'components');
if (fs.existsSync(compDir)) {
  const n = fs.readdirSync(compDir).filter((f) => f.endsWith('.json')).length;
  // 生成器期望 150 个（149 个组件 + common_attrs.json）；少于这个数说明 CLT 换版本了
  if (n >= 150) ok('ets-loader 组件元数据', `${n} 个 JSON`);
  else bad('ets-loader 组件元数据数量异常', `${n} 个（期望 ≥150）——CLT 版本变了吗？`);
} else bad('ets-loader components 目录不存在', compDir);

console.log('\n== 运行时宿主 ==');
const chrome = '/opt/google/chrome/chrome';
if (fs.existsSync(chrome) && isExec(chrome)) ok('Chrome', chrome);
else bad('Chrome 不存在或不可执行', `${chrome}（浏览器用例需要）`);

const elBin = path.join(ROOT, 'electron/runtime/electron');
if (fs.existsSync(elBin) && isExec(elBin)) ok('Electron', elBin);
else bad('Electron 不存在或不可执行', `${elBin}\n     从 ~/.cache/electron/electron-v44.2.0-linux-x64.zip 解压到 electron/runtime/`);

console.log('\n== 项目自身 ==');
// 可执行位：交付给用户/CI 的入口必须是可执行的
const mustExec = ['run.sh', 'electron/run.sh', 'tools/extract.mjs', 'tools/serve.py', 'tools/gen-components.mjs', 'tools/stats.mjs'];
const notExec = mustExec.filter((f) => !isExec(path.join(ROOT, f)));
if (notExec.length === 0) ok('入口脚本可执行位', mustExec.join(' '));
else bad('以下脚本缺可执行位', `${notExec.join(' ')}\n     修复: chmod +x ${notExec.join(' ')}`);

const mustExist = [
  'runtime/arkui-dom-runtime.js', 'runtime/generated-components.js', 'runtime/ohos-shims.js',
  'fixtures/pages/Index.ts', 'test/index.html',
];
const missing = mustExist.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length === 0) ok('运行时与 fixtures 齐备');
else bad('缺少核心文件', missing.join(' '));

// fixtures 是"官方产物能跑"的证据，被改动过就要警惕
const fixtureCount = fs.existsSync(path.join(ROOT, 'fixtures/pages'))
  ? fs.readdirSync(path.join(ROOT, 'fixtures/pages')).filter((f) => f.endsWith('.ts')).length
  : 0;
if (fixtureCount > 0) ok('冻结的转换产物', `${fixtureCount} 个 .ts`);
else bad('fixtures/pages 下没有 .ts', '测试的输入没有了');

// hvigor 缓存：只在需要重新生成 fixtures 时才要，没有不算失败
const CACHE = new URL('../harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets', import.meta.url).pathname;
if (fs.existsSync(CACHE)) note('hvigor 缓存存在', CACHE);
else note('hvigor 缓存不在（尚未构建）', '只在新增页面/重新生成 fixtures 时需要：cd harmony-proj && devecocli build');

console.log('');
if (failures.length === 0) {
  console.log(`✅ preflight 通过（${notes.length} 条提示）`);
  process.exit(0);
}
console.error(`❌ preflight 失败：${failures.length} 项`);
for (const f of failures) console.error(`   - ${f}`);
process.exit(1);
