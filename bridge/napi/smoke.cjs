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
check(addon.cjkKernelVersionK('c') === 10001, 'R118 c 槽实现版本符号 10001（R107 的历史「无符号→0」容忍断言由实现演进取代——五内核现均实现版本握手）');
check(addon.cjkShutdownK('c') === true, 'R107 shutdownK("c") 只关 c 槽');
check(addon.cjkCall('fib', '{"n":10}') === '{"result":55}', 'R107 c 槽关闭后 default 仍服务');

// R112：类型化直调（零序列化；两内核同名同签名，符号表一致——nm -D 对比可见）
// 注：c 槽在 R107 段末已 shutdown——此处重新挂载，顺带证明幂等挂载可重入
check(addon.cjkInitK('c', '', K_C_LIB, '{}') === true, 'R112 c 槽重新挂载（幂等挂载可重入）');
check(addon.cjkAdd(20, 22) === 42, 'R112 cjkAdd 直调（default 仓颉内核）');
check(addon.cjkEcho('直调回声') === '直调回声', 'R112 cjkEcho 直调（UTF-8）');
check(addon.cjkAddK('c', 7, 35) === 42, 'R112 c 槽 kernel_add（同符号同签名）');
check(addon.cjkEchoK('c', 'c-kernel') === 'c-kernel', 'R112 c 槽 kernel_echo');

// R118：纯 C 补全——agent 五件 + pthread 作业面（宿主零驱动，五语言作业面同构）
check(addon.cjkCallK('c', 'agent.spawn', '{"name":"c-worker"}') ===
  '{"id":1,"name":"c-worker","state":"idle"}', 'R118 c agent.spawn');
addon.cjkCallK('c', 'agent.send', '{"id":1,"text":"c-mail"}');
check(addon.cjkCallK('c', 'agent.send', '{"id":1,"text":"第二封"}') === '{"queued":2}',
  'R118 c agent.send 计数');
check(addon.cjkCallK('c', 'agent.poll', '{"id":1}') ===
  '{"messages":["c-mail","第二封"],"drained":2}', 'R118 c poll FIFO+转义（UTF-8）');
check(addon.cjkCallK('c', 'agent.list', '{"x":1}').includes('"count":1'),
  'R118 c agent.list');
check(addon.cjkCallK('c', 'agent.kill', '{"id":1}') === '{"killed":"c-worker"}',
  'R118 c agent.kill');
// pthread 作业（宿主零驱动）
addon.cjkCallK('c', 'agent.spawn', '{"name":"c-jobber"}');
addon.cjkCallK('c', 'agent.submit', '{"id":2,"kind":"fib","n":40}');
const cSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let cDone = null;
for (let i = 0; i < 400 && cDone === null; i++) {
  const r = addon.cjkCallK('c', 'agent.result', '{"jobId":1}');
  if (r && /"state":"done"/.test(r)) cDone = r;
  else cSleep(5);
}
check(cDone === '{"state":"done","value":102334155}',
  'R118 c pthread 作业（fib(40)=102334155 迭代实现零驱动）');
const ctm = JSON.parse(addon.cjkCallK('c', 'agent.timings', '{}'));
check(ctm.n === 1 && ctm.t[0][1] > ctm.t[0][0], 'R118 c timings 时间窗有效');
check(addon.cjkCallK('c', 'agent.cancel', '{"jobId":99}') === null,
  'R118 c cancel 未知 job → null');

// R110：作业取消——精确态语义由契约测试覆盖（C 宿主无后置驱动，pending 路径稳定）；
// addon 侧 submit 即 drive（claim 后 in-flight），此处只断言返回形合法 + 未知 job null
const csub = addon.cjkCall('agent.submit', '{"id":2,"kind":"fib","n":30}');
const cjob = JSON.parse(csub).jobId;
const cx = JSON.parse(addon.cjkCall('agent.cancel', '{"jobId":' + cjob + '}'));
check(cx && (cx.cancelled === 'pending' || (cx.cancelled === 'none' && cx.state === 'in-flight')),
  'R110 agent.cancel 返回形合法（observed=' + JSON.stringify(cx) + '）');
let crest = '';
const rSleep2 = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (let i = 0; i < 300 && !/cancelled|done/.test(crest); i++) {
  crest = addon.cjkCall('agent.result', '{"jobId":' + cjob + '}');
  if (!/cancelled|done/.test(crest)) rSleep2(5);   // 让步：in-flight 路径需等 fib(30)≈20ms
}
check(/"state":"(cancelled|done)"/.test(crest), 'R110 result 收敛终态（' + crest + '）');
check(addon.cjkCall('agent.cancel', '{"jobId":99}') === null,
  'R110 cancel 未知 job → null');

// R114：Haskell/GHC 内核槽（trha 数据面）——第三种语言同一契约
// rtLib 传【目录】= GHC 序列（多 RTS 泛化：目录扫描 libHSrts→ghc-internal→…→hs_init）
const GHC_LIB_DIR = process.env.GHC_LIB_DIR_TEST ||
  '/usr/local/lib/ghc-9.14.1/lib/x86_64-linux-ghc-9.14.1-inplace';
const HS_LIB = process.env.HS_KERNEL_LIB_TEST;
if (HS_LIB && require('node:fs').existsSync(GHC_LIB_DIR)) {
  check(addon.cjkInitK('hs', GHC_LIB_DIR, HS_LIB, '{}') === true,
    'R114 cjkInitK("hs", GHC目录) 挂载 Haskell 内核（hs_init 宿主方案 A）');
  check(addon.cjkKernelVersionK('hs') === 10001, 'R114 hs 槽 abi 版本 10001');
  check(addon.cjkCallK('hs', 'add', '{"a":20,"b":22}') === '{"sum":42}',
    'R114 hs 内核 add（同契约第三语言）');
  check(addon.cjkCallK('hs', 'agent.spawn', '{"name":"trha-ling"}') ===
    '{"id":1,"name":"trha-ling","state":"idle"}',
    'R114 hs trha 数据面 spawn');
  addon.cjkCallK('hs', 'agent.send', '{"id":1,"text":"haskell-mail"}');
  check(addon.cjkCallK('hs', 'agent.poll', '{"id":1}') ===
    '{"messages":["haskell-mail"],"drained":1}',
    'R114 hs 邮箱 FIFO 排空（trha TQueue 同构）');
  check(addon.cjkCallK('hs', 'agent.transition',
    '{"id":1,"cmd":"start"}') ===
    '{"before":{"state":"Idle"},"after":{"state":"Processing","step":"step-1"}}',
    'R114 hs trha 状态机 Idle→Processing（StateMachine.hs 语义）');
  check(addon.cjkCallK('hs', 'agent.transition',
    '{"id":1,"cmd":"start"}') ===
    '{"before":{"state":"Processing","step":"step-1"},"after":{"state":"Processing","step":"step-1"}}',
    'R114 hs 非法转移自环（transition state _ = state）');
  check(addon.cjkCallK('hs', 'echo', '{"v":1}') === '{"v":1}', 'R114 hs echo');
  // R115：并行证据的家在 addon 层（node 宿主下 setNumCapabilities=8 生效；
  // C 原生嵌入宿主下单能力——hs_contract_test 条件 SKIP，见坑 107）
  check(JSON.parse(addon.cjkCallK('hs', 'sys.caps', '{}')).now >= 2,
    'R115 hs 能力数 ≥2（node 宿主 setNumCapabilities 生效）');
  for (let i = 0; i < 4; i++) addon.cjkCallK('hs', 'agent.submit', '{"id":1,"kind":"fib","n":30}');
  let pDone = 0, pGuard = 0;
  while (pDone < 4 && pGuard < 400) {
    pDone = 0; pGuard++;
    for (let j = 1; j <= 4; j++) {
      const x = addon.cjkCallK('hs', 'agent.result', '{"jobId":' + j + '}');
      if (x && /"state":"done"/.test(x)) pDone++;
    }
  }
  check(pDone === 4, 'R115 hs 4×fib(30) 全部 done（零驱动轮询）');
  const hst = JSON.parse(addon.cjkCallK('hs', 'agent.timings', '{}'));
  let hsov = 0;
  for (let i = 0; i < hst.n; i++)
    for (let j = i + 1; j < hst.n; j++)
      if (hst.t[i][0] < hst.t[j][1] && hst.t[j][0] < hst.t[i][1]) hsov++;
  check(hsov > 0, 'R115 hs 时间戳重叠 ' + hsov + '/6 对（forkIO 真并发——宿主零泵）');
  check(addon.cjkShutdownK('hs') === true, 'R114 shutdownK("hs")');
} else {
  console.log('SKIP R114 hs 槽（GHC_LIB_DIR_TEST/HS_KERNEL_LIB_TEST 未注入或 GHC 缺席）');
}

// R116：Go 内核槽（DeepSeek-Reasonix 线索，第四语言）——rtLib 空串零宿主序，
// c-shared 仅依赖 libc，goroutine 自调度作业
{
  const fs = require('node:fs');
  const GO_LIB = process.env.GO_KERNEL_LIB_TEST ||
    require('node:path').join(__dirname, '..', '..', 'kernel', 'go', 'libkernel_go.so');
  if (fs.existsSync(GO_LIB)) {
    check(addon.cjkInitK('go', '', GO_LIB, '{}') === true, 'R116 cjkInitK("go", "") 零宿主序挂载');
    check(addon.cjkKernelVersionK('go') === 10001, 'R116 go 槽 abi 10001');
    check(addon.cjkCallK('go', 'add', '{"a":20,"b":22}') === '{"sum":42}', 'R116 go add');
    check(addon.cjkCallK('go', 'fib', '{"n":12}') === '{"result":144}', 'R116 go fib');
    check(addon.cjkAddK('go', 7, 35) === 42, 'R116 go typed add（kernel_add 同签名）');
    check(addon.cjkCallK('go', 'echo', '{"v":1}') === '{"v":1}', 'R116 go echo');
    check(addon.cjkCallK('go', 'agent.spawn', '{"name":"go-ling"}') ===
      '{"id":1,"name":"go-ling","state":"idle"}', 'R116 go spawn');
    addon.cjkCallK('go', 'agent.send', '{"id":1,"text":"go-mail"}');
    check(addon.cjkCallK('go', 'agent.poll', '{"id":1}') ===
      '{"messages":["go-mail"],"drained":1}', 'R116 go 邮箱 FIFO');
    check(addon.cjkCallK('go', 'agent.kill', '{"id":1}') === '{"killed":"go-ling"}',
      'R116 go kill');
    // goroutine 作业（宿主零驱动）——同步 sleep 让出 CPU（纯忙轮询 200 轮
    // 在 fib(30)≈12ms 完成窗口内跑完 → 误判未完成）
    const syncSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    addon.cjkCallK('go', 'agent.spawn', '{"name":"worker"}');
    addon.cjkCallK('go', 'agent.submit', '{"id":2,"kind":"fib","n":30}');
    let gDone = null;
    for (let i = 0; i < 300 && gDone === null; i++) {
      const r = addon.cjkCallK('go', 'agent.result', '{"jobId":1}');
      if (r && /"state":"done"/.test(r)) gDone = r;
      else syncSleep(5);
    }
    check(gDone === '{"state":"done","value":832040}',
      'R116 go goroutine 作业（fib(30)=832040 零驱动）');
    const gtm = JSON.parse(addon.cjkCallK('go', 'agent.timings', '{}'));
    check(gtm.n === 1 && gtm.t[0][1] > gtm.t[0][0], 'R116 go timings 时间窗有效');
    check(addon.cjkCallK('go', 'nope', '{}') === null &&
      /unknown method/.test(addon.cjkLastErrorK('go')), 'R116 go 未知方法+lastError');
    // Reasonix 特色（DeepSeek-Reasonix 对齐）：lifecycle 枚举 + Generation CAS
    check(addon.cjkCallK('go', 'session.get', '{"id":2}') ===
      '{"lifecycle":"active","generation":0}', 'R116 session.get 初始 active/gen0');
    check(addon.cjkCallK('go', 'session.set', '{"id":2,"lifecycle":"archived","generation":0}') ===
      '{"lifecycle":"archived","generation":1}', 'R116 session.set CAS 成功 → gen1');
    check(addon.cjkCallK('go', 'session.set', '{"id":2,"lifecycle":"active","generation":0}') === null &&
      /generation conflict/.test(addon.cjkLastErrorK('go')),
      'R116 旧 generation → conflict（ErrOperationConflict 同义）');
    check(addon.cjkCallK('go', 'session.set', '{"id":2,"lifecycle":"zombie","generation":1}') === null &&
      /bad lifecycle/.test(addon.cjkLastErrorK('go')), 'R116 非法 lifecycle → 报错');
    check(addon.cjkCallK('go', 'session.set', '{"id":2,"lifecycle":"deleted","generation":1}') ===
      '{"lifecycle":"deleted","generation":2}', 'R116 deleted 迁移成功 → gen2');
    check(addon.cjkCallK('go', 'session.set', '{"id":2,"lifecycle":"active","generation":2}') === null &&
      /terminal/.test(addon.cjkLastErrorK('go')), 'R116 deleted 是终态（purge 语义）');
    check(addon.cjkShutdownK('go') === true, 'R116 shutdownK("go")');
  } else {
    console.log('SKIP R116 go 槽（libkernel_go.so 未构建）');
  }
}

// R117：Rust 内核槽（claurst 线索，第五语言）——cdylib 仅 libgcc_s+libc，零宿主序，
// std::thread 作业
{
  const fs = require('node:fs');
  const RS_LIB = process.env.RS_KERNEL_LIB_TEST ||
    require('node:path').join(__dirname, '..', '..', 'kernel', 'rust', 'libkernel_rs.so');
  if (fs.existsSync(RS_LIB)) {
    check(addon.cjkInitK('rs', '', RS_LIB, '{}') === true, 'R117 cjkInitK("rs", "") 零宿主序挂载');
    check(addon.cjkKernelVersionK('rs') === 10001, 'R117 rs 槽 abi 10001');
    check(addon.cjkCallK('rs', 'add', '{"a":20,"b":22}') === '{"sum":42}', 'R117 rs add');
    check(addon.cjkCallK('rs', 'fib', '{"n":12}') === '{"result":144}', 'R117 rs fib');
    check(addon.cjkAddK('rs', 7, 35) === 42, 'R117 rs typed add（kernel_add 同签名）');
    check(addon.cjkCallK('rs', 'echo', '{"v":1}') === '{"v":1}', 'R117 rs echo');
    check(addon.cjkCallK('rs', 'agent.spawn', '{"name":"rust-ace"}') ===
      '{"id":1,"name":"rust-ace","state":"idle"}', 'R117 rs spawn');
    addon.cjkCallK('rs', 'agent.send', '{"id":1,"text":"rust-mail"}');
    check(addon.cjkCallK('rs', 'agent.poll', '{"id":1}') ===
      '{"messages":["rust-mail"],"drained":1}', 'R117 rs 邮箱 FIFO');
    // std::thread 作业（宿主零驱动）
    addon.cjkCallK('rs', 'agent.submit', '{"id":1,"kind":"fib","n":30}');
    let rDone = null;
    const rSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let i = 0; i < 300 && rDone === null; i++) {
      const r = addon.cjkCallK('rs', 'agent.result', '{"jobId":1}');
      if (r && /"state":"done"/.test(r)) rDone = r;
      else rSleep(5);
    }
    check(rDone === '{"state":"done","value":832040}',
      'R117 rs thread 作业（fib(30)=832040 零驱动）');
    const rtm = JSON.parse(addon.cjkCallK('rs', 'agent.timings', '{}'));
    check(rtm.n === 1 && rtm.t[0][1] > rtm.t[0][0], 'R117 rs timings 时间窗有效');
    check(addon.cjkCallK('rs', 'agent.kill', '{"id":1}') === '{"killed":"rust-ace"}',
      'R117 rs kill');
    // claurst 特色（AgentDefinition 元数据 + Generation CAS 守卫）
    check(addon.cjkCallK('rs', 'agent.spawn',
      '{"name":"claurst","model":"claude-x","maxTurns":42}') ===
      '{"id":2,"name":"claurst","state":"idle"}', 'R117 claurst spawn（返回形契约互通）');
    check(addon.cjkCallK('rs', 'agent.info', '{"id":2}') ===
      '{"id":2,"name":"claurst","model":"claude-x","maxTurns":42,"lifecycle":"active","generation":0}',
      'R117 claurst agent.info（AgentDefinition 元数据+lifecycle/generation）');
    check(addon.cjkCallK('rs', 'session.get', '{"id":2}') ===
      '{"lifecycle":"active","generation":0}', 'R117 session.get 初始态');
    check(addon.cjkCallK('rs', 'session.set', '{"id":2,"lifecycle":"archived","generation":0}') ===
      '{"lifecycle":"archived","generation":1}', 'R117 Generation CAS 成功 → gen1');
    check(addon.cjkCallK('rs', 'session.set', '{"id":2,"lifecycle":"active","generation":0}') === null &&
      /generation conflict/.test(addon.cjkLastErrorK('rs')), 'R117 旧 generation → conflict');
    check(addon.cjkCallK('rs', 'session.set', '{"id":2,"lifecycle":"deleted","generation":1}') ===
      '{"lifecycle":"deleted","generation":2}', 'R117 deleted 迁移 → gen2');
    check(addon.cjkCallK('rs', 'session.set', '{"id":2,"lifecycle":"active","generation":2}') === null &&
      /terminal/.test(addon.cjkLastErrorK('rs')), 'R117 终态不回流（claurst update_status 同义）');
    check(addon.cjkCallK('rs', 'nope', '{}') === null &&
      /unknown method/.test(addon.cjkLastErrorK('rs')), 'R117 rs 未知方法+lastError');
    check(addon.cjkShutdownK('rs') === true, 'R117 shutdownK("rs")');
  } else {
    console.log('SKIP R117 rs 槽（libkernel_rs.so 未构建）');
  }
}

check(addon.cjkShutdown() === true, 'cjkShutdown');

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
