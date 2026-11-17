#!/usr/bin/env node
// ────────────────── tsc --checkJs 门禁（R38 渐进强类型化）──────────────────
//
// 检查【拼接后的产物】runtime/arkui-dom-runtime.js + 类型词汇表 runtime/src/runtime.d.ts。
// 为什么是产物不是分片：15 个分片在运行时共享同一个 IIFE 函数作用域（`resolveResource`
// 等声明在 main.js 的 IIFE 体内），按文件检查会得到上百个假 "Cannot find name"
//（2026-09-21 实测：分片模式 370 错，其中 153 个是拼接模型假阳性；产物模式 211 错，
// 且挖出 2 个真 bug——onSubmit 的 `value` 未定义、v2 的 `const Event` 遮蔽 DOM Event）。
//
// 档位：checkJs + strictNullChecks + noImplicitAny（R55 起三档全开：约 1500 个隐式 any 经
// 十六批人工 + 六组并行代理清零后翻进门禁，试验档 tsconfig.implicit-any.json 已完成使命删除）。
// TypeScript 用 ets-loader 自带的 4.9.5（本项目没有 npm 依赖，与 tools/extract.mjs 同源）。
//
// ── 7.x 并行轴（--tsc=7）──
// 默认轴不变（4.9.5-r4，与产物生成器同源）。--tsc=7 用原生 TypeScript 7 复核同一份产物，
// 只作并行观察，不替代默认门禁。两处必须对齐的口径差异（官方 7.0 发布说明）：
//   · "strict is true by default" —— 7.x 默认 strict，故显式 --strict false 回到 4.9 档位
//     （tsconfig 的 strictNullChecks/noImplicitAny 是子开关，仍照旧生效）
//   · Closure 风格 JSDoc 函数类型 function(): T 已移除 —— 源码统一写 (...)=>T
// 二进制解析：TSC7 环境变量优先，其次 PATH 上的 tsc（须自报 Version 7.x）；不引入 npm 依赖。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import url from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
// R174 全补①：路径可覆盖——CI（ubuntu-ohos 腿）传 ARKUI_CLT=$CLT_ROOT，本地缺省钉官方安装位
const CLT = process.env.ARKUI_CLT || '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools';
const TS_PATH = path.join(
  CLT, 'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'
);
const CONFIG = path.join(HERE, 'tsconfig.check.json');

// 轴选择：默认 4.9.5-r4；--tsc=7 走 7.x 并行轴（不是默认门禁）
const AXIS7 = process.argv.includes('--tsc=7') || process.argv.includes('--tsc7');
if (AXIS7) runAxis7();
else runAxis495();

function runAxis495() {
  if (!fs.existsSync(TS_PATH)) {
    console.error(`❌ 找不到 ets-loader 自带的 TypeScript：${TS_PATH}`);
    console.error('   （与 tools/extract.mjs 同一来源；CLT 升级后请同步改这两个文件里的路径）');
    process.exit(2);
  }
  const ts = require(TS_PATH);

  const parsed = ts.getParsedCommandLineOfConfigFile(
    CONFIG, { noEmit: true }, {
      ...ts.sys,
      getCurrentDirectory: () => HERE,
    }
  );
  if (!parsed) {
    console.error(`❌ tsconfig 解析失败：${CONFIG}`);
    process.exit(2);
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options,
    projectReferences: parsed.projectReferences });
  const diags = ts.getPreEmitDiagnostics(program);
  if (diags.length === 0) {
    console.log(`✅ 类型检查通过（${parsed.fileNames.length} 个文件，` +
      `tsc ${ts.version}，checkJs + strictNullChecks）`);
    process.exit(0);
  }
  for (const d of diags) {
    const at = d.file
      ? `${path.relative(HERE, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
      : '<全局>';
    console.error(`❌ ${at}  TS${d.code}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  console.error(`\n共 ${diags.length} 个类型错误。红线上限 = 0：类型错误不允许进主干。`);
  process.exit(1);
}

function runAxis7() {
  const resolved = resolveTsc7();
  if (!resolved) {
    console.error('❌ 找不到 TypeScript 7.x：设置 TSC7=/path/to/tsc，或把 7.x 的 tsc 放进 PATH');
    console.error('   （7.x 轴不引入 npm 依赖；本机示例：pnpm add -g typescript@7）');
    process.exit(2);
  }
  const out = spawnSync(resolved.bin, ['-p', CONFIG, '--strict', 'false'],
    { encoding: 'utf8', cwd: HERE });
  if (out.error) {
    console.error(`❌ 无法执行 ${resolved.bin}：${out.error.message}`);
    process.exit(2);
  }
  if (out.status === 0) {
    console.log(`✅ 类型检查通过（tsc 7 轴，${resolved.version}，` +
      'checkJs + strictNullChecks，--strict false 对齐 4.9 档位）');
    process.exit(0);
  }
  const text = `${out.stdout || ''}${out.stderr || ''}`.trim();
  if (text) console.error(text);
  console.error('\n7 轴红线同样是 0。若报 TS1005 于 @param {function(): T}，' +
    '那是 TS 7 移除的 Closure 语法，改用 {() => T}。');
  process.exit(1);
}

function resolveTsc7() {
  const bin = process.env.TSC7 || 'tsc';
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  const version = (probe.stdout || '').trim();
  if (!/^Version 7\./.test(version)) return null;
  return { bin, version };
}
