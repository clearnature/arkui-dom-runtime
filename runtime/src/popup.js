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
    (Array.isArray(args && args[0]) ? args[0] : []).forEach(/** @param {any} opt */ (opt) => {
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
    // R166 续（真机口径）：选中标记 ✓ 是字形——真机为图标资源不进 a11y 文本
    //（设备 PopDemo 流无 ✓），视觉保留、a11y 隐藏（harness 跳 aria-hidden）
    mark.setAttribute('aria-hidden', 'true');
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
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
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
    value: (n, v) => {
      const s = String(resolveResource(v));
      n.dataset.valueText = s;                          // Select.value：显示文本覆盖（记录）
      // R166 续（真机口径）：value() 是【显示文本覆盖】——真机页面折叠态可见
      // 'Choosed'（设备 dumpLayout 实证），我们此前只记 dataset 显示仍为选中
      // option 文本。改写当前选中 option 的 textContent（视觉与采集同源）；
      // option.value 属性不动（onSelect 派发原值）
      const i = n.selectedIndex;
      if (i >= 0 && n.options && n.options[i]) n.options[i].textContent = s;
    },
    fontColor: (n, v) => { n.style.color = colorOf(v); },
    showPosition: (n, v) => { n.dataset.showPosition = String(resolveResource(v)); },
    onChange: (n, v) => { (/** @type {any} */ (n.__popupCbs = n.__popupCbs || {})).onChange = v; },   // MenuItem 的回调（点击切换见工厂）
  };

  // Select.onSelect 的双参派发（特殊签名，拦在通用 on* 规则之前）：change 事件 → (index, value)。
  // 编程改 selectedIndex 不派发（DOM 语义取舍已记录）；测试用 dispatchEvent('change') 驱动。
  /** @param {any} node @param {any} cb */
  function popupBindSelect(node, cb) {
    node.addEventListener('change', () => {
      const i = node.selectedIndex;
      const opt = node.options && node.options[i];
      // R166 续：派发 SelectOption.value 原值（与 create 填充 line23 同源）——
      // textContent 可能被 value() 显示覆盖改写，派发不应带覆盖文本
      try { cb(i, opt ? opt.value : ''); }
      catch (e) { layoutWarnings.push(`Select.onSelect 派发抛错：${e && e.message}`); }
    });
  }
