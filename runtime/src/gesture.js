  // ────────────────────── 手势（R23） ──────────────────────
  //
  // ⚠️ 调用约定（实测产物）：**两层栈**，全部走自由变量（不走 import）：
  //
  //   globalThis.Gesture.create(GesturePriority.LOW);   // ① 打开手势作用域
  //   PanGesture.create({fingers, direction, distance});
  //   PanGesture.onActionStart(cb); PanGesture.onActionUpdate(cb); PanGesture.onActionEnd(cb);
  //   PanGesture.pop();                                  // ② 收一个手势
  //   globalThis.Gesture.pop();                          // ③ 关作用域 → 挂到"当前节点"上
  //
  // 「当前节点」= 组件栈顶：手势作用域嵌在组件的构建器里（`Row…Gesture.create…Gesture.pop…Row.pop`），
  // 关作用域时栈顶正是那个组件，所以不需要 `.gesture()` 这样的属性方法（产物里也没有）。
  //
  // 识别器全部基于真实 DOM **pointer 事件**（pointerdown/move/up/cancel）+ setPointerCapture，
  // 这样合成事件（dispatchEvent）与真实指针走的是同一条路。
  const PanDirection = { None: 0, Horizontal: 1, Left: 2, Right: 3, Vertical: 4, Up: 5, Down: 6, All: 7 };
  const SwipeDirection = { None: 0, Horizontal: 1, Vertical: 2, All: 3 };
  // GesturePriority 有【两套名字】，必须同时提供：
  //  · 产物实发的是 ets-loader 的约定名（sdk/.../ets-loader/lib/pre_define.js）：
  //      GESTURE_ENUM_KEY="GesturePriority"、GESTURE_ENUM_VALUE_LOW/HIGH/PARALLEL="Low"/"High"/"Parallel"，
  //      .gesture() / .priorityGesture() / .parallelGesture() 三个属性经 gestureMap 映射成这三个成员
  //      （实测见 fixtures/pages/GestureGroupDemo.ts：create(GesturePriority.Low|High|Parallel)）。
  //  · .d.ts 里 `declare enum GesturePriority { NORMAL = 0, PRIORITY = 1 }` 是【另一套】（API 12 的
  //      addGesture 用的）；源码里手写 NORMAL/PRIORITY 会被 loader 原样透传，所以也得支持。
  //  对齐关系：NORMAL=Low、PRIORITY=High；Parallel 是产物独有的第三档（父子并列响应，不参与独占仲裁）。
  //  ⚠️ 旧实现只定义了 {NORMAL, PRIORITY} → 产物的 `GesturePriority.Low` 是 undefined，三个属性在
  //     运行时**完全区分不开**（都退化成默认档）。这是本轮修掉的 bug。
  const GesturePriority = { NORMAL: 0, PRIORITY: 1, Low: 0, High: 1, Parallel: 2 };
  // .d.ts：GestureMask.Normal = 子组件手势按默认顺序参战；IgnoreInternal = **禁用子组件手势**
  // （含 List 这类内置手势；父子区域部分重叠时只禁重叠区）。后者在仲裁里按"压制所有后代"实现。
  const GestureMask = { Normal: 0, IgnoreInternal: 1 };
  // .d.ts 声明顺序即取值：Sequence / Parallel / Exclusive
  const GestureMode = { Sequence: 0, Parallel: 1, Exclusive: 2 };

  /** @type {any[]} */                   // Gesture.create/pop 的作用域栈
  const gestureScopes = [];
  /** @type {any[]} */                   // 正在构建的手势记录栈（各手势 + 手势组的 create/pop）
  const gestureBuild = [];
  const TAP_SLOP_PX = 10;                // 超过这个位移就不算 tap（ArkUI 内部也有类似的容差）
  const TAP_WINDOW_MS = 300;             // 连续点击的归组窗口

  /** @param {any} [extra] */
  function gestureEvent(extra) {
    // GestureEvent 的字段（.d.ts）：repeat/fingerList/offsetX/offsetY/angle/speed/scale/
    // pinchCenterX/pinchCenterY/velocityX/velocityY/velocity + BaseEvent 的 timestamp
    return Object.assign({
      repeat: false, fingerList: [], offsetX: 0, offsetY: 0, angle: 0, speed: 0,
      scale: 1, pinchCenterX: 0, pinchCenterY: 0,
      velocityX: 0, velocityY: 0, velocity: 0, timestamp: Date.now(),
    }, extra || {});
  }

  // ── 手势仲裁（R23 收口）──
  // 三条规则各有 .d.ts 原文依据，互不干扰：
  //  ① 元素级（父子包含链）—— CommonMethod 的文档原文：
  //      · `gesture`：      「By default, the child component preferentially recognizes the gesture
  //                         specified by gesture」→ 默认【子优先】
  //      · `priorityGesture`：「the parent component preferentially recognizes the gesture specified by
  //                         priorityGesture (if set)」→ 父档位高，压过内层
  //      · `parallelGesture`：「the gesture event is not a bubbling event. When parallelGesture is set
  //                         for a component, both it and its child component can respond to the same
  //                         gesture events」→ 准冒泡，父子都触发
  //      · `GestureMask.IgnoreInternal`：「The gestures of child components are disabled, including the
  //                         built-in gestures」→ 压制所有后代
  //  ② 组级（GestureGroup 三态）—— 见 fireGesture 里的分档处理
  //  ③ 元素内多个作用域：按元素取最高档（block > high > parallel > low），不做逐手势区分
  //
  // 元素级仲裁必须在任何识别结果【之前】定下来：pointer 事件由内向外冒泡，所以内层先"认领"，
  // 外层后到、可以覆盖；识别循环之后只查 isEligible()，不再参与决策。
  const ARB_BLOCK = 'block', ARB_HIGH = 'high', ARB_PARALLEL = 'parallel', ARB_LOW = 'low';
  const gestureSessions = new Map();   // pointerId -> {chain:[el], ownerEl, ownerClass, captureEl}

  /** @param {any[]} records */
  function gestureArbClass(records) {
    let high = false, par = false, block = false;
    for (const r of records) {
      if (r.__mask === GestureMask.IgnoreInternal) block = true;
      if (r.__priority === GesturePriority.High) high = true;
      if (r.__priority === GesturePriority.Parallel) par = true;
    }
    return block ? ARB_BLOCK : (high ? ARB_HIGH : (par ? ARB_PARALLEL : ARB_LOW));
  }

  /** @param {HTMLElement} el @param {any} st @param {PointerEvent} ev */
  function participate(el, st, ev) {
    let s = gestureSessions.get(ev.pointerId);
    if (!s) {
      s = { chain: [], ownerEl: null, ownerClass: null, captureEl: null };
      gestureSessions.set(ev.pointerId, s);
    }
    if (s.chain.indexOf(el) >= 0) return;          // 同一指针不重复参战
    s.chain.push(el);
    const cls = st.arbClass;
    if (cls === ARB_BLOCK || cls === ARB_HIGH) {
      // block 能压过内层任意档；high 只压过内层 low（内层同为 high 时按"内层优先"）
      if (s.ownerEl && (cls === ARB_BLOCK || s.ownerClass === ARB_LOW)) s.ownerEl = null;
      if (!s.ownerEl) { s.ownerEl = el; s.ownerClass = cls; }
    } else if (cls === ARB_PARALLEL) {
      // 不参与独占，但始终可触发（见 gestureArbState）
    } else if (!s.ownerEl) {
      s.ownerEl = el; s.ownerClass = ARB_LOW;
    }
    // 指针捕获只交给【最先见到的那一个】（=最内层）：捕获只改事件的 target，事件仍沿祖先链冒泡，
    // 所以链上每个元素都还收得到；交给最内层，才能让"最内层是 parallel 的子元素"继续收到移动。
    if (!s.captureEl) {
      s.captureEl = el;
      try { el.setPointerCapture(ev.pointerId); } catch (_) { /* 合成事件可能不支持 */ }
    }
  }

  // 元素对外的仲裁结论（也是内省用的口径）：
  //   owner=本次会话归它 / parallel=并列参战 / suppressed=被压制 / idle=没有活跃会话
  /** @param {any} st */
  function gestureArbState(st) {
    let seen = false;
    for (const s of gestureSessions.values()) {
      if (s.chain.indexOf(st.el) < 0) continue;
      seen = true;
      if (s.ownerEl === st.el) return 'owner';
      if (st.arbClass === ARB_PARALLEL) return 'parallel';
    }
    return seen ? 'suppressed' : 'idle';
  }

  // 会话只能由【冒泡路径上最后参战的那个元素】来删：pointerup 会继续往外冒泡，
  // 外层元素还要读同一份仲裁结论。若最内层先删，被压制的祖先就会查不到结论而误触发。
  /** @param {any} st @param {PointerEvent} ev */
  function isSessionTail(st, ev) {
    const s = gestureSessions.get(ev.pointerId);
    return !s || s.chain[s.chain.length - 1] === st.el;
  }

  // "识别完成"对应的回调名（Exclusive 靠它判先后、Sequence 靠它推进阶段）
  /** @type {Record<string, string>} */
  const GESTURE_RECOG_KIND = {
    tap: 'onAction', longPress: 'onAction', pan: 'onActionStart',
    pinch: 'onActionStart', rotation: 'onActionStart', swipe: 'onAction',
  };
  const GESTURE_MODE_NAME = ['Sequence', 'Parallel', 'Exclusive'];
  const GESTURE_MASK_NAME = ['Normal', 'IgnoreInternal'];

  /** @param {any[]} records @param {any[]=} [out] @returns {any[]} */
  function flattenGestures(records, out) {
    const acc = out || [];
    for (const r of records) {
      if (r && r.__isGroup) flattenGestures(r.gestures, acc);
      else if (r) acc.push(r);
    }
    return acc;
  }

  /** @param {any} g */
  function fireGroupCancel(g) {
    if (typeof g.onCancel !== 'function') return;
    try { g.onCancel(); } catch (e) {
      layoutWarnings.push(`手势组 onCancel 回调抛错：${e && e.message}`);
    }
  }

  // 会话收尾（所有指头都抬起 / 被系统取消）：
  //  · Sequence 没走完 = 「某一步没认出 → 后面的不再认」，按文档触发该组 onCancel；
  //  · 指针被 pointercancel 掉、而该组已认出过成员 → 也触发 onCancel。
  // 无论是否触发，都把组状态归零，免得下一次手势继承了上一次的 winner/stage。
  /** @param {any} st @param {boolean} cancelled */
  function settleGroups(st, cancelled) {
    for (const g of st.gestures) {
      if (!g.__isGroup) continue;
      let fire = false;
      if (g.mode === GestureMode.Sequence) fire = g.stage > 0 && g.stage < g.gestures.length;
      else fire = cancelled && !!g.anyRecognized;
      g.winner = null; g.stage = 0; g.anyRecognized = false;
      if (fire) fireGroupCancel(g);
    }
  }

  // 返回值 = 这次回调【有没有被仲裁放行】。识别器只在这个返回 true 时才推进内部状态：
  // 否则会出现"手势标成已开始、但 start 从没发出去"的错位（Sequence 的门控尤其致命）。
  /** @param {any} st @param {any} rec @param {string} kind @param {PointerEvent|ReturnType<typeof gestureEvent>} ev */
  function fireGesture(st, rec, kind, ev) {
    if (!rec) return false;
    if (gestureArbState(st) === 'suppressed') return false;  // ① 元素级（父子链）
    const g = rec.__group;
    if (g) {                                                 // ② 组级
      const recog = GESTURE_RECOG_KIND[rec.type] === kind;
      if (g.mode === GestureMode.Exclusive) {
        if (g.winner && g.winner !== rec) return false;      // 先认出者独占，其余作废
        if (!g.winner && recog) { g.winner = rec; g.anyRecognized = true; }
      } else if (g.mode === GestureMode.Sequence) {
        const i = g.gestures.indexOf(rec);
        if (i > g.stage) return false;                       // 还没轮到它
        if (kind === 'onActionEnd' && i < g.gestures.length - 1) return false;  // 只有最后一个能收 End
        if (i === g.stage && recog) { g.stage = i + 1; g.anyRecognized = true; }
      } else if (recog) {
        g.anyRecognized = true;                              // Parallel：互不影响，只记账
      }
    }
    if (typeof rec[kind] === 'function') {
      try { rec[kind](ev); } catch (e) {
        layoutWarnings.push(`手势 ${rec.type}.${kind} 回调抛错：${e && e.message}`);
      }
    }
    return true;
  }

  /** @param {any} rec @param {number} dx @param {number} dy */
  function gestureDirOk(rec, dx, dy) {
    const d = (rec.params.direction === undefined || rec.params.direction === null)
      ? null : Number(rec.params.direction);
    const horiz = Math.abs(dx) >= Math.abs(dy);
    switch (d) {
      case null: case PanDirection.All: return true;
      case PanDirection.Horizontal: return horiz;
      case PanDirection.Vertical: return !horiz;
      case PanDirection.Left: return dx < 0 && horiz;
      case PanDirection.Right: return dx > 0 && horiz;
      case PanDirection.Up: return dy < 0 && !horiz;
      case PanDirection.Down: return dy > 0 && !horiz;
      default: return true;
    }
  }
  /** @param {any} rec @param {number} dx @param {number} dy */
  function swipeDirOk(rec, dx, dy) {
    const d = (rec.params.direction === undefined || rec.params.direction === null)
      ? SwipeDirection.All : Number(rec.params.direction);
    const horiz = Math.abs(dx) >= Math.abs(dy);
    if (d === SwipeDirection.All) return true;
    if (d === SwipeDirection.Horizontal) return horiz;
    if (d === SwipeDirection.Vertical) return !horiz;
    return true;
  }

  // RotationGesture 的角度（.d.ts 原文）：
  //   "the line connecting the two fingers is identified as the starting line ... The rotation angle is
  //    calculated as arctan2(cy2-cy1, cx2-cx1) - arctan2(y2-y1, x2-x1). With the starting line as the
  //    reference axis, clockwise rotation ranges from 0 to 180 degrees, and counterclockwise ... 0 to -180"
  // 屏幕坐标 y 向下，故 atan2 的顺时针为正，正好对上；归一化到 [−180, 180]。
  const RAD2DEG = 180 / Math.PI;
  /** @param {{x: number, y: number}} p @param {{x: number, y: number}} q */
  const lineDeg = (p, q) => Math.atan2(q.y - p.y, q.x - p.x) * RAD2DEG;
  /** @param {number} a */
  const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  /** @param {any} startLine @param {{x: number, y: number}} p0 @param {{x: number, y: number}} p1 */
  function rotationDeltaDeg(startLine, p0, p1) {
    if (!startLine) return 0;
    return norm180(lineDeg(p0, p1) - lineDeg({ x: startLine.x1, y: startLine.y1 },
      { x: startLine.x2, y: startLine.y2 }));
  }

  /** @param {any} el */
  function detachGestures(el) {
    const st = el && el.__arkuiGestureState;
    if (!st) return;
    for (const [k, fn] of st.listeners) el.removeEventListener(k, fn);
    for (const rs of st.longPress) if (rs.timer) clearTimeout(rs.timer);
    if (st.tapTimer) clearTimeout(st.tapTimer);
    el.__arkuiGestureState = null;
  }
  /** @param {any} el @returns {any[]} */
  function gestureTypes(el) {
    const st = el && el.__arkuiGestureState;
    return st ? st.gestures.map((/** @type {any} */ g) => (g.__isGroup ? 'group' : g.type)) : [];
  }
  /** @param {any} el @returns {any[]} */
  function gestureGroups(el) {
    const st = el && el.__arkuiGestureState;
    if (!st) return [];
    return st.gestures.filter((/** @type {any} */ g) => g.__isGroup).map((/** @type {any} */ g) => ({
      mode: GESTURE_MODE_NAME[g.mode] || String(g.mode),
      members: flattenGestures(g.gestures).map((/** @type {any} */ x) => x.type),
    }));
  }

  /** @param {HTMLElement} el @param {any[]} gestures @returns {any} */
  function attachGestures(el, gestures) {
    detachGestures(el);
    // @type 档位：listeners/longPress 不写会推成 never[]，push 全红；tapTimer null↔number 摆动；
    // arbClass 等字段是挂上后才有的 → 整袋 any（识别器状态的形状本来就是动态的）
    const st = /** @type {any} */ ({
      el,
      gestures: gestures.slice(), listeners: [], longPress: [],
      ptrs: new Map(), recState: new Map(), tapCount: 0, tapTimer: null,
    });
    st.arbClass = gestureArbClass(st.gestures);
    // 识别循环一律跑【摊平后】的手势表：组只是登记层，识别与回调仍在元素这一层做
    const flat = flattenGestures(st.gestures);
    el.__arkuiGestureState = st;
    /** @param {string} k @param {(ev: PointerEvent) => void} fn */
    const on = (k, fn) => { el.addEventListener(k, fn); st.listeners.push([k, fn]); };
    const primary = () => {
      let best = null;
      for (const p of st.ptrs.values()) if (!best || p.seq < best.seq) best = p;
      return best;
    };
    const clearLongPress = () => {
      for (const rs of st.longPress) { if (rs.timer) clearTimeout(rs.timer); rs.timer = null; }
      st.longPress = [];
    };

    /** @param {PointerEvent} ev */
    const onDown = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      st.ptrs.set(ev.pointerId, {
        seq: st.ptrs.size, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY,
        x: ev.clientX, y: ev.clientY, t: Date.now(),
      });
      // 先定仲裁（内含指针捕获，见 participate），再让识别器开局
      participate(el, st, ev);
      for (const rec of flat) {
        if (rec.type === 'longPress') {
          const dur = rec.params.duration === undefined ? 500 : Number(rec.params.duration);
          const rs = /** @type {any} */ ({ rec, timer: null, fired: 0, dur });
          const tick = () => {
            fireGesture(st, rec, 'onAction', gestureEvent({ repeat: rs.fired > 0 }));
            rs.fired++;
            if (rec.params.repeat === true) rs.timer = setTimeout(tick, dur);
          };
          rs.timer = setTimeout(tick, dur);
          st.longPress.push(rs);
        } else if (rec.type === 'pinch') {
          // d0（初始两指距离）必须在【第二个指针按下时】取，而不是"第一次 move" ——
          // 否则第一帧的移动会被当成基准，scale 永远从 1 开始（实测踩到）
          let d0 = 0;
          if (st.ptrs.size >= 2) {
            const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
            d0 = Math.hypot(arr[1].x - arr[0].x, arr[1].y - arr[0].y);
          }
          st.recState.set(rec, { started: false, d0 });
        } else if (rec.type === 'pan') {
          st.recState.set(rec, { started: false });
        } else if (rec.type === 'rotation') {
          // 起始线取【第二指按下时】的两指连线 —— 与 pinch 的 d0 同一时机。
          // （.d.ts 说"detected 时"，但那一刻基准已被首帧位移吃掉；取按下时刻更确定，
          //   两者差异的上界恰好就是 angle 阈值本身。）
          let startLine = null;
          if (st.ptrs.size >= 2) {
            const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
            startLine = { x1: arr[0].x, y1: arr[0].y, x2: arr[1].x, y2: arr[1].y };
          }
          st.recState.set(rec, { started: false, startLine });
        }
      }
    };

    /** @param {PointerEvent} ev */
    const onMove = (ev) => {
      const p = st.ptrs.get(ev.pointerId);
      if (!p) return;
      p.x = ev.clientX; p.y = ev.clientY;
      const first = primary();
      const dx = first ? first.x - first.x0 : 0;
      const dy = first ? first.y - first.y0 : 0;
      const dist = Math.hypot(dx, dy);
      if (dist > TAP_SLOP_PX) clearLongPress();            // 动了就不算长按
      for (const rec of flat) {
        if (rec.type === 'pan') {
          const th = rec.params.distance === undefined ? 5 : Number(rec.params.distance);
          const rs = st.recState.get(rec) || { started: false };
          st.recState.set(rec, rs);
          if (!rs.started) {
            // 只有回调真的发出去（没被组仲裁挡下）才把识别器标成已开始
            if (dist >= th && gestureDirOk(rec, dx, dy)
              && fireGesture(st, rec, 'onActionStart', gestureEvent({ offsetX: dx, offsetY: dy }))) {
              rs.started = true;
            }
          } else if (gestureDirOk(rec, dx, dy)) {
            fireGesture(st, rec, 'onActionUpdate', gestureEvent({ offsetX: dx, offsetY: dy }));
          }
        } else if (rec.type === 'pinch' && st.ptrs.size >= 2) {
          const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
          const d = Math.hypot(arr[1].x - arr[0].x, arr[1].y - arr[0].y);
          const rs = st.recState.get(rec) || { started: false, d0: 0 };
          st.recState.set(rec, rs);
          const th = rec.params.distance === undefined ? 5 : Number(rec.params.distance);
          if (!rs.started) {
            if (rs.d0 === 0) rs.d0 = d;
            else if (Math.abs(d - rs.d0) >= th
              && fireGesture(st, rec, 'onActionStart', gestureEvent({
                scale: d / rs.d0,
                pinchCenterX: (arr[0].x + arr[1].x) / 2, pinchCenterY: (arr[0].y + arr[1].y) / 2,
              }))) {
              rs.started = true;
            }
          } else {
            fireGesture(st, rec, 'onActionUpdate', gestureEvent({
              scale: d / rs.d0,
              pinchCenterX: (arr[0].x + arr[1].x) / 2, pinchCenterY: (arr[0].y + arr[1].y) / 2,
            }));
          }
        } else if (rec.type === 'rotation' && st.ptrs.size >= 2) {
          const arr = [...st.ptrs.values()].sort((/** @type {any} */ a, /** @type {any} */ b) => a.seq - b.seq);
          const rs = st.recState.get(rec) || { started: false, startLine: null };
          st.recState.set(rec, rs);
          if (!rs.startLine) {
            rs.startLine = { x1: arr[0].x0, y1: arr[0].y0, x2: arr[1].x0, y2: arr[1].y0 };
          }
          rs.angle = rotationDeltaDeg(rs.startLine, arr[0], arr[1]);
          const th = rec.params.angle === undefined ? 1 : Number(rec.params.angle);
          if (!rs.started) {
            if (Math.abs(rs.angle) >= th
              && fireGesture(st, rec, 'onActionStart', gestureEvent({ angle: rs.angle }))) {
              rs.started = true;
            }
          } else {
            fireGesture(st, rec, 'onActionUpdate', gestureEvent({ angle: rs.angle }));
          }
        }
      }
    };

    /** @param {PointerEvent} ev */
    const onUp = (ev) => {
      const p = st.ptrs.get(ev.pointerId);
      if (!p) return;
      st.ptrs.delete(ev.pointerId);
      const dx = ev.clientX - p.x0;
      const dy = ev.clientY - p.y0;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, Date.now() - p.t);
      clearLongPress();
      const isLast = st.ptrs.size === 0;
      for (const rec of flat) {
        if (rec.type === 'pan') {
          const rs = st.recState.get(rec) || {};
          if (rs.started) {
            fireGesture(st, rec, 'onActionEnd', gestureEvent({ offsetX: dx, offsetY: dy }));
            rs.started = false;
          }
        } else if (rec.type === 'pinch') {
          const rs = st.recState.get(rec) || {};
          if (rs.started && st.ptrs.size < 2) {
            fireGesture(st, rec, 'onActionEnd', gestureEvent({ scale: rs.d0 ? 1 : 1 }));
            rs.started = false;
          }
        } else if (rec.type === 'rotation') {
          const rs = st.recState.get(rec) || {};
          if (rs.started && st.ptrs.size < 2) {
            // 结束时用【最后一次算出的角度】——抬手后再没有两指连线可算
            fireGesture(st, rec, 'onActionEnd', gestureEvent({ angle: rs.angle || 0 }));
            rs.started = false;
          }
        } else if (rec.type === 'tap') {
          if (dist <= TAP_SLOP_PX) {
            const count = rec.params.count === undefined ? 1 : Number(rec.params.count);
            st.tapCount++;
            if (st.tapTimer) clearTimeout(st.tapTimer);
            st.tapTimer = setTimeout(() => { st.tapCount = 0; st.tapTimer = null; }, TAP_WINDOW_MS);
            if (st.tapCount % count === 0) {
              fireGesture(st, rec, 'onAction', gestureEvent({ repeat: st.tapCount > count }));
            }
          }
        } else if (rec.type === 'swipe' && isLast) {
          // .d.ts：speed 单位 vp/s；angle 以水平向右为基准，顺时针 0~180、逆时针 0~-180
          const speed = (dist / dt) * 1000;
          const th = rec.params.speed === undefined ? 100 : Number(rec.params.speed);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (speed >= th && swipeDirOk(rec, dx, dy)) {
            fireGesture(st, rec, 'onAction', gestureEvent({ angle, speed }));
          }
        }
      }
      // 收尾必须在识别循环【之后】：tap 的识别就发生在本次 pointerup 里，
      // Sequence 的"有没有走完"要看到它刚推进过的阶段。
      if (isLast) settleGroups(st, false);
      if (isLast && isSessionTail(st, ev)) gestureSessions.delete(ev.pointerId);
    };

    /** @param {PointerEvent} ev */
    const onCancel = (ev) => {
      const p = st.ptrs.get(ev.pointerId);
      if (p) st.ptrs.delete(ev.pointerId);
      clearLongPress();
      for (const rec of flat) {
        const rs = st.recState.get(rec) || {};
        if ((rec.type === 'pan' || rec.type === 'pinch' || rec.type === 'rotation') && rs.started) {
          fireGesture(st, rec, 'onActionCancel', gestureEvent({}));
          rs.started = false;
        }
      }
      if (st.ptrs.size === 0) settleGroups(st, true);
      if (st.ptrs.size === 0 && isSessionTail(st, ev)) gestureSessions.delete(ev.pointerId);
    };

    on('pointerdown', onDown);
    on('pointermove', onMove);
    on('pointerup', onUp);
    on('pointercancel', onCancel);
    return st;
  }

  // 手势构建器：`XxxGesture.create(params)` → `.on*（cb）` → `.pop()`
  /** @type {Record<string, string>} */
  const GESTURE_TYPES = {
    TapGesture: 'tap', LongPressGesture: 'longPress', PanGesture: 'pan',
    SwipeGesture: 'swipe', PinchGesture: 'pinch', RotationGesture: 'rotation',
  };
  // 收一个手势/手势组：归入【最近一层容器】——有手势组就进组，否则进当前手势作用域。
  // 产物里组是嵌套的（组内 `XxxGesture.pop()` 之后才 `GestureGroup.pop()`），
  // 所以要从栈顶往下找最近的组，而不是只看栈顶。
  /** @param {any} rec */
  function pushGestureRecord(rec) {
    if (!rec) return;
    for (let i = gestureBuild.length - 1; i >= 0; i--) {
      if (gestureBuild[i].__isGroup) { gestureBuild[i].gestures.push(rec); rec.__group = gestureBuild[i]; return; }
    }
    const scope = gestureScopes[gestureScopes.length - 1];
    if (!scope) {
      layoutWarnings.push(`${rec.name || rec.type}.pop() 不在任何 Gesture.create() 作用域里 —— 手势无处挂载`);
      return;
    }
    rec.__priority = scope.priority;
    rec.__mask = scope.mask;
    scope.list.push(rec);
  }

  /** @param {string} name */
  function makeGestureBuilder(name) {
    const type = GESTURE_TYPES[name];
    const impl = {
      /** @param {any} params */
      create(params) {
        const rec = { type, name, params: (params && typeof params === 'object') ? params : {}, seq: gestureSeq++ };
        gestureBuild.push(rec);
        return rec;
      },
      pop() {
        pushGestureRecord(gestureBuild.pop());
      },
    };
    // 未列举的 on* 方法一律当"回调 setter"（onAction/onActionStart/onActionUpdate/onActionEnd/onActionCancel）
    return new Proxy(impl, {
      get(/** @type {any} */ target, key) {
        if (key in target) return target[key];
        if (typeof key === 'symbol') return undefined;
        let fn = target['__' + String(key)];
        if (!fn) {
          /** @param {any} cb */
          fn = function (cb) {
            const rec = gestureBuild[gestureBuild.length - 1];
            if (!rec) {
              layoutWarnings.push(`${name}.${String(key)}() 不在任何手势的 create 之后 —— 回调无处安放`);
              return undefined;
            }
            rec[String(key)] = cb;
            return undefined;
          };
          target['__' + String(key)] = fn;
        }
        return fn;
      },
    });
  }
  // GestureGroup 走同一套 create/on*/pop 协议，但它是【容器】：产物里
  //   GestureGroup.create(mode) → GestureGroup.onCancel(cb) → 组内各手势 create/on*/pop → GestureGroup.pop()
  // 组状态（winner/stage/anyRecognized）挂在组记录上，识别时由 rec.__group 反查（见 fireGesture）。
  const GestureGroup = new Proxy({
    /** @param {any} mode */
    create(mode) {
      const g = {
        __isGroup: true, name: 'GestureGroup', type: 'group',
        mode: mode === undefined ? GestureMode.Sequence : mode,
        gestures: [], winner: null, stage: 0, anyRecognized: false, seq: gestureSeq++,
      };
      gestureBuild.push(g);
      return g;
    },
    pop() {
      const g = gestureBuild.pop();
      for (let i = gestureBuild.length - 1; i >= 0; i--) {
        if (gestureBuild[i].__isGroup) {
          gestureBuild[i].gestures.push(g); g.__group = gestureBuild[i];
          return;
        }
      }
      const scope = gestureScopes[gestureScopes.length - 1];
      if (!scope) {
        layoutWarnings.push('GestureGroup.pop() 不在任何 Gesture.create() 作用域里 —— 手势组无处挂载');
        return;
      }
      g.__priority = scope.priority;
      g.__mask = scope.mask;
      scope.list.push(g);
    },
  }, {
    get(/** @type {any} */ target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      let fn = target['__' + String(key)];
      if (!fn) {
        /** @param {any} cb */
        fn = function (cb) {
          const g = gestureBuild[gestureBuild.length - 1];
          if (!g || !g.__isGroup) {
            layoutWarnings.push(`GestureGroup.${String(key)}() 不在任何 GestureGroup.create() 之后 —— 回调无处安放`);
            return undefined;
          }
          g[String(key)] = cb;
          return undefined;
        };
        target['__' + String(key)] = fn;
      }
      return fn;
    },
  });
  let gestureSeq = 0;
  /** @type {Record<string, any>} */
  const gestureBuilders = {};
  for (const name of Object.keys(GESTURE_TYPES)) gestureBuilders[name] = makeGestureBuilder(name);

  const Gesture = {
    // 产物是两参形式：Gesture.create(GesturePriority.Low|High|Parallel[, GestureMask.Xxx])
    /** @param {any} [priority] @param {any=} [mask] */
    create(priority, mask) {
      gestureScopes.push({
        priority: priority === undefined ? GesturePriority.Low : priority,
        mask: mask === undefined ? GestureMask.Normal : mask,
        list: [],
      });
    },
    pop() {
      const scope = gestureScopes.pop();
      if (!scope) {
        layoutWarnings.push('Gesture.pop() 没有对应的 Gesture.create()');
        return;
      }
      const el = ViewStackProcessor.top();
      if (!el) {
        layoutWarnings.push(`Gesture.pop() 时组件栈是空的 —— 手势（${scope.list.map((/** @type {any} */ g) => g.type).join(',')}）无处可挂`);
        return;
      }
      scheduleGestureAttach(el, scope.list);
    },
  };
  let gestureAttachCount = 0;
  // 同一元素上可能开了多个手势作用域（`.gesture` 之外还有 priorityGesture/parallelGesture 之类），
  // 所以先按元素累积、到微任务再一次性挂载 —— 这样"一次渲染"里是【合并】，
  // 而"下一次渲染"是【替换】（否则重渲染会把回调叠成两份，回调被触发两次）。
  const pendingGestureAttach = new Map();
  let pendingAttachScheduled = false;
  /** @param {any} el @param {any[]} records */
  function scheduleGestureAttach(el, records) {
    const list = pendingGestureAttach.get(el) || [];
    for (const r of records) list.push(r);
    pendingGestureAttach.set(el, list);
    if (pendingAttachScheduled) return;
    pendingAttachScheduled = true;
    Promise.resolve().then(() => {
      pendingAttachScheduled = false;
      for (const [element, recs] of pendingGestureAttach) {
        attachGestures(element, recs);
        gestureAttachCount++;
      }
      pendingGestureAttach.clear();
    });
  }
