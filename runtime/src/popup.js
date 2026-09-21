  // ────────────────── 弹出类：Select / Menu + MenuItem（R29）──────────────────
  //
  // 产物形态（实测 fixtures/pages/PopDemo.ts）：
  //   Select.create([{value: 'A'}, …]);   ← create 单参数（SelectOption = {value, icon?…}）
  //     Select.selected(i); Select.value(str); Select.fontColor(...);
  //     Select.onSelect((index: number, value: string) => …)
  //   Menu.create(); MenuItem.create({content}); MenuItem.selected(bool); MenuItem.onChange((on)=>…)
  //
  // 语义锚点（.d.ts）：Select.create 只收选项数组（"selected" 是属性方法，selected(value:
  // number | Resource)）；onSelect 的签名是双参 (index, value)（index = 选中序号、value =
  // 选中项文本）；MenuItem.onChange 是**多选语义**（每项独立 selected + onChange，非互斥）。
  //
  // DOM 映射：Select 沿用原生 <select> 基座（options → <option>，selectedIndex 直落）；
  // Menu/MenuItem 是行式面板：MenuItem 点击切换自身 selected（带 ✓ 标记）并派发 onChange。
  // Select.value(str)（"设置当前显示文本"）：原生 <select> 的显示文本不可覆盖 → 照实记
  // data-value-text（不静默，取舍已写进 docs）。
  const Select = ensureComponent('Select', (args) => {
    const el = document.createElement('select');
    el.style.display = 'inline-block';
    el.__arkuiPopup = 'Select';
    (Array.isArray(args && args[0]) ? args[0] : []).forEach((opt) => {
      const o = document.createElement('option');
      const text = String(resolveResource(opt && opt.value === undefined ? '' : opt.value));
      o.value = text;
      o.textContent = text;
      el.appendChild(o);
    });
    return el;
  });
  const Menu = ensureComponent('Menu', () => {
    const el = document.createElement('div');
    el.__arkuiPopup = 'Menu';
    el.dataset.menu = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    return el;
  });
  const MenuItem = ensureComponent('MenuItem', (args) => {
    const el = document.createElement('div');
    el.__arkuiPopup = 'MenuItem';
    el.dataset.menuItem = '';
    el.style.cursor = 'pointer';
    const o = (args && typeof args[0] === 'object' && args[0] !== null) ? args[0] : {};
    const mark = document.createElement('span');
    mark.setAttribute('data-arkui-select-icon', '');
    el.appendChild(mark);
    const text = document.createElement('span');
    text.textContent = String(resolveResource(o.content === undefined ? '' : o.content));
    el.appendChild(text);
    // 点击切换选中（多选语义：每项独立 selected，非互斥），派发 onChange(新状态)
    el.addEventListener('click', () => {
      const now = el.dataset.selected !== 'true';
      el.dataset.selected = String(now);
      mark.textContent = now ? '✓' : '';
      if (el.__popupCbs && typeof el.__popupCbs.onChange === 'function') {
        try { el.__popupCbs.onChange(now); }
        catch (e) { layoutWarnings.push(`MenuItem.onChange 派发抛错：${e && e.message}`); }
      }
    });
    return el;
  });

  // 弹出类语义属性分派（applyAttr 里抢在通用落点之前）：函数值的 onSelect/onChange 必须拦在
  // 通用 on* 规则之前（坑 86 同族），selected 按组件身份分派（Select 落 selectedIndex、
  // MenuItem 落 data-selected）
  const POPUP_ATTRS = {
    selected: (n, v) => {
      if (n.__arkuiPopup === 'Select') {
        n.selectedIndex = Number(resolveResource(v));       // 直接改 <select> 的选中序号
        return;
      }
      // MenuItem
      n.dataset.selected = String(!!v);
      const mark = n.querySelector('[data-arkui-select-icon]');
      if (mark) mark.textContent = v ? '✓' : '';
    },
    selectIcon: (n, v) => { n.dataset.selectIcon = String(resolveResource(v)); },
    value: (n, v) => { n.dataset.valueText = String(resolveResource(v)); },   // Select.value：显示文本覆盖（记录取舍）
    fontColor: (n, v) => { n.style.color = colorOf(v); },
    showPosition: (n, v) => { n.dataset.showPosition = String(resolveResource(v)); },
    onChange: (n, v) => { (/** @type {any} */ (n.__popupCbs = n.__popupCbs || {})).onChange = v; },   // MenuItem 的回调（点击切换见工厂）
  };

  // Select.onSelect 的双参派发（特殊签名，拦在通用 on* 规则之前）：change 事件 → (index, value)。
  // 编程改 selectedIndex 不派发（DOM 语义取舍已记录）；测试用 dispatchEvent('change') 驱动。
  function popupBindSelect(node, cb) {
    node.addEventListener('change', () => {
      const i = node.selectedIndex;
      const opt = node.options && node.options[i];
      try { cb(i, opt ? opt.textContent : ''); }
      catch (e) { layoutWarnings.push(`Select.onSelect 派发抛错：${e && e.message}`); }
    });
  }
