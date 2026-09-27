// R98 冒烟：node 直接加载 addon，走完整 cjkInit→ping→call→错误→shutdown 序列
// .cjs：package.json 是 "type": "module"，CommonJS 载入 addon 必须用 .cjs 后缀。
// 环境变量：CANGJIE_HOME_TEST=<SDK>/runtime/lib/linux_x86_64_cjnative
//          KERNEL_LIB_TEST=内核 .so 绝对路径
let fails = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const addon = require('./cjk_napi.node');
check(typeof addon.cjkInit === 'function' && typeof addon.cjkCall === 'function' &&
  typeof addon.cjkKernelVersion === 'function',
  'addon 导出 cjkInit/cjkPing/cjkCall/cjkLastError/cjkKernelVersion/cjkShutdown');

const rtLib = process.env.CANGJIE_HOME_TEST + '/libcangjie-runtime.so';
addon.cjkInit(rtLib, process.env.KERNEL_LIB_TEST, '{}');
check(true, 'cjkInit（运行时+内核+config）不抛');

// R102：ABI 版本握手
check(addon.cjkKernelVersion() === 10001, 'cjkKernelVersion=10001（v1.1：六核心+三调度符号）');

// R101：大 payload 往返（旧实现 params[4096] 静默截断）
const big = JSON.stringify({ s: 'x'.repeat(65536), tag: 'R101' });
const echoed = addon.cjkCall('echo', big);
check(typeof echoed === 'string' && echoed.length === big.length &&
  echoed.endsWith('"tag":"R101"}') && echoed.includes('xxxxx'),
  'R101 64KB echo 完整往返（不截断）');
let overThrew = '';
try {
  addon.cjkCall('echo', JSON.stringify({ s: 'y'.repeat(2 * 1024 * 1024) }));
} catch (e) { overThrew = String(e && e.message || e); }
check(/params too large/.test(overThrew), 'R101 超 1MB → 显式抛错（' + overThrew.slice(0, 46) + '…）');

check(addon.cjkPing() === 0, 'cjkPing=0');

check(addon.cjkCall('echo', '{"x":1}') === '{"x":1}', 'cjkCall(echo) 直通');
check(addon.cjkCall('add', '{"a":20,"b":22}') === '{"sum":42}', 'cjkCall(add)={sum:42}');
check(addon.cjkCall('fib', '{"n":24}') === '{"result":46368}', 'cjkCall(fib 24)=46368');
check(addon.cjkCall('upper', '{"text":"cjk"}') === '{"text":"CJK"}', 'cjkCall(upper)');

check(addon.cjkCall('nope', '{}') === null, 'cjkCall(未知方法)=null');
check(/unknown method/.test(addon.cjkLastError()), 'cjkLastError 报 unknown method');

// R99：agent 调度原语（跨调用持久状态经 addon 透传；addon 返回原始 JSON 串）
check(addon.cjkCall('agent.spawn', '{"name":"w1"}') === '{"id":1,"name":"w1","state":"idle"}',
  'cjkCall(agent.spawn) → id=1');
check(addon.cjkCall('agent.send', '{"id":1,"text":"t1"}') === '{"queued":1}',
  'cjkCall(agent.send) → queued=1');
check(addon.cjkCall('agent.poll', '{"id":1}') === '{"messages":["t1"],"drained":1}',
  'cjkCall(agent.poll) → 排空');
check(addon.cjkCall('agent.kill', '{"id":1}') === '{"killed":"w1"}',
  'cjkCall(agent.kill) → killed');

// R100：异步作业（submit → drainer cjthread 算 → result 轮询；addon 后置驱动自动推进）
// 注：前面 kill 过 id=1，故这里 spawn 得 id=2；jobId 计数独立于 agent id，首支=1
const sub2 = addon.cjkCall('agent.spawn', '{"name":"worker"}');
check(/"id":2/.test(sub2), 'R100 agent.spawn → id=2');
const sj = addon.cjkCall('agent.submit', '{"id":2,"kind":"fib","n":20}');
check(sj === '{"jobId":1,"state":"pending"}', 'agent.submit(fib 20) → jobId=1 pending');
let fibDone = null;
for (let i = 0; i < 100 && fibDone === null; i++) {
  const r = addon.cjkCall('agent.result', '{"jobId":1}');
  if (/done/.test(r)) fibDone = r;
}
check(fibDone === '{"state":"done","value":6765}', 'agent.result 轮询至 done（fib(20)=6765，cjthread 真并发）');
const se = addon.cjkCall('agent.submit', '{"id":2,"kind":"echo","text":"回声"}');
let echoDone = null;
for (let i = 0; i < 100 && echoDone === null; i++) {
  const r = addon.cjkCall('agent.result', '{"jobId":2}');
  if (/done/.test(r)) echoDone = r;
}
check(echoDone === '{"state":"done","text":"回声"}', 'agent.result echo 作业（UTF-8 保真）');

// R105：多 worker 并行（addon drive 上限 4；时间戳重叠 = 真并发证据）
// 注：spawn 过 w1(id1,已 kill)/worker(id2) → 此处得 id=3；jobId 计数独立，本批 = 3..6
const par = addon.cjkCall('agent.spawn', '{"name":"par"}');
check(/"id":3/.test(par), 'R105 agent.spawn 并行组 → id=3');
for (let i = 0; i < 4; i++) addon.cjkCall('agent.submit', '{"id":3,"kind":"fib","n":28}');
let pdone = 0, guard = 0;
while (pdone < 4 && guard < 2000) {
  pdone = 0; guard++;
  for (let j = 3; j <= 6; j++) {
    const r = addon.cjkCall('agent.result', '{"jobId":' + j + '}');
    if (r && /"state":"done"/.test(r)) pdone++;
  }
}
check(pdone === 4, 'R105 4×fib(28) 全部完成（多 worker）');
const tm = JSON.parse(addon.cjkCall('agent.timings', '{}'));
let ov = 0;
for (let i = 0; i < tm.n; i++)
  for (let j = i + 1; j < tm.n; j++) {
    if (tm.t[i][0] < tm.t[j][1] && tm.t[j][0] < tm.t[i][1]) ov++;
  }
check(ov > 0 && tm.n === 6, 'R105 时间戳重叠 ' + ov + ' 对（真并发非协作串行；n=6 含历史 2 作业）');

check(addon.cjkShutdown() === true, 'cjkShutdown');

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
