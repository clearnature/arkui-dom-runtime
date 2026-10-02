  // ────────────────── 状态管理 v2（@ComponentV2 等）──────────────────
  //
  // V1 与 V2 的机制【根本不同】，这点必须先说清：
  //   V1: 产物把状态包成对象 —— this.__theme = new ObservedPropertySimplePU(...)
  //       → 观测能力由【状态类】提供，值藏在包装对象里。
  //   V2: 产物保留装饰器，编译成
  //         __decorate([Local], V2.prototype, "count", void 0)
  //       状态存【裸字段】，观测能力由【装饰器函数】提供（在原型上装访问器）。
  //
  // 所以 V2 不是"再加几个状态类"，而是要【实现装饰器层】。TS 4.9 的 __decorate 助手
  // 决定了各装饰器的调用形态（已实测，见 docs/ARCHITECTURE.md §3.4）：
  //   属性   __decorate([Param],  Proto, "label", void 0) → Param(Proto, "label", undefined)
  //   方法   __decorate([Monitor('inner')], Proto, "cb", null)
  //          → desc=null 时助手会取真实描述符 → Monitor('inner')(Proto, "cb", methodDesc)
  //   访问器 __decorate([Computed], Proto, "doubled", null) → 拿到 {get,...}，可返回改写后的
  //   类     __decorate([ObservedV2], Cls) → 只有 1 个实参 → ObservedV2(Cls)，必须【返回类】
  //
  // 为什么装饰器不挂 global：`Event` 既是装饰器名也是浏览器全局，挂上去会把 window.Event
  // 覆盖掉（test/lazy.html 等页面脚本在用 new Event）。R38 再进一步：IIFE 【内部】的装饰器
  // 绑定也不能叫 Event（会遮蔽 Scroller 的 new Event，见下方 EventDeco 处的说明）。
  // 改为导出装饰器表 __arkui_dom_decorators，
  // 由 tools/extract.mjs 在产物里生成【作用域内】的绑定前奏（只绑实际用到的名字）。

  const v2InstCells = new WeakMap();   // 任意对象 -> Map<字段名, 依赖单元>（复用 propDeps 机制）
  const v2ProtoMeta = new WeakMap();   // 原型 -> {observed, consumers, providers, monitors, computed}

  // 依赖单元的粒度是【实例 × 字段】。若按原型共享，同类多实例会互相触发多余重渲染。
  /** @param {any} inst @param {string} key */
  function v2Cell(inst, key) {
    let m = v2InstCells.get(inst);
    if (!m) v2InstCells.set(inst, (m = new Map()));
    let c = m.get(key);
    if (!c) m.set(key, (c = { __v2: true, __name: key }));
    return c;
  }

  /** @param {any} proto */
  function v2Info(proto) {
    let i = v2ProtoMeta.get(proto);
    if (!i) {
      v2ProtoMeta.set(proto, (i = {
        observed: new Set(), consumers: new Map(), providers: new Map(),
        monitors: new Map(), computed: new Set(),
      }));
    }
    return i;
  }

  // 沿原型链汇总（子类能继承装饰器信息，与 ArkUI 一致）
  /** @param {any} inst @param {(info: any, out: any[]) => void} pick @param {any[]=} [out] */
  function v2Collect(inst, pick, out = []) {
    for (let p = Object.getPrototypeOf(inst); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      const info = v2ProtoMeta.get(p);
      if (info) pick(info, out);
    }
    return out;
  }

  // 字段存储的隐藏槽。名字带前缀避免与产物的其它字段撞车。
  /** @param {string} key */
  const v2Slot = (key) => '__v2slot_' + key;

  // ── W2：@Computed 缓存 ──
  // 真机权威语义（state_mgmt/src/lib/v2/v2_computed.ts）：
  //   · InitRun 把 getter 换成「读缓存 ___comp_cached_<prop> + addRef(computedId)」（:59-77）
  //   · 依赖变更 → fireChange() 立即重算；值【变了】才 fireChange(prop) 驱动视图（:79-86）
  //   · 求值期 startRecordDependencies(computedId)：内部读取记到 computed 名下、不记 elmtId（:105-122）
  //   · resetComputed 重算并回写缓存（:151-159）——@Reusable 出池链按名调用它（v2_view.ts:242）
  // 本实现：缓存单元 rec={inst,key,fn,value,valid,deps,computing}。
  //   · 依赖收集复用 v2 访问器的读取点：rec 求值期间 v2ComputedRecording 指向它，
  //     installV2Accessor.get() 把读到的 cell 记进 rec.deps，并反注册到 v2CellComputedRecs；
  //   · 写路径命中 v2CellComputedRecs → 立即重算 → 值变了 markDependentsDirty(computed 的 cell)
  //     并递归传播给依赖它的上层 @Computed（链式失效）。
  const v2ComputedRecs = new WeakMap();       // inst -> Map<字段名, rec>
  const v2CellComputedRecs = new WeakMap();   // 依赖 cell -> Set<rec>（写路径的反向索引）
  /** @type {any} */ let v2ComputedRecording = null;   // 正在求值的 rec（真机 startRecordDependencies 窗口）

  /** @param {any} inst @param {string} key @param {function(): any} fn */
  function v2ComputedRecOf(inst, key, fn) {
    let m = v2ComputedRecs.get(inst);
    if (!m) v2ComputedRecs.set(inst, (m = new Map()));
    let rec = m.get(key);
    if (!rec) m.set(key, (rec = { inst, key, fn, value: undefined, valid: false, deps: new Set(), computing: false }));
    return rec;
  }

  /** @param {any} rec @param {any} cell */
  function v2AddComputedDep(rec, cell) {
    rec.deps.add(cell);
    let s = v2CellComputedRecs.get(cell);
    if (!s) v2CellComputedRecs.set(cell, (s = new Set()));
    s.add(rec);
  }

  /** @param {any} rec */
  function v2DropComputedDeps(rec) {
    for (const cell of rec.deps) { const s = v2CellComputedRecs.get(cell); if (s) s.delete(rec); }
    rec.deps.clear();
  }

  // 重算并刷新依赖（真机 observeObjectAccess，v2_computed.ts:105）。求值期间屏蔽 elmtId 依赖
  //（内部读取只归 computed），这是链式 @Computed（A 读 B）不把渲染依赖记串的关键。
  /** @param {any} rec */
  function v2RunComputedRec(rec) {
    if (rec.computing) {
      // 真机无环保护（会直接栈溢出）；这里保旧值兜底并告警
      layoutWarnings.push(`@Computed '${rec.key}' 循环依赖，返回上次缓存值`);
      rec.valid = true;
      return rec.value;
    }
    v2DropComputedDeps(rec);
    rec.computing = true;
    const savedRec = v2ComputedRecording;
    const savedElmt = currentNodeElmtId;
    v2ComputedRecording = rec;
    currentNodeElmtId = null;
    try { rec.value = rec.fn.call(rec.inst); rec.valid = true; }
    finally { v2ComputedRecording = savedRec; currentNodeElmtId = savedElmt; rec.computing = false; }
    return rec.value;
  }

  // 依赖写 → 相关 @Computed 立即重算（真机 ComputedV2.fireChange，v2_computed.ts:79）。
  // 真机在「复用窗口期」把变更通知抑制入队、出池收尾一次性冲刷（v2_change_observation.ts:727,735）；
  // DOM 运行时的重渲染本就是微任务批量 flush（markDirty→Promise.then→flush），等价达成，
  // 不需要额外的抑制窗口。
  /** @param {any} cell */
  function v2InvalidateComputeds(cell) {
    const recs = v2CellComputedRecs.get(cell);
    if (!recs || !recs.size) return;
    for (const rec of [...recs]) {
      const old = rec.valid ? rec.value : undefined;
      try { v2RunComputedRec(rec); } catch (e) {
        // 真机会把异常抛给应用（v2_computed.ts:112-115 rethrow）；这里发生在【写路径】上，
        // 抛出去会炸掉整条赋值语句，故降级：告警 + 保持失效（下次读取重试重算）。
        rec.valid = false;
        layoutWarnings.push(`@Computed '${rec.key}' 重算抛错：${e && e.message}`);
        continue;
      }
      if (Object.is(old, rec.value)) continue;
      markDependentsDirty(v2Cell(rec.inst, rec.key));      // 读过它的 elmtId 重渲染
      v2InvalidateComputeds(v2Cell(rec.inst, rec.key));    // 链式：A 依赖 B，B 变 → A 失效重算
    }
  }

  // ── W3：@Monitor 点分路径（items.0.name 这样的嵌套路径）──
  // 真机权威语义（state_mgmt/src/lib/v2/v2_monitor.ts 的 MonitorV2）：
  //   · 每条声明路径 init 时【逐段走读】并登记依赖（analysisProp，:520-531）；before=now 不标脏（:104-112）
  //   · 路径上任一环变更 → 整个监视器重走全部路径取 now，与上次值比对；
  //     dirty =【变化了的声明路径】，一个方法一次回调收全量（bindRun :500-516；dirty :347-355）
  //   · 曾可访问后断链也判 dirty（setNotFound，:127-134）
  //   · 复用时 notifyChangeOnReuse → bindRun(true) 重快照（:490-492）
  // 本实现：bind 在 finalizeConstruction（首建）/ resetMonitorsOnReuse（复用）时做——沿声明路径
  // 逐段 v2Cell(obj, seg) 注册监视器（首段=视图字段、尾段=@Trace 字段，写入都经过 v2.js 的
  // 访问器 set，正好是通知点）；set() 里 v2NotifyPathMonitors(cell) 重评估并聚合回调。
  // 简化（与真机的差异）：数组【元素替换】arr[0]=x 不经过任何访问器——已由下方 W5 的
  // @Trace 数组容器代理补齐（通知点与字段写入相同）；元素【字段】写入（arr[0].name=x）
  // 走 @Trace 访问器，正常感知。真机靠容器代理连元素替换也观测。
  const v2CellPathMonitors = new WeakMap();   // 依赖 cell -> Set<mr>
  const v2InstPathMonitors = new WeakMap();   // inst -> Set<mr>（解绑用）

  /** @param {any} cell @param {any} mr */
  function v2AddCellPathMonitor(cell, mr) {
    let s = v2CellPathMonitors.get(cell);
    if (!s) v2CellPathMonitors.set(cell, (s = new Set()));
    s.add(mr);
    mr.cells.push(cell);
  }

  /** @param {any} inst @param {string[]} segs 真机 analysisProp：逐段 Reflect.has + 取值 */
  function v2WalkPath(inst, segs) {
    let obj = inst;
    for (let i = 0; i < segs.length; i++) {
      if (obj === null || obj === undefined ||
          (typeof obj !== 'object' && typeof obj !== 'function') ||
          !Reflect.has(obj, segs[i])) return { ok: false, value: undefined };
      obj = obj[segs[i]];
    }
    return { ok: true, value: obj };
  }

  // 沿声明路径逐段注册监视 cell（bind 与每次 fire 后重走共用）。真机每次 bindRun 都重跑
  // analysisProp 重登记依赖（v2_monitor.ts:520-531）——元素替换后若不重登记，尾段 cell 就永远
  // 落在旧元素上，新元素的 @Trace 字段写入无法唤醒本监视器（v2sem W5 回归案）。
  /** @param {any} mr @returns {{ok: boolean, value: any}} value=走读终点（断链时 undefined） */
  function v2RegisterMonitorSegs(mr) {
    for (const cell of mr.cells) { const s = v2CellPathMonitors.get(cell); if (s) s.delete(mr); }
    mr.cells.length = 0;
    let obj = mr.inst;
    let ok = true;
    for (let i = 0; i < mr.segs.length; i++) {
      const seg = mr.segs[i];
      if (obj === null || obj === undefined ||
          (typeof obj !== 'object' && typeof obj !== 'function') || !Reflect.has(obj, seg)) { ok = false; break; }
      v2AddCellPathMonitor(v2Cell(obj, seg), mr);   // 每一段的写入都要能唤醒本监视器
      obj = obj[seg];
    }
    return { ok, value: ok ? obj : undefined };
  }

  // 绑定（或复用时重绑）inst 上声明的全部点分路径：逐段注册 + 走读快照
  /** @param {any} inst */
  function v2BindMonitorPaths(inst) {
    v2UnbindMonitorPaths(inst);
    let mrs = v2InstPathMonitors.get(inst);
    if (!mrs) v2InstPathMonitors.set(inst, (mrs = new Set()));
    const dotted = v2Collect(inst, (/** @type {any} */ info, /** @type {any[]} */ out) => {
      for (const [k, s] of info.monitors) {
        if (k.indexOf('.') >= 0) for (const m of s) out.push([k, m]);
      }
    });
    for (const [path, method] of dotted) {
      const mr = { inst, method, path, segs: path.split('.'), last: undefined, valid: false, cells: [] };
      const savedElmt = currentNodeElmtId;
      currentNodeElmtId = null;              // 路径走读不记 elmtId 依赖（真机 start/stopRecordDependencies 隔离）
      try {
        const r = v2RegisterMonitorSegs(mr);
        mr.valid = r.ok;
        mr.last = r.value;                     // initRun：before=now，不标脏（真机 setValue(true,·)，:104-112）
      } finally { currentNodeElmtId = savedElmt; }
      mrs.add(mr);
    }
  }

  /** @param {any} inst */
  function v2UnbindMonitorPaths(inst) {
    const mrs = v2InstPathMonitors.get(inst);
    if (!mrs) return;
    for (const mr of mrs) {
      for (const cell of mr.cells) { const s = v2CellPathMonitors.get(cell); if (s) s.delete(mr); }
      mr.cells.length = 0;
    }
    mrs.clear();
  }

  // 写路径通知：重评估注册在该 cell 上的全部路径监视器，dirty 的按 (inst, method) 聚合，
  // 一个方法一次回调收全量 dirty（对齐真机 MonitorV2.values_ 聚合语义，:347-355）。
  /** @param {any} cell */
  function v2NotifyPathMonitors(cell) {
    const mrs = v2CellPathMonitors.get(cell);
    if (!mrs || !mrs.size) return;
    const seen = new Set();                    // 一次写入可能命中同一 mr 的多个段 cell → 去重
    const fires = new Map();                   // method -> {inst, entries[]}
    for (const mr of [...mrs]) {
      if (seen.has(mr)) continue;
      seen.add(mr);
      const savedElmt = currentNodeElmtId;
      currentNodeElmtId = null;                // 重走路径的读取不记渲染依赖
      let entry;
      try {
        const r = v2WalkPath(mr.inst, mr.segs);
        const dirty = mr.valid ? !Object.is(mr.last, r.value) : true;   // 断链恢复也算 dirty（setNotFound）
        entry = { path: mr.path, before: mr.valid ? mr.last : undefined, now: r.value, dirty };
        mr.last = r.value;
        mr.valid = r.ok;                       // 回调后 before=now（真机 resetMonitor，:495-497）
        v2RegisterMonitorSegs(mr);             // fire 后重登记段 cell（真机 bindRun 重跑 analysisProp）——
                                               // 元素替换后尾段随路径落到新元素，后续字段写才能继续唤醒
      } finally { currentNodeElmtId = savedElmt; }
      if (!entry.dirty) continue;
      let f = fires.get(mr.method);
      if (!f) fires.set(mr.method, (f = { inst: mr.inst, entries: [] }));
      f.entries.push(entry);
    }
    for (const [method, f] of fires) v2FirePathMonitor(f.inst, method, f.entries);
  }

  // ── W5：@Trace 数组容器代理（元素替换 arr[0]=x / 变异方法感知，R159-B）──
  // 补齐上方 W3 块注释里的已知简化。真机权威语义（v2_observed_proxy.ts 的 ArrayProxyHandler）：
  //   · 整数索引写入 set()：target[key]===value 跳过；否则 fireChange(target, key)——监视器靠
  //     MonitorV2.OB_ANY（v2_change_observation.ts:697 命中汇入）醒来 → bindRun 重走路径比对，
  //     路径值【没变就不发】（push 后 items.0.name 不误发、splice 挪位后变化会发）。
  //   · 长度变异方法 push/pop/shift/splice/unshift 与原位变异 copyWithin/fill/reverse/sort：
  //     get() 里包一层，调完 fireChange(OB_LENGTH) 一次性通知（真机 arrayLengthChangingFunctions/
  //     arrayMutatingFunctions 两张表；shrinkTo/extendTo 是 collection.Array API，_plain Array 无），
  //     调用直接打在 target 上——内部逐索引写【不再】二次进 set 拦截，一次方法调用恰好一条通知。
  //   · 代理在集合首次被读取时创建并【写回 target[key]】缓存（autoProxyObject，防双包）。
  // DOM 运行时没有真机的 SYMBOL_REFS 依赖登记面，两路变更统一收敛到【与字段写入相同的通知点】
  //（通知字段 cell：markDependentsDirty → v2InvalidateComputeds → v2NotifyPathMonitors）：
  //   · 渲染依赖记在 items 字段 cell 上（installV2Accessor get 的 recordDep），通知它恰好覆盖
  //     全部读方；@Computed 依赖同样登记在该 cell。
  //   · 点分路径监视器（W3）逐段注册时首段就是字段 cell，通知它即重走全路径 + 比对——精确
  //     dirty 判定由既有 v2NotifyPathMonitors 给出，索引 cell（v2Cell(代理,'0')）无人依赖，不通知。
  const V2_ARRAY_MUTATING_FNS = new Set(['copyWithin', 'fill', 'reverse', 'sort']);
  const V2_ARRAY_LEN_CHANGING_FNS = new Set(['push', 'pop', 'shift', 'splice', 'unshift']);
  const v2ArrayProxies = new WeakMap();        // 原始数组 -> {proxy, owners:[{inst,key}]}
  // 性能取舍：代理【惰性且缓存】——只在 @Trace 字段 get 到数组时包一次，按原始数组存 WeakMap
  // 复用同一代理（身份稳定：=== / instanceof / Map 键不受影响；真机同样只在读取时包）。
  // 非数组字段与非 @Trace 字段零开销；已包过的数组再读只是一次 WeakMap 查找。
  /** @param {any} raw @param {any} inst @param {string} key */
  function v2ArrayProxyOf(raw, inst, key) {
    let e = v2ArrayProxies.get(raw);
    if (!e) v2ArrayProxies.set(raw, (e = { proxy: null, owners: [] }));
    if (!e.owners.some((/** @type {any} */ o) => o.inst === inst && o.key === key)) {
      e.owners.push({ inst, key });            // 同一数组被多个 @Trace 字段引用时逐一通知（幂等登记）
    }
    if (e.proxy) return e.proxy;
    const notify = () => {
      for (const o of e.owners) {
        const cell = v2Cell(o.inst, o.key);
        markDependentsDirty(cell);
        v2InvalidateComputeds(cell);
        v2NotifyPathMonitors(cell);
      }
    };
    e.proxy = new Proxy(raw, {
      /** @param {any} target @param {string|symbol} prop @param {any} v @param {any} receiver */
      set(target, prop, v, receiver) {
        if (prop === 'length') {
          const before = target.length;
          const ok = Reflect.set(target, prop, v, receiver);
          if (ok && target.length !== before) notify();   // 长度收缩在此一次性通知（元素级删除不逐个发）
          return ok;
        }
        const before = target[/** @type {string} */ (prop)];
        const ok = Reflect.set(target, prop, v, receiver);
        if (ok && !Object.is(before, v) && typeof prop === 'string' && /^(0|[1-9]\d*)$/.test(prop)) notify();
        return ok;
      },
      /** @param {any} target @param {string|symbol} prop */
      deleteProperty(target, prop) {
        const ok = Reflect.deleteProperty(target, prop);
        // 真机无 delete 拦截（语义超集记档）：delete arr[0] 也感知
        if (ok && typeof prop === 'string' && /^(0|[1-9]\d*)$/.test(prop)) notify();
        return ok;
      },
      /** @param {any} target @param {string|symbol} prop @param {any} receiver */
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== 'function') return v;   // 元素/length 透传：返回【原始元素引用】，元素上的
                                                 // @ObservedV2/@Trace 访问器原样生效（arr[0].name=x 回归保障）
        const k = /** @type {string} */ (prop);
        if (V2_ARRAY_MUTATING_FNS.has(k)) {
          return (/** @param {...any} args */ function (...args) {   // 真机返回 receiver：链式调用继续落在代理上
            const r = v.apply(target, args);
            notify();
            return receiver;
          });
        }
        if (V2_ARRAY_LEN_CHANGING_FNS.has(k)) {
          return (/** @param {...any} args */ function (...args) {
            const r = v.apply(target, args);
            notify();
            return r;
          });
        }
        return v;                                // 其余方法原样返回：以代理为 this 调用时内部索引写仍走 set 拦截
      },
    });
    return e.proxy;
  }

  /** @param {any} inst @param {string} method @param {any[]} entries */
  function v2FirePathMonitor(inst, method, entries) {
    const fn = inst[method];
    if (typeof fn !== 'function') { layoutWarnings.push(`@Monitor('${entries[0].path}') 找不到方法 '${method}'`); return; }
    const monitor = {
      dirty: entries.map((/** @type {any} */ e) => e.path),
      /** @param {string=} [path] */
      value(path) {
        if (path === undefined) {
          const d = entries.find((/** @type {any} */ e) => e.dirty);
          return d ? { before: d.before, now: d.now, path: d.path } : undefined;
        }
        const e = entries.find((/** @type {any} */ x) => x.path === path);
        return e ? { before: e.before, now: e.now, path: e.path } : undefined;
      },
    };
    try { fn.call(inst, monitor); }
    catch (e) { layoutWarnings.push(`@Monitor('${entries[0].path}') → ${method} 抛错：${e && e.message}`); }
  }

  // ── W1：@Reusable / @ReusableV2 复用池 ──
  // 真机权威语义（按真机调研简报对齐，全部带出处）：
  //   · 池键：构造函数稳定 id + reuseId，buildKey = ctorKey__reuseId（puv2_globalreuse.ts:127-134、
  //     454-464）。DOM 运行时拿得到 constructor，直接以【构造函数引用】为桶键（等价且天然无
  //     同名冲突）；产物创建调用目前不传 reuseId，全部落默认桶 INTERNAL_DEFAULT。
  //   · 生命周期：入池 aboutToRecycle() → 冻结 → 子树递归 recycle → push（v2_view.ts:303-320、
  //     198-204）；出池 pop（LIFO 取尾）→ resetStateVarsOnReuse(params) → unfreeze →
  //     aboutToReuse()（v2_view.ts:238-247）。冻结在 DOM 运行时退化为 no-op（无渲染线程可停）；
  //     子树递归由 purgeDetachedRecords 对每条 elmtRecord 独立扫描达成（子组件各自入池）。
  //   · 池容量：默认 100、硬上限 200、负值截 0；满则拒绝入池=真销毁（puv2_globalreuse.ts:
  //     68-69、579-585、549-554）。出池取尾部 LIFO（:260-262、616）。
  //   · 入池挂点：purgeDetachedRecords 是自定义组件离开 DOM 的唯一收口（if/else 分支切换、
  //     ForEach 重建、路由 clearRoot 都走它）——v2.js 内包装它扫描入池，不改 main.js（文件末尾）。
  //   · 出池挂点：产物以 `new Child(...)` 直接构造（冻结产物，无法外拦），ViewV2 构造器
  //     【返回池实例】即可替换派生构造的 this（JS 语言语义），随后的派生构造体（initParam/
  //     字段赋值/finalizeConstruction）全部落在旧实例上——等效真机「pop 池 → reset → 不走 new」
  //     （v2_view.ts:1087 reuseOrCreateNewComponent 的 recycledNode 分支）。
  //   · 范围说明：本池只覆盖 V2（ViewV2 系）。V1（ViewPU 直接子类）的构造在 main.js，
  //     无法在不改该文件的前提下拦构造返回值，V1 复用留待后续（见任务报告）。
  const V2_REUSE_POOL_DEFAULT_MAX = 100;   // 真机默认桶容量（puv2_globalreuse.ts:68-69）
  const V2_REUSE_POOL_HARD_CAP = 200;      // 真机硬上限（:579-585）
  let v2ReusePoolMax = V2_REUSE_POOL_DEFAULT_MAX;
  const v2ReusePools = new Map();          // ctor -> ViewV2[]（LIFO：push 入尾、pop 取尾）
  const v2ReuseStats = { pooled: 0, reused: 0, evicted: 0 };   // 入池 / 复用 / 满拒真销毁 计数

  // 类装饰器：__decorate([Reusable], Cls)（2 实参）与 Reusable(options)(Cls) 两种形态都支持
  //（d.ts：common.d.ts:1376 Reusable、:1386 ReusableV2；options 只有 memoryOptimizationStrategy）
  /** @param {any} targetOrOptions */
  function Reusable(targetOrOptions) {
    if (typeof targetOrOptions === 'function') return v2MarkReusable(targetOrOptions, undefined);
    return (/** @param {any} target */ (target) => v2MarkReusable(target, targetOrOptions));
  }
  /** @param {any} target @param {any} options */
  function v2MarkReusable(target, options) {
    try {
      target.__arkuiIsReusable = true;
      target.__arkuiReuseOptions = options || null;
    } catch (_) { /* 冻结类等极端情况：标记失败按不复用处理 */ }
    return target;                         // 类装饰器必须返回类本身
  }

  /** @param {any} ctor 出池：LIFO 取尾（真机 popRecycleV2Component，v2_recycle_pool.ts:93-95） */
  function v2ReusePop(ctor) {
    if (!ctor || !ctor.__arkuiIsReusable) return null;
    const pool = v2ReusePools.get(ctor);
    if (!pool || !pool.length) return null;
    const inst = pool.pop();
    v2ReuseStats.reused++;
    return inst;
  }

  /** @param {any} view 入池：aboutToRecycle → push（满则拒绝=真销毁，v2_view.ts:303-320） */
  function v2RecycleChildView(view) {
    const ctor = view && view.constructor;
    if (!ctor || !ctor.__arkuiIsReusable) return false;   // 未标 @Reusable：照旧交给 GC
    if (typeof view.aboutToRecycle === 'function') {
      try { view.aboutToRecycle(); }
      catch (e) { layoutWarnings.push(`aboutToRecycle 抛错（${ctor.name}）：${e && e.message}`); }
    }
    let pool = v2ReusePools.get(ctor);
    if (!pool) v2ReusePools.set(ctor, (pool = []));
    if (pool.indexOf(view) >= 0) return true;             // 防重复入池（同实例残留多条记录时）
    if (pool.length >= v2ReusePoolMax) { v2ReuseStats.evicted++; return false; }
    pool.push(view);
    v2ReuseStats.pooled++;
    return true;
  }

  /** @param {any} proto @param {string} key @param {string} kind */
  function installV2Accessor(proto, key, kind) {
    const existing = /** @type {any} */ (Object.getOwnPropertyDescriptor(proto, key));
    if (existing && existing.get && existing.get.__v2) return;    // 已装过（重复装饰）
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: true,
      get() {
        // @Consumer：读提供者的字段。依赖由【提供者的访问器】记录，所以祖先改值
        // 会直接使后代读到它的 elmtId 变脏——不需要额外转发。
        const bind = this.__v2consumerBind && this.__v2consumerBind.get(key);
        if (bind) return bind.inst[bind.key];
        const cell = v2Cell(this, key);
        // W2：@Computed 求值期间的读取记到【该 computed 的依赖集】而不是 elmtId——
        // 对齐真机 startRecordDependencies(computedId) 的隔离（v2_computed.ts:106）。
        if (v2ComputedRecording) v2AddComputedDep(v2ComputedRecording, cell);
        else if (kind !== 'event') recordDep(cell);
        const slot = this[v2Slot(key)];
        // W5：@Trace 数组读路径包容器代理（元素替换/变异方法感知，见 W5 块注释）。
        // 仅 @Trace 深度观测开启：@Local/@Param 等维持原样（真机 autoProxyObject 对全部 V2
        // 集合都包，这里是收敛到任务范围的子集——边界记档，见 R159-B 报告）。
        if (kind === 'trace' && Array.isArray(slot)) return v2ArrayProxyOf(slot, this, key);
        return slot;
      },
      set(v) {
        const bind = this.__v2consumerBind && this.__v2consumerBind.get(key);
        if (bind) {
          // ArkUI 的 @Consumer 是单向下行数据；写它不应悄悄改掉祖先。
          layoutWarnings.push(`@Consumer 字段 '${key}' 被写入（应为只读），已忽略`);
          return;
        }
        const before = this[v2Slot(key)];
        this[v2Slot(key)] = v;
        if (kind === 'event') return;                 // @Event 只是回调槽，不参与观测
        const cell = v2Cell(this, key);
        markDependentsDirty(cell);
        if (!Object.is(before, v)) {
          v2InvalidateComputeds(cell);                // W2：依赖写 → 相关 @Computed 立即重算
          v2NotifyPathMonitors(cell);                 // W3：点分路径监视器重评估
          fireV2Monitors(this, key, v, before);
        }
      },
    });
    const d = /** @type {any} */ (Object.getOwnPropertyDescriptor(proto, key));
    d.get.__v2 = true;
    d.set.__v2 = true;
    // observed 的语义是"参与观测的字段"。@Event 只是回调槽（不记依赖、不发通知），
    // 装访问器只是为了让赋值统一走 setter —— 故不计入，否则自省会给出误导性的结论。
    if (kind !== 'event') v2Info(proto).observed.add(key);
  }

  // @Monitor 回调入参：形状取自 SDK 的权威声明
  //   <CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/common.d.ts
  //     declare interface IMonitor { dirty: Array<string>; value<T>(path?: string): IMonitorValue<T> | undefined }
  //     declare interface IMonitorValue<T> { before: T; now: T; path: string }
  // 曾经按 {dirty:[{path,value,before,kind}]} 实现，被 ArkTS 编译器当场判错
  // （"Property 'value' does not exist on type 'string'"）——所以这里以 .d.ts 为准。
  // 已知简化：一次赋值只产生一条 dirty（ArkUI 会把同一批变更合并）。W3 之后【点分路径】
  //（items.0.name 这样的嵌套路径）不再走这里——由 v2BindMonitorPaths（bind）+
  // v2NotifyPathMonitors（写路径重评估）接管，见上方 W3 块；这里只处理【无点分】的键
  //（test/v2.html 的 @Monitor('count') 用例）。
  /** @param {any} inst @param {string} key @param {any} value @param {any} before */
  function fireV2Monitors(inst, key, value, before) {
    const methods = v2Collect(inst, (info, out) => {
      const s = info.monitors.get(key);
      if (s) for (const m of s) out.push(m);
    });
    if (!methods.length) return;
    const entries = [{ path: key, now: value, before }];
    const monitor = {
      dirty: entries.map((e) => e.path),
      /** @param {string=} [path] */
      value(path) {
        const want = path === undefined ? entries[0].path : path;
        const e = entries.find((x) => x.path === want);
        return e ? { before: e.before, now: e.now, path: e.path } : undefined;
      },
    };
    for (const m of methods) {
      const fn = inst[m];
      if (typeof fn !== 'function') { layoutWarnings.push(`@Monitor 找不到方法 '${m}'`); continue; }
      try {
        fn.call(inst, monitor);
      } catch (e) {
        // 回调抛错不该让整页渲染挂掉（与 @Watch 一致的容错策略）
        layoutWarnings.push(`@Monitor('${key}') → ${m} 抛错：${e && e.message}`);
      }
    }
  }

  /** @param {string} kind */
  const v2Field = (kind) => function (/** @type {any} */ target, /** @type {any} */ key) {
    if (typeof key === 'string') installV2Accessor(target, key, kind);
    return undefined;                                  // 属性装饰器的返回值被 __decorate 忽略
  };

  const Param = v2Field('param');
  const Local = v2Field('local');
  const Once = v2Field('once');
  // ⚠️ 内部绑定名【不能】叫 Event：整个 runtime 是一个 IIFE，这里的 `const Event` 会把
  // 同作用域里 Scroller 的 `new Event('scroll')`（layout.js scrollToIndex 未渲染分支）一并
  // 遮蔽掉——IIFE 求值完成后那次 new 构造的是装饰器函数实例，dispatchEvent 直接 TypeError。
  // 该分支有 flush() 兜底所以 lazy.html 一直绿，炸点是潜伏的（R38 tsc --checkJs 抓出）。
  // 装饰器表的【键名】保持 'Event'（extract.mjs 给产物生成的作用域绑定按表键取，不受影响）。
  const EventDeco = v2Field('event');
  const Trace = v2Field('trace');

  /** @param {string=} [name] */
  const Provider = (name) => function (/** @type {any} */ target, /** @type {any} */ key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).providers.set(key, name || key);
    return undefined;
  };

  /** @param {string=} [name] */
  const Consumer = (name) => function (/** @type {any} */ target, /** @type {any} */ key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).consumers.set(key, name || key);
    return undefined;
  };

  /** @param {...string} keys */
  const Monitor = (...keys) => function (/** @type {any} */ target, /** @type {any} */ key, /** @type {any} */ desc) {
    const info = v2Info(target);
    for (const k of keys) {
      const s = info.monitors.get(k) || new Set();
      s.add(key);
      info.monitors.set(k, s);
    }
    return desc;                                       // 方法描述符原样传回
  };

  // @Computed：缓存实现（对齐真机 ComputedV2，出处见上方 W2 块的注释）。
  // 产物形态：__decorate([Computed], Proto, "doubled", null) → 助手传入真实访问器描述符，
  // 这里返回【改写后的描述符】（缓存 getter + 只读 setter），__decorate 助手会拿它
  // defineProperty 装回原型（TS 4.9：c>3 && r 时安装，见文件头注释）。
  /** @param {any} target @param {any} key @param {any} desc */
  function Computed(target, key, desc) {
    if (typeof key !== 'string') return desc;
    if (desc && typeof desc.get === 'function') {
      if (desc.get.__v2computed) return desc;            // 重复装饰：不二次包一层
      v2Info(target).computed.add(key);
      const fn = desc.get;                               // 产物写的原始计算函数
      const cachingGet = function () {
        const rec = v2ComputedRecOf(this, key, fn);
        const cell = v2Cell(this, key);
        if (v2ComputedRecording) {
          v2AddComputedDep(v2ComputedRecording, cell);   // 上层 @Computed 依赖本 @Computed（链式）
        } else if (rec.valid) {
          recordDep(cell);                               // 命中缓存：读它的 elmtId 依赖它（真机 addRef）
        }
        if (rec.valid) return rec.value;
        v2RunComputedRec(rec);                           // 首次/失效：求值并刷新依赖
        if (!v2ComputedRecording) recordDep(cell);       // 求值完成后同样补记 elmtId 依赖
        return rec.value;
      };
      cachingGet.__v2computed = true;
      return {
        get: cachingGet,
        set(/** @type {any} */ _v) {
          // 真机 @Computed 写入直接抛错（v2_computed.ts:67-71）；DOM 运行时降级为告警，
          // 避免一次误写让整页渲染挂掉。
          layoutWarnings.push(`@Computed '${key}' 是只读（真机直接抛错），写入被忽略`);
        },
        enumerable: desc.enumerable !== false,
        configurable: true,
      };
    }
    installV2Accessor(target, key, 'local');             // 容错：@Computed 用在字段上（保持旧行为）
    return desc;
  }

  // @ObservedV2 是【类装饰器】：__decorate([ObservedV2], Cls) 只有 1 个实参，
  // 助手会当成"整体替换"处理，所以必须返回这个类本身。
  /** @param {any} target */
  function ObservedV2(target) {
    v2Info(target.prototype);
    return target;
  }

  class ViewV2 extends ViewPU {
    // 注意产物调用的是 super(parent, elmtId, extraInfo) —— 比 ViewPU 少一个
    // __localStorage。这里补上 undefined 以复用 ViewPU 的全部机制。
    //
    // W1 出池挂点：@Reusable 类的池里有存货时，构造器【返回池实例】——JS 语言语义下
    // 派生构造函数的 this 会被替换成返回值，产物 `new Child(parent, params, …)` 的整个
    // 构造体（initParam/字段赋值/finalizeConstruction）全部落在旧实例上，等效真机
    // 「pop 池 → reset → 不走 new」（v2_view.ts:1087 reuseOrCreateNewComponent 的
    // recycledNode 分支）。reset 链在 finalizeConstruction 收尾处补调（见下）。
    /** @param {any} parent @param {number} elmtId @param {any} extraInfo */
    constructor(parent, elmtId, extraInfo) {
      const pooled = v2ReusePop(new.target);
      if (pooled) {
        super(parent, undefined, elmtId, extraInfo);   // 语言要求仍须调用（作用在被丢弃的新实例上）
        pooled.__viewId = ++viewSeq;
        pooled.__parent = parent;
        pooled.__localStorage = undefined;
        pooled.__elmtId = elmtId;
        pooled.__extraInfo = extraInfo;
        pooled.__v2consumerBind = null;
        pooled.__v2reusePending = true;
        pooled.__v2initParams = {};                    // 派生构造体里的 initParam 会重新累计本次 params
        return pooled;
      }
      super(parent, undefined, elmtId, extraInfo);
      this.__v2consumerBind = null;
      this.__v2reusePending = false;
      /** @type {Record<string, any>|null} */ this.__v2initParams = null;
    }

    // ── 产物契约：initParam / updateParam / resetParam ──
    /** @param {string} name @param {any} value */
    initParam(name, value) {
      // W1：复用窗口期把 params 逐名累计下来，finalizeConstruction 里回放给 reset 链
      if (this.__v2initParams) this.__v2initParams[name] = value;
      (/** @type {any} */ (this))[name] = value;   // 动态属性名：ViewV2 字段面放开（R151）
    }
    /** @param {string} name @param {any} value */
    updateParam(name, value) { (/** @type {any} */ (this))[name] = value; }
    /** @param {string} name @param {any} value */
    resetParam(name, value) { (/** @type {any} */ (this))[name] = value; }

    /** @param {string} fieldKey @param {any} fallback */
    resetConsumer(fieldKey, fallback) {
      const provName = v2Collect(this, (info, out) => {
        const n = info.consumers.get(fieldKey);
        if (n) out.push(n);
      })[0] || fieldKey;
      // 直接写槽，绕过 setter（此刻尚未绑定，走 setter 会平白触发一次通知）
      if (fallback !== undefined && (/** @type {any} */ (this))[v2Slot(fieldKey)] === undefined) {
        (/** @type {any} */ (this))[v2Slot(fieldKey)] = fallback;
      }
      if (!this.__v2consumerBind) this.__v2consumerBind = new Map();
      this.bindConsumer(fieldKey, provName, true);
    }

    // ── W1/W2/W3：复用链与缓存复位（产物契约方法，占位桩全部转正）──

    // W2：@Computed 缓存复位——重算 + 回写缓存 + 刷新依赖（真机 ComputedV2.resetComputed，
    // v2_computed.ts:151-159）。@Reusable 出池链（产物 resetStateVarsOnReuse）按名调用它；
    // 与 W2 的缓存结构是同一套（v2ComputedRecs），不是两套实现。
    /** @param {string} name */
    resetComputed(name) {
      const m = v2ComputedRecs.get(this);
      const rec = m && m.get(name);
      if (!rec) return;                      // 还没被读过：无缓存可清
      const old = rec.valid ? rec.value : undefined;
      v2RunComputedRec(rec);
      if (rec.valid && !Object.is(old, rec.value)) markDependentsDirty(v2Cell(this, name));
    }

    // W3/W1：复用时重绑点分路径并重快照（真机 notifyChangeOnReuse → bindRun(true)，
    // v2_monitor.ts:490-492；入口 v2_view.ts:519-523 resetMonitorsOnReuse）
    resetMonitorsOnReuse() { v2BindMonitorPaths(this); }

    // 真机基类对旧工具链直接抛错（v2_view.ts:212-216）；DOM 运行时给通用兜底链：
    //   ① 新版产物只生成 __resetStateVarsOnReuse__Internal（fixtures/LazyVar.ts:178、
    //      AnimatorDemo.ts:105，常为空壳）→ 先调它；
    //   ② params 逐名 resetParam 回放（字段值已由构造体重放，这里是幂等补一遍）；
    //   ③ 全部 @Computed 清缓存重算；④ @Monitor 点分路径重绑快照。
    // 产物自己重写了 resetStateVarsOnReuse 时（fixtures/V2.ts:38，链内自调 resetComputed/
    // resetMonitorsOnReuse）走子类版本，本默认不被调用。
    /** @param {any=} [params] */
    resetStateVarsOnReuse(params) {
      if (this.__resetStateVarsOnReuse__Internal !== ViewV2.prototype.__resetStateVarsOnReuse__Internal) {
        (/** @type {any} */ (this)).__resetStateVarsOnReuse__Internal(params);
      }
      const p = params || {};
      for (const k of Object.keys(p)) this.resetParam(k, p[k]);
      for (const k of v2Collect(this, (/** @type {any} */ info, /** @type {any[]} */ out) => {
        for (const c of info.computed) out.push(c);
      })) this.resetComputed(k);
      this.resetMonitorsOnReuse();
    }

    /** @param {any=} [_params] 新版工具链的 reset 逻辑挂这里；基类空实现（fixtures/AnimatorDemo.ts:105） */
    __resetStateVarsOnReuse__Internal(_params) {}

    /** @param {string} fieldKey @param {string} provName @param {boolean=} [quiet] */
    bindConsumer(fieldKey, provName, quiet) {
      const found = this._findProvided(provName);
      if (found && found.inst) {
        if (!this.__v2consumerBind) this.__v2consumerBind = new Map();
        this.__v2consumerBind.set(fieldKey, { inst: found.inst, key: found.key });
      } else if (!quiet) {
        layoutWarnings.push(`@Consumer('${provName}') 未找到祖先 @Provider，退化为本地字段`);
      }
    }

    // 产物在子类构造函数末尾调用它。用它来登记 @Provider / 绑定 @Consumer：
    // 这个时机两边都齐了（祖先实例已存在，本实例的字段也已赋值）。
    finalizeConstruction() {
      const provs = v2Collect(this, (info, out) => { for (const [k, n] of info.providers) out.push([k, n]); });
      for (const [key, name] of provs) {
        if (!this.__providedVars) this.__providedVars = new Map();
        const inst = /** @type {any} */ (this);
        // 同时提供 get/set：这样 V1 的 @Consume（initializeConsume 期望拿到 prop 对象）
        // 也能消费 V2 的 @Provider，反之亦然。
        this.__providedVars.set(name, {
          __v2provider: true, inst, key,
          get() { return inst[key]; },
          set(/** @type {any} */ v) { inst[key] = v; },
          purgeDependencyOnElmtId() {},
          aboutToBeDeleted() {},
        });
      }
      const cons = v2Collect(this, (info, out) => { for (const [k, n] of info.consumers) out.push([k, n]); });
      for (const [key, name] of cons) this.bindConsumer(key, name);
      // W3：点分路径 @Monitor 首建绑定（真机 constructMonitor 在构造期 InitRun，v2_monitor.ts:377）。
      // 复用实例走 resetMonitorsOnReuse 重绑，这里跳过避免双份注册。
      if (!this.__v2reusePending) v2BindMonitorPaths(this);
      // W1 复用收尾：派生构造体已把本次 params 应用到本实例，这里补【reset 链】——
      // 真机出池序（v2_view.ts:238-247）：resetStateVarsOnReuse(params) → unfreeze → aboutToReuse()。
      // unfreeze 在 DOM 运行时为 no-op；变更通知的批量冲刷由 markDirty 的微任务 flush 等价达成。
      if (this.__v2reusePending) {
        this.__v2reusePending = false;
        const params = this.__v2initParams || {};
        this.__v2initParams = null;
        this.resetStateVarsOnReuse(params);
        const reuseHook = /** @type {any} */ (this).aboutToReuse;
        if (typeof reuseHook === 'function') reuseHook.call(this);   // V2 无参（common.d.ts:24506）
      }
    }
  }

  // 装饰器表：不给 global 加裸名（`Event`/`Local` 之类会撞浏览器全局），
  // 由抽取工具在产物里做作用域内绑定。
  // `Observed` 是 V1 的类装饰器（与 V2 的 `ObservedV2` 对应），走同一张表同一套机制。
  // `Reusable`/`ReusableV2` 是 W1 的类装饰器（d.ts common.d.ts:1376/1386，见 W1 块注释）。
  const ReusableV2 = Reusable;
  const decorators = {
    ViewV2, Param, Local, Once, Event: EventDeco, Monitor, Computed, Provider, Consumer, ObservedV2, Trace,
    Observed, Reusable, ReusableV2,
  };

  // ── W1 入池挂点 + 测试/排障钩子（v2.js 内的最小侵入，不改 main.js）──
  // purgeDetachedRecords 是 main.js:354 的函数声明，闭包内重绑后所有调用点（if/else 分支
  // 切换、ForEach 重建、clearRoot 路由切换）都走包装版：先把本轮将被清除的 @Reusable
  // 子视图入池（aboutToRecycle → push），再走原逻辑删记录。
  const __v2OrigPurgeDetachedRecords = purgeDetachedRecords;
  purgeDetachedRecords = function () {
    if (rootNode) {
      for (const rec of [...elmtRecords.values()]) {
        if (rec && rec.childView && rec.node && !rootNode.contains(rec.node)) {
          v2RecycleChildView(rec.childView);
        }
      }
    }
    __v2OrigPurgeDetachedRecords();
  };

  // 纯 runtime 级测试页（test/v2sem.html）与排障用：真机这些在 C++ 侧，没有对外口。
  (/** @type {any} */ (global)).__arkui_dom_v2sem = {
    /** 纯 runtime 页设置根节点（产品页走 __arkui_dom_loadRoute，不需要它） */
    /** @param {any} el */
    attachRoot(el) { rootNode = el; },
    /** 手工触发一次卸载扫描（正常由 if/ForEach/路由切换驱动） */
    purgeDetached() { purgeDetachedRecords(); },
    /** @param {any} ctor 组件类的池存量 */
    poolSizeOf(ctor) { const p = v2ReusePools.get(ctor); return p ? p.length : 0; },
    /** 复用池计数：pooled=入池 reused=复用 evicted=满拒真销毁 */
    reuseStats: v2ReuseStats,
    /** @param {any} inst 复用链是否挂起（构造中，待 finalizeConstruction 收尾） */
    reusePendingOf(inst) { return !!(inst && inst.__v2reusePending); },
    /** 池容量读取 */
    poolMax() { return v2ReusePoolMax; },
    /** @param {number} n 池容量设置（负值截 0、硬上限 200，对齐真机 puv2_globalreuse.ts:549-554 钳制） */
    setPoolMax(n) {
      v2ReusePoolMax = Math.max(0, Math.min(V2_REUSE_POOL_HARD_CAP, Math.floor(n) || 0));
      return v2ReusePoolMax;
    },
  };
