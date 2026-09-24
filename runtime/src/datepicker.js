  // ────────────────── DatePicker 三列滚轮选择器（R51）──────────────────
  //
  // 产物形态（实测 fixtures/pages/DatePickerDemo.ts）：
  //   DatePicker.create({start, end, selected, mode?});
  //   DatePicker.onChange((v: DatePickerResult) => …);   ← {year, month(0 基), day}
  //   DatePicker.onDateChange((d: Date) => …);            ← 年月日按选择、时分取当前、秒 0
  //   DatePicker.lunar(v); .canLoop(v); .digitalCrownSensitivity(v); .enableHapticFeedback(v);
  //
  // DOM 映射：根 = div（overflow hidden），三列（year/month/day）各 5 行可见、行高 40px。
  // 选中行 = 中行（index 2），±1 候选，±2 边缘渐隐。wheel deltaY<0 = 上一步（值+1）、
  // deltaY>0 = 下一步（值−1）（真机 AXIS+MOUSE 同步单步，picker_column_pattern.cpp:506-510）。
  // 跨列联动：month/day 变更 → 重算 day 列选项并夹取（真机 HandleSolarMonthChange）。
  // start/end 钳制：selected 夹入 [start, end]（真机 AdjustSolarDate）。设了 start/end 则
  // canLoop 强制 false（真机 OnModifyDone:486）。lunar 不实现（记警告，无农历换算）。
  const DP_ROW_H = 40;
  const DP_ROWS = 5;
  const DP_COLOR_DIS = 'rgb(24, 36, 49)';
  const DP_COLOR_SEL = 'rgb(0, 125, 255)';
  const dpDaysInMonth = (y, m) => new Date(y, m, 0).getDate();   // m=1..12
  const DATEPICKER_ATTRS = {
    lunar: (n, v) => {
      n.dataset.dpLunar = String(!!resolveResource(v));
      if (resolveResource(v)) layoutWarnings.push('DatePicker.lunar 未实现（无农历换算，记 data-*）');
    },
    canLoop: (n, v) => { n.dataset.dpLoop = String(!!resolveResource(v)); },
    digitalCrownSensitivity: (n, v) => { n.dataset.dpCrown = String(Number(resolveResource(v))); },
    enableHapticFeedback: (n, v) => { n.dataset.dpHaptic = String(!!resolveResource(v)); },
    disappearTextStyle: (n, v) => { n.dataset.dpDisTextStyle = JSON.stringify(v); },
    textStyle: (n, v) => { n.dataset.dpTextStyle = JSON.stringify(v); },
    selectedTextStyle: (n, v) => { n.dataset.dpSelTextStyle = JSON.stringify(v); },
    onChange: (n, v) => { (/** @type {any} */ (n.__dpCbs = n.__dpCbs || {})).change = v; },
    onDateChange: (n, v) => { (/** @type {any} */ (n.__dpCbs = n.__dpCbs || {})).dateChange = v; },
  };
  const DatePicker = ensureComponent('DatePicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiDatePicker = true;
    el.dataset.dp = '';
    el.style.display = 'flex';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const now = new Date();
    const start = o.start instanceof Date ? o.start : new Date(1970, 0, 1);
    const end = o.end instanceof Date ? o.end : new Date(2100, 11, 31);
    let sel = o.selected instanceof Date ? o.selected : now;
    if (sel < start) sel = new Date(start);
    if (sel > end) sel = new Date(end);
    const mode = o.mode != null ? Number(o.mode) : 0;    // DATE=0
    el.__dp = {
      start, end, mode,
      year: sel.getFullYear(), month: sel.getMonth() + 1, day: sel.getDate(),
      canLoop: !((o.start !== undefined && o.start !== null) || (o.end !== undefined && o.end !== null)),
      cbs: {},
    };
    el.__dpCbs = el.__dp.cbs;
    // 列选项
    const getYears = () => { const a = []; for (let y = start.getFullYear(); y <= end.getFullYear(); y++) a.push(y); return a; };
    const getMonths = () => { const a = []; for (let m = 1; m <= 12; m++) a.push(m); return a; };
    const getDays = (y, m) => { const n = dpDaysInMonth(y, m); const a = []; for (let d = 1; d <= n; d++) a.push(d); return a; };
    const cols = {};
    const mk = (label) => {
      const wrap = document.createElement('div');
      wrap.dataset['dpCol'] = label;
      wrap.style.flex = '1';
      wrap.style.overflow = 'hidden';
      wrap.style.position = 'relative';
      wrap.style.height = `${DP_ROWS * DP_ROW_H}px`;
      const inner = document.createElement('div');
      inner.style.position = 'absolute';
      inner.style.left = '0'; inner.style.right = '0';
      inner.style.willChange = 'transform';
      for (let r = 0; r < DP_ROWS; r++) {
        const row = document.createElement('div');
        row.style.height = `${DP_ROW_H}px`;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'center';
        row.style.fontSize = '16px';
        row.style.color = DP_COLOR_DIS;
        if (r === 2) { row.style.color = DP_COLOR_SEL; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
        inner.appendChild(row);
      }
      wrap.appendChild(inner);
      el.appendChild(wrap);
      return { wrap, inner, rows: [...inner.children] };
    };
    cols.year = mk('year'); cols.month = mk('month'); cols.day = mk('day');
    if (mode === 1) cols.day.wrap.style.display = 'none';       // YEAR_AND_MONTH
    if (mode === 2) cols.year.wrap.style.display = 'none';      // MONTH_AND_DAY
    el.dataset.dpMode = String(mode);
    // 渲染一列：围绕 idx 显示 5 行（idx-2..idx+2）
    const renderCol = (col, options, idx, fmt) => {
      const c = cols[col];
      for (let r = 0; r < DP_ROWS; r++) {
        const oi = idx - 2 + r;
        c.rows[r].textContent = (oi >= 0 && oi < options.length) ? fmt(options[oi]) : '';
      }
      c.inner.style.transform = `translateY(${(2 - idx) * DP_ROW_H}px)`;
    };
    const dp = el.__dp;
    dp.renderAll = () => {
      const years = getYears();
      const months = getMonths();
      const days = getDays(dp.year, dp.month);
      dp.yearIdx = years.indexOf(dp.year);
      dp.monthIdx = months.indexOf(dp.month);
      dp.dayIdx = days.indexOf(dp.day);
      renderCol('year', years, dp.yearIdx, (v) => String(v));
      renderCol('month', months, dp.monthIdx, (v) => String(v));
      renderCol('day', days, dp.dayIdx, (v) => String(v));
      el.dataset.dpYearCount = String(years.length);
      el.dataset.dpMonthCount = String(months.length);
      el.dataset.dpDayCount = String(days.length);
    };
    dp.fireChange = () => {
      const cb = el.__dpCbs;
      if (typeof cb.change === 'function') {
        try { cb.change({ year: dp.year, month: dp.month - 1, day: dp.day }); }
        catch (e) { layoutWarnings.push(`DatePicker.onChange 抛错：${e && e.message}`); }
      }
      if (typeof cb.dateChange === 'function') {
        try { const now = new Date(); cb.dateChange(new Date(dp.year, dp.month - 1, dp.day, now.getHours(), now.getMinutes(), 0)); }
        catch (e) { layoutWarnings.push(`DatePicker.onDateChange 抛错：${e && e.message}`); }
      }
    };
    dp.step = (col, dir) => {
      // dir: +1 = 值+1（wheel deltaY<0），-1 = 值−1
      const opts = col === 'year' ? getYears() : col === 'month' ? getMonths() : getDays(dp.year, dp.month);
      const cur = col === 'year' ? dp.yearIdx : col === 'month' ? dp.monthIdx : dp.dayIdx;
      let ni = cur + dir;
      if (!dp.canLoop || (dp.start && dp.end)) {
        if (ni < 0 || ni >= opts.length) return;   // 非循环：越界不动
      } else {
        if (ni < 0) ni = opts.length - 1;
        if (ni >= opts.length) ni = 0;
      }
      ni = Math.max(0, Math.min(ni, opts.length - 1));
      if (col === 'year') dp.year = opts[ni];
      else if (col === 'month') dp.month = opts[ni];
      else dp.day = opts[ni];
      // 跨列联动：月/年变 → 重算当月天数 → day 夹取
      const maxD = dpDaysInMonth(dp.year, dp.month);
      if (dp.day > maxD) dp.day = maxD;
      // start/end 钳制
      const sel = new Date(dp.year, dp.month - 1, dp.day);
      if (sel < start) { dp.year = start.getFullYear(); dp.month = start.getMonth() + 1; dp.day = start.getDate(); }
      if (sel > end) { dp.year = end.getFullYear(); dp.month = end.getMonth() + 1; dp.day = end.getDate(); }
      dp.renderAll();
      dp.fireChange();
    };
    // wheel 步进（deltaY<0 = 上/值+1；deltaY>0 = 下/值−1）
    for (const col of ['year', 'month', 'day']) {
      cols[col].wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        dp.step(col, e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }
    dp.renderAll();
    return el;
  });
