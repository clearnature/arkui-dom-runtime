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
      const el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      el.style.display = 'inline-block';
      el.__arkuiInput = name === 'Slider' ? 'slider' : 'input';
      if (type && type !== 'textarea') (/** @type {any} */ (el)).type = type;
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

  // ── 输入收官（R34）：TextInput / TextArea / Search ──
  // 产物形态（实测 fixtures/pages/TextDemo.ts）：
  //   TextInput.create({placeholder, text, controller})；TextArea.create({placeholder})；
  //   Search.create({value})；.maxLength(n)；.caretColor；onChange 双参（value + previewText?，
  //   text_common.d.ts："EditableTextOnChangeCallback = (value, previewText?, options?)"）；
  //   onSubmit((enterKey, event) => …)（SubmitEvent 可按住软键盘收起等，DOM 无对应）；
  //   TextInputController（caretPosition 等，按需补面）
  // DOM 映射：沿用原生 input/textarea 基座；maxLength/caretColor/placeholder 直落原生属性；
  // onChange 沿用通用 input 事件（单参 value）——DOM 无 previewText 对应（取舍已记录）；
  // onSubmit 在通用 on* 规则前拦截：keydown Enter 时派发 (EnterKeyType, SubmitEvent)。
  // TextInputController：caretPosition/caretAnimationTime 等按需补面（本轮只挂基座 + 绑定）
  const TextInputControllerBase = class {
    constructor() { this.__arkuiEditable = null; }
    __arkuiBindEditable(el) { this.__arkuiEditable = el; }
    caretPosition(pos) {
      if (this.__arkuiEditable) this.__arkuiEditable.setSelectionRange(pos, pos);
    }
  };
  const TextInputController = class extends TextInputControllerBase {};
  // EnterKeyType 的数值来自 .d.ts 原文（Go=2…NEW_LINE=8；0/1 未声明——产物没引用就不挂）
  const EnterKeyType = { Go: 2, Search: 3, Send: 4, Next: 5, Done: 6, PREVIOUS: 7, NEW_LINE: 8 };
  const TextInput = inputComponent('TextInput', 'text', (el, o) => {
    if (o.placeholder !== undefined) el.dataset.placeholder = String(resolveResource(o.placeholder));
    if (o.text !== undefined) el.value = String(resolveResource(o.text));
    if (o.controller && typeof o.controller.__arkuiBindEditable === 'function') {
      o.controller.__arkuiBindEditable(el);
    }
  });
  const TextArea = inputComponent('TextArea', 'textarea', (el, o) => {
    if (o.placeholder !== undefined) el.dataset.placeholder = String(resolveResource(o.placeholder));
  });
  const Search = inputComponent('Search', 'search', (el, o) => {
    if (o.value !== undefined) el.value = String(resolveResource(o.value));
    if (o.placeholder !== undefined) el.dataset.placeholder = String(resolveResource(o.placeholder));
  });
  const Hyperlink = ensureComponent('Hyperlink', (args) => {
    const el = document.createElement('a');
    el.__arkuiLink = true;
    el.__arkuiHref = args && args[0] !== undefined ? String(resolveResource(args[0])) : '';
    el.href = el.__arkuiHref;                              // <a> 语义：href 直落
    el.target = '_blank';                                  // 外链新开（实现选择）
    const text = args && args[1] !== undefined ? String(resolveResource(args[1])) : '';
    if (text) el.textContent = text;                       // 无子组件时显示 content（JSDoc 原文）
    return el;
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
    // 文本输入收官（R34）
    maxLength: (n, v) => { n.maxLength = Number(resolveResource(v)); },          // 原生截断
    caretColor: (n, v) => { n.style.caretColor = colorOf(v); },
    // enterKeyType 落 data-enter-key，onSubmit 的 wrapper 按它取回调整数（.d.ts：Go=2…NEW_LINE=8）
    enterKeyType: (n, v) => { n.setAttribute('data-enter-key', String(Number(resolveResource(v)))); },
    onSubmit: (n, v) => {
      // ArkUI 签名：(enterKey, event: SubmitEvent)。DOM 在 keydown Enter 时派发
      // （原生 input 无 submit 事件——必须拦在通用 on* 规则之前，坑 86 同族）。
      // enterKey 未设时取 Done(6)（.d.ts 默认值原文："Default value: EnterKeyType.Done"）。
      // （R38 修复：此前的 wrapper 里写的是 `value(...)`——未定义标识符，Enter 一按就
      // ReferenceError 且被本 try/catch 吞掉，表现为"派发未打通"之谜；tsc --checkJs 抓出。）
      const wrapper = (e) => {
        if (e.target !== n) return;
        const key = n.getAttribute('data-enter-key');
        const enterKey = key !== null ? Number(key) : EnterKeyType.Done;
        try { v(enterKey, { keepEditable: true }); }
        catch (err) { layoutWarnings.push(`onSubmit 派发抛错：${err && err.message}`); }
      };
      if (!n.__arkuiEv) n.__arkuiEv = {};
      if (n.__arkuiEv.keydown) n.removeEventListener('keydown', n.__arkuiEv.keydown);
      n.__arkuiEv.keydown = wrapper;
      n.addEventListener('keydown', wrapper);
    },
    color: (n, v) => { if (n.__arkuiLink) n.style.color = colorOf(v); },     // Hyperlink.color
  };
