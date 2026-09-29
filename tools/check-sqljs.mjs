#!/usr/bin/env node
// ────────────────── sql.js WASM 在位诊断（E1-2）──────────────────
//
// 检查 runtime/vendor/sqljs/ 下 sql.js 的两个发行文件是否在位、是否像真货：
//   · sql-wasm.js   —— UMD 加载器（require/全局 initSqlJs）
//   · sql-wasm.wasm —— SQLite WASM 二进制（魔数必须是 `\0asm`）
// 在位则进一步做一次真加载冒烟（SELECT 1+1）；缺席则打印可操作安装步骤。
//
// 用途：文档/诊断。node tools/check-sqljs.mjs
//   退出码 0 = 在位且冒烟通过；1 = 缺席/损坏（安装步骤见输出）。
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const DIR = path.join(HERE, 'runtime', 'vendor', 'sqljs');
const JS = path.join(DIR, 'sql-wasm.js');
const WASM = path.join(DIR, 'sql-wasm.wasm');

const INSTALL_STEPS = [
  '安装步骤：',
  '  1. npm i sql.js@1.8.0 --no-save   # 版本须与 runtime/vendor/sqljs 的发行包一致',
  '  2. mkdir -p runtime/vendor/sqljs',
  '  3. cp node_modules/sql.js/dist/sql-wasm.js   runtime/vendor/sqljs/',
  '  4. cp node_modules/sql.js/dist/sql-wasm.wasm runtime/vendor/sqljs/',
  '  5. node tools/check-sqljs.mjs   # 本脚本，复检',
  '（或从 https://github.com/sql-js/sql.js/releases 取 dist/ 同名两文件；',
  '  仓库内留有 runtime/vendor/sqljs/sql.js-1.8.0.tgz 可直接解包取 dist/）',
].join('\n');

console.log(`检查目录：${DIR}`);
const jsOk = fs.existsSync(JS);
const wasmOk = fs.existsSync(WASM);

if (!jsOk) console.log(`  ✗ 缺 ${path.relative(HERE, JS)}`);
else console.log(`  ✓ ${path.relative(HERE, JS)}（${fs.statSync(JS).size} 字节）`);

if (!wasmOk) {
  console.log(`  ✗ 缺 ${path.relative(HERE, WASM)}`);
} else {
  const head = fs.readFileSync(WASM).subarray(0, 4);
  const magicOk = head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d; // "\0asm"
  console.log(`  ${magicOk ? '✓' : '✗'} ${path.relative(HERE, WASM)}（${fs.statSync(WASM).size} 字节，魔数${magicOk ? '正确 \\0asm' : '错误：不是 WASM 二进制'}）`);
  if (!magicOk) { console.log('\n' + INSTALL_STEPS); process.exit(1); }
}

if (!jsOk || !wasmOk) {
  console.log('\n状态：sql.js 未安装 —— @ohos:data.relationalStore 会显式报 14800000（不静默假装）');
  console.log(INSTALL_STEPS);
  process.exit(1);
}

// 在位 → Node 冒烟：UMD require + initSqlJs + 真跑一条 SQL
try {
  const req = createRequire(JS);
  const initSqlJs = req(JS);
  const SQL = await initSqlJs({ locateFile: (f) => path.join(DIR, f) });
  const db = new SQL.Database();
  const r = db.exec('SELECT 1 + 1');
  const v = r[0].values[0][0];
  db.close();
  if (v !== 2) throw new Error(`SELECT 1+1 得到 ${v}，期望 2`);
  console.log('\n状态：sql.js 可用（Node 冒烟 SELECT 1+1 = 2 通过）');
  process.exit(0);
} catch (e) {
  console.log(`\n状态：文件在位但加载失败：${e && e.message}`);
  console.log('（常见原因：wasm 与 js 版本不匹配 —— 两个文件必须取自同一发行包）');
  process.exit(1);
}
