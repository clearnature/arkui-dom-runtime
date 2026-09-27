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

// R106：状态快照/恢复（restore 整体替换状态 + id 续号）
// 注：此前 w1(id1) 已被 kill，存活 = worker(id2)+par(id3) → 快照 n=2
const snap106 = addon.cjkCall('sys.snapshot', '{}');
check(/"v":1/.test(snap106) && /"n":2/.test(snap106), 'R106 sys.snapshot 可快照（含 2 存活 agents）');
addon.cjkCall('agent.kill', '{"id":3}');
addon.cjkCall('agent.spawn', '{"name":"intruder"}');
const restored = addon.cjkCall('sys.restore', snap106);
check(restored === '{"restored":2}', 'R106 sys.restore → restored=2');
const list106 = JSON.parse(addon.cjkCall('agent.list', '{}'));
check(list106.count === 2 && list106.agents.every(g => g.name !== 'intruder'),
  'R106 restore 后注册表等价（intruder 被清除）');
const cont = addon.cjkCall('agent.spawn', '{}');
check(/"id":4/.test(cont), 'R106 restore 后 id 续号（nextId 随快照）');
check(addon.cjkCall('sys.restore', '{"v":9}') === null, 'R106 坏版本快照 → null');

// R107：多内核共存——"c" 槽挂纯 C 内核（rtLib 空串 = 无需仓颉运行时），与 default 互不串扰
const K_C_LIB = process.env.KERNEL_C_LIB_TEST;
check(!!K_C_LIB, 'KERNEL_C_LIB_TEST 已注入（纯 C 样例内核）');
check(addon.cjkInitK('c', '', K_C_LIB, '{}') === true, 'R107 cjkInitK("c", rtLib="") 挂载纯 C 内核');
check(addon.cjkCallK('c', 'rev', '{"text":"abc"}') === '{"text":"cba"}',
  'R107 c 槽 rev（第二语言实现同一契约）');
check(addon.cjkCallK('c', 'len', '{"text":"仓颉"}') === '{"len":6}',
  'R107 c 槽 len（UTF-8 按字节，样例边界如实）');
check(addon.cjkCallK('c', 'fib', '{"n":10}') === null &&
  /unknown method/.test(addon.cjkLastErrorK('c')),
  'R107 隔离：c 槽没有 fib → null + c 槽 lastError');
check(addon.cjkCall('fib', '{"n":10}') === '{"result":55}',
  'R107 隔离：default 槽 fib 照常（c 槽挂载零影响）');
check(addon.cjkPingK('c') === 0 && addon.cjkPing() === 0, 'R107 双槽 ping 均 0');
check(addon.cjkKernelVersionK('c') === 0, 'R107 c 槽无版本符号 → 0（旧内核容忍路径）');
check(addon.cjkShutdownK('c') === true, 'R107 shutdownK("c") 只关 c 槽');
check(addon.cjkCall('fib', '{"n":10}') === '{"result":55}', 'R107 c 槽关闭后 default 仍服务');

check(addon.cjkShutdown() === true, 'cjkShutdown');

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
