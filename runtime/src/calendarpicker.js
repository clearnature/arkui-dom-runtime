  // ────────────────── CalendarPicker 日期选择入口（R54）──────────────────
  //
  // 产物形态（实测 fixtures/pages/CalendarPickerDemo.ts）：
  //   CalendarPicker.create({ selected, start?, end?, disabledDateRange?, hintRadius? });
  //   CalendarPicker.edgeAlign(CalendarAlign.START); CalendarPicker.markToday(true);
  //   CalendarPicker.textStyle({...}); CalendarPicker.onChange((d: Date) => …);
  //   CalendarPickerDialog.show({ selected, onAccept, onCancel, onChange? });
  //
  // 真机结构（calendar_picker_model_ng.cpp LayoutPicker:89-113 / calendar_picker_pattern.cpp）：
  //   入口 = 年/月/日三段文本 + 加/减两按钮；点日期段 → ShowDialog + 记活动段（:404-427）；
  //   点 +/- → HandleAddButtonClick(:561-584)：NextDateBySelectedType 步进活动段 →
  //   GetAvailableNextDay 跳过 disabledDateRange 且夹在 [start,end]（无可到日返回 year<=0
  //   哨兵 → 不动不发）→ SetDate + FireChangeEvents——【+/- 也触发 onChange】；
  //   非 YEAR/MONTH 段步进后回贴 DAY（:420-430）。
  // 弹层（calendar_dialog_pattern.cpp）：点日期 → ReportChangeEvent("CalendarPicker","onChange")
  //   由 CanReportChangeEvent 同值不重发（:1615-1620）；弹层不因点日期关闭
  //   （OK=accept 关、外点=cancel 关）。月历首列【周日】（calendar_paint_method.cpp:531
  //   weekNumbers_[(startOfWeek_+1)%7]，startOfWeek_ 默认 64→log2=6→首列=weekNumbers_[0]=SUN）。
  // selected 缺省/非法 → 系统今天（.d.ts:101）；AdjustDateToRange 夹入 [start,end]（model_ng:98）。
  // DOM 映射：入口 inline-flex（span 三段 + button 两枚）；弹层 = 入口内绝对定位面板
  //   （edgeAlign START/CENTER/END → left/居中/right，缺省 END .d.ts:198）；网格 7 列 grid，
  //   前置空格 = 首日 getDay()（周日=0）；语言取 zh（本项目夹具环境，标注）。
  const CALP_WEEK = ['日', '一', '二', '三', '四', '五', '六'];   // 首列周日（真机同序）
  const calpDaysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const calpDateOf = (p) => new Date(p.y, p.m, p.d);
  const calpPartsOf = (date) => ({ y: date.getFullYear(), m: date.getMonth(), d: date.getDate() });
  const calpLe = (a, b) => calpDateOf(a).getTime() <= calpDateOf(b).getTime();
  const calpLt = (a, b) => calpDateOf(a).getTime() < calpDateOf(b).getTime();
  const calpEq = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
  // AdjustDateToRange（calendar_picker_model_ng.cpp:98）：夹入 [start,end]
  const calpAdjust = (p, start, end) => {
    if (start && calpLt(p, start)) return Object.assign({}, start);   // p 在 start 前 → 抬到 start
    if (end && calpLt(end, p)) return Object.assign({}, end);         // p 在 end 后 → 压到 end
    return p;
  };
  // hintRadius（.d.ts:73-83）：0=直角矩形、(0,16)=圆角 px、负数或>16=回落缺省 16（圆形 → 50%）
  const calpRadius = (hr) => (hr === undefined || hr === null || hr < 0 || hr > 16)
    ? '50%' : (hr === 0 ? '0px' : `${hr}px`);
  // 禁用判定：越 [start,end] 边界，或落在任一 disabledDateRange 区间内
  const calpDisabled = (p, st) => {
    if (st.start && !calpLe(st.start, p)) return true;
    if (st.end && !calpLe(p, st.end)) return true;
    return (st.dis || []).some((r) => calpLe(r.start, p) && calpLe(p, r.end));
  };
  // GetAvailableNextDay（:563-566）：从 p 沿 dir 找第一个可用日；无可到日返 null（=真机 year<=0 哨兵）
  const calpNextAvail = (p, dir, st) => {
    let cur = Object.assign({}, p);
    for (let i = 0; i < 4000; i++) {
      const cand = calpPartsOf(new Date(cur.y, cur.m, cur.d + dir));
      if (calpDisabled(cand, st)) { cur = cand; continue; }
      return cand;
    }
    return null;
  };
  const calpRender = (el) => {
    const st = /** @type {any} */ (el).__calp;
    el.querySelectorAll('[data-cal-seg]').forEach((s) => {
      const k = s.getAttribute('data-cal-seg');
      s.textContent = k === 'year' ? `${st.sel.y}年` : k === 'month' ? `${st.sel.m + 1}月` : `${st.sel.d}日`;
    });
  };
  const calpFire = (el, date) => {
    const st = /** @type {any} */ (el).__calp;
    if (typeof st.cbs.change !== 'function') return;
    try { st.cbs.change(date); }
    catch (e) { layoutWarnings.push(`CalendarPicker.onChange 回调抛错：${e && e.message}`); }
  };
  // 入口 +/-（真机 HandleAddButtonClick/HandleSubButtonClick 全流程）
  const calpStep = (el, dir) => {
    const st = /** @type {any} */ (el).__calp;
    let cand;
    if (st.seg === 'year') cand = Object.assign({}, st.sel, { y: st.sel.y + dir });
    else if (st.seg === 'month') {
      cand = calpPartsOf(new Date(st.sel.y, st.sel.m + dir, 1));
      const dim = calpDaysIn(cand.y, cand.m);
      if (st.sel.d > dim) cand.d = dim;                      // 步月：日超出当月则贴月末
    } else cand = Object.assign({}, st.sel);
    const avail = calpNextAvail(cand, dir, st) || cand;
    if (calpEq(avail, st.sel)) return;                       // 无可到日：不动不发（真机 year<=0）
    if (st.seg !== 'year' && st.seg !== 'month') st.seg = 'day';   // 真机：非年月段回贴 DAY
    st.sel = avail;
    calpRender(el);
    calpFire(el, calpDateOf(st.sel));
  };
  const CALPICK_ATTRS = {
    edgeAlign: (n, v) => {
      const a = Number(resolveResource(v));                  // START=0 CENTER=1 END=2（.d.ts 显式）
      n.dataset.align = String(a);
      (/** @type {any} */ (n).__calp).align = a;
    },
    textStyle: (n, v) => {
      const o = v || {};
      n.dataset.textStyle = 'set';
      n.querySelectorAll('[data-cal-seg]').forEach((s) => {
        if (o.color !== undefined) s.style.color = colorOf(o.color);
        if (o.font && o.font.size !== undefined) s.style.fontSize = toCssSize(o.font.size);
        if (o.font && o.font.weight !== undefined) s.style.fontWeight = String(resolveResource(o.font.weight));
      });
    },
    markToday: (n, v) => {
      (/** @type {any} */ (n).__calp).markToday = v === true;   // 状态必须接线（首跑抓到只写 dataset）
      n.dataset.markToday = String(v === true);
    },
    onChange: (n, v) => { (/** @type {any} */ (n).__calp).cbs.change = v; },
  };
  // 弹层网格（组件弹层与静态 Dialog 共用）：首列周日、前置空格、选中/禁用/今天标记
  const calpBuildGrid = (grid, st, onChangeTap) => {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    const render = () => {
      grid.textContent = '';
      CALP_WEEK.forEach((w) => {
        const c = document.createElement('span');
        c.setAttribute('data-cal-wk', '');
        c.textContent = w;
        grid.appendChild(c);
      });
      for (let i = 0; i < new Date(st.view.y, st.view.m, 1).getDay(); i++) {
        grid.appendChild(document.createElement('span'));    // 前置空格 = 首日 getDay()（周日=0）
      }
      const dim = calpDaysIn(st.view.y, st.view.m);
      for (let d = 1; d <= dim; d++) {
        const p = { y: st.view.y, m: st.view.m, d };
        const cell = document.createElement('button');
        cell.setAttribute('data-cal-day', String(d));
        cell.textContent = String(d);
        if (calpEq(p, st.sel)) {
          cell.setAttribute('data-cal-selected', 'true');
          cell.style.borderRadius = calpRadius(st.hr);       // hintRadius 视觉（缺省圆形）
        }
        if (calpDisabled(p, st)) cell.setAttribute('data-cal-disabled', 'true');
        if (st.markToday && calpEq(p, calpPartsOf(new Date()))) cell.setAttribute('data-cal-today', 'true');
        cell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (calpDisabled(p, st)) return;                   // 禁用日点击忽略
          const prevSel = st.sel;
          st.sel = p;
          if (!calpEq(prevSel, p) && onChangeTap) onChangeTap(calpDateOf(p));   // 同值不重发
          render();
        });
        grid.appendChild(cell);
      }
    };
    render();
    return render;
  };
  const calpOpenDialog = (el) => {
    const st = /** @type {any} */ (el).__calp;
    if (st.dlg && el.contains(st.dlg)) return;               // IsDialogShow 守卫（:536）
    st.view = { y: st.sel.y, m: st.sel.m };                  // 打开时落在 selected 所在月
    const dlg = document.createElement('div');
    dlg.setAttribute('data-arkui-calpick-dlg', '');
    dlg.setAttribute('data-open', 'true');
    const a = st.align;
    if (a === 0) dlg.style.left = '0px';
    else if (a === 1) { dlg.style.left = '50%'; dlg.style.transform = 'translateX(-50%)'; }
    else dlg.style.right = '0px';                            // 缺省 END（.d.ts:198）
    dlg.style.top = el.offsetHeight + 'px';
    const title = document.createElement('div');
    title.setAttribute('data-cal-title', '');
    const prev = document.createElement('button');
    prev.setAttribute('data-cal-prev', ''); prev.textContent = '‹';
    const next = document.createElement('button');
    next.setAttribute('data-cal-next', ''); next.textContent = '›';
    const tt = document.createElement('span');
    title.appendChild(prev); title.appendChild(tt); title.appendChild(next);
    const grid = document.createElement('div');
    grid.setAttribute('data-cal-grid', '');
    const renderGrid = calpBuildGrid(grid, st, (date) => calpFire(el, date));
    prev.addEventListener('click', (ev) => {
      ev.stopPropagation();
      st.view = calpPartsOf(new Date(st.view.y, st.view.m - 1, 1));
      tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
      renderGrid();
    });
    next.addEventListener('click', (ev) => {
      ev.stopPropagation();
      st.view = calpPartsOf(new Date(st.view.y, st.view.m + 1, 1));
      tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
      renderGrid();
    });
    tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
    dlg.appendChild(title);
    dlg.appendChild(grid);
    dlg.addEventListener('click', (ev) => ev.stopPropagation());   // 弹层内点击不算外点
    el.appendChild(dlg);
    st.dlg = dlg;
    setTimeout(() => {                                       // 开层这一笔点击不能自己关自己
      st.outside = (ev) => {
        if (!el.contains(ev.target)) calpCloseDialog(el);
      };
      document.addEventListener('click', st.outside);
    }, 0);
  };
  const calpCloseDialog = (el) => {
    const st = /** @type {any} */ (el).__calp;
    if (st.dlg && st.dlg.parentNode) st.dlg.parentNode.removeChild(st.dlg);
    st.dlg = null;
    if (st.outside) {
      document.removeEventListener('click', st.outside);
      st.outside = null;
    }
  };
  const CalendarPicker = ensureComponent('CalendarPicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiCalPick = true;
    el.dataset.calPick = '';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.position = 'relative';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const st = /** @type {any} */ (el).__calp = /** @type {any} */ ({
      sel: null, start: null, end: null, dis: [], hr: undefined,
      align: 2, markToday: false, seg: 'day', cbs: {}, dlg: null, outside: null, view: null,
    });
    if (o.start instanceof Date) { st.start = calpPartsOf(o.start); el.dataset.start = calpIso(o.start); }
    if (o.end instanceof Date) { st.end = calpPartsOf(o.end); el.dataset.end = calpIso(o.end); }
    if (Array.isArray(o.disabledDateRange)) {
      st.dis = o.disabledDateRange
        .filter((r) => r && r.start instanceof Date && r.end instanceof Date)
        .map((r) => ({ start: calpPartsOf(r.start), end: calpPartsOf(r.end) }));
      el.dataset.disabledRange = String(st.dis.length);
    }
    st.sel = o.selected instanceof Date
      ? calpPartsOf(o.selected)
      : calpPartsOf(new Date());                             // 缺省 = 系统今天（.d.ts:101）
    st.sel = calpAdjust(st.sel, st.start, st.end);           // AdjustDateToRange
    if (o.hintRadius !== undefined) st.hr = Number(resolveResource(o.hintRadius));
    el.dataset.hintRadius = String(st.hr === undefined ? 16 : st.hr);   // 缺省 16（.d.ts:85）
    el.dataset.align = '2';                                  // 缺省 END（.d.ts:198）
    el.dataset.markToday = 'false';                          // 缺省 false（.d.ts:291）
    ['year', 'month', 'day'].forEach((k) => {
      const s = document.createElement('span');
      s.setAttribute('data-cal-seg', k);
      s.style.cursor = 'pointer';
      s.addEventListener('click', (ev) => {
        ev.stopPropagation();
        st.seg = k;                                          // 点段：记活动段 + 开弹层（真机 :404-427）
        calpOpenDialog(el);
      });
      el.appendChild(s);
    });
    const sub = document.createElement('button');
    sub.setAttribute('data-cal-btn', 'sub');
    sub.textContent = '−';
    sub.addEventListener('click', (ev) => { ev.stopPropagation(); calpStep(el, -1); });
    const add = document.createElement('button');
    add.setAttribute('data-cal-btn', 'add');
    add.textContent = '+';
    add.addEventListener('click', (ev) => { ev.stopPropagation(); calpStep(el, 1); });
    el.appendChild(sub);
    el.appendChild(add);
    el.addEventListener('click', () => calpOpenDialog(el));  // 其余区域点击 → 开弹层（:440）
    calpRender(el);
    return el;
  });
  const calpIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  // CalendarPickerDialog.show（静态弹层）：带 OK/Cancel（onAccept/onCancel，.d.ts:332-344）。
  // 与组件弹层共用 calpBuildGrid；面板 fixed 居中（DOM 无 OverlayManager 弹簧动画，标注）。
  const CalendarPickerDialog = {
    show(options) {
      const o = options || {};
      const host = document.createElement('div');
      host.setAttribute('data-arkui-calpick-static', '');
      host.setAttribute('data-open', 'true');
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.top = '50%';
      host.style.transform = 'translate(-50%, -50%)';
      host.style.zIndex = '9999';
      const st = {
        sel: o.selected instanceof Date ? calpPartsOf(o.selected) : calpPartsOf(new Date()),
        start: o.start instanceof Date ? calpPartsOf(o.start) : null,
        end: o.end instanceof Date ? calpPartsOf(o.end) : null,
        dis: Array.isArray(o.disabledDateRange)
          ? o.disabledDateRange
            .filter((r) => r && r.start instanceof Date && r.end instanceof Date)
            .map((r) => ({ start: calpPartsOf(r.start), end: calpPartsOf(r.end) }))
          : [],
        hr: o.hintRadius !== undefined ? Number(resolveResource(o.hintRadius)) : undefined,
        align: 1, markToday: o.markToday === true, seg: 'day',
        cbs: {}, dlg: null, outside: null,
        view: { y: 0, m: 0 },
      };
      st.view = { y: st.sel.y, m: st.sel.m };
      const title = document.createElement('div');
      title.setAttribute('data-cal-title', '');
      const tt = document.createElement('span');
      tt.textContent = `${st.view.y}年${st.view.m + 1}月`;
      title.appendChild(tt);
      const grid = document.createElement('div');
      grid.setAttribute('data-cal-grid', '');
      calpBuildGrid(grid, st, (date) => {
        if (typeof o.onChange === 'function') {
          try { o.onChange(date); }
          catch (e) { layoutWarnings.push(`CalendarPickerDialog.onChange 抛错：${e && e.message}`); }
        }
      });
      const ok = document.createElement('button');
      ok.setAttribute('data-cal-ok', '');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        close();
        if (typeof o.onAccept === 'function') {
          try { o.onAccept(calpDateOf(st.sel)); }
          catch (e) { layoutWarnings.push(`CalendarPickerDialog.onAccept 抛错：${e && e.message}`); }
        }
      });
      const cancel = document.createElement('button');
      cancel.setAttribute('data-cal-cancel', '');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        close();
        if (typeof o.onCancel === 'function') {
          try { o.onCancel(); }
          catch (e) { layoutWarnings.push(`CalendarPickerDialog.onCancel 抛错：${e && e.message}`); }
        }
      });
      host.appendChild(title);
      host.appendChild(grid);
      host.appendChild(ok);
      host.appendChild(cancel);
      const close = () => { if (host.parentNode) host.parentNode.removeChild(host); };
      document.body.appendChild(host);
    },
  };
