  // ────────────────── TimePicker 时间选择器（R52）──────────────────
  //
  // 产物形态（实测 fixtures/pages/TimePickerDemo.ts）：
  //   TimePicker.create({selected: Date, format?: TimePickerFormat});
  //   TimePicker.useMilitaryTime(bool); TimePicker.onChange((v)=>…);
  // 列：hour(0..23) + minute(0..59) + second(0..59，仅 HOUR_MINUTE_SECOND 格式)。
  // 状态机/事件/步进与 DatePicker 共用模式（wheel 同步单步）。
  const TimePickerFormat = { HOUR_MINUTE: 0, HOUR_MINUTE_SECOND: 1 };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const TIMEPICKER_ATTRS = {
    useMilitaryTime: (n, v) => {
      n.__tp.military = !!resolveResource(v);
      n.dataset.military = String(n.__tp.military);
      n.__tpRender();
    },
    onChange: (n, v) => { (/** @type {any} */ (n.__tpCbs = n.__tpCbs || {})).change = v; },
  };
  const TimePicker = ensureComponent('TimePicker', (args) => {
    const el = document.createElement('div');
    el.__arkuiTimePicker = true;
    el.dataset.tp = '';
    el.style.display = 'flex';
    el.style.overflow = 'hidden';
    const o = args && args[0] && typeof args[0] === 'object' ? args[0] : {};
    const sel = o.selected instanceof Date ? o.selected : new Date();
    const fmt = o.format != null ? Number(o.format) : 0;   // HOUR_MINUTE=0
    const hasSec = fmt === 1;
    el.__tp = {
      hour: sel.getHours(), minute: sel.getMinutes(), second: sel.getSeconds(),
      military: true, hasSec,
      cbs: {},
    };
    el.__tpCbs = el.__tp.cbs;
    const tp = el.__tp;
    const mk = (label) => {
      const wrap = document.createElement('div');
      wrap.dataset['tpCol'] = label;
      wrap.style.flex = '1';
      wrap.style.overflow = 'hidden';
      wrap.style.position = 'relative';
      wrap.style.height = '200px';
      const inner = document.createElement('div');
      inner.style.position = 'absolute';
      inner.style.left = '0'; inner.style.right = '0';
      for (let r = 0; r < 5; r++) {
        const row = document.createElement('div');
        row.style.height = '40px';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'center';
        row.style.fontSize = '16px';
        row.style.color = 'rgb(24, 36, 49)';
        if (r === 2) { row.style.color = 'rgb(0, 125, 255)'; row.style.fontSize = '20px'; row.style.fontWeight = '500'; }
        inner.appendChild(row);
      }
      wrap.appendChild(inner);
      el.appendChild(wrap);
      return { wrap, inner, rows: [...inner.children] };
    };
    const cols = { hour: mk('hour'), minute: mk('minute') };
    if (hasSec) cols.second = mk('second');
    /** @param {number} v */
    const pad2 = (v) => String(v).padStart(2, '0');
    /** @param {number} h */
    const fmtHour = (h) => (tp.military ? String(h) : h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
    /** @param {string} col @param {any[]} options @param {number} idx @param {(v: any) => string} fmtFn */
    const renderCol = (col, options, idx, fmtFn) => {
      const c = cols[col];
      for (let r = 0; r < 5; r++) {
        const oi = idx - 2 + r;
        c.rows[r].textContent = (oi >= 0 && oi < options.length) ? fmtFn(options[oi]) : '';
      }
      c.inner.style.transform = `translateY(${(2 - idx) * 40}px)`;
    };
    el.__tpRender = tp.tpRender = () => {
      const hours = []; for (let h = 0; h < 24; h++) hours.push(h);
      const mins = []; for (let m = 0; m < 60; m++) mins.push(m);
      renderCol('hour', hours, tp.hour, fmtHour);
      renderCol('minute', mins, tp.minute, pad2);
      if (hasSec) renderCol('second', mins, tp.second, pad2);
      el.dataset.tpHour = String(tp.hour);
      el.dataset.tpMinute = String(tp.minute);
      if (hasSec) el.dataset.tpSecond = String(tp.second);
    };
    el.__tpFireChange = tp.fireChange = () => {
      const cb = el.__tpCbs;
      if (typeof cb.change === 'function') {
        try { cb.change({ hour: tp.hour, minute: tp.minute, second: tp.second }); }
        catch (e) { layoutWarnings.push(`TimePicker.onChange 抛错：${e && e.message}`); }
      }
    };
    el.__tpStep = tp.step = (col, dir) => {
      const max = col === 'hour' ? 23 : 59;
      const cur = col === 'hour' ? tp.hour : col === 'minute' ? tp.minute : tp.second;
      let ni = cur + dir;
      if (ni < 0) ni = tp.military ? max : max;   // loop 默认 true → 回绕
      if (ni > max) ni = 0;
      if (col === 'hour') tp.hour = ni;
      else if (col === 'minute') tp.minute = ni;
      else tp.second = ni;
      tp.tpRender();
      tp.fireChange();
    };
    for (const col of ['hour', 'minute'].concat(hasSec ? ['second'] : [])) {
      cols[col].wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        tp.step(col, e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
    }
    tp.tpRender();
    return el;
  });
