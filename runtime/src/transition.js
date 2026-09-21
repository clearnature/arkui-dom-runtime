  // ────────────────────── transition：组件出现/消失动画（R22 收口） ──────────────────────
  //
  // 实测产物（fixtures/pages/TransitionDemo.ts）：
  //   Text.transition({ opacity: 0, translate: { x: 0, y: 40 } });                    ← TransitionOptions
  //   Text.transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ x: 20, y: 0 }))
  //                       .animation({ duration: 200, curve: Curve.Linear }));         ← TransitionEffect
  //   Text.transition(TransitionEffect.asymmetric(A, B), (transitionIn) => {…});      ← 两参重载
  //   Text.transition({ type: TransitionType.Insert, opacity: 0 });                   ← 显式方向
  // 即：`transition` 是**属性**（走 builder 栈，两参重载要把第二个参数一起传进来），
  // 而 `TransitionEffect`/`TransitionType` 是**自由变量**（必须由运行时提供全局）。
  //
  // 语义（只用 CSS transition 能表达的部分）：
  //   · 触发时机 = 组件被【插入/删除】。插入点 = mountNode；删除点 = 分支切换/ForEach 重建。
  //     删除**不能**立刻 remove：要么带着过渡留在 DOM 里到点再摘，要么就根本没有消失动画。
  //   · 方向：Insert = 从"偏离态"过渡到常态；Delete = 从常态过渡到"偏离态"。
  //   · 时长来源有**两档**（最要紧的差别）：TransitionEffect 自带 `.animation()` → 用它；
  //     TransitionOptions 自己没有时间字段 → 用【外层 animateTo 窗口】的参数；
  //     两者都没有 → AnimateParam 的默认（duration 1000 / Linear），并把 source 记成 'default'
  //     （可自省，不假装是"按设备来的"）。
  //   · `TransitionEffect.IDENTITY`、或 type 与方向不匹配 → **不动**（仍记一条 skipped，可自省）。
  //   · CSS 表达不了的（`rotate.centerX/centerY`、`translate.z`）→ 出声。
  const TransitionType = { All: 0, Insert: 1, Delete: 2 };
  const TRANSITION_DIR_NAME = { [TransitionType.All]: 'All', [TransitionType.Insert]: 'Insert', [TransitionType.Delete]: 'Delete' };

  class TransitionEffect {
    constructor(kind, value) { this.kind = kind; this.value = value; this.anim = undefined; this.next = null; }
    static get IDENTITY() { return new TransitionEffect('identity', undefined); }
    static get OPACITY() { return new TransitionEffect('opacity', 0); }
    static get SLIDE() { return new TransitionEffect('slide', undefined); }
    static get SLIDE_SWITCH() { return new TransitionEffect('slideSwitch', undefined); }
    static translate(o) { return new TransitionEffect('translate', o); }
    static rotate(o) { return new TransitionEffect('rotate', o); }
    static scale(o) { return new TransitionEffect('scale', o); }
    static opacity(a) { return new TransitionEffect('opacity', a); }
    static move(e) { return new TransitionEffect('move', e); }
    static asymmetric(appear, disappear) { return new TransitionEffect('asymmetric', { appear: appear, disappear: disappear }); }
    // `.animation()` / `.combine()` 都返回**新实例**：静态常量（OPACITY/SLIDE…）是共享的，
    // 若就地改会把别的页面用到的同一个常量污染掉。两者都必须**整链深拷贝** ——
    // 只拷自己会把 combine 出来的链丢掉（第一版就这么错的：`.a().combine(b).animation()` 之后链没了）。
    _deepCopy() {
      const head = new TransitionEffect(this.kind, this.value);
      head.anim = this.anim;
      let tail = head;
      for (const n of _effectChain(this).slice(1)) {
        tail.next = new TransitionEffect(n.kind, n.value);
        tail = tail.next;
        tail.anim = n.anim;
      }
      return head;
    }
    animation(p) { const c = this._deepCopy(); c.anim = p; return c; }
    combine(e) {
      const head = this._deepCopy();
      let tail = head;
      while (tail.next) tail = tail.next;
      for (const n of _effectChain(e)) { tail.next = n._deepCopy(); tail = tail.next; }
      return head;
    }
  }
  function _effectChain(e) { const out = []; for (let t = e; t; t = t.next) out.push(t); return out; }
  function _effectAnim(e) { for (const n of _effectChain(e)) if (n.anim) return n.anim; return undefined; }
  function _effectSummary(e) { return _effectChain(e).map((n) => n.kind).join('+'); }

  const transitionRegistered = [];         // 登记过的 transition（自省用）
  const transitionRuns = [];               // 每次真的跑过的出现/消失（自省用）
  let transitionSeq = 0;
  let transitionRunSeq = 0;

  // 偏离态 → CSS（ArkUI 的裸数字 = vp，这里 1vp=1px，与项目其它地方一致）
  function _offStyleOf(effectOrOptions, isEffect) {
    const out = { opacity: undefined, transforms: [], warnings: [] };
    const list = isEffect ? _effectChain(effectOrOptions) : [{ kind: 'options', value: effectOrOptions }];
    for (const item of list) {
      const kind = item.kind;
      const v = item.value;
      if (kind === 'identity') continue;
      if (kind === 'options') {                       // TransitionOptions：opacity/translate/scale/rotate
        const o = v || {};
        if (o.opacity !== undefined) out.opacity = Number(o.opacity);
        if (o.translate) out.transforms.push(`translate(${Number(o.translate.x || 0)}px, ${Number(o.translate.y || 0)}px)`);
        if (o.translate && o.translate.z) out.warnings.push('transition 的 translate.z（3D）未实现');
        if (o.scale) {
          out.transforms.push(`scale(${o.scale.x !== undefined ? o.scale.x : 1}, ${o.scale.y !== undefined ? o.scale.y : 1})`);
          if (o.scale.centerX !== undefined || o.scale.centerY !== undefined) {
            out.warnings.push('transition 的 scale.centerX/centerY 未实现（CSS 走 transform-origin，未接入）');
          }
        }
        if (o.rotate) {
          out.transforms.push(`rotate(${Number(o.rotate.angle || 0)}deg)`);
          if (o.rotate.centerX !== undefined || o.rotate.centerY !== undefined) {
            out.warnings.push('transition 的 rotate.centerX/centerY 未实现');
          }
        }
        continue;
      }
      if (kind === 'opacity') { out.opacity = Number(v); continue; }
      if (kind === 'translate') { out.transforms.push(`translate(${Number((v && v.x) || 0)}px, ${Number((v && v.y) || 0)}px)`); continue; }
      if (kind === 'scale') { out.transforms.push(`scale(${v && v.x !== undefined ? v.x : 1}, ${v && v.y !== undefined ? v.y : 1})`); continue; }
      if (kind === 'rotate') { out.transforms.push(`rotate(${Number((v && v.angle) || 0)}deg)`); continue; }
      if (kind === 'move') {                      // 从某条边滑入/滑出
        const edge = v;
        const pct = edge === TransitionEdge.Left ? 'translate(-100%, 0)'
          : edge === TransitionEdge.Right ? 'translate(100%, 0)'
            : edge === TransitionEdge.Top ? 'translate(0, -100%)' : 'translate(0, 100%)';
        out.transforms.push(pct);
        continue;
      }
      if (kind === 'slide') { out.transforms.push('translate(-100%, 0)'); continue; }        // 推断：从左滑入
      if (kind === 'slideSwitch') {                                                          // 推断：缩小+淡出
        out.transforms.push('scale(0.8)');
        if (out.opacity === undefined) out.opacity = 0;
        out.warnings.push('TransitionEffect.SLIDE_SWITCH 的具体参数 .d.ts 未给出 → 按 scale(0.8)+opacity 0 近似（推断）');
        continue;
      }
      out.warnings.push(`TransitionEffect 的 ${kind} 未实现（本次不动这一项）`);
    }
    return out;
  }
  const TransitionEdge = { Top: 0, Bottom: 1, Left: 2, Right: 3 };
  // 自省用的"偏离态"文本（断言据此核对 translate/scale/opacity 真的被算进去了）
  function _offText(off) {
    const parts = [];
    if (off.opacity !== undefined) parts.push('opacity=' + off.opacity);
    if (off.transforms.length) parts.push('transform=' + off.transforms.join(' '));
    return parts.join(' ');
  }

  // 把一次 transition 解析成"某方向要不要动、怎么动、多久"
  function transitionPlanFor(el, dir) {          // dir: 'enter' | 'exit'
    const spec = el && el.__arkuiTransition;
    if (!spec) return null;
    const wantInsert = spec.isEffect ? true : (spec.type === TransitionType.All || spec.type === TransitionType.Insert);
    const wantDelete = spec.isEffect ? true : (spec.type === TransitionType.All || spec.type === TransitionType.Delete);
    const want = dir === 'enter' ? wantInsert : wantDelete;
    const typeName = spec.isEffect ? 'All(effect)' : (TRANSITION_DIR_NAME[spec.type] || String(spec.type));
    if (!want) return { skip: `type=${typeName} 不含 ${dir === 'enter' ? 'Insert' : 'Delete'}` };
    let payload = spec.payload;
    if (spec.isEffect && spec.payload && spec.payload.kind === 'asymmetric') {
      payload = dir === 'enter' ? spec.payload.value.appear : spec.payload.value.disappear;
    }
    const isEffect = spec.isEffect;
    const off = _offStyleOf(payload, isEffect);
    if (!off.transforms.length && off.opacity === undefined) {
      return { skip: 'IDENTITY（没有可动的属性）' };
    }
    // 时长：effect 自带 > 外层 animateTo 窗口 > AnimateParam 默认
    const own = isEffect ? _effectAnim(payload) : undefined;
    let duration; let delay; let curveCss; let source; let curveName;
    if (own) {
      duration = own.duration === undefined ? 1000 : Number(own.duration);
      delay = own.delay === undefined ? 0 : Number(own.delay);
      curveCss = animCurveCss(own.curve);
      curveName = animCurveName(own.curve);
      source = 'effect';
    } else if (animWindow) {
      // 窗口对象的曲线在 `win.rec.curveCss`（窗口本身只带 duration/delay）—— 别读错字段，
      // 读错不会报错，只会把 curve 弄丢（CSS 静默回落到 ease），这类"静默降级"最难发现
      duration = animWindow.duration; delay = animWindow.delay;
      curveCss = (animWindow.rec && animWindow.rec.curveCss) || 'linear';
      curveName = (animWindow.rec && animWindow.rec.curve) || 'Linear';
      source = 'animateTo';
    } else {
      duration = 1000; delay = 0; curveCss = 'linear'; source = 'default';
    }
    return {
      off, duration, delay, curveCss, curveName, source, typeName,
      identifier: el.id || '(无 id)', onFinish: spec.onFinish,
    };
  }

  const transitionTimers = new Set();
  function _transitionWitness(el, run) {         // 与 animateTo 一样：transitionend 只当"见证"，不当收口依据
    const fn = () => { run.sawTransitionEnd = true; };
    el.addEventListener('transitionend', fn, { once: true });
    return () => el.removeEventListener('transitionend', fn);
  }
  function _finishTransitionRun(el, run, plan, cleanup) {
    run.endedBy = 'timer';
    cleanup();
    el.style.transitionProperty = '';
    el.style.transitionDuration = '';
    el.style.transitionTimingFunction = '';
    el.style.transitionDelay = '';
    delete el.dataset.arkuiTransition;
    if (plan && typeof plan.onFinish === 'function') {
      try { plan.onFinish(run.dir === 'enter'); }
      catch (e) { layoutWarnings.push(`transition 的 onFinish 抛错：${e && e.message}`); }
    }
  }
  function runEnterTransition(el, plan) {
    const run = {
      seq: ++transitionRunSeq, dir: 'enter', id: plan.identifier, target: 'identity',
      duration: plan.duration, delay: plan.delay, curve: plan.curveName, curveCss: plan.curveCss, source: plan.source,
      offText: _offText(plan.off), endedBy: null, sawTransitionEnd: false,
    };
    transitionRuns.push(run);
    const offOpacity = plan.off.opacity;
    const offTransform = plan.off.transforms.join(' ');
    for (const w of plan.off.warnings) layoutWarnings.push(`transition(${plan.identifier}): ${w}`);
    // 先落到"偏离态"，**强制一次重排**把起始值提交掉，再带 transition 回到常态 ——
    // 这样不依赖 rAF（headless 里 rAF 节流不确定，见坑表 ⑧）
    if (offOpacity !== undefined) el.style.opacity = String(offOpacity);
    if (offTransform) el.style.transform = offTransform;
    el.dataset.arkuiTransition = 'enter';
    void el.offsetHeight;
    const stopWitness = _transitionWitness(el, run);
    el.style.transitionProperty = 'opacity, transform';
    el.style.transitionDuration = plan.duration + 'ms';
    el.style.transitionTimingFunction = plan.curveCss;
    el.style.transitionDelay = plan.delay + 'ms';
    if (offOpacity !== undefined) el.style.opacity = '';
    if (offTransform) el.style.transform = '';
    const cleanup = () => { stopWitness(); transitionTimers.delete(timer); };
    const timer = setTimeout(() => _finishTransitionRun(el, run, plan, cleanup),
      Math.max(0, plan.duration + plan.delay) + 30);
    transitionTimers.add(timer);
  }
  function runExitTransition(el, plan) {
    const run = {
      seq: ++transitionRunSeq, dir: 'exit', id: plan.identifier, target: 'off',
      duration: plan.duration, delay: plan.delay, curve: plan.curveName, curveCss: plan.curveCss, source: plan.source,
      offText: _offText(plan.off), endedBy: null, sawTransitionEnd: false,
    };
    transitionRuns.push(run);
    const offOpacity = plan.off.opacity;
    const offTransform = plan.off.transforms.join(' ');
    for (const w of plan.off.warnings) layoutWarnings.push(`transition(${plan.identifier}): ${w}`);
    el.dataset.arkuiTransition = 'exit';
    const stopWitness = _transitionWitness(el, run);
    el.style.transitionProperty = 'opacity, transform';
    el.style.transitionDuration = plan.duration + 'ms';
    el.style.transitionTimingFunction = plan.curveCss;
    el.style.transitionDelay = plan.delay + 'ms';
    if (offOpacity !== undefined) el.style.opacity = String(offOpacity);
    if (offTransform) el.style.transform = offTransform;
    const cleanup = () => { stopWitness(); transitionTimers.delete(timer); };
    const timer = setTimeout(() => {
      _finishTransitionRun(el, run, plan, cleanup);
      el.remove();                                // 过渡走完才真的摘掉
      purgeDetachedRecords();
    }, Math.max(0, plan.duration + plan.delay) + 30);
    transitionTimers.add(timer);
  }

  // 拆容器时：带"消失过渡"的子节点留在 DOM 里把动画走完，其余立刻摘
  function detachChildren(container) {
    if (!container) return;
    for (const child of [...container.children]) {
      const plan = transitionPlanFor(child, 'exit');
      if (plan && !plan.skip) runExitTransition(child, plan);
      else child.remove();
    }
  }

  // 登记：属性管线把 `.transition(...)` 的实参原样交过来
  function registerTransition(node, value, onFinish) {
    if (!node) return;
    let spec;
    if (value instanceof TransitionEffect) {
      spec = { isEffect: true, payload: value, summary: _effectSummary(value), type: TransitionType.All };
    } else if (value && typeof value === 'object') {
      spec = {
        isEffect: false, payload: value, type: value.type === undefined ? TransitionType.All : value.type,
        summary: Object.keys(value).filter((k) => k !== 'type').join(',') || '(空)',
      };
      if (value.type !== undefined && TRANSITION_DIR_NAME[value.type] === undefined) {
        layoutWarnings.push(`transition 的 type=${value.type} 不是 TransitionType 的成员，按 All 处理`);
      }
    } else {
      layoutWarnings.push(`transition 收到不支持的值类型（${typeof value}）—— 本次不产生动画`);
      return;
    }
    spec.onFinish = typeof onFinish === 'function' ? onFinish : undefined;
    spec.seq = ++transitionSeq;
    node.__arkuiTransition = spec;
    transitionRegistered.push({
      seq: spec.seq, id: node.id || '(无 id)', kind: spec.isEffect ? 'TransitionEffect' : 'TransitionOptions',
      type: TRANSITION_DIR_NAME[spec.type] || String(spec.type), summary: spec.summary,
      hasOnFinish: !!spec.onFinish,
    });
    // 刚挂上的节点（本轮渲染新建的）→ 现在就跑"出现"过渡。重渲染时不会带这个标记，
    // 所以不会出现"每次重渲染都重新播一遍出现动画"。
    if (node.__arkuiFreshMount) {
      delete node.__arkuiFreshMount;
      const plan = transitionPlanFor(node, 'enter');
      if (plan && !plan.skip) runEnterTransition(node, plan);
    }
  }
  function transitionsDescribe() {
    return {
      registered: transitionRegistered.map((r) => Object.assign({}, r)),
      runs: transitionRuns.map((r) => Object.assign({}, r)),
      pending: transitionTimers.size,
      text: () => transitionRegistered.map((r) => `#${r.id} ${r.kind}/${r.type}/${r.summary}`
        + (r.hasOnFinish ? '+onFinish' : '')).join(' | '),
      runsText: () => transitionRuns.map((r) => `${r.dir}:${r.id}/${r.duration}+${r.delay}/${r.source}/${r.endedBy}`
        + `/te=${r.sawTransitionEnd}`).join(' | '),
    };
  }

  let animWindow = null;                 // 当前开着的动画窗口（rerenderElmt 会往里收集节点）
  const animHistory = [];
  let animSeq = 0;
  let onFinishCount = 0;

  function animCurveCss(curve) {
    if (typeof curve === 'string' && curve) return curve;      // CSS 关键字 / cubic-bezier(...)
    if (typeof curve === 'number' && CURVE_NAMES[curve] !== undefined) {
      return CURVE_CSS[CURVE_NAMES[curve]] || 'ease-in-out';
    }
    if (curve && typeof curve === 'object') {
      layoutWarnings.push('animateTo 的 curve 是 ICurve（弹簧/自定义插值）：CSS transition 表达不了，'
        + '本次退化为 ease-in-out —— 真机上会按 interpolate 逐帧插值');
      return 'ease-in-out';
    }
    return 'ease-in-out';                                      // .d.ts 默认 Curve.EaseInOut
  }
  function animCurveName(curve) {
    if (typeof curve === 'number' && CURVE_NAMES[curve] !== undefined) return CURVE_NAMES[curve];
    if (typeof curve === 'string' && curve) return curve;
    if (curve && typeof curve === 'object') return 'ICurve';
    return 'EaseInOut(默认)';
  }

  function animFireFinish(win) {
    onFinishCount++;
    if (typeof win.onFinish !== 'function') return;
    // 回调一律异步（同 AsyncCallback 的规矩）
    Promise.resolve().then(() => {
      try { win.onFinish(); } catch (e) {
        layoutWarnings.push(`animateTo 的 onFinish 抛错：${e && e.message}`);
      }
    });
  }

  function animFinish(win, how) {
    if (!win || win.done) return;
    win.done = true;
    if (win.timer) clearTimeout(win.timer);
    for (const el of win.els) {
      const s = el.__animStyle || {};
      el.style.transitionProperty = s.prop || '';
      el.style.transitionDuration = s.dur || '';
      el.style.transitionTimingFunction = s.curve || '';
      el.style.transitionDelay = s.delay || '';
      el.removeAttribute('data-arkui-anim');
      delete el.__animStyle;
    }
    for (const [el, fn] of win.listeners) el.removeEventListener('transitionend', fn);
    win.listeners.length = 0;
    win.rec.endedBy = how;
    win.rec.sawTransitionEnd = !!win.sawTransitionEnd;
    win.rec.els = win.els.length;
    animFireFinish(win);
  }

  function runExplicitAnimation(param, fn, api) {
    if (typeof fn !== 'function') {
      // .d.ts: animateTo(value: AnimateParam, event: () => void) —— event 是必填
      throw bizError(401, `${api}(value, event): 缺少 event 闭包（.d.ts 里它是必填的 () => void）`);
    }
    const p = (param && typeof param === 'object') ? param : {};
    const duration = (p.duration === undefined || p.duration === null) ? 1000 : Number(p.duration);  // @default 1000
    const delay = (p.delay === undefined || p.delay === null) ? 0 : Number(p.delay);
    // CSS transition 表达不了的参数：出声
    if (p.iterations !== undefined && p.iterations !== 1) {
      layoutWarnings.push(`animateTo 的 iterations=${p.iterations} 无法用 CSS transition 表达`
        + '（transition 只跑一次）—— 本次按 1 次执行');
    }
    if (p.playMode !== undefined && p.playMode !== 0) {
      layoutWarnings.push(`animateTo 的 playMode=${p.playMode} 无法用 CSS transition 表达`
        + '（单向位移没有"反向/交替"的概念）—— 本次按 Normal 执行');
    }
    if (p.tempo !== undefined && p.tempo !== 1) {
      layoutWarnings.push(`animateTo 的 tempo=${p.tempo} 未实现（需要缩放时长，请直接改 duration）`);
    }
    if (p.expectedFrameRateRange !== undefined) {
      layoutWarnings.push('animateTo 的 expectedFrameRateRange 未实现（帧率由浏览器决定）');
    }
    // 同一时刻只维护一个窗口：上一个还没结束就先收口（否则两个窗口会互相清 transition）
    if (animWindow) animFinish(animWindow, 'superseded');

    const rec = {
      seq: ++animSeq, api, duration, delay,
      curve: animCurveName(p.curve), curveCss: animCurveCss(p.curve),
      els: 0, endedBy: null, sawTransitionEnd: false,
    };
    animHistory.push(rec);

    if (!(duration > 0)) {
      fn();                                    // duration:0 → 不进动画
      flush();
      rec.endedBy = 'duration-0';
      animFireFinish({ onFinish: p.onFinish });
      return undefined;
    }

    const win = {
      seq: rec.seq, api, duration, delay, onFinish: p.onFinish, rec,
      els: [], listeners: [], sawTransitionEnd: false, done: false,
    };
    animWindow = win;
    try {
      fn();
    } finally {
      flush();                                 // 同步落地（不变量 7 允许关键路径同步 flush）
      animWindow = null;
    }
    const els = [...new Set(win.els)].filter((el) => el && el.style);
    win.els = els;
    if (els.length === 0) {
      // fn() 没引起任何重渲染 → 没有可动画的节点。这不该静默：多半是写错了（比如在 aboutToAppear 里调用）
      layoutWarnings.push(`${api} 的 fn() 没有引起任何节点重渲染 → 没有可动画的属性`
        + '（.d.ts 明确警告不要在 aboutToAppear/aboutToDisappear 里用它）');
      animFinish(win, 'no-target');
      return undefined;
    }
    for (const el of els) {
      el.__animStyle = {
        prop: el.style.transitionProperty, dur: el.style.transitionDuration,
        curve: el.style.transitionTimingFunction, delay: el.style.transitionDelay,
      };
      el.style.transitionProperty = 'all';
      el.style.transitionDuration = duration + 'ms';
      el.style.transitionTimingFunction = rec.curveCss;
      el.style.transitionDelay = delay + 'ms';
      el.setAttribute('data-arkui-anim', String(win.seq));
      const onEnd = (ev) => {
        if (ev && ev.target === el) win.sawTransitionEnd = true;   // 浏览器真的跑了过渡（无头环境下可能不来）
      };
      el.addEventListener('transitionend', onEnd);
      win.listeners.push([el, onEnd]);
    }
    rec.els = els.length;
    // 结束时间 = duration + delay（稍加余量）；transitionend 只作为"浏览器真跑了"的旁证记录，
    // 不用它来清理 —— 否则多属性/无头环境下会清早或清晚
    win.timer = setTimeout(() => animFinish(win, 'timer'), Math.max(0, duration) + Math.max(0, delay) + 30);
    return undefined;
  }

  const Context = {
    animateTo: (param, fn) => runExplicitAnimation(param, fn, 'animateTo'),
    // animateToImmediately 与 animateTo 在 DOM 里等价：CSS transition 本来就是"下一帧开始"。
    // 真机差异（不等 vsync 立即投递）在 CSS 里没有对应物，见 docs 已知限制。
    animateToImmediately: (param, fn) => runExplicitAnimation(param, fn, 'animateToImmediately'),
  };

