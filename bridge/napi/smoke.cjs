// R98 冒烟：node 直接加载 addon，走完整 cjkInit→ping→call→错误→shutdown 序列
// .cjs：package.json 是 "type": "module"，CommonJS 载入 addon 必须用 .cjs 后缀。
// 环境变量：CANGJIE_HOME_TEST=<SDK>/runtime/lib/linux_x86_64_cjnative
//          KERNEL_LIB_TEST=内核 .so 绝对路径
let fails = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const addon = require('./cjk_napi.node');
check(typeof addon.cjkInit === 'function' && typeof addon.cjkCall === 'function',
  'addon 导出 cjkInit/cjkPing/cjkCall/cjkLastError/cjkShutdown');

const rtLib = process.env.CANGJIE_HOME_TEST + '/libcangjie-runtime.so';
addon.cjkInit(rtLib, process.env.KERNEL_LIB_TEST, '{}');
check(true, 'cjkInit（运行时+内核+config）不抛');

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

check(addon.cjkShutdown() === true, 'cjkShutdown');

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
