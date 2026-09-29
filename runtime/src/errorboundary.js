  // ────────────────── E0-1 渲染错误边界（ErrorBoundary）──────────────────
  //
  // 可信度底线：任一组件 render / 属性应用抛错不炸整页——错误被捕获、记录进环形缓冲、
  // 同批其余组件照常渲染。三个捕获落点：
  //   ① flush() 重渲染循环（main.js，集成补丁）：每个 rerenderElmt 独立 try/catch，
  //     单组件 updateFunc 抛错不再中断批次里其余 elmtId；
  //   ② applyAttr 入口（area.js，集成补丁）：属性应用抛错进缓冲，不再打断调用方；
  //   ③ window 'error' / 'unhandledrejection'（本分片自带）：onClick 这类事件回调在
  //     DOM 派发层抛错，渲染管线的 try/catch 够不着——浏览器本就隔离监听器异常
  //     （同元素其余监听器与整页照常跑），这里只做【记录】：不 preventDefault、
  //     不劫持 console——不吞错，控制台照常报。
  //
  // 全局面（沿 __arkui_dom_* 诊断家族命名，同 __arkui_dom_perf / __arkui_dom_layout_warnings）：
  //   __arkui_dom_errors.push(info) / .list() / .clear()   —— 最近 50 条环形缓冲
  //   ErrorBoundary.create({ onError, fallback }) + .pop() —— 容器组件最小面
  //
  // 自包含与声明顺序说明（@include 位置：main.js `// @include builtin` 之后，约 353 行）：
  //   · 顶层语句只依赖【更早】声明的绑定与 function 声明：ViewStackProcessor（main.js:50）、
  //     elmtRecords（main.js:30）、window/document；
  //   · mountNode / parentOfTop 是 IIFE 内的 function 声明（提升，任意位置可调），但只在
  //     create() 调用期使用（运行期早就过了顶层求值）；
  //   · layoutWarnings 是 layout 分片的 const（@include 在本分片之后）——顶层直呼名字会
  //     TDZ。镜像诊断走 global.__arkui_dom_layout_warnings（layout.js 第 5 行把【同一个
  //     数组】挂在了 global 上），语义等价且无声明顺序风险。

  // ────────────────── 环形缓冲 ──────────────────
  const ERRBOUNDARY_LIMIT = 50;               // 最近 50 条（任务口径）
  /** @type {any[]} */
  const errRing = [];
  let errSeq = 0;                             // 全局单调序号：clear() 只清缓冲，不回退 seq

  /**
   * 归一化任意抛出值：message 取字符串；stack 只留首行（缓冲是诊断面，不是日志面）。
   * @param {any} err
   * @returns {{message: string, stack: string}}
   */
  function normalizeCaughtErr(err) {
    const msg = (err && err.message !== undefined) ? String(err.message) : String(err);
    const st = (err && typeof err.stack === 'string') ? String(err.stack) : '';
    return { message: msg, stack: st ? st.split('\n', 1)[0] : '' };
  }

  /**
   * 节点 → 组件名（优先注册名 __arkuiComp，退回 data-arkui-comp，再退回标签名）。
   * @param {any} node
   * @returns {string}
   */
  function errCompName(node) {
    if (!node) return '';
    if (node.__arkuiComp) return String(node.__arkuiComp);
    if (node.getAttribute) {
      const a = node.getAttribute('data-arkui-comp');
      if (a) return a;
    }
    return node.tagName ? String(node.tagName) : '';
  }

  /** @type {{limit: number, push: (info: any) => any, list: () => any[], clear: () => number}} */
  const errorBuffer = {
    limit: ERRBOUNDARY_LIMIT,
    /**
     * 记录一条错误，返回实际入缓冲的条目（含分配的 seq/time）。info 可以是：
     *   - Error 实例（自动归一化 message / stack 首行）；
     *   - {where, component, elmtId, message, stack} 载荷（渲染管线 / 边界派发用）；
     *   - 任意值（按字符串记录进 message）。
     * @param {any} info
     * @returns {any}
     */
    push(info) {
      /** @type {any} */
      const src = (info instanceof Error) ? normalizeCaughtErr(info)
        : (info && typeof info === 'object') ? info : { message: String(info) };
      const entry = {
        seq: ++errSeq,
        time: Date.now(),
        component: (src.component !== undefined && src.component !== null) ? String(src.component) : '',
        elmtId: (typeof src.elmtId === 'number') ? src.elmtId : -1,
        message: (src.message !== undefined && src.message !== null) ? String(src.message) : '',
        stack: (src.stack !== undefined && src.stack !== null) ? String(src.stack) : '',
        where: (src.where !== undefined && src.where !== null) ? String(src.where) : 'manual',
      };
      errRing.push(entry);
      while (errRing.length > ERRBOUNDARY_LIMIT) errRing.shift();   // 超限挤掉最旧
      return entry;
    },
    /**
     * 快照（防御性拷贝：改动返回值不影响缓冲本体）。旧 → 新排列。
     * @returns {any[]}
     */
    list() {
      return errRing.map((/** @type {any} */ en) => ({
        seq: en.seq, time: en.time, component: en.component, elmtId: en.elmtId,
        message: en.message, stack: en.stack, where: en.where,
      }));
    },
    /**
     * 清空缓冲，返回清掉的条数。seq 计数器刻意不回退：条目序号跨 clear 仍单调，
     * 便于外部去重/对账。
     * @returns {number}
     */
    clear() {
      const n = errRing.length;
      errRing.length = 0;
      return n;
    },
  };

  /**
   * 从出错节点向上找最近的 ErrorBoundary 容器，把条目交给它（onError + fallback）。
   * 只取最近一层（真机语义推断：最近边界负责，外层不再重复处理）。没有边界时
   * 只留在缓冲——这正是"不炸整页"的底线。返回是否有人接住。
   * @param {any} node
   * @param {any} entry
   * @returns {boolean}
   */
  function dispatchErrorBoundary(node, entry) {
    /** @type {any} */
    let cur = node;
    while (cur) {
      const b = cur.__arkuiErrBoundary;
      if (b && typeof b.capture === 'function') return b.capture(entry) === true;
      cur = cur.parentElement || null;      // 未挂载/已脱离 DOM 时自然终止
    }
    return false;
  }

  /**
   * 渲染管线错误统一入口（集成补丁的两处 try/catch 与 window 钩子都汇到这里）：
   * 记缓冲 → 向上派发最近 ErrorBoundary → 镜像到诊断数组。全程不再向外抛。
   * @param {string} where 来源（'rerender' | 'applyAttr:<prop>' | 'window' | 'promise'）
   * @param {number} elmtId 出错 elmtId（未知传 -1；给了 node 会反查）
   * @param {any} err 抛出的值
   * @param {any=} [node] 出错节点（可选：反查组件名/elmtId + 边界派发锚点）
   * @returns {void}
   */
  function __arkuiReportRenderError(where, elmtId, err, node) {
    const norm = normalizeCaughtErr(err);
    const comp = errCompName(node);
    let realId = elmtId;
    if (node && realId < 0) {
      // elmtId 反查：applyAttr 路径只有节点（错误路径才走，O(n) 可接受）
      for (const [id, rec] of elmtRecords) {
        if (rec && rec.node === node) { realId = id; break; }
      }
    }
    const entry = errorBuffer.push({
      where, component: comp, elmtId: realId, message: norm.message, stack: norm.stack,
    });
    dispatchErrorBoundary(node, entry);
    // 镜像到诊断数组（走 global 而非直呼 layoutWarnings：那个 const 在更晚的 layout 分片，
    // 顶层求值期触发本函数会 TDZ；layout.js 第 5 行把同一数组挂在 global 上，语义等价）
    try {
      const W = (/** @type {any} */ (global)).__arkui_dom_layout_warnings;
      if (W && typeof W.push === 'function') {
        W.push(`渲染错误[${where}] ${comp || '?'}#${realId}: ${norm.message}`);
      }
    } catch (_) { /* 镜像失败不掩盖原错误 */ }
  }

  // ────────────────── ErrorBoundary 组件面 ──────────────────
  //
  // 最小面/推断：HarmonyOS 公开 SDK 没有面向应用的 ErrorBoundary 声明（无公开 d.ts 可引；
  // 官方错误边界方案尚在提案阶段），本组件按"容器组件 + onError 回调 + fallback 内容"
  // 的最小可用面实现，调用形态与既有组件一致（create → 子组件 → pop）：
  //   const eb = ErrorBoundary.create({ onError(entry), fallback })
  //   ……子组件照常 create/attr/pop（落进边界元素内）
  //   ErrorBoundary.pop()
  // 捕获时机：管线补丁的 catch 统一走 __arkuiReportRenderError → dispatchErrorBoundary，
  // 从出错节点向上找最近边界；也可以手动驱动 el.__arkuiErrBoundary.capture(entry)。
  const ErrorBoundary = {
    /**
     * @param {any=} [options] { onError?: (entry: any) => void,
     *                            fallback?: string | Node | (() => string | Node) }
     * @returns {HTMLElement}
     */
    create(options) {
      const el = document.createElement('div');
      el.__arkuiComp = 'ErrorBoundary';
      /** @type {any} */
      const bound = {
        el,
        onError: (options && typeof options.onError === 'function') ? options.onError : null,
        fallback: options ? options.fallback : undefined,
        nCaught: 0,                       // 收到的错误条数（测试/诊断内省用）
      };
      // 边界把柄：管线派发与手动驱动都走它。返回 true = 已接住（向上派发停止）。
      bound.capture = (/** @type {any} */ entry) => {
        bound.nCaught++;
        if (bound.onError) {
          try { bound.onError(entry); }
          catch (e) {
            // onError 自身抛错：记录（不吞），但不再向外抛——边界必须比业务更稳
            const n2 = normalizeCaughtErr(e);
            errorBuffer.push({ where: 'onError', component: 'ErrorBoundary', elmtId: -1,
              message: n2.message, stack: n2.stack });
          }
        }
        try { applyErrFallback(el, bound.fallback); }
        catch (e) {
          const n3 = normalizeCaughtErr(e);
          errorBuffer.push({ where: 'fallback', component: 'ErrorBoundary', elmtId: -1,
            message: n3.message, stack: n3.stack });
        }
        el.dataset.arkuiErrorBoundary = '1';   // data-arkui-error-boundary="1"（已触发过）
        return true;
      };
      (/** @type {any} */ (el)).__arkuiErrBoundary = bound;
      mountNode(el);                    // 与组件同款挂载（rec 省略 → 挂进 parentOfTop()）
      ViewStackProcessor.push(el);      // 子组件照常落进边界内
      return el;
    },
    /** @returns {void} */
    pop() { ViewStackProcessor.pop(); },
  };

  /**
   * 兜底内容落位：字符串 → textContent；Node → appendChild；
   * 函数 → 先求值再按上述（builder 只支持返回字符串/Node，不做组件栈展开——最小面）。
   * 其余值（未提供/undefined）只打标记，保持"出错但可见"。
   * @param {HTMLElement} host
   * @param {any} fallback
   * @returns {void}
   */
  function applyErrFallback(host, fallback) {
    /** @type {any} */
    let v = fallback;
    if (typeof v === 'function') v = v();
    host.textContent = '';
    if (typeof v === 'string') { host.textContent = v; return; }
    if (v && v.nodeType) { host.appendChild(v); return; }
    host.dataset.arkuiErrFallback = 'empty';
  }

  // ────────────────── 全局兜底钩子（事件回调 / Promise 拒绝）──────────────────
  //
  // onClick 这类回调经 applyAttr 原样注册成 DOM 监听器（area.js 通用 on* 分支），抛错
  // 发生在【派发层】，管线 try/catch 够不着。这里把浏览器已隔离的错误补记进缓冲。
  // 注意：本钩子无 node 上下文（component 留空、elmtId=-1），也不做边界派发——
  // 派发层错误拿不到出错组件的归属，这是最小面的已知边界。
  window.addEventListener('error', (/** @type {ErrorEvent} */ ev) => {
    const norm = normalizeCaughtErr(ev.error || ev.message || 'unknown');
    errorBuffer.push({ where: 'window', component: '', elmtId: -1,
      message: norm.message, stack: norm.stack });
  });
  // flush 由 Promise.resolve().then 调度（main.js markDirty）——补丁包裹之外若仍有异常
  // 会成为未处理拒绝，同样记录（不吞）。
  window.addEventListener('unhandledrejection', (/** @type {PromiseRejectionEvent} */ ev) => {
    const norm = normalizeCaughtErr(ev.reason);
    errorBuffer.push({ where: 'promise', component: '', elmtId: -1,
      message: norm.message, stack: norm.stack });
  });

  // ────────────────── 安装全局 ──────────────────
  // batch-nav 同款 defineProperty 自装（main.js 的 Object.assign 块是历史清单，分片自带
  // 的诊断面刻意不走它——见 main.js assign 块内注）。getter 保活：常驻诊断面不可被覆盖丢引用。
  Object.defineProperty(global, '__arkui_dom_errors', {
    get: () => errorBuffer, configurable: true,
  });
  Object.defineProperty(global, 'ErrorBoundary', {
    get: () => ErrorBoundary, configurable: true,
  });
