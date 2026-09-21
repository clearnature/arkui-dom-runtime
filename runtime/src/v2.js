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
  // 为什么装饰器不挂 global：`Event` 既是装饰器名也是浏览器全局，而 runtime 自己
  // （Scroller 里 `new Event('scroll')`）与 test/lazy.html 都在用 new Event(...)。
  // 挂 global 会直接把滚动事件打断。改为导出装饰器表 __arkui_dom_decorators，
  // 由 tools/extract.mjs 在产物里生成【作用域内】的绑定前奏（只绑实际用到的名字）。

  const v2InstCells = new WeakMap();   // 任意对象 -> Map<字段名, 依赖单元>（复用 propDeps 机制）
  const v2ProtoMeta = new WeakMap();   // 原型 -> {observed, consumers, providers, monitors, computed}

  // 依赖单元的粒度是【实例 × 字段】。若按原型共享，同类多实例会互相触发多余重渲染。
  function v2Cell(inst, key) {
    let m = v2InstCells.get(inst);
    if (!m) v2InstCells.set(inst, (m = new Map()));
    let c = m.get(key);
    if (!c) m.set(key, (c = { __v2: true, __name: key }));
    return c;
  }

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
  function v2Collect(inst, pick, out = []) {
    for (let p = Object.getPrototypeOf(inst); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      const info = v2ProtoMeta.get(p);
      if (info) pick(info, out);
    }
    return out;
  }

  // 字段存储的隐藏槽。名字带前缀避免与产物的其它字段撞车。
  const v2Slot = (key) => '__v2slot_' + key;

  function installV2Accessor(proto, key, kind) {
    const existing = Object.getOwnPropertyDescriptor(proto, key);
    if (existing && existing.get && existing.get.__v2) return;    // 已装过（重复装饰）
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: true,
      get() {
        // @Consumer：读提供者的字段。依赖由【提供者的访问器】记录，所以祖先改值
        // 会直接使后代读到它的 elmtId 变脏——不需要额外转发。
        const bind = this.__v2consumerBind && this.__v2consumerBind.get(key);
        if (bind) return bind.inst[bind.key];
        if (kind !== 'event') recordDep(v2Cell(this, key));
        return this[v2Slot(key)];
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
        markDependentsDirty(v2Cell(this, key));
        if (!Object.is(before, v)) fireV2Monitors(this, key, v, before);
      },
    });
    const d = Object.getOwnPropertyDescriptor(proto, key);
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
  // 已知简化：一次赋值只产生一条 dirty（ArkUI 会把同一批变更合并），且 path 是
  // 字段名而不是 `items.0.name` 这样的点分路径。
  function fireV2Monitors(inst, key, value, before) {
    const methods = v2Collect(inst, (info, out) => {
      const s = info.monitors.get(key);
      if (s) for (const m of s) out.push(m);
    });
    if (!methods.length) return;
    const entries = [{ path: key, now: value, before }];
    const monitor = {
      dirty: entries.map((e) => e.path),
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

  const v2Field = (kind) => function (target, key) {
    if (typeof key === 'string') installV2Accessor(target, key, kind);
    return undefined;                                  // 属性装饰器的返回值被 __decorate 忽略
  };

  const Param = v2Field('param');
  const Local = v2Field('local');
  const Once = v2Field('once');
  const Event = v2Field('event');
  const Trace = v2Field('trace');

  const Provider = (name) => function (target, key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).providers.set(key, name || key);
    return undefined;
  };

  const Consumer = (name) => function (target, key) {
    if (typeof key !== 'string') return undefined;
    installV2Accessor(target, key, 'local');
    v2Info(target).consumers.set(key, name || key);
    return undefined;
  };

  const Monitor = (...keys) => function (target, key, desc) {
    const info = v2Info(target);
    for (const k of keys) {
      const s = info.monitors.get(k) || new Set();
      s.add(key);
      info.monitors.set(k, s);
    }
    return desc;                                       // 方法描述符原样传回
  };

  // @Computed：【不缓存】实现。getter 体在求值时就处在目标 elmtId 的渲染上下文里，
  // 它读到的每个字段都会直接把依赖记到该 elmtId 上——所以"传递依赖"天然成立，
  // 也就不需要缓存与失效逻辑。代价是每次重渲染都重算，换了正确性，值这个价。
  function Computed(target, key, desc) {
    if (typeof key === 'string') {
      if (desc && typeof desc.get === 'function') v2Info(target).computed.add(key);
      else installV2Accessor(target, key, 'local');     // 容错：@Computed 用在字段上
    }
    return desc;
  }

  // @ObservedV2 是【类装饰器】：__decorate([ObservedV2], Cls) 只有 1 个实参，
  // 助手会当成"整体替换"处理，所以必须返回这个类本身。
  function ObservedV2(target) {
    v2Info(target.prototype);
    return target;
  }

  class ViewV2 extends ViewPU {
    // 注意产物调用的是 super(parent, elmtId, extraInfo) —— 比 ViewPU 少一个
    // __localStorage。这里补上 undefined 以复用 ViewPU 的全部机制。
    constructor(parent, elmtId, extraInfo) {
      super(parent, undefined, elmtId, extraInfo);
      this.__v2consumerBind = null;
    }

    // ── 产物契约：initParam / updateParam / resetParam ──
    initParam(name, value) { this[name] = value; }
    updateParam(name, value) { this[name] = value; }
    resetParam(name, value) { this[name] = value; }

    resetConsumer(fieldKey, fallback) {
      const provName = v2Collect(this, (info, out) => {
        const n = info.consumers.get(fieldKey);
        if (n) out.push(n);
      })[0] || fieldKey;
      // 直接写槽，绕过 setter（此刻尚未绑定，走 setter 会平白触发一次通知）
      if (fallback !== undefined && this[v2Slot(fieldKey)] === undefined) {
        this[v2Slot(fieldKey)] = fallback;
      }
      if (!this.__v2consumerBind) this.__v2consumerBind = new Map();
      this.bindConsumer(fieldKey, provName, true);
    }

    // 无缓存实现 → 无需失效；保留方法只为对齐产物契约
    resetComputed(_name) {}
    resetMonitorsOnReuse() {}
    resetStateVarsOnReuse(_params) {}

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
        const inst = this;
        // 同时提供 get/set：这样 V1 的 @Consume（initializeConsume 期望拿到 prop 对象）
        // 也能消费 V2 的 @Provider，反之亦然。
        this.__providedVars.set(name, {
          __v2provider: true, inst, key,
          get() { return inst[key]; },
          set(v) { inst[key] = v; },
          purgeDependencyOnElmtId() {},
          aboutToBeDeleted() {},
        });
      }
      const cons = v2Collect(this, (info, out) => { for (const [k, n] of info.consumers) out.push([k, n]); });
      for (const [key, name] of cons) this.bindConsumer(key, name);
    }
  }

  // 装饰器表：不给 global 加裸名（`Event`/`Local` 之类会撞浏览器全局），
  // 由抽取工具在产物里做作用域内绑定。
  // `Observed` 是 V1 的类装饰器（与 V2 的 `ObservedV2` 对应），走同一张表同一套机制。
  const decorators = {
    ViewV2, Param, Local, Once, Event, Monitor, Computed, Provider, Consumer, ObservedV2, Trace,
    Observed,
  };
