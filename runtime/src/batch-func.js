  // ────────── 批量功能组件（R66）：Calendar / ContainerReader / IndicatorComponent /
  // MenuItemGroup / Repeat / WithTheme ──────────
  //
  // 权威来源：
  //   Repeat           component/repeat.d.ts（Repeat(arr) → .each/.key/.template/.templateId/
  //                    .virtualScroll；each 是必填；templateId 未命中任何 template 时回落 each）
  //   WithTheme        component/with_theme.d.ts（WithThemeOptions {theme?, colorMode?}；
  //                    ThemeColorMode：SYSTEM=0 / LIGHT=1 / DARK=2，common.d.ts:6808）
  //   MenuItemGroup    component/menu_item_group.d.ts（MenuItemGroupOptions {header?, footer?}，
  //                    header/footer: ResourceStr | CustomBuilder；子组件只有 MenuItem）
  //   IndicatorComponent component/indicatorcomponent.d.ts（create(controller?) + initialIndex/
  //                    count/style/loop/vertical/onChange + IndicatorComponentController）
  //   ContainerReader  api/@ohos.arkui.components.ContainerReader.d.ts（create({size,
  //                    widthBreakpoint?, heightBreakpoint?}) + .breakpointConfig({width?[], height?[]})）
  //   Calendar         【无 d.ts】——本 SDK 只发布了 CalendarPicker；Calendar 是 systemApi 老组件，
  //                    声明文件未随 SDK 发布（component/index-full.d.ts 引用 ./calendar.d.ts 但文件
  //                    缺失）。属性面取自 ets-loader/components/calendar.json（date/showLunar/
  //                    startOfWeek/offDays/onSelectChange/onRequestData/currentData/preData/
  //                    nextData/needSlide/showHoliday/direction + 五个样式对象）；无权威文本的
  //                    语义（onRequestData 入参、CalendarDay 结构）按字段名近似，见各 handler 注释。
  //
  // 产物形态（ets-loader lib/process_component_build.js：recurseRepeatExpression 会给 Repeat
  // 调用追加 this 实参；其余按 component_map 通用 create/attr 形态）：
  //   Repeat.create(this.arr, this); Repeat.each((ri) => {…}); Repeat.key((item, i) => …);
  //     Repeat.templateId(fn)?; Repeat.template('t', (ri) => {…})?; Repeat.virtualScroll({...})?;
  //   Repeat.pop();
  //   WithTheme.create({ colorMode: 1 }); …子组件…; WithTheme.pop();
  //   MenuItemGroup.create({ header: '组一' }); …MenuItem…; MenuItemGroup.pop();
  //   IndicatorComponent.create(this.ctrl); IndicatorComponent.count(3); …; IndicatorComponent.pop();
  //   ContainerReader.create({ size: { width: 700, height: 500 } }); …; ContainerReader.pop();
  //
  // DOM 策略：
  //   Repeat/WithTheme 是"逻辑容器"——Repeat 用 display:contents（同 ForEach，不引入盒子）；
  //   WithTheme 用真块级盒（color-scheme 要作用到后代原生控件）。Item 渲染走 microtask 批处理：
  //   属性方法在首渲染与每次重渲染都会重放（updateFunc 重跑），而 pop() 只在 initialRender 出现，
  //   所以渲染触发点放【属性应用】上（同 ForEach 把 forEachUpdateFunction 放 updateFunc 内的思路），
  //   用 scheduled 标记去重、lastSig 快照去重（数组没变就不重建）。

  // ════════════════════ Repeat ════════════════════
  // R153-A：键 diff 三分支复用语义（对齐真机 pu_repeat_impl.ts:122-185 + repeat_node.cpp:103-111）：
  //   · 键生成：有 .key(fn) → fn(item, i)；缺省 = `${index}__` + 键串（对象/function/symbol 走
  //     WeakMap 稳定自增 id——JSON.stringify 对对象不稳定且循环引用会抛，其余 JSON.stringify）。
  //   · 数据源变更 = 暂存区 + 按新序 append 回填（真机 std::swap(children_, tempChildren_) 的
  //     DOM 对应物是 DocumentFragment）：①预扫删除集合（旧有新无）；②旧子树整体摘进暂存区；
  //     ③按新数组序逐键三分支——键保留 → 仅 updateIndex（item 不动：键相等即同一逻辑项）；
  //     键消失但删除集/持久池非空 → 复用（先 updateItem 再 updateIndex，真机 :166-167 顺序）；
  //     否则新建。逐项 appendChild 到尾部，循环结束顺序天然正确（不需要 LCS/insertBefore）。
  //   · RepeatItem 是状态对象（repeat.d.ts:279-286 "Do not destructure RepeatItem"）：同一键
  //     跨数据变更保持同一 ri 实例、item/index 原地改写。本项目无嵌套 Proxy，"响应性"的等价
  //     实现 = 需要更新的项重放 each builder，但 DOM 节点按 key 复用：scratch 重放 + 浅层 DOM
  //     补丁（属性/文本/子树逐位对齐），同 key 的项根节点对象引用不变——与 ForEach 整体重建
  //     基线的可观测差异就是这个节点身份保持。
  //   · 回收池：本渲染删除集先尽（LIFO 尾取，同真机 tempChildren 尾 pop），再落持久池（单池、
  //     上限 16、同模板优先——真机非虚拟路径无持久池、虚拟路径按 ttype 分桶，此处是仓库纪律
  //     下的超集）；池满真销毁。重复键 → 告警（含真机修复指引文案）+ 整体回退缺省键全量重渲染。
  // R154-A：onMove 拖拽换位派发（__arkui_dom_repeatMove 驱动钩子 + repeatMoveDispatch）——
  //   真机协议 = 拖拽期间框架重排视觉节点、落定 FireOnMove 单发回调（两参裸 number from/to）、
  //   数据源由回调 splice；垫片把后两步折叠进钩子（详见钩子处块注释），与键 diff 共存。
  // R155-A：onLazyLoading 数据源懒加载派发（__arkui_dom_repeatLazy 驱动钩子 + repeatLazyDispatch）——
  //   真机协议 = 容器布局按需取项：请求的索引无数据时同步单发 onLazyLoading(index)（单参裸
  //   number 绝对索引，repeat.d.ts:173），数据源由回调 arr[index]=item 自行补齐；垫片没有滚动
  //   容器的按需取项管线，回调经驱动钩子派发（详见钩子处块注释）。数据到站后调度键 diff（新增
  //   键走 case#3 新建分支）；渲染在首个缺数据索引处截断（repeat.d.ts:156-157 停止语义）。
  // R156-A：onMoveThrough 拖拽进行中细粒度派发（__arkui_dom_repeatMoveThrough 驱动钩子 +
  //   repeatMoveThroughDispatch）——真机协议 = 拖拽中每跨过一项先 MoveData 平移表换位、再
  //   FireOnMoveThrough(fromIndex_, to)（首参=拖拽起始索引整个手势恒定；数据源不动，落定
  //   onMove 才由开发者 splice）；垫片只做视觉换位 + RepeatItem.index 原地改写 + 事件派发
  //   （详见钩子处块注释）。登记面 = onMove 第二参 ItemDragEventHandler.onMoveThrough
  //   （common.d.ts:25838 since 20 重载，非独立链式属性）。
  /** @param {any[]} prev @param {any[]} next @param {number} n */
  const repeatSigSame = (prev, next, n) => prev.length === n && next.length >= n
    && prev.every((/** @type {any} */ v, /** @type {number} */ k) => Object.is(v, next[k]));

  /** @param {any} st */
  function repeatSchedule(st) {
    if (st.scheduled) return;
    st.scheduled = true;
    Promise.resolve().then(() => {
      st.scheduled = false;
      repeatRender(st);
    });
  }

  // 缺省键的对象/function/symbol 稳定 id 表（WeakMap：对象被 GC 后条目随之回收）
  const repeatKeyIds = new WeakMap();
  let repeatKeySeq = 0;

  /** @param {any} v @returns {string} */
  function repeatKeyStringOf(v) {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'object' || t === 'function' || t === 'symbol') {
      let id = repeatKeyIds.get(v);
      if (id === undefined) { id = ++repeatKeySeq; repeatKeyIds.set(v, id); }
      return '@' + id;
    }
    if (t === 'string') return JSON.stringify(v);
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch (e) { return String(v); }
  }

  /** @param {any} item @param {number} i @returns {string} 缺省键 = `${index}__` + 键串 */
  function repeatDefaultKey(item, i) { return i + '__' + repeatKeyStringOf(item); }

  /** @param {any} item @param {number} i @returns {any} RepeatItem 状态对象（可变字段，跨 diff 原地改写） */
  function repeatMakeItem(item, i) { return { item, index: i }; }

  /**
   * 浅层 DOM 补丁：把 fresh 子树的属性/文本/子树逐位对齐进 old，尽量保住节点身份。
   * 返回 true = old 已原位复用；false = 结构不兼容（调用方整体换新——身份让位于内容正确）。
   * @param {Element} oldEl @param {Element} newEl @returns {boolean}
   */
  function repeatPatchInto(oldEl, newEl) {
    if (oldEl.nodeType !== 1 || newEl.nodeType !== 1) return false;
    if (oldEl.nodeName !== newEl.nodeName) return false;
    for (const at of Array.from(newEl.attributes)) {
      if (oldEl.getAttribute(at.name) !== at.value) oldEl.setAttribute(at.name, at.value);
    }
    for (const at of Array.from(oldEl.attributes)) {
      if (!newEl.hasAttribute(at.name)) oldEl.removeAttribute(at.name);
    }
    const oc = Array.from(oldEl.childNodes);
    const nc = Array.from(newEl.childNodes);
    const len = Math.max(oc.length, nc.length);
    for (let k = 0; k < len; k++) {
      const o = oc[k]; const w = nc[k];
      if (o && w) {
        if (o.nodeType === 3 && w.nodeType === 3) {
          if ((/** @type {Text} */ (o)).data !== (/** @type {Text} */ (w)).data) {
            (/** @type {Text} */ (o)).data = (/** @type {Text} */ (w)).data;
          }
        } else if (o.nodeType === 1 && w.nodeType === 1
          && repeatPatchInto(/** @type {Element} */ (o), /** @type {Element} */ (w))) {
          // 原位复用
        } else {
          oldEl.replaceChild(w, o);          // 结构不兼容 → 该子树换新
        }
      } else if (w) {
        oldEl.appendChild(w);                // 新增：直接采纳 scratch 节点
      } else if (o) {
        oldEl.removeChild(o);                // 缩减：销毁多余旧子节点
      }
    }
    return true;
  }

  /**
   * RepeatItem 的 item/index 已原地改写后重放 builder：scratch 里重跑一遍，再按位补丁回
   * 已保留的旧节点（节点身份保持——本项目"响应性"的等价实现）。
   * @param {any} st @param {any} rec @param {any} b
   */
  function repeatReplayPatch(st, rec, b) {
    const scratch = document.createElement('div');
    runBuilderInto(scratch, () => b(rec.ri), 'Repeat.diff');
    const fresh = Array.from(scratch.childNodes);
    const old = Array.from(rec.nodes || []);
    const kept = [];
    const len = Math.max(old.length, fresh.length);
    for (let k = 0; k < len; k++) {
      const o = old[k]; const w = fresh[k];
      if (o && w) {
        if (o.nodeType === 1 && w.nodeType === 1
          && repeatPatchInto(/** @type {Element} */ (o), /** @type {Element} */ (w))) {
          kept.push(o);
        } else if (o.parentNode) {
          o.parentNode.replaceChild(w, o);
          kept.push(w);
        } else {
          kept.push(w);
        }
      } else if (w) {
        kept.push(w);
      } else if (o && o.parentNode) {
        o.parentNode.removeChild(o);
      }
    }
    rec.nodes = kept;
  }

  /**
   * 解析 (item, i) 的构建器与模板桶标识（templateId 未命中任何 template 时回落 each，
   * repeat.d.ts）。返回 null = 缺 .each（已告警，跳过该项——真机是运行时错误，这里降级）。
   * @param {any} st @param {any} item @param {number} i @returns {{b:any, tplKey:string}|null}
   */
  function repeatResolveBuilder(st, item, i) {
    let b = st.eachB;
    let tplKey = 'each';
    if (st.templateIdFn) {
      let t = null;
      try { t = st.templateIdFn(item, i); } catch (e) {
        warnOnce('Repeat.templateId 抛错：' + (e && e.message));
      }
      if (t !== undefined && t !== null && st.templates[String(t)]) {
        b = st.templates[String(t)];
        tplKey = 'tpl:' + String(t);
      }
    }
    if (typeof b !== 'function') {
      if (!st.warnedEach) {
        st.warnedEach = true;
        // repeat.d.ts："The each property is mandatory. If it is omitted, runtime errors
        // will occur." —— 真机直接报错；这里降级为警告 + 跳过该项，其余项照常渲染。
        layoutWarnings.push('Repeat 缺少 .each 构建器（必填），未命中模板的项不会渲染');
      }
      return null;
    }
    return { b, tplKey };
  }

  /**
   * 键列表：有 .key(fn) 用 fn(item, i)（抛错/返回 undefined/null 该项回落缺省键）；缺省键 =
   * `${index}__` + 键串。重复键在 Map 阶段检测（Map.set 静默覆盖 → size < n 判定，
   * pu_repeat_impl.ts:62-71）。
   * @param {any} st @param {number} n @returns {{keys:any[], dup:boolean}}
   */
  function repeatComputeKeys(st, n) {
    const keys = new Array(n);
    for (let i = 0; i < n; i++) {
      const item = st.arr[i];
      let k;
      if (st.keyFn) {
        try { k = st.keyFn(item, i); } catch (e) {
          warnOnce('Repeat.key 抛错：' + (e && e.message));
        }
      }
      if (k === undefined || k === null) k = repeatDefaultKey(item, i);
      keys[i] = k;
    }
    const seen = new Map();
    for (let i = 0; i < n; i++) seen.set(keys[i], i);
    return { keys, dup: seen.size < n };
  }

  /**
   * 全量重建（首渲染 / 重复键回退 / 构建器面更换）。keys 为 null 时用缺省键
   * （重复键回退 = 真机"换 index 前缀键重建"语义）。返回新 items 表。
   * @param {any} st @param {number} n @param {any[]|null} keys @returns {Map<any, any>}
   */
  function repeatBuildAll(st, n, keys) {
    st.el.textContent = '';
    purgeDetachedRecords();
    st.pool = [];                          // 全量重建弃池（被弃节点已随 textContent='' 脱离文档）
    const items = new Map();
    let rendered = 0;
    for (let i = 0; i < n; i++) {
      const item = st.arr[i];
      const res = repeatResolveBuilder(st, item, i);
      if (!res) continue;
      const ri = repeatMakeItem(item, i);
      const before = st.el.childNodes.length;
      // repeat.d.ts：itemGenerator 收到 RepeatItem {item, index}，且【不要解构】（保持可观测）
      runBuilderInto(st.el, () => res.b(ri), 'Repeat.item' + i);
      const key = keys ? keys[i] : repeatDefaultKey(item, i);
      items.set(key, { key, ri, tplKey: res.tplKey, nodes: Array.from(st.el.childNodes).slice(before) });
      rendered++;
    }
    st.el.dataset.repeatCount = String(rendered);
    return items;
  }

  /** @param {any[]} arr @param {string} tplKey @returns {number} 从尾部向前找同模板回收项（LIFO） */
  function repeatRecycleIdx(arr, tplKey) {
    for (let k = arr.length - 1; k >= 0; k--) {
      if (arr[k].tplKey === tplKey) return k;
    }
    return -1;
  }

  /**
   * 键 diff 渲染：暂存区 + 按新序 append 回填（区块注释的 ①②③）。
   * @param {any} st @param {number} n @param {any[]} keys
   */
  function repeatDiffRender(st, n, keys) {
    // ① 预扫删除集合（旧有新无；LIFO 尾取对应真机 tempChildren 尾 pop）
    const newKeySet = new Set(keys);
    const oldItems = st.items;
    const dead = [];
    for (const [k, rec] of oldItems) {
      if (!newKeySet.has(k)) dead.push(rec);
    }
    // ② 暂存区：旧子树整体摘进 DocumentFragment（std::swap(children_, tempChildren_) 的 DOM 对应物）
    const frag = document.createDocumentFragment();
    while (st.el.firstChild) frag.appendChild(st.el.firstChild);
    // ③ 按新数组序逐键三分支；每项 appendChild 到尾部 → 循环结束顺序天然正确
    const items = new Map();
    let rendered = 0;
    for (let i = 0; i < n; i++) {
      const item = st.arr[i];
      const res = repeatResolveBuilder(st, item, i);
      if (!res) continue;
      const key = keys[i];
      const keptRec = oldItems.get(key);
      if (keptRec) {
        // case#1 键保留：仅 updateIndex（item 不动——键相等即同一逻辑项，pu_repeat_impl.ts）。
        // index 没变就不重放（真机 pu_repeat.ts:64-71 "无人依赖 index 跳过 set" 的对应物）。
        // R156-A：moved = onMoveThrough 拖拽期已把 ri.index 原地改写到视觉序——「index 没变跳
        // 重放」的基线被改写，落定键 diff 须强制重放一次 index 依赖内容（收口 'p@0'→'p@2'）。
        oldItems.delete(key);
        if (keptRec.ri.index !== i || keptRec.moved) {
          keptRec.ri.index = i;                    // RepeatItem 原地改写（不换对象）
          repeatReplayPatch(st, keptRec, res.b);   // 重放 + 补丁：内容更新、节点身份保持
        }
        keptRec.moved = false;
        for (const nd of keptRec.nodes) st.el.appendChild(nd);   // 从暂存区取回
        items.set(key, keptRec);
      } else {
        // case#2 池选择：本渲染删除集优先，其次持久池；同模板优先，从尾部找（LIFO）；
        // 同模板没有时退而取尾（跨模板复用——补丁对不兼容子树自动换新，内容仍正确）
        let di = repeatRecycleIdx(dead, res.tplKey);
        let src = dead;
        if (di < 0) { di = repeatRecycleIdx(st.pool, res.tplKey); src = st.pool; }
        if (di < 0 && (dead.length || st.pool.length)) {
          src = dead.length ? dead : st.pool;
          di = src.length - 1;
        }
        if (di >= 0) {
          const rec = src.splice(di, 1)[0];
          // case#2 复用：先 updateItem 再 updateIndex（真机 pu_repeat_impl.ts:166-167 顺序）
          rec.ri.item = item;
          rec.ri.index = i;
          rec.key = key;
          rec.tplKey = res.tplKey;
          repeatReplayPatch(st, rec, res.b);
          for (const nd of rec.nodes) st.el.appendChild(nd);
          items.set(key, rec);
        } else {
          // case#3 新建
          const ri = repeatMakeItem(item, i);
          const before = st.el.childNodes.length;
          runBuilderInto(st.el, () => res.b(ri), 'Repeat.item' + i);
          items.set(key, { key, ri, tplKey: res.tplKey, nodes: Array.from(st.el.childNodes).slice(before) });
        }
      }
      rendered++;
    }
    // 收尾：本渲染消失项入持久池（单池、上限 16——真机非虚拟路径无持久池，此处是超集；
    // 池满真销毁：节点已随暂存区脱离文档，弃引用即可，再防御性清一次 elmtRecords）。
    for (const rec of dead) {
      st.pool.push(rec);
      while (st.pool.length > 16) st.pool.shift();
    }
    if (dead.length) purgeDetachedRecords();
    st.items = items;
    st.el.dataset.repeatCount = String(rendered);
  }

  /**
   * R155-A：virtualScroll 的 totalCount 口径提取（onTotalCount() 与 totalCount 二选一，前者优先；
   * 非自然数/非法/未配置 → null）。repeatEffectiveN（渲染裁剪）与 repeatLazyWindow（懒加载派发
   * 窗口）共用，保证两处 totalCount 读数一致。
   * @param {any} st @returns {number|null}
   */
  function repeatVsWant(st) {
    if (!st.vs || typeof st.vs !== 'object') return null;
    let want = null;
    if (typeof st.vs.onTotalCount === 'function') {
      try { want = Number(st.vs.onTotalCount()); } catch (e) {
        warnOnce('Repeat.virtualScroll.onTotalCount 抛错：' + (e && e.message));
      }
    } else if (st.vs.totalCount !== undefined) {
      want = Number(st.vs.totalCount);
    }
    return want !== null && Number.isFinite(want) && want >= 0 ? Math.floor(want) : null;
  }

  /**
   * virtualScroll 裁剪后的渲染条数 n（repeat.d.ts VirtualScrollOptions JSDoc 语义）：
   *   totalCount ∈ (0, 数据源长度] → 只渲染 [0, totalCount-1]；=0 → 不渲染；
   *   缺省/非法 → 数据源长度。onTotalCount() 与 totalCount 二选一，前者优先。
   * R154-A 起提取为独立函数：repeatRender 与 onMove 派发共用同一口径
   * （onMove 的 from/to 按同一 n 校验，virtualScroll 共存时语义一致）。
   * R155-A：totalCount 超数据源长度且【未登记 onLazyLoading】= 真机 applicationError
   * （pu_repeat_virtual_scroll_2_impl.ts:480-482 "'totalCount' must not exceed the array
   * length without 'onLazyLoading' being defined!"）——垫片降级为警告 + 按数据源长度裁剪；
   * 登记了 onLazyLoading 时渲染长度口径不变（仍 = min(数据源长度, totalCount)，真机 C++
   * FrameCount = min(arrLen_, totalCount_)，repeat_virtual_scroll_2_node.cpp:762-767——
   * 超出数据源的索引不凭空渲染，等 onLazyLoading 补齐数据后随 arr 长度增长进入渲染窗口）。
   * @param {any} st @returns {number}
   */
  function repeatEffectiveN(st) {
    let total = st.arr.length;
    const want = repeatVsWant(st);
    if (want !== null) {
      if (typeof st.onLazy !== 'function' && want > total && !st.warnedNoLazy) {
        st.warnedNoLazy = true;
        layoutWarnings.push('Repeat.virtualScroll totalCount(' + want + ') 超过数据源长度(' + total
          + ') 且未登记 onLazyLoading（真机 applicationError：totalCount must not exceed the '
          + 'array length without onLazyLoading），已按数据源长度裁剪');
      }
      total = Math.min(total, want);
    }
    return Math.max(0, total);
  }

  /** @param {any} st */
  function repeatRender(st) {
    // R156-A：渲染即拖拽手势状态失效（真机拖拽期间不允许改数组、也不 rerender；垫片防御性
    // 复位在途 onMoveThrough 手势——after 渲染 DOM 序已按键 diff 收敛，旧"被拖项"引用作废）
    st.mtFrom = null;
    st.mtDragged = null;
    let n = repeatEffectiveN(st);
    // R155-A：懒加载缺口截断（repeat.d.ts:152-157 "After the onLazyLoading method is
    // executed, if no data exists in the specified index, the components corresponding to
    // the current index and subsequent indexes cannot be loaded"）——渲染窗口内首个缺数据
    // 索引处停止：该索引及后续项不渲染（真机 getItemUnmonitored 无数据时容器停止渲染、
    // pu_repeat_virtual_scroll_2_impl.ts:146-147 的对应物）。数据补齐（arr[index]=…）后
    // arr 长度增长，下一轮键 diff 自然把新项纳入渲染。未登记 onLazyLoading 时零改动
    // （行为与 R154 完全一致，稀疏数组语义不回退）。
    if (st.onLazy) {
      for (let i = 0; i < n; i++) {
        if (!(i in st.arr)) { n = i; break; }
      }
    }
    if (st.lastSig && repeatSigSame(st.lastSig, st.arr, n)) return;
    st.lastSig = st.arr.slice(0, n);

    // 构建器面（each/templateId/template）被整体更换 → 键无关的结构性变化，走全量重建
    const builderFp = [st.eachB, st.templateIdFn]
      .concat(Object.keys(st.templates).sort().map((/** @type {string} */ k) => st.templates[k]));
    const buildersChanged = !!st.lastBuilders && (st.lastBuilders.length !== builderFp.length
      || st.lastBuilders.some((/** @type {any} */ v, /** @type {number} */ k) => v !== builderFp[k]));
    st.lastBuilders = builderFp;

    const kc = repeatComputeKeys(st, n);
    if (kc.dup && !st.warnedDupKeys) {
      st.warnedDupKeys = true;
      // 真机告警含修复指引（pu_repeat_impl.ts："Correct the key gen function"）；
      // 处置同真机：整体回退缺省键（index 前缀）全量重渲染。
      layoutWarnings.push('Repeat.key 生成了重复键，已整体回退缺省键全量重渲染，'
        + '请修正 key 生成函数（Correct the key gen function）');
    }
    if (kc.dup || buildersChanged || !st.items) {
      st.items = repeatBuildAll(st, n, kc.dup ? null : kc.keys);
      return;
    }
    repeatDiffRender(st, n, kc.keys);
  }

  // repeat.json 属性面：each/key/onMove/template/templateId/virtualScroll。
  // 注意 main.js 通用代理只把 attr 前两个实参透传给 applyAttr（args[0]→v、args[1]→opts），
  // 所以 template(type, itemBuilder, templateOptions?) 的【第三个参 cachedCount 到不了这里】
  // ——如实记录：TemplateOptions.cachedCount 是缓存池容量（纯性能参数，不影响行为）。
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const REPEAT_ATTRS = {
    each: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.eachB = typeof v === 'function' ? v : null;
      repeatSchedule(st);
    },
    key: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.keyFn = typeof v === 'function' ? v : null;
      // R153-A：键生成器参与 diff（键保留→原地复用 / 键消失→池复用 / 新键→新建）；
      // 缺省键 = `${index}__` + 键串；重复键 → 告警 + 回退缺省键全量重渲染
      n.dataset.key = typeof v === 'function' ? 'custom' : 'default';
    },
    template: (n, v, opts) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.templates[String(v)] = typeof opts === 'function' ? opts : null;
      repeatSchedule(st);
    },
    templateId: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.templateIdFn = typeof v === 'function' ? v : null;
      repeatSchedule(st);
    },
    virtualScroll: (n, v) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.vs = v && typeof v === 'object' ? v : null;
      // R155-A：onLazyLoading 在 virtualScroll 选项对象内（repeat.d.ts:173
      // onLazyLoading?(index: number): void，since 19；真机 :473-475 同样从 config 取）——
      // 不是独立链式属性，随 virtualScroll 一起登记。
      st.onLazy = st.vs && typeof st.vs.onLazyLoading === 'function' ? st.vs.onLazyLoading : null;
      n.dataset.virtualScroll = st.vs ? 'on' : 'off';
      n.dataset.onLazyLoading = st.onLazy ? 'registered' : 'none';
      if (st.onLazy && !st.warnedLazy) {
        st.warnedLazy = true;
        // R155-A：如实——真机触发源 = 容器布局按需取项（GetFrameChildByIndex → L1 无此索引 →
        // getItemUnmonitored 同步单发 onLazyLoading(i)，pu_repeat_virtual_scroll_2_impl.ts
        // :401-414；预取距离由容器 cachedCount 决定——List 默认 1、上限 16，Repeat 级无阈值）。
        // DOM 垫片没有滚动容器的按需取项管线，回调经驱动钩子 __arkui_dom_repeatLazy(node,
        // index) 派发（同 R154-A onMove 先例）。
        layoutWarnings.push('Repeat.onLazyLoading 已登记：DOM 垫片无容器按需取项管线，'
          + '回调经 __arkui_dom_repeatLazy 驱动钩子派发');
      }
      repeatSchedule(st);
    },
    onMove: (n, v, opts) => {
      const st = (/** @type {any} */ (n)).__repeat;
      if (!st) return;
      st.onMove = typeof v === 'function' ? v : null;
      n.dataset.onMove = st.onMove ? 'registered' : 'none';
      // R156-A：onMoveThrough 走 onMove 的第二参 ItemDragEventHandler（common.d.ts:25838
      // onMove(handler, eventHandler) since 20 重载；:25788 onMoveThrough?: OnMoveHandler）——
      // 非独立链式属性；area.js:441 已把 args[1] 透传到 opts。同接口的 onLongPress/onDragStart/
      // onDrop 不在本片范围（不消费，如声明实记档于此注释）。
      const evh = opts && typeof opts === 'object' ? opts : null;
      st.onMoveThrough = evh && typeof evh.onMoveThrough === 'function' ? evh.onMoveThrough : null;
      n.dataset.onMoveThrough = st.onMoveThrough ? 'registered' : 'none';
      if (st.onMoveThrough && !st.warnedMoveThrough) {
        st.warnedMoveThrough = true;
        // R156-A：如实——真机触发源 = List/Grid 父容器拖拽中每跨过一项（HandleSwapAnimation
        // 换位后 FireOnMoveThrough，list_item_drag_manager.cpp:660-663），DOM 垫片无拖拽手势。
        // 回调由驱动钩子 __arkui_dom_repeatMoveThrough(node, from, to) 派发（两参裸 number，
        // from=拖拽起始索引手势内恒定；数据源仍由 onMove 落定时开发者 splice）。
        layoutWarnings.push('Repeat.onMoveThrough 已登记：DOM 垫片无拖拽手势触发源，'
          + '回调经 __arkui_dom_repeatMoveThrough 驱动钩子派发');
      }
      if (st.onMove && !st.warnedMove) {
        st.warnedMove = true;
        // R154-A：如实——onMove 的真机触发源是 List/Grid 父容器的拖拽手势
        // （RepeatNode::SetOnMove 只对 LIST/GRID 父容器挂拖拽管理器，repeat_node.cpp:222-229；
        // 落定单发一次，list_item_drag_manager.cpp:768-769），DOM 垫片没有手势系统。
        // 回调由驱动钩子 __arkui_dom_repeatMove(node, from, to) 派发（两参裸 number，
        // pu_foreach.d.ts:45 / i_repeat.ts:37 OnMoveHandler——不存在事件对象类型）。
        layoutWarnings.push('Repeat.onMove 已登记：DOM 垫片无拖拽手势触发源，'
          + '回调经 __arkui_dom_repeatMove 驱动钩子派发');
      }
    },
  };

  /** @param {any[]} args */
  const Repeat = ensureComponent('Repeat', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiRepeat = true;
    el.setAttribute('data-arkui-repeat', '');
    el.style.display = 'contents';              // 逻辑容器：不引入盒子（同 ForEach）
    const st = /** @type {any} */ (el).__repeat = /** @type {any} */ ({
      el,
      arr: args && Array.isArray(args[0]) ? args[0] : [],
      eachB: null, keyFn: null, templateIdFn: null,
      /** @type {Record<string, any>} */ templates: {},
      vs: null, onMove: null, onLazy: null,   // onLazy = virtualScroll 选项里的 onLazyLoading（R155-A）
      onMoveThrough: null,   // R156-A = onMove 第二参 ItemDragEventHandler.onMoveThrough（API 20）
      mtFrom: null, mtDragged: null,         // R156-A 在途拖拽手势（fromIndex_ 恒定 + 被拖项 rec）
      scheduled: false, lastSig: null,
      items: null,           // Map<key, rec>：当前存活项；rec = {key, ri, tplKey, nodes}
      pool: [],              // 持久回收池（单池、上限 16、LIFO）
      lastBuilders: null,    // 构建器面指纹（each/templateId/template 更换 → 全量重建）
      warnedEach: false, warnedMove: false, warnedMoveThrough: false, warnedDupKeys: false,
      warnedLazy: false, warnedNoLazy: false,
    });
    return st.el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    // 重渲染：Repeat.create(arr, this) 重放 → 只更新数据源；构建器由属性重放重新登记
    const st = (/** @type {any} */ (node)).__repeat;
    if (!st) return;
    st.arr = args && Array.isArray(args[0]) ? args[0] : [];
    repeatSchedule(st);
  });

  // 运行时级数据源变更驱动（同 __arkui_dom_swiperState 先例，供测试/诊断页直调）：
  // 走与 Repeat.create 重放完全相同的更新路径（arr 换源 + 调度微任务键 diff 渲染）。
  (/** @type {any} */ (global)).__arkui_dom_repeatUpdate = (/** @type {any} */ node, /** @type {any[]} */ arr) => {
    const st = (/** @type {any} */ (node)).__repeat;
    if (!st) return;
    st.arr = Array.isArray(arr) ? arr : [];
    repeatSchedule(st);
  };

  // ── R154-A：拖拽换位驱动（onMove 派发）──
  // 真机协议（pu_repeat_virtual_scroll_2_impl.ts:71-83 权威七步）：
  //   1) 长按 ListItem 拖拽开始；
  //   2) 拖拽期间【框架自动重排视觉节点】（C++ RepeatNode::MoveData 平移表 moveFromTo_，
  //      repeat_virtual_scroll_2_node / repeat_node.cpp:152-184），期间不允许 app 改数组；
  //   3) 松手落定；
  //   4) FireOnMove（list_item_drag_manager.cpp:768-769；拖拽取消同发 :793-794；from==to
  //      不派发，for_each_base_node.h:33）；
  //   5) onMove 回调给应用，【数据源由开发者在回调里 splice】——框架从不改用户数组；
  //   6) 框架观察数组变化触发 rerender；
  //   7) Repeat rerender（键 diff：键保留 → updateIndex + moveChild 回填）。
  // 回调签名 = 两参裸 number (from, to)（pu_foreach.d.ts:45 / i_repeat.ts:37
  // OnMoveHandler；from=拖拽起始原索引、to=落定索引，list_item_drag_manager.cpp:189/:767，
  // 均为数据源索引口径）。真机源码与 SDK declarations 全量 grep 均无 RepeatMoveEvent
  // 事件对象——事件对象形态不存在。
  // 生效范围：真机只在父容器为 List/Grid 时激活（repeat_node.cpp:222-229 / virtual 2 node
  // :921-925）；virtualScroll 与 onMove 完全兼容（同一驱动钩子口径，from/to 按裁剪后的
  // n 校验）。
  // DOM 垫片把手势协议折叠为一次调用，本钩子依次：
  //   ① 视觉重排 DOM 子节点（MoveData 的 DOM 对应物；同步生效——真机落定时 UI 已是新序）；
  //   ② splice st.arr：垫片无状态观察系统，把「开发者 splice + 框架观察 rerender」折叠进来
  //      ——【onMove 回调里不要再 splice，否则双重换位】；
  //   ③ 派发 onMove(from, to)（此时数据源已重排，value 可从 arr[to] 取；两参裸 number）；
  //   ④ 调度标准键 diff 渲染（R153 暂存区回填模型）：视觉已是目标序，本步只收口
  //      RepeatItem.index 原地改写与 index 依赖的内容重放——节点身份保持。
  /**
   * @param {any} st @param {number} from @param {number} to @returns {boolean} 是否已派发
   */
  function repeatMoveDispatch(st, from, to) {
    const n = repeatEffectiveN(st);
    // 真机口径：MoveData 对 from==to/负数直返（repeat_node.cpp:154）；越界 = 拖拽手势
    // 产生不了的索引，告警忽略（同 indicatorStep 边界口径）。
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to
      || from < 0 || to < 0 || from >= n || to >= n) {
      layoutWarnings.push(`Repeat.onMove 非法换位（from=${from}, to=${to}, 渲染条数=${n}），已忽略`);
      return false;
    }
    if (!st.items || st.items.size === 0) {
      layoutWarnings.push('Repeat.onMove：尚无已渲染项，已忽略');
      return false;
    }
    // R156-A：落定 = 结束在途 onMoveThrough 手势（真机 FireOnMove 在 drop/cancel 收口路径，
    // list_item_drag_manager.cpp:872-877——手势状态不跨落定存活）
    st.mtFrom = null;
    st.mtDragged = null;
    const keys = repeatComputeKeys(st, n).keys;
    // 渲染序条目（= 当前 DOM 序；缺 each 的项未渲染，跳过——与子节点序列一致）
    const seq = [];
    for (let i = 0; i < n; i++) {
      const rec = st.items.get(keys[i]);
      if (rec) seq.push({ rec, d: i });
    }
    const fi = seq.findIndex((/** @type {any} */ e) => e.d === from);
    if (fi < 0) {
      layoutWarnings.push(`Repeat.onMove：from=${from} 对应项未渲染，已忽略`);
      return false;
    }
    // 数据序 splice 语义（应用侧 canonical op = splice(from,1) + splice(to,0,moved)）：
    // 目标插入位 = 新序里排在 moved 前面的渲染项个数。旧序位置 d 换算新序：d<from → d、
    // d>from → d-1（erase 先行，同 C++ children.erase+insert，repeat_node.cpp:168-176）。
    let insertAt = 0;
    for (const e of seq) {
      if (e.d === from) continue;
      const nd = e.d < from ? e.d : e.d - 1;
      if (nd < to) insertAt++;
    }
    // ① 视觉重排：整组摘进 DocumentFragment 一批回填（appendChild 移位，节点身份保持——
    //    同 R153 暂存区回填模型；一项多节点时按 rec.nodes 整组搬）
    const [moved] = seq.splice(fi, 1);
    seq.splice(insertAt, 0, moved);
    const frag = document.createDocumentFragment();
    for (const e of seq) {
      for (const node of e.rec.nodes) frag.appendChild(node);
    }
    st.el.appendChild(frag);
    st.items = new Map(seq.map((/** @type {any} */ e) => [e.rec.key, e.rec]));
    st.el.dataset.repeatMoveFrom = String(from);
    st.el.dataset.repeatMoveTo = String(to);
    // ② splice 数据源（真机由开发者在回调里做——见块注释；垫片代做，回调里不要再 splice）
    if (Array.isArray(st.arr)) {
      const [movedItem] = st.arr.splice(from, 1);
      st.arr.splice(to, 0, movedItem);
    }
    // ③ 派发（两参裸 number；回调抛错不阻断后续收口——同 onChange 口径）
    if (typeof st.onMove === 'function') {
      try { st.onMove(from, to); } catch (e) {
        layoutWarnings.push('Repeat.onMove 回调抛错：' + (e && e.message));
      }
    }
    // ④ 标准键 diff 收口：lastSig 仍是旧序 → 必跑；键保留分支原地改写 RepeatItem.index
    //    并重放 index 依赖的内容，子节点按新序 append——视觉序不变、节点身份保持。
    repeatSchedule(st);
    return true;
  }

  // 运行时级拖拽换位驱动钩子（同 __arkui_dom_repeatUpdate 先例，供测试/诊断页直调）。
  // 返回 boolean：true = 已派发；false = 非法/不可派发（已告警）。
  (/** @type {any} */ (global)).__arkui_dom_repeatMove
    = (/** @type {any} */ node, /** @type {number} */ from, /** @type {number} */ to) => {
      const st = (/** @type {any} */ (node)).__repeat;
      if (!st) return false;
      return repeatMoveDispatch(st, from, to);
    };

  // ── R156-A：拖拽进行中细粒度派发（onMoveThrough，API 20）──
  // 真机协议（list_item_drag_manager.cpp HandleOnItemDragUpdate，每个拖拽更新帧，:645-663）：
  //   · from_live = GetIndex()（被拖项在框架子节点序的实时索引）；to = ScaleNearItem(from_live,…)
  //     = 越过中线的最近邻居目标（:337-356 IsNeedMove 中线口径）；to == from_live → 直接 return
  //     （:595-597【唯一守卫】——无 lastThroughIndex 防抖，往复摆动会反复触发）；
  //   · 先 HandleSwapAnimation(from_live, to)（:660 → MoveData 平移表换位：拖拽项移到 to、邻居
  //     顺次腾位；InterpolatingSpring(0,1,400,38)/30ms 只是视觉插值，内部顺序换位在动画启动即
  //     生效），【再】FireOnMoveThrough(fromIndex_, to)（:663/:707）；
  //   · 回调首参 fromIndex_ = 拖拽起始索引（:198 赋值一次，全手势【恒定不随换位更新】——即一次
  //     拖拽的事件序为 (from0,t1),(from0,t2),…），次参 to = 本次越过的目标（实时序）；
  //   · 【框架只重排自己的视觉节点（MoveData），数据源不动】——数据源仍由 onMove 落定时开发者
  //     splice（权威七步 pu_repeat_virtual_scroll_2_impl.ts:71-83）；未登记回调时换位照常
  //     （for_each_base_node.h:52-55 FireOnMoveThrough 只门回调，不门换位）。
  // 签名 = 两参裸 number OnMoveHandler（common.d.ts:25744/:25788，同 onMove 无事件对象）。
  // DOM 垫片无拖拽会话（无手势系统），驱动钩子按「真机回调同形两参」驱动：
  //   · 首次调用（或 from 与在途手势不同 = 新手势开始）：from 定位被拖项——首次跨越时该帧实时位
  //     恰等于起始索引，两者相等；
  //   · 同手势后续调用：按在途被拖项 rec 反查实时位 cur（真机 GetIndex 口径），换位 cur→to；
  //   · 回调收 (from, to) 原样两参——from 即 fromIndex_ 恒定口径。
  // 本钩子依次：
  //   ① 视觉平移换位（erase 先行再插入，同 MoveData/canonical splice 语义：[a,b,c,d] move(0,2)
  //      → [b,c,a,d]；DocumentFragment 一批回填，节点身份保持——同 R154 先例）；
  //   ② RepeatItem.index 原地改写（ri 实例不换）+ rec.moved 标记——不重放 builder（真机拖拽期
  //      MoveData 不重渲染，内容收口在落定键 diff；moved 强制 case#1 重放：R153 的「index 没变
  //      跳重放」以 ri.index 为基线，through 已把它改写，不强制会漏收 'p@0'→'p@2'）；
  //   ③ lastSig 置 null：R153 前缀快照按旧数组序记，换位后 DOM 序与 st.arr 序脱钩——真机
  //      moveFromTo_ 平移表同款失效语义，下一次键 diff 不得误判"数组没变"而跳过；
  //   ④ 派发 onMoveThrough(from, to)。
  // 【不 splice st.arr、不调度渲染】——真机拖拽期间不 rerender、不动用户数组；渲染收口只在
  // onMove 落定的 splice rerender（__arkui_dom_repeatMove → repeatSchedule）。
  /**
   * @param {any} st @param {number} from @param {number} to @returns {boolean} 是否已换位派发
   */
  function repeatMoveThroughDispatch(st, from, to) {
    const n = repeatEffectiveN(st);
    // 真机口径：越界/非整数 = 拖拽手势产生不了的索引，告警忽略（同 onMove 边界口径）
    if (!Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || to < 0 || from >= n || to >= n) {
      layoutWarnings.push(`Repeat.onMoveThrough 非法换位（from=${from}, to=${to}, 渲染条数=${n}），已忽略`);
      return false;
    }
    if (!st.items || st.items.size === 0) {
      layoutWarnings.push('Repeat.onMoveThrough：尚无已渲染项，已忽略');
      return false;
    }
    // 视觉序 = 当前 DOM 序（through 换位后 DOM 与 st.arr 序脱钩，不能按 keys 表重建——
    // 节点→rec 反查后按 childNodes 走序；st.items 的键→rec 映射与顺序无关，仍有效）
    const byNode = new Map();
    for (const rec of st.items.values()) {
      for (const nd of rec.nodes) byNode.set(nd, rec);
    }
    const seq = [];
    for (const nd of st.el.childNodes) {
      const rec = byNode.get(nd);
      if (rec) seq.push(rec);
    }
    if (!seq.length) {
      layoutWarnings.push('Repeat.onMoveThrough：尚无已渲染项，已忽略');
      return false;
    }
    // 手势状态：首次调用 / from 变化 = 新手势（真机 drag start 重赋 fromIndex_，:198）
    let cur;
    if (typeof st.mtFrom !== 'number' || st.mtFrom !== from) {
      st.mtFrom = from;
      st.mtDragged = seq[from];
      cur = from;
    } else {
      cur = seq.indexOf(st.mtDragged);
      if (cur < 0) {
        // 防御：在途被拖项已不在渲染序（中途全量重建等）——复位手势，告警忽略本次
        st.mtFrom = null;
        st.mtDragged = null;
        layoutWarnings.push(`Repeat.onMoveThrough：在途被拖项未渲染（from=${from}），手势状态已复位`);
        return false;
      }
    }
    if (cur === to) return false;      // 真机 :595-597 唯一守卫（无跨越不换位不派发；拖拽更新帧
                                       // 高频触发，静默同款——不同于 onMove 的"落定调用"告警口径）
    // ① 视觉平移换位（erase 先行再插入）
    const movedRec = seq.splice(cur, 1)[0];
    seq.splice(to, 0, movedRec);
    const frag = document.createDocumentFragment();
    for (const rec of seq) {
      for (const node of rec.nodes) frag.appendChild(node);
    }
    st.el.appendChild(frag);
    st.items = new Map(seq.map((/** @type {any} */ rec) => [rec.key, rec]));
    // ② RepeatItem.index 原地改写（不重放 builder——内容收口在落定键 diff，moved 见块注释）
    for (let k = 0; k < seq.length; k++) {
      seq[k].ri.index = k;
      seq[k].moved = true;
    }
    // ③ R153 前缀快照过期（本钩子不调度渲染，何时重放由落定/数据源变更决定）
    st.lastSig = null;
    st.el.dataset.repeatMoveThroughFrom = String(from);
    st.el.dataset.repeatMoveThroughTo = String(to);
    // ④ 派发（两参裸 number 原样——from 即真机 fromIndex_ 恒定口径；回调抛错不阻断，同 onMove）
    if (typeof st.onMoveThrough === 'function') {
      try { st.onMoveThrough(from, to); } catch (e) {
        layoutWarnings.push('Repeat.onMoveThrough 回调抛错：' + (e && e.message));
      }
    }
    return true;
  }

  // 运行时级拖拽进行中驱动钩子（同 __arkui_dom_repeatMove 先例，供测试/诊断页直调）。
  // 返回 boolean：true = 已换位（回调是否派发取决于是否登记——真机换位与事件守卫解耦）；
  // false = 非法/无跨越（已告警或静默，见 repeatMoveThroughDispatch）。
  (/** @type {any} */ (global)).__arkui_dom_repeatMoveThrough
    = (/** @type {any} */ node, /** @type {number} */ from, /** @type {number} */ to) => {
      const st = (/** @type {any} */ (node)).__repeat;
      if (!st) return false;
      return repeatMoveThroughDispatch(st, from, to);
    };

  // ── R155-A：数据源懒加载派发（onLazyLoading）──
  // 真机协议（pu_repeat_virtual_scroll_2_impl.ts:120-147 权威注释 + :401-414 实现）：
  //   · 签名 = 单参裸 number：onLazyLoading?(index: number): void（repeat.d.ts:173，since 19；
  //     pu_repeat.ts:157 OnLazyLoadingHandler 同型）——index 是【要加载的数据项绝对索引】，
  //     不是"距 totalCount 还差多少"（任务书猜测已被真机源码纠偏）。
  //   · 触发 = 按需逐索引：容器布局请求索引 i（滚动接近尾部时 = 可见窗 + 容器 cachedCount 预取
  //     范围；List 默认 cachedCount=1、上限 16——预取距离是容器参数，Repeat 级无阈值）→ L1 无
  //     此索引 → 若登记了 onLazyLoading 且 !(index in arr_) → 同步调 onLazyLoading(i) 一次。
  //   · 数据源责任在开发者（同 onMove"框架只发事件"口径——但与 onMove 相反，这里垫片【不代写】
  //     数据）：回调里必须 arr[index] = item，且真机只允许写该索引（Proxy 强制，其他数组操作/
  //     写其他索引 → BusinessError 103804，:1592-1595 与 :1632-1635）；垫片无 Proxy，push 等
  //     追加也收（超集，如实不模拟 103804）。框架从不改用户数组。
  //   · 回调返回后 arr[index] 仍无数据 → 真机 applicationError "onLazyLoading function did
  //     not provide data to index N"（:407-409），该索引及后续停止加载（repeat.d.ts:156-157），
  //     无重试、无死循环（lazyLoadingIndex_ 复位 -1，:411；再次派发只会来自下一次独立的布局
  //     请求——垫片对应物 = 再调一次驱动钩子）。垫片同口径：告警 + 不调度渲染。
  //   · 回调给到数据 → 真机走 tryFastRelayout（:136-140：arr[index]= 的 Proxy 拦截 → 请求容器
  //     重排版，无需整树 rerender；官方因此建议配 onTotalCount 用）；垫片对应物 = 调度标准键
  //     diff 渲染（新增键走 case#3 新建分支，节点身份模型不变）。
  /**
   * R155-A：懒加载派发窗口 = totalCount 口径（repeatVsWant；真机登记 onLazyLoading 后传给 C++
   * 的 arrLen 即 totalCount，pu_repeat_virtual_scroll_2_impl.ts:529/:594——布局请求得到 [0,
   * totalCount) 内的任意索引）。totalCount 缺省/非法 → 数据源长度。
   * @param {any} st @returns {number}
   */
  function repeatLazyWindow(st) {
    const want = repeatVsWant(st);
    return want !== null ? want : st.arr.length;
  }

  /**
   * 单次懒加载询问（真机 getItemUnmonitored 的按需单发折叠）。返回 true = 回调给到了数据。
   * @param {any} st @param {number} index @returns {boolean}
   */
  function repeatLazyDispatch(st, index) {
    // 越界 = 滚动/布局请求不出来的索引（同 onMove 边界口径，告警忽略）
    const win = repeatLazyWindow(st);
    if (!Number.isInteger(index) || index < 0 || index >= win) {
      layoutWarnings.push(`Repeat.onLazyLoading 非法索引（index=${index}, totalCount 窗口=${win}），已忽略`);
      return false;
    }
    if (typeof st.onLazy !== 'function') {
      layoutWarnings.push('Repeat.onLazyLoading 未登记，无法派发');
      return false;
    }
    // 真机 :403 !(index in this.arr_) 守卫：数据已在的索引不派发（静默 false，非错误）
    if (index in st.arr) return false;
    try { st.onLazy(index); } catch (e) {
      layoutWarnings.push('Repeat.onLazyLoading 回调抛错：' + (e && e.message));
    }
    if (!(index in st.arr)) {
      // 真机 :407-409 applicationError 文案 + d.ts:156-157 停止语义：不重试、不调度渲染
      layoutWarnings.push(`Repeat.onLazyLoading 回调未给 index=${index} 提供数据`
        + `（真机 applicationError：onLazyLoading function did not provide data to index ${index}；`
        + '该索引及后续停止加载，无重试）');
      return false;
    }
    // 数据已到站：键 diff 渲染接管（tryFastRelayout 的垫片对应物）
    repeatSchedule(st);
    return true;
  }

  // 运行时级懒加载驱动钩子（模拟容器滚动取项对缺失索引的请求，供测试/诊断页直调）。
  // 返回 boolean：true = 已派发且回调给到了数据（渲染已调度）；false = 非法/已有数据/未给数据。
  (/** @type {any} */ (global)).__arkui_dom_repeatLazy
    = (/** @type {any} */ node, /** @type {number} */ index) => {
      const st = (/** @type {any} */ (node)).__repeat;
      if (!st) return false;
      return repeatLazyDispatch(st, index);
    };

  // ════════════════════ WithTheme ════════════════════
  /** @param {HTMLElement} el @param {any} o @returns {any} */
  function applyWithThemeOptions(el, o) {
    const anyEl = /** @type {any} */ (el);
    if (!o || typeof o !== 'object') return anyEl.__wtheme;
    const st = anyEl.__wtheme || (anyEl.__wtheme = /** @type {any} */ ({
      colorMode: 0, hasTheme: false, warnedTheme: false,
    }));
    if (o.colorMode !== undefined) {
      // ThemeColorMode：SYSTEM=0 / LIGHT=1 / DARK=2（common.d.ts:6808 起）
      const m = Number(resolveResource(o.colorMode)) || 0;
      st.colorMode = m;
      el.dataset.colorMode = String(m);
      // DOM 对应物：CSS color-scheme 作用域（后代原生控件的浅/深色默认皮肤随之切换）
      el.style.colorScheme = m === 2 ? 'dark' : (m === 1 ? 'light' : '');
      // R141：sys.* 资源表联动——DARK 时 resolveResource 查 dark 表（generated-sys-resources
      // 生成的 __arkui_dom_resources_dark）。【全局效应】而非作用域（真机 scope 换表走 C 层，
      // DOM 侧简化为全局换表——已注释如实）；light 表引用保留供切回。
      const gAny = /** @type {any} */ (global);
      if (gAny.__arkui_dom_resources_dark) {
        // light 表引用在首次 colorMode 处理时定格（此后 resources 可能已是 dark）
        gAny.__arkui_dom_resources_light = gAny.__arkui_dom_resources_light || gAny.__arkui_dom_resources;
        gAny.__arkui_dom_resources = m === 2 ? gAny.__arkui_dom_resources_dark : gAny.__arkui_dom_resources_light;
      }
    }
    if (o.theme !== undefined) {
      st.hasTheme = o.theme !== null;
      el.dataset.theme = st.hasTheme ? 'custom' : 'none';
      if (st.hasTheme && !st.warnedTheme) {
        st.warnedTheme = true;
        // 如实：CustomTheme 是令牌表（@ohos.arkui.theme），没有到 CSS 变量的映射，只记录
        layoutWarnings.push('WithTheme({theme}) 的 CustomTheme 令牌未映射到 DOM（仅记录 data-theme）；'
          + 'colorMode 生效');
      }
    }
    return st;
  }

  /** @param {any[]} args */
  const WithTheme = ensureComponent('WithTheme', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiWithTheme = true;
    el.dataset.withTheme = '';
    el.style.display = 'block';
    applyWithThemeOptions(el, args && args[0]);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => { applyWithThemeOptions(node, args && args[0]); });

  // ════════════════════ MenuItemGroup ════════════════════
  // header/footer: ResourceStr | CustomBuilder（menu_item_group.d.ts）。真机序是
  // header → items → footer（同 ListItemGroup）；items 由框架在 create..pop 之间 appendChild，
  // 会排在【DOM 里最后】的 footerWrap 之后 → 给 footerWrap 设 flex order:1（header/items 缺省 0，
  // DOM 序先行），视觉序仍是 header → items → footer。
  /** @param {HTMLElement} slot @param {any} v @param {string} what */
  function applyMigSlot(slot, v, what) {
    if (typeof v === 'function') {
      runBuilderInto(slot, v, 'MenuItemGroup.' + what);
      return;
    }
    slot.textContent = String(resolveResource(v));
  }

  /** @param {any[]} args */
  const MenuItemGroup = ensureComponent('MenuItemGroup', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiMenuItemGroup = true;
    el.dataset.menuItemGroup = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    const st = /** @type {any} */ (el).__mig = /** @type {any} */ ({ header: null, footer: null });
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.header !== undefined) st.header = o.header;
    if (o.footer !== undefined) st.footer = o.footer;
    const headerWrap = document.createElement('div');
    headerWrap.setAttribute('data-arkui-mig-header', '');
    el.appendChild(headerWrap);
    if (st.header !== null) applyMigSlot(headerWrap, st.header, 'header');
    const footerWrap = document.createElement('div');
    footerWrap.setAttribute('data-arkui-mig-footer', '');
    footerWrap.style.order = '1';
    el.appendChild(footerWrap);
    if (st.footer !== null) applyMigSlot(footerWrap, st.footer, 'footer');
    return el;
  });

  // ════════════════════ IndicatorComponent ════════════════════
  // 指示器条（indicatorcomponent.d.ts，since 15）：create(controller?)；属性 initialIndex/count/
  // style/loop/vertical/onChange；控制器 showNext/showPrevious/changeIndex(i, useAnimation?)。
  // DOM：一排圆点（flex row/column）；活动点由 loop 决定越界回卷或停在边界（同 Swiper 基线）。
  let indicSeq = 0;

  class IndicatorComponentController {
    constructor() {
      /** @type {number} */ this._id = ++indicSeq;
      /** @type {any} */ this._state = null;
    }
    showNext() { return indicStep(this._state, 1); }
    showPrevious() { return indicStep(this._state, -1); }
    /** @param {number} i @param {boolean=} [useAnimation] */
    changeIndex(i, useAnimation) {
      if (useAnimation === true) {
        warnOnce('IndicatorComponentController.changeIndex(useAnimation=true)：无动画实现，已忽略动画');
      }
      return indicStep(this._state, 0, Number(i));
    }
  }

  /** @param {any} st @param {any} ctl */
  function bindIndicController(st, ctl) {
    if (!ctl || typeof ctl !== 'object') return;
    if (typeof ctl.showNext !== 'function') {
      layoutWarnings.push('IndicatorComponent.create 的参数不是 IndicatorComponentController');
      return;
    }
    if (ctl._state && ctl._state !== st) {
      layoutWarnings.push('同一个 IndicatorComponentController 被绑定到多个 IndicatorComponent（后绑定的生效）');
    }
    ctl._state = st;
    st.controller = ctl;
  }

  /** @param {any} st @param {number} delta @param {number=} [absolute] */
  function indicStep(st, delta, absolute) {
    if (!st) {
      layoutWarnings.push('IndicatorComponentController 尚未绑定到任何 IndicatorComponent');
      return false;
    }
    const n = st.count;
    if (!n) {
      layoutWarnings.push('IndicatorComponent.count 为 0，无法切换指示点');
      return false;
    }
    let next = (absolute !== undefined) ? absolute : st.index + delta;
    if (st.loop) next = ((next % n) + n) % n;
    return indicSetActive(st, next, true);
  }

  /** @param {any} st @param {number} i @param {boolean} fire */
  function indicSetActive(st, i, fire) {
    const n = st.count;
    let idx = Number(i);
    if (!st.loop && (idx < 0 || idx >= n)) {
      layoutWarnings.push(`IndicatorComponent 切换越界（index=${i}，count=${n}，loop=false）`);
      return false;
    }
    if (st.loop) idx = ((idx % n) + n) % n;
    st.index = idx;
    st.dots.forEach((/** @type {any} */ d, /** @type {number} */ k) => {
      d.setAttribute('data-indic-active', k === idx ? 'true' : 'false');
    });
    if (fire) {
      const cb = st.cbs.change;
      if (typeof cb === 'function') {
        try { cb(idx); } catch (e) { layoutWarnings.push(`IndicatorComponent.onChange 抛错：${e && e.message}`); }
      }
    }
    return true;
  }

  /** @param {any} st */
  function indicRender(st) {
    const el = st.el;
    el.textContent = '';
    st.dots = [];
    for (let k = 0; k < st.count; k++) {
      const d = document.createElement('div');
      d.setAttribute('data-indic-dot', String(k));
      d.setAttribute('data-indic-active', 'false');
      d.style.width = '8px';
      d.style.height = '8px';
      d.style.borderRadius = '50%';
      d.style.background = '#bbb';
      d.style.cursor = 'pointer';
      d.addEventListener('click', () => indicSetActive(st, k, true));
      el.appendChild(d);
      st.dots.push(d);
    }
    if (st.count) indicSetActive(st, st.index, false);
  }

  /** @param {any} st */
  function indicSchedule(st) {
    if (st.scheduled) return;
    st.scheduled = true;
    Promise.resolve().then(() => {
      st.scheduled = false;
      indicRender(st);
    });
  }

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const INDIC_ATTRS = {
    initialIndex: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.index = Math.max(0, Number(resolveResource(v)) || 0);
    },
    count: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (!st) return;
      st.count = Math.max(0, Math.floor(Number(resolveResource(v)) || 0));
      indicSchedule(st);
    },
    style: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (!st) return;
      n.dataset.style = 'custom';
      if (!st.warnedStyle) {
        st.warnedStyle = true;
        // 与 Swiper.indicator 同一口径：DotIndicator/DigitIndicator 的配置读不到，退化为默认圆点
        layoutWarnings.push('IndicatorComponent.style 只支持默认圆点；DotIndicator/DigitIndicator 的配置未实现');
      }
    },
    loop: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.loop = !!v;
      n.dataset.loop = String(!!v);
    },
    vertical: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.vertical = !!v;
      n.style.flexDirection = v ? 'column' : 'row';
      n.dataset.vertical = String(!!v);
    },
    onChange: (n, v) => {
      const st = (/** @type {any} */ (n)).__indic;
      if (st) st.cbs.change = v;
    },
  };

  /** @param {any[]} args */
  const IndicatorComponent = ensureComponent('IndicatorComponent', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiIndicator = true;
    el.dataset.indicator = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.justifyContent = 'center';
    el.style.alignItems = 'center';
    el.style.gap = '8px';
    const st = /** @type {any} */ (el).__indic = /** @type {any} */ ({
      el, index: 0, count: 0, loop: false, vertical: false,
      cbs: {}, dots: [], controller: null,
      scheduled: false, warnedStyle: false,
    });
    bindIndicController(st, args && args[0]);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    const st = (/** @type {any} */ (node)).__indic;
    if (st) bindIndicController(st, args && args[0]);
  });

  // ════════════════════ ContainerReader ════════════════════
  // 容器断点读取（@ohos.arkui.components.ContainerReader.d.ts，since 26.0.0）：
  //   create({size:{width,height}, widthBreakpoint?, heightBreakpoint?}) + .breakpointConfig(
  //   {width?: number[], height?: number[]})。桶序 = 【不小于】阈值的连续个数（阈值升序）；
  //   未配置阈值时透传 create 里的 WidthBreakpoint/HeightBreakpoint 枚举值。
  /** @param {any[]} th @param {number} v @returns {number} */
  function creaderBucket(th, v) {
    const arr = [...th].sort((/** @type {number} */ a, /** @type {number} */ b) => a - b);
    let i = 0;
    while (i < arr.length && v >= arr[i]) i++;
    return i;
  }

  /** @param {any} st */
  function creaderApply(st) {
    const w = (st.size && Number(st.size.width)) || 0;
    const h = (st.size && Number(st.size.height)) || 0;
    st.activeW = (st.cfg.width && st.cfg.width.length) ? creaderBucket(st.cfg.width, w) : st.widthBp;
    st.activeH = (st.cfg.height && st.cfg.height.length) ? creaderBucket(st.cfg.height, h) : st.heightBp;
    st.el.dataset.widthBp = String(st.activeW);
    st.el.dataset.heightBp = String(st.activeH);
  }

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CREADER_ATTRS = {
    breakpointConfig: (n, v) => {
      const st = (/** @type {any} */ (n)).__creader;
      if (!st) return;
      const o = v && typeof v === 'object' ? v : {};
      st.cfg.width = Array.isArray(o.width) ? o.width.map(Number) : [];
      st.cfg.height = Array.isArray(o.height) ? o.height.map(Number) : [];
      n.dataset.bpWidth = JSON.stringify(st.cfg.width);
      n.dataset.bpHeight = JSON.stringify(st.cfg.height);
      creaderApply(st);
    },
  };

  /** @param {any[]} args */
  const ContainerReader = ensureComponent('ContainerReader', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiCReader = true;
    el.dataset.containerReader = '';
    el.style.display = 'block';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const st = /** @type {any} */ (el).__creader = /** @type {any} */ ({
      el,
      size: o.size && typeof o.size === 'object' ? o.size : { width: 0, height: 0 },
      widthBp: Number(o.widthBreakpoint) || 0,
      heightBp: Number(o.heightBreakpoint) || 0,
      cfg: { width: [], height: [] },
      activeW: 0, activeH: 0,
    });
    creaderApply(st);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    // 重渲染：create({size}) 重放 → 只刷新 size 与断点（breakpointConfig 由属性重放重新应用）
    const st = (/** @type {any} */ (node)).__creader;
    if (!st) return;
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    if (o.size && typeof o.size === 'object') st.size = o.size;
    if (o.widthBreakpoint !== undefined) st.widthBp = Number(o.widthBreakpoint) || 0;
    if (o.heightBreakpoint !== undefined) st.heightBp = Number(o.heightBreakpoint) || 0;
    creaderApply(st);
  });

  // ════════════════════ Calendar（systemApi 老组件，无随包 d.ts）════════════════════
  // 属性面 = ets-loader/components/calendar.json。无权威文本处按字段名近似（已标注）：
  //   date：锚定月份 + 选中日（接受 Date/时间戳/'YYYY-MM-DD'）；
  //   startOfWeek：0=周日（getDay 口径）；offDays：休息日 weekday 数组；
  //   currentData：当月天数据（按 {year,month,day} 匹配标记，month 为 1 基的近似口径）；
  //   preData/nextData：相邻月数据，只记条数（本实现不显示相邻月格子）；
  //   onRequestData：挂载/翻月时回调 currentYearMonth（'YYYY-MM' 字符串——近似口径）；
  //   needSlide：显示 ‹ › 翻月按钮（真机是手势滑动，DOM 近似为按钮）；
  //   direction：Axis 竖排（周头条在上）/ 横排（周头条在左）；运行时全局 Axis 的取值是
  //     'vertical'/'horizontal' 字符串（layout.js），SDK 枚举是 0/1，两者都认。
  const CAL_WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

  /** @param {any} v @returns {Date} */
  function calToDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const m = v.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
    }
    return new Date();
  }

  /** @param {Date} d @returns {string} */
  function calKeyOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** @param {Date} d @returns {string} */
  function calMonthKeyOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** @param {HTMLElement} c @param {any} s */
  function calApplyTextStyle(c, s) {
    if (!s || typeof s !== 'object') return;
    // CalendarDayStyle 近似字段面：dayColor/dayFontSize/dayFontWeight/dayFontFamily 作用到
    // 【公历】文本；lunarColor 等 Lunar 系字段没有对应渲染物（本实现不排农历），只落 data-*
    if (s.dayColor !== undefined) c.style.color = colorOf(s.dayColor);
    if (s.dayFontSize !== undefined) c.style.fontSize = toCssSize(s.dayFontSize);
    if (s.dayFontWeight !== undefined) c.style.fontWeight = String(resolveResource(s.dayFontWeight));
    if (s.dayFontFamily !== undefined) c.style.fontFamily = String(resolveResource(s.dayFontFamily));
    if (s.lunarColor !== undefined) (/** @type {any} */ (c)).__lunarColor = colorOf(s.lunarColor);
  }

  /** @param {any} st */
  function calSchedule(st) {
    if (st.scheduled) return;
    st.scheduled = true;
    Promise.resolve().then(() => {
      st.scheduled = false;
      calRender(st);
    });
  }

  /** @param {any} st */
  function calRender(st) {
    const el = st.el;
    const anchor = st.anchor;
    const y = anchor.getFullYear();
    const m = anchor.getMonth();

    // 头部：‹ YYYY-MM ›（needSlide=false 时隐藏按钮）
    const label = el.querySelector('[data-cal-month]');
    if (label) label.textContent = calMonthKeyOf(anchor);
    const prevBtn = el.querySelector('[data-cal-prev]');
    const nextBtn = el.querySelector('[data-cal-next]');
    if (prevBtn) (/** @type {HTMLElement} */ (prevBtn)).style.display = st.needSlide ? '' : 'none';
    if (nextBtn) (/** @type {HTMLElement} */ (nextBtn)).style.display = st.needSlide ? '' : 'none';

    // 周头条（按 startOfWeek 旋起）；横排方向时整条变竖列
    const weeksEl = /** @type {HTMLElement} */ (el.querySelector('[data-cal-weeks]'));
    weeksEl.textContent = '';
    weeksEl.style.display = st.horizontal ? 'flex' : 'grid';
    if (!st.horizontal) {
      weeksEl.style.gridTemplateColumns = 'repeat(7, 1fr)';
    }
    for (let k = 0; k < 7; k++) {
      const wd = (st.startOfWeek + k) % 7;
      const c = document.createElement('div');
      c.setAttribute('data-cal-week', String(wd));
      c.textContent = CAL_WEEK_CN[wd];
      c.style.textAlign = 'center';
      calApplyTextStyle(c, st.styles.weekStyle);
      weeksEl.appendChild(c);
    }

    // 日格：首列按 startOfWeek 对齐；前导补空位；选中/今天/休息日/已登记数据落 data-*
    const gridEl = /** @type {HTMLElement} */ (el.querySelector('[data-cal-grid]'));
    gridEl.textContent = '';
    gridEl.style.display = 'grid';
    gridEl.style.gridTemplateColumns = 'repeat(7, 1fr)';
    const first = new Date(y, m, 1);
    const lead = (first.getDay() - st.startOfWeek + 7) % 7;
    for (let p = 0; p < lead; p++) {
      const pad = document.createElement('div');
      pad.setAttribute('data-cal-pad', String(p));
      gridEl.appendChild(pad);
    }
    const days = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    const tKey = calKeyOf(today);
    // currentData 的标记索引（近似口径：{year,month,day}，month 为 1 基）
    /** @type {Record<string, any>} */
    const marks = {};
    for (const e of (st.dataCur || [])) {
      if (e && typeof e === 'object' && e.year !== undefined && e.day !== undefined) {
        const key = Number(e.year) + '-' + String(Number(e.month || (m + 1))).padStart(2, '0')
          + '-' + String(Number(e.day)).padStart(2, '0');
        marks[key] = e;
      }
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const key = calKeyOf(date);
      const c = document.createElement('div');
      c.setAttribute('data-cal-day', String(d));
      c.setAttribute('data-date', key);
      c.textContent = String(d);
      c.style.textAlign = 'center';
      c.style.cursor = 'pointer';
      const wd = date.getDay();
      if (st.offDays.indexOf(wd) >= 0) {
        c.setAttribute('data-off-day', 'true');
        calApplyTextStyle(c, st.styles.workStateStyle);
      } else {
        calApplyTextStyle(c, st.styles.currentDayStyle);
      }
      if (key === tKey) {
        c.setAttribute('data-today', 'true');
        calApplyTextStyle(c, st.styles.todayStyle);
      }
      if (st.selected && calKeyOf(st.selected) === key) c.setAttribute('data-selected', 'true');
      if (marks[key]) {
        c.setAttribute('data-marked', 'true');
        const mk = marks[key].mark || (marks[key].status && marks[key].status.mark);
        if (mk !== undefined && mk !== null) c.setAttribute('data-mark', String(mk));
      }
      c.addEventListener('click', () => {
        st.selected = date;
        calMarkSelection(st);
        const cb = st.cbs.select;
        if (typeof cb === 'function') {
          try { cb(new Date(y, m, d)); } catch (e) {
            layoutWarnings.push(`Calendar.onSelectChange 抛错：${e && e.message}`);
          }
        }
      });
      gridEl.appendChild(c);
    }
    el.dataset.currentCount = String(st.dataCur ? st.dataCur.length : 0);
    if (!st.requested) {
      st.requested = true;
      const cb = st.cbs.request;
      if (typeof cb === 'function') {
        try { cb(calMonthKeyOf(anchor)); } catch (e) {
          layoutWarnings.push(`Calendar.onRequestData 抛错：${e && e.message}`);
        }
      }
    }
  }

  /** @param {any} st */
  function calMarkSelection(st) {
    const gridEl = st.el.querySelector('[data-cal-grid]');
    if (!gridEl) return;
    const sel = st.selected ? calKeyOf(st.selected) : null;
    [...gridEl.children].forEach((/** @type {any} */ c) => {
      if (c.getAttribute('data-cal-day') === null) return;
      const on = sel !== null && c.getAttribute('data-date') === sel;
      if (on) c.setAttribute('data-selected', 'true');
      else c.removeAttribute('data-selected');
    });
  }

  /** @param {any} st @param {number} delta */
  function calShiftMonth(st, delta) {
    const a = st.anchor;
    st.anchor = new Date(a.getFullYear(), a.getMonth() + delta, 1);
    calRender(st);
    const cb = st.cbs.request;
    if (typeof cb === 'function') {
      try { cb(calMonthKeyOf(st.anchor)); } catch (e) {
        layoutWarnings.push(`Calendar.onRequestData 抛错：${e && e.message}`);
      }
    }
  }

  // 应用 create 选项 / 属性共用的入口（键面与 calendar.json 一致 + selected/lunar 等别名）
  /** @param {any} st @param {any} o */
  function applyCalOptions(st, o) {
    if (!o || typeof o !== 'object') return;
    if (o.date !== undefined || o.selected !== undefined) {
      const d = calToDate(o.date !== undefined ? o.date : o.selected);
      st.anchor = new Date(d.getFullYear(), d.getMonth(), 1);
      st.selected = d;
    }
    if (o.showLunar !== undefined) {
      st.showLunar = !!o.showLunar;
      if (st.showLunar && !st.warnedLunar) {
        st.warnedLunar = true;
        // 如实：农历换算没有实现，showLunar=true 只落标记、不排农历文本
        layoutWarnings.push('Calendar.showLunar 已记录，但本实现不排农历文本（无农历换算）');
      }
    }
    if (o.startOfWeek !== undefined) {
      st.startOfWeek = Math.min(6, Math.max(0, Math.floor(Number(resolveResource(o.startOfWeek)) || 0)));
    }
    if (o.offDays !== undefined) {
      st.offDays = Array.isArray(o.offDays) ? o.offDays.map((/** @type {any} */ x) => Number(x) % 7) : [];
    }
    if (o.onSelectChange !== undefined) st.cbs.select = o.onSelectChange;
    if (o.onRequestData !== undefined) st.cbs.request = o.onRequestData;
    if (o.currentData !== undefined) st.dataCur = Array.isArray(o.currentData) ? o.currentData : [];
    if (o.preData !== undefined) {
      st.el.dataset.preCount = String(Array.isArray(o.preData) ? o.preData.length : 0);
    }
    if (o.nextData !== undefined) {
      st.el.dataset.nextCount = String(Array.isArray(o.nextData) ? o.nextData.length : 0);
    }
    if (o.needSlide !== undefined) st.needSlide = !!o.needSlide;
    if (o.showHoliday !== undefined) {
      st.showHoliday = !!o.showHoliday;
      if (st.showHoliday && !st.warnedHoliday) {
        st.warnedHoliday = true;
        layoutWarnings.push('Calendar.showHoliday 已记录，但本实现无节假日数据，不显示节假日名');
      }
    }
    if (o.direction !== undefined) st.horizontal = isHorizontalAxis(o.direction);
    const styleKeys = ['currentDayStyle', 'nonCurrentDayStyle', 'todayStyle', 'weekStyle', 'workStateStyle'];
    for (const k of styleKeys) {
      if (o[k] !== undefined) st.styles[k] = o[k];
    }
    calSchedule(st);
  }

  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const CALGRID_ATTRS = {
    date: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { date: v });
    },
    showLunar: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { showLunar: v });
      n.dataset.showLunar = String(!!v);
    },
    startOfWeek: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { startOfWeek: v });
    },
    offDays: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { offDays: v });
    },
    onSelectChange: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) st.cbs.select = v;
    },
    onRequestData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) st.cbs.request = v;
    },
    currentData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { currentData: v });
    },
    preData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { preData: v });
    },
    nextData: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { nextData: v });
    },
    needSlide: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) {
        st.needSlide = !!v;
        calSchedule(st);
      }
      n.dataset.needSlide = String(!!v);
    },
    showHoliday: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { showHoliday: v });
      n.dataset.showHoliday = String(!!v);
    },
    direction: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) {
        st.horizontal = isHorizontalAxis(v);
        n.dataset.direction = st.horizontal ? 'horizontal' : 'vertical';
        calSchedule(st);
      }
    },
    currentDayStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { currentDayStyle: v });
    },
    nonCurrentDayStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { nonCurrentDayStyle: v });
    },
    todayStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { todayStyle: v });
    },
    weekStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { weekStyle: v });
    },
    workStateStyle: (n, v) => {
      const st = (/** @type {any} */ (n)).__calgrid;
      if (st) applyCalOptions(st, { workStateStyle: v });
    },
  };

  /** @param {any[]} args */
  const Calendar = ensureComponent('Calendar', (args) => {
    const el = document.createElement('div');
    (/** @type {any} */ (el)).__arkuiCalendar = true;
    el.dataset.calendar = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    const st = /** @type {any} */ (el).__calgrid = /** @type {any} */ ({
      el,
      anchor: new Date(),
      selected: null,
      startOfWeek: 0,
      offDays: [],
      showLunar: false, showHoliday: false, needSlide: true,
      horizontal: false,
      dataCur: [],
      styles: {},
      cbs: {},
      scheduled: false, requested: false,
      warnedLunar: false, warnedHoliday: false,
    });

    const head = document.createElement('div');
    head.setAttribute('data-cal-head', '');
    head.style.display = 'flex';
    head.style.flexDirection = 'row';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'center';
    head.style.gap = '8px';
    const prev = document.createElement('div');
    prev.setAttribute('data-cal-prev', '');
    prev.textContent = '‹';
    prev.style.cursor = 'pointer';
    prev.addEventListener('click', () => calShiftMonth(st, -1));
    const label = document.createElement('div');
    label.setAttribute('data-cal-month', '');
    const next = document.createElement('div');
    next.setAttribute('data-cal-next', '');
    next.textContent = '›';
    next.style.cursor = 'pointer';
    next.addEventListener('click', () => calShiftMonth(st, 1));
    head.appendChild(prev);
    head.appendChild(label);
    head.appendChild(next);
    el.appendChild(head);

    const body = document.createElement('div');
    body.setAttribute('data-cal-body', '');
    body.style.display = 'flex';
    body.style.flexDirection = 'row';
    body.style.gap = '4px';
    const weeks = document.createElement('div');
    weeks.setAttribute('data-cal-weeks', '');
    weeks.style.flex = 'none';
    const grid = document.createElement('div');
    grid.setAttribute('data-cal-grid', '');
    grid.style.flex = '1 1 auto';
    body.appendChild(weeks);
    body.appendChild(grid);
    el.appendChild(body);

    applyCalOptions(st, args && args[0]);
    return el;
  }, (/** @type {any} */ node, /** @type {any} */ args) => {
    const st = (/** @type {any} */ (node)).__calgrid;
    if (st) applyCalOptions(st, args && args[0]);
  });

  // ════════════════════ 安装全局 ════════════════════
  // 产物里这些名字是【自由变量】引用（不走 import）。registerGeneratedComponents 只给
  // 【生成骨架】装全局；手写组件如果只进 components 注册表而不上 global，页面一跑就是
  // ReferenceError —— 所以这里按 main.js Object.assign 的同一口径自己装上。
  (/** @type {any} */ (global)).Calendar = Calendar;
  (/** @type {any} */ (global)).ContainerReader = ContainerReader;
  (/** @type {any} */ (global)).IndicatorComponent = IndicatorComponent;
  (/** @type {any} */ (global)).IndicatorComponentController = IndicatorComponentController;
  (/** @type {any} */ (global)).MenuItemGroup = MenuItemGroup;
  (/** @type {any} */ (global)).Repeat = Repeat;
  (/** @type {any} */ (global)).WithTheme = WithTheme;
