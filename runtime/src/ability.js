  // ────────────────────── ability 栈（R20） ──────────────────────
  // 一个 ability = 一份生命周期 + 一个窗口。根 ability 由 __arkui_dom_startAbility 起；
  // 子 ability 由 context.startAbility / startAbilityForResult 起；terminateSelf* 结束自己。
  //
  // ⚠️ 实测更正：API 26 SDK 里【没有】onAbilityResult（全 SDK grep 0 命中），
  // stage 模型的结果只走 startAbilityForResult 的 Promise / AsyncCallback —— 见 docs/ROADMAP R20。
  /** @type {any[]} */
  const abilityStack = [];
  // @type 档位：history 不写会推成 never[]
  // @type 档位：history 不写会推成 never[]（属性位置的 JSDoc 在 TS4.9 不生效，整袋收）
  const abilityWindowStats = /** @type {any} */ ({ created: 0, closed: 0, history: [] });
  /** @type {any} */ let abilityClassForChildren = null;     // 同一进程内再起实例时用的类（不按 abilityName 路由）

  /** @param {any} rec */
  function abilityLog(rec) {
    (global.__arkui_dom_logs = global.__arkui_dom_logs || []).push(rec);
  }
  /** @param {number} code @param {string} message */
  function bizError(code, message) { return Object.assign(new Error(message), { code }); }
  const okRes = () => ({ code: 0, message: '' });

  /** @param {any} entry */
  function makeAbilityWindow(entry) {
    const el = document.createElement('div');
    el.setAttribute('data-arkui-ability-window', entry.name);
    // 真机上被启动的 ability 在【新窗口】里：DOM 里用一个盖满全屏的独立容器表示，
    // 结束（terminateSelf*）时移除 —— 这样"起了第二个 ability"是可被看见、可被断言的
    el.setAttribute('style',
      'position:fixed;left:0;top:0;right:0;bottom:0;background:#fff;z-index:20;overflow:auto');
    document.body.appendChild(el);
    abilityWindowStats.created++;
    abilityLog({ t: 'abilityWindow', op: 'create', ability: entry.name });
    return el;
  }

  /** @param {any} entry */
  function closeAbilityWindow(entry) {
    const el = entry.windowEl;
    if (!el) return;
    // 关窗前把窗口里的文本抓下来：这是"这个窗口真的渲染过页面"的证据（不只一行日志）
    abilityWindowStats.history.push({
      ability: entry.name, page: entry.pagePath, text: String(el.textContent || ''),
    });
    abilityWindowStats.closed++;
    abilityLog({ t: 'abilityWindow', op: 'close', ability: entry.name, page: entry.pagePath });
    el.remove();
    purgeDetachedRecords();
    entry.windowEl = null;
  }

  // loadRoute 用的是单例 rootNode/pageStack：起子 ability 时切成它的窗口，跑完切回来。
  // 已知限制：子 ability 的【异步】重渲染不在支持范围（它必须在自己生命周期内完成渲染）——
  // 见 docs/ARCHITECTURE §4.14。
  /** @param {any} entry @param {() => any} fn */
  function withAbilityWindow(entry, fn) {
    const savedRoot = rootNode;
    const savedStack = pageStack.slice();
    rootNode = entry.windowEl;
    pageStack.length = 0;
    try {
      return fn();
    } finally {
      rootNode = savedRoot;
      pageStack.length = 0;
      for (const p of savedStack) pageStack.push(p);
    }
  }

  /** @param {any} entry */
  function makeWindowStage(entry) {
    return {
      /** @param {string} page @param {any} cb */
      loadContent(page, cb) {
        abilityLog({ t: 'loadContent', page, ability: entry.name });
        let err = null;
        try {
          entry.pagePath = page;
          if (entry.windowEl) withAbilityWindow(entry, () => loadRoute(page, entry.windowEl));
          else loadRoute(page, entry.rootEl);
        } catch (e) {
          err = { code: 1, message: e.message };
          abilityLog({ t: 'loadContentError', message: e.message });
        }
        // 注意：生成代码是 `if (err.code) …`，【没有 null 检查】——说明官方 API 成功时
        // 也必须传一个 BusinessError 形状的对象（code=0）。传 null 会直接 TypeError。
        if (typeof cb === 'function') cb(err || { code: 0, message: '' });
        return err ? undefined : true;
      },
    };
  }

  // AsyncCallback：一律【异步】回调（同步回调会让"回调晚于后续同步代码"的假设悄悄不成立）
  /** @param {Promise<any>} promise @param {any=} [cb] */
  function withCallback(promise, cb) {
    if (typeof cb !== 'function') return promise;
    promise.then(
      (v) => Promise.resolve().then(() => cb(okRes(), v)),
      (e) => Promise.resolve().then(() => cb(bizError(e.code || 1, e.message), undefined)),
    );
    return undefined;
  }

  /** @param {any} want @param {any} parent @param {any=} [onResult] */
  function spawnChildAbility(want, parent, onResult) {
    if (!want || typeof want !== 'object') {
      throw bizError(401, 'startAbilityForResult: 缺少必填参数 want（BusinessError 401）');
    }
    const AbilityClass = abilityClassForChildren;
    if (typeof AbilityClass !== 'function') {
      throw bizError(16000001, '没有可启动的 ability：本运行时只会启动 '
        + '__arkui_dom_startAbility 注册的那个类（不按 want.abilityName 路由，见 docs 已知限制）');
    }
    // @type 档位：windowEl/context/ability 是 null↔对象 摆动（生命周期里先后赋值）
    const entry = /** @type {any} */ ({
      name: (want.abilityName !== undefined && want.abilityName !== null) ? String(want.abilityName) : AbilityClass.name,
      role: 'child', parent, rootEl: null, windowEl: null, pagePath: null,
      ability: null, context: null, terminated: false,
      pending: onResult ? [onResult] : [],   // 先登记结果接收者：子 ability 可能在自己的
    });                                      // 生命周期里【同步】就 terminateSelfWithResult
    entry.windowEl = makeAbilityWindow(entry);
    abilityStack.push(entry);
    entry.context = makeAbilityContext(entry);
    const ability = new AbilityClass(entry.context);
    entry.ability = ability;
    abilityLog({ t: 'ability', name: entry.name, child: true });
    ability.onCreate(want, { launchReason: 1 });
    ability.onWindowStageCreate(makeWindowStage(entry));
    if (!entry.terminated) ability.onForeground();
    return entry;
  }

  // parameter 为空 = terminateSelf()：.d.ts 没规定"不带结果结束"时结果是什么 →
  // 本实现取 resultCode 0（见 docs 已知限制），并保证调用方【不会挂住】
  /** @param {any} entry @param {any=} [parameter] */
  function terminateEntry(entry, parameter) {
    if (entry.terminated) return undefined;      // 幂等：重复 terminateSelf 不重复交结果
    entry.terminated = true;
    const result = (parameter && typeof parameter === 'object')
      ? { resultCode: Number(parameter.resultCode), want: parameter.want }
      : { resultCode: 0 };
    const ability = entry.ability;
    if (ability) {
      try {
        ability.onWindowStageDestroy();
      } finally {
        ability.onDestroy();
      }
    }
    closeAbilityWindow(entry);
    const i = abilityStack.indexOf(entry);
    if (i >= 0) abilityStack.splice(i, 1);
    for (const w of entry.pending.splice(0)) w.resolve(result);
    return undefined;
  }

  /** @param {any} entry */
  function makeAbilityContext(entry) {
    const appContext = {
      /** @param {any} mode */
      setColorMode(mode) { abilityLog({ t: 'setColorMode', mode }); },
      getApplicationContext() { return appContext; },
    };
    return {
      getApplicationContext: () => appContext,
      resourceManager: {
        /** @param {any} k */
        getStringSync: (k) => k,
        /** @param {any} k */
        getStringByNameSync: (k) => k,
      },
      /** @param {any} want @param {any} optionsOrCb @param {any=} [cbMaybe] */
      startAbility(want, optionsOrCb, cbMaybe) {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : cbMaybe;
        return withCallback(Promise.resolve().then(() => { spawnChildAbility(want, entry, null); }), cb);
      },
      // Promise 形态与 AsyncCallback 形态（want, cb）/（want, options, cb）
      /** @param {any} want @param {any} optionsOrCb @param {any=} [cbMaybe] */
      startAbilityForResult(want, optionsOrCb, cbMaybe) {
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : cbMaybe;
        const started = new Promise((resolve, reject) => {
          spawnChildAbility(want, entry, { resolve, reject });
        });
        return withCallback(started, cb);
      },
      /** @param {any=} [cb] */
      terminateSelf(cb) {
        return withCallback(Promise.resolve().then(() => terminateEntry(entry, null)), cb);
      },
      /** @param {any} parameter @param {any=} [cb] */
      terminateSelfWithResult(parameter, cb) {
        return withCallback(Promise.resolve().then(() => terminateEntry(entry, parameter)), cb);
      },
    };
  }

  // 扮演"框架"启动 ability：onCreate → onWindowStageCreate(loadContent 真的渲染页面) → onForeground
  /** @param {any} AbilityClass @param {any=} [opts] */
  function startAbility(AbilityClass, opts) {
    const { rootEl, want = {} } = opts || {};
    const logs = (global.__arkui_dom_logs = global.__arkui_dom_logs || []);
    abilityClassForChildren = AbilityClass;

    // @type 档位：windowEl/context/ability 是 null↔对象 摆动（同 child entry）
    const entry = /** @type {any} */ ({
      name: AbilityClass.name, role: 'root', parent: null, rootEl, windowEl: null,
      pagePath: null, ability: null, context: null, terminated: false, pending: [],
    });
    abilityStack.push(entry);
    const context = makeAbilityContext(entry);
    entry.context = context;

    const ability = new AbilityClass(context);
    entry.ability = ability;
    logs.push({ t: 'ability', name: AbilityClass.name });

    ability.onCreate(want, { launchReason: 1 });
    ability.onWindowStageCreate(makeWindowStage(entry));
    if (!entry.terminated) ability.onForeground();
    return { ability, logs, context, entry };
  }
