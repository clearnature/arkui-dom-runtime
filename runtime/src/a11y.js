  // ────────────────── 无障碍 ARIA 映射（R136，E1-6）──────────────────
  //
  // 目标：屏幕阅读器可用的底线——组件语义 → role/aria-* 静态映射 + accessibility*
  // 通用属性真落 aria-*（此前经通用兜底落 data-*，AT 读不到）。
  //
  // 语义出处（SDK component/common.d.ts）：
  //   accessibilityGroup(value)（:21947）——"是否构成无障碍组合单元"→ ariaGroup 概念，
  //     DOM 侧映射为 role="group"（group 语义聚合，AT 焦点不再逐子遍历——WAI-ARIA group）
  //   accessibilityText（:22008）→ aria-label
  //   accessibilityDescription（:22143）→ aria-description（ARIADevote；兼容层再补 title? 否——
  //     title 有悬停语义副作用，只用 aria-description 与原生 description 属性双写）
  //   accessibilityLevel（:22200 附近，"auto"/数值）→ aria-level（数值时）
  //   accessibilityPreferred（accessibilityGroup 二参 AccessibilityOptions，:22063）→ 记录面
  //
  // 组件静态 role 映射（按 __arkuiComp 标记/基座形态，挂载时一次性落 role 属性）：
  //   Button→button、Checkbox/Radio/Toggle(checkbox 型)→checkbox/radio（原生控件自带语义，
  //     不重复覆盖——只对 div 基座的手写组件补）、TextInput/Search/TextArea→textbox、
  //   Image→img、Text→（无 role，AT 读文本）、Rating→slider、Slider→slider、
  //   Progress/LoadingProgress→progressbar、CheckboxGroup→group、
  //   Toggle(switch 型)→switch、StepperItem/TabContent→tabpanel/tab（TabContent 由
  //   Tabs 装配时标 tab）、ListItem→listitem、List→list、TableRow→row、Scroll→（无）
  //   ——映射表显式声明于 A11Y_ROLES，缺席组件不强行加 role（无语义强加反而误导 AT）。
  //
  const g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : self);

  // axe-core 扫描：本分片不内嵌 axe（体积 400KB+）；a11ydemo 页用断言锁定映射事实，
  // axe 接入列为后续（vendor 引入时登记 THIRD-PARTY）。

  // 组件 → ARIA role 静态映射（键 = __arkuiComp 名；值 = role 串；缺省不设 role）
  const A11Y_ROLES = /** @type {Record<string, string>} */ ({
    Button: 'button',
    Checkbox: 'checkbox',
    Radio: 'radio',
    TextInput: 'textbox',
    TextArea: 'textbox',
    Search: 'searchbox',
    Image: 'img',
    Rating: 'slider',
    Slider: 'slider',
    Progress: 'progressbar',
    LoadingProgress: 'progressbar',
    Gauge: 'meter',
    CheckboxGroup: 'group',
    ListItem: 'listitem',
    List: 'list',
    Toggle: 'switch',
    Menu: 'menu',
    MenuItem: 'menuitem',
    Select: 'combobox',
    TabContent: 'tabpanel',
    StepperItem: 'tabpanel',
  });

  /**
   * 挂载时一次性落 role（幂等：已带 role 不覆盖——显式 role 属性优先级最高）。
   * 由 area.js 的 mountNode 后置调用（集成补丁），或测试页手动调用。
   * @param {HTMLElement} el
   */
  function a11yApplyRole(el) {
    if (!el || el.getAttribute('role')) return;
    const comp = el.getAttribute('data-arkui-comp') || el.__arkuiComp || '';
    const role = A11Y_ROLES[comp];
    if (role) el.setAttribute('role', role);
  }
  // 诊断面：测试页显式复验幂等守卫用
  g.__arkui_dom_a11y_apply = a11yApplyRole;

  /**
   * accessibility* 属性 → ARIA（area.js 在通用兜底前调用；返回 true = 已消费）。
   * @param {HTMLElement} node @param {string} prop @param {any} value @returns {boolean}
   */
  function a11yConsumeAttr(node, prop, value) {
    switch (prop) {
      case 'accessibilityText':
        node.setAttribute('aria-label', String(value));
        return true;
      case 'accessibilityDescription':
        // aria-description 支持尚新（Chromium 109+）；同步落 description 保险
        node.setAttribute('aria-description', String(value));
        node.setAttribute('description', String(value));
        return true;
      case 'accessibilityLevel': {
        // "auto" = 交给 AT 判（不落 aria-level）；数值 → aria-level。
        // ARIA 1.2（axe-core 4.10 口径）role=group 不支持 aria-level——已带 group 角色的
        // 记录到 data-* 不落（R140：a11ydemo scoped 审计抓的组合冲突）
        if (node.getAttribute('role') === 'group') {
          node.dataset.accessibilityLevel = String(value);
          return true;
        }
        const n = Number(value);
        if (value !== 'auto' && Number.isFinite(n)) node.setAttribute('aria-level', String(n));
        return true;
      }
      case 'accessibilityGroup':
        // group 语义聚合（WAI-ARIA group role；AT 以组为单位朗读）。
        // ARIA 1.2 group 不支持 aria-level——若先设了 level，迁移到 data-*（R140 scoped 审计抓）
        if (value === true) {
          if (node.getAttribute('role') !== 'group') node.setAttribute('role', 'group');
          if (node.hasAttribute('aria-level')) {
            node.dataset.accessibilityLevel = node.getAttribute('aria-level') || '';
            node.removeAttribute('aria-level');
          }
        }
        return true;
      default:
        return false;
    }
  }
