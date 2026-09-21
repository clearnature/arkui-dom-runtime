  // ────────────────── 输入类：Checkbox / Radio / Toggle / Slider（R27）──────────────────
  //
  // 产物形态（实测 fixtures/pages/InputDemo.ts）：
  //   Checkbox.create({name});  Checkbox.select(bool);  Checkbox.selectedColor(...);  Checkbox.onChange((on)=>…)
  //   Radio.create({value, group});
  //     ⚠️ RadioOptions = {value, group}，【没有 name】（放进 create 编译就红，编译期实测）
  //   Radio.checked(bool);  Radio.onChange((isChecked)=>…)
  //   Toggle.create({type: ToggleType.Switch, isOn: true});
  //     ⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn（编译期实测）
  //   Slider.create({value, min, max, step});  blockColor/trackColor/selectedColor/showTips;
  //     Slider.onChange((value, mode: SliderChangeMode)=>…)
  //
  // 语义锚点（.d.ts）：SliderChangeMode = { Begin=0, Moving=1, End=2, Click=3 }
  //（声明顺序；Begin=触摸滑块、Moving=拖动中、End=拖动结束）
  //
  // DOM 映射（沿用生成骨架的原生控件基座，手写优先接管）：
  //   Checkbox/Toggle → <input type=checkbox>；Radio → <input type=radio> 且 **name = group**
  //   （原生单选互斥就是同名 name）；Slider → <input type=range>，min/max/step/value 直落控件。
  //   select/checked 落 checked；selectedColor → accent-color（原生控件唯一可映射的选中色）；
  //   原生控件没有对应属性的（unselectedColor/mark/shape/radioStyle/switchPointColor/…）
  //   照实记 data-*，不静默。select/checked 只改状态【不派发】change —— DOM 语义里
  //   change 是用户交互事件，编程改态是否触发 onChange .d.ts 没写死，取"不派发"并已写进 docs。
  const ToggleType = { Switch: 'switch', Checkbox: 'checkbox', Button: 'button' };
  const SliderChangeMode = { Begin: 0, Moving: 1, End: 2, Click: 3 };

  function inputComponent(name, type, setup) {
    return ensureComponent(name, (args) => {
      layoutWarnings.push('DBG-FACTORY ' + name); // TODO 调试后删
      const el = document.createElement('input');
      el.style.display = 'inline-block';
      el.__arkuiInput = name === 'Slider' ? 'slider' : 'input';
      if (type) el.type = type;
      const o = args && typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
      setup(el, o);
      return el;
    });
  }

  const Checkbox = inputComponent('Checkbox', 'checkbox', (el, o) => {
    if (o.name !== undefined && o.name !== null) el.name = String(o.name);
  });
  // Radio 的组登记：互斥时被取消成员的 onChange(false) 要【补发】—— Chrome 只给新选中者发
  // change（radio.d.ts JSDoc："false means that the radio button changes from selected to
  // unselected"，被取消的那次状态变化也是"选中态变化"，真机会发）
  const radioGroups = new Map();
  const Radio = inputComponent('Radio', 'radio', (el, o) => {
    if (o.group !== undefined && o.group !== null) {
      el.name = String(o.group);   // 互斥 = 同名 name
      if (!radioGroups.has(el.name)) radioGroups.set(el.name, new Set());
      radioGroups.get(el.name).add(el);
    }
    if (o.value !== undefined && o.value !== null) el.value = String(o.value);
  });
  const Toggle = inputComponent('Toggle', 'checkbox', (el, o) => {
    el.dataset.toggleType = o.type === undefined ? ToggleType.Checkbox : String(o.type);
    if (o.type === ToggleType.Switch) el.classList.add('arkui-toggle-switch');
    if (o.isOn !== undefined) el.checked = !!o.isOn;
  });
  const Slider = inputComponent('Slider', 'range', (el, o) => {
    const num = (v, d) => { const n = Number(resolveResource(v)); return Number.isFinite(n) ? n : d; };
    el.min = String(num(o.min, 0));                       // .d.ts 默认：min 0、max 100
    el.max = String(num(o.max, 100));
    el.step = String(num(o.step, 1));
    el.value = String(num(o.value, num(o.min, 0)));
  });

  // 输入类的语义属性：select/checked 落状态（**按上次应用的值做幂等 diff**——源码里是静态
  // 字面量，重渲染再应用同值必须是无操作；否则用户交互后的每次重渲染都会把状态拉回去，
  // 还连带触发组内互斥的 change —— inputdemo 首跑当场抓住）；selectedColor 落 accent-color；
  // 原生控件没有对应物的照实记 data-*（不静默）
  const INPUT_ATTRS = {
    select: (n, v) => {
      const want = !!v;
      if (n.__arkuiCheckedApplied !== want) { n.checked = want; n.__arkuiCheckedApplied = want; n.__arkuiRadioOn = want; }
    },
    checked: (n, v) => {
      const want = !!v;
      if (n.__arkuiCheckedApplied !== want) { n.checked = want; n.__arkuiCheckedApplied = want; n.__arkuiRadioOn = want; }
    },
    selectedColor: (n, v) => { n.style.accentColor = colorOf(v); },
    unselectedColor: (n, v) => { n.dataset.unselectedColor = String(colorOf(v)); },
    mark: (n, v) => { n.dataset.mark = String(resolveResource(v)); },
    shape: (n, v) => { n.dataset.shape = String(resolveResource(v)); },
    radioStyle: (n, v) => { n.dataset.radioStyle = String(resolveResource(v)); },
    switchPointColor: (n, v) => { n.dataset.switchPointColor = String(colorOf(v)); },
    switchStyle: (n, v) => { n.dataset.switchStyle = String(resolveResource(v)); },
    blockColor: (n, v) => { n.dataset.blockColor = String(colorOf(v)); },
    trackColor: (n, v) => { n.dataset.trackColor = String(colorOf(v)); },
    showTips: (n, v) => { n.dataset.showTips = String(v); },
    showSteps: (n, v) => { n.dataset.showSteps = String(v); },
  };
