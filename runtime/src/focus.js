  // ════════════════ 焦点管理 + 键盘可达性（E0-3）════════════════
  //
  // 目标：桌面应用键盘可达性底线——Tab 序可达、focusable/tabIndex 语义、requestFocus
  // 编程聚焦、焦点环样式。自包含分片：只依赖 document/globalThis，不引用闭包内其它分片
  // 的符号（因此也能被测试页在【产物未重拼】时作为独立 <script> 补载）。
  //
  // 语义出处（SDK：openharmony/ets/component/common.d.ts，JSDoc 原文摘录）：
  //  · focusable(value)（18724-18742 行）："Components that have default interaction logic,
  //    such as Button and TextInput, are focusable by default. Other components, such as
  //    Text and Image, are not focusable by default. Only focusable components can trigger
  //    a focus event." → 本运行时 applyAttr 没有 focusable 分支，值经通用兜底落
  //    dataset（area.js 末段 node.dataset[prop] = JSON.stringify(value)），即
  //    data-focusable="true"/"false"；本分片在扫描期读它定进出，不拦 applyAttr。
  //  · tabIndex(index)（18789-18808 行）："When components with positive tabIndex values are
  //    present, only these components are reachable through sequential focus navigation, and
  //    they are navigated cyclically in ascending order based on the tabIndex value." /
  //    "tabIndex >= 0: The component is focusable and can be reached through sequential
  //    keyboard navigation." / "tabIndex < 0 (usually tabIndex = -1): The component is
  //    focusable, but cannot be reached through sequential keyboard navigation."
  //    → 页面级语义（同一扫描根内）：有正值组时只有正值组沿 Tab 可达（升序循环）；无正值组
  //    时 0 值/默认组按 DOM 序；负值不进链但仍可编程聚焦。⚠️ 与浏览器原生行为（正值优先、
  //    其后 0 值组仍可达）不同——这里按 ArkUI 语义实现，页面若混用两种预期需知晓。
  //  · focusControl.requestFocus(value)（6251-6270 行）："Requests focus transfer to the
  //    specified component during the next frame rendering... @param value - String bound to
  //    the target component using key(value: string) or id(value: string). @returns ...
  //    If the target component pointed to by the parameter exists, is mounted to the component
  //    tree, and is focusable, true is returned."
  //    → 实现按原文：先校验（存在/已挂载/非 focusable(false)/非 disabled），受理即返回
  //    true，真正的 focus() 排到下一帧（rAF，setTimeout 兜底）。
  //  · enabled(value)（20439-20453 行）："If the value is true, the component is available
  //    and can respond to operations such as clicking." → enabled(false) 落
  //    data-enabled="false"，与原生 disabled 属性同判为"剔除出链"。
  //  · onKeyEvent（18643 行，通用键事件，载荷 KeyEvent：type=KeyType.Down/Up、keyCode、
  //    keyText——common.d.ts:11038 起 / enums.d.ts:1171 KeyType）。⚠️ 坑：applyAttr 的通用
  //    on* 规则把它小写成 'keyevent' 绑 addEventListener——DOM 无此事件名，永不触发；DOM
  //    实际事件名是 'keydown'。修正 hunk 在交付说明里（area.js 通用分支一行），本分片不动它。
  //
  // DOM 模型：document 级 keydown 只拦 Tab/Shift+Tab——preventDefault 后沿链手动 focus()
  //（原生 Tab 序 ≠ ArkUI 链序，必须自己驱动）；链在每次按键时现扫（动态 DOM 免订阅、免
  // MutationObserver）。方向键空间导航是任务标注的"可选"项，本片未实现（见交付说明）。
  //
  // 已知限制（推断/取舍，均标注）：焦点环颜色 #007dff 为推断（focus.d.ts 的 FocusBoxStyle
  // 只给自定义接口，JSDoc 未给默认色）；Shadow DOM 内的元素不在扫描范围；display:contents
  // 的包裹器（无盒）不可聚焦，天然出链。

  (function () {
    const g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : self);
    // 防重：产物集成本分片后、测试页又独立补载 src/focus.js 时，不能叠第二个 keydown 监听
    //（叠了 Tab 一次会前进两步）。已装即整个分片跳过。
    if (g.__arkui_dom_focus) return;

    /** @type {boolean} */ let focusStyleDone = false;
    // 受理序号：一次 requestFocus = 一个号。rAF 回调在 headless + --virtual-time-budget 下
    // 可能【迟到】（不是丢、是拖到几十帧后补跑，main.js:1861 同族实测）——迟到的旧回调若
    // 照常 focus() 会覆盖更新一次的受理结果，所以 apply 前对号，非最新请求一律作废。
    /** @type {number} */ let focusReqSeq = 0;

    // 参选元素集合：显式 ArkUI 落点（data-focusable/data-tab-index）∪ 原生可聚焦形态
    //（button/input/select/textarea、带 href 的链接、contenteditable、带 tabindex 的元素）
    const FOCUS_CANDIDATE_SELECTOR = '[data-focusable],[data-tab-index],button,input,select,textarea,'
      + 'a[href],[contenteditable],[tabindex]';

    /**
     * 排除判据：focusable(false)（common.d.ts:18731-18734 "false: The component is not
     * focusable"）、禁用（原生 disabled / enabled(false)→data-enabled="false"（20439-20453
     * 行 JSDoc）/ aria-disabled）。
     * @param {HTMLElement} el 候选元素
     * @returns {boolean} true = 被剔除
     */
    function focusExcluded(el) {
      if (el.getAttribute('data-focusable') === 'false') return true;
      if (el.hasAttribute('disabled')) return true;
      if ((/** @type {any} */ (el)).disabled === true) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if (el.getAttribute('data-enabled') === 'false') return true;
      return false;
    }

    /**
     * 可聚焦信号：显式 ArkUI 标记，或原生可聚焦形态。注意 div 这类 Text/Image 基座
     * 默认【不是】可聚焦（common.d.ts:18732-18734 JSDoc 原文），必须有显式标记。
     * @param {HTMLElement} el 候选元素
     * @returns {boolean} true = 具备可聚焦信号
     */
    function focusSignal(el) {
      if (el.getAttribute('data-focusable') === 'true') return true;
      if (el.hasAttribute('data-tab-index')) return true;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
      if (tag === 'A' && el.hasAttribute('href')) return true;
      if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return true;
      // 原生 tabindex 属性（含 -1：可编程聚焦、不进 Tab 链——18806-18808 行 JSDoc 语义）
      if (el.hasAttribute('tabindex')) return true;
      const ti = (/** @type {any} */ (el)).tabIndex;
      return typeof ti === 'number' && ti >= 0;
    }

    /**
     * 可见性（无盒即不可见）：display:none / 未挂载 / 尺寸为 0 的元素不参与链。
     * @param {HTMLElement} el 候选元素
     * @returns {boolean} true = 有渲染盒
     */
    function focusVisible(el) {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    /**
     * 把 data-tab-index / data-focusable 镜像到原生 tabIndex：div 这类非原生可聚焦基座
     * 必须 · 有 · tabIndex 才能被 .focus()（点击聚焦/requestFocus 的前提）。
     * 返回该元素的有效 tabIndex（无显式值 = 原生值；原生值非数字按 0）。
     * @param {HTMLElement} el 候选元素
     * @returns {number} 有效 tabIndex
     */
    function focusSyncTabIndex(el) {
      const anyEl = /** @type {any} */ (el);
      const raw = el.getAttribute('data-tab-index');
      if (raw !== null && raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          if (anyEl.tabIndex !== n) anyEl.tabIndex = n;
          return n;
        }
      }
      if (el.getAttribute('data-focusable') === 'true' && anyEl.tabIndex < 0) {
        anyEl.tabIndex = 0;   // focusable(true) 未给 tabIndex：按 0 参选（18799-18801 行语义）
      }
      return typeof anyEl.tabIndex === 'number' ? anyEl.tabIndex : 0;
    }

    /**
     * 构建 Tab 链（每次现扫，动态 DOM 免订阅）。
     * 链序 = 正值 tabIndex 组升序在前（同值按 DOM 序）→ 0 值/默认组按 DOM 序；
     * 页面级语义：存在正值组时 0 值组整组退出链（common.d.ts:18799-18800 原文
     * "only these components are reachable"）；负值组恒不进链。
     * @param {ParentNode=} [container] 扫描根，缺省 document
     * @returns {HTMLElement[]} 链（数组顺序即 Tab 次序）
     */
    function buildFocusChain(container) {
      if (typeof document === 'undefined') return [];
      const root = container || document;
      /** @type {{el: HTMLElement, ti: number, ord: number}[]} */
      const positives = [];
      /** @type {HTMLElement[]} */
      const zeros = [];
      let ord = 0;
      root.querySelectorAll(FOCUS_CANDIDATE_SELECTOR).forEach((/** @type {Element} */ node) => {
        const el = /** @type {HTMLElement} */ (node);
        const i = ord++;
        if (focusExcluded(el) || !focusVisible(el) || !focusSignal(el)) return;
        const ti = focusSyncTabIndex(el);
        if (ti > 0) positives.push({ el: el, ti: ti, ord: i });
        else if (ti === 0) zeros.push(el);
        // ti < 0：不进链（18799-18808 行 JSDoc），但保留 tabIndex=-1 供 requestFocus
      });
      positives.sort((/** @type {{ti:number,ord:number}} */ a, /** @type {{ti:number,ord:number}} */ b) =>
        (a.ti - b.ti) || (a.ord - b.ord));
      // 页面级语义（18799-18800 行原文 "only these components are reachable"）：扫描根内
      // 存在正值组时【只有】正值组进链——0 值组整组退出（不是排在后面！那是浏览器原生
      // "正值优先、0 值随后" 的另一套语义，这里按 ArkUI 口径）。无正值组时 0 值组按 DOM 序。
      if (positives.length > 0) return positives.map((/** @type {{el:HTMLElement}} */ p) => p.el);
      return zeros;
    }

    /**
     * 焦点环样式一次性注入（<style id="arkui-focus-style">，写法对齐 batch-platform.js
     * Skeleton2d 的 keyframes 注入）。:focus-visible 只在键盘聚焦时显示环（鼠标点击不闪）。
     * 颜色 #007dff 为【推断】——ArkUI 系统蓝；focus.d.ts 的 FocusBoxStyle 只给自定义
     * 接口（margin/strokeColor/strokeWidth），JSDoc 未给默认色。
     */
    function ensureFocusStyle() {
      if (focusStyleDone || typeof document === 'undefined') return;
      if (document.getElementById('arkui-focus-style')) { focusStyleDone = true; return; }
      const style = document.createElement('style');
      style.id = 'arkui-focus-style';
      style.textContent = '/* arkui-dom 焦点环（E0-3）：键盘可达性底线，颜色 #007dff 为推断（见 focus.js 注释） */\n'
        + '[data-focusable]:focus-visible,[data-tab-index]:focus-visible,[data-arkui-comp]:focus-visible,'
        + 'button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,'
        + 'a[href]:focus-visible,[contenteditable]:focus-visible,[tabindex]:focus-visible'
        + '{outline:2px solid #007dff;outline-offset:1px;}';
      document.head.appendChild(style);
      focusStyleDone = true;
    }

    /**
     * 编程聚焦（focusControl.requestFocus 语义对齐，common.d.ts:6257-6270）。
     * @param {HTMLElement|string} target 元素，或 id()/key() 绑定的字符串
     *   （id 分支：applyAttr 的 prop==='id' 落 node.id；key 分支：通用兜底落 data-key）
     * @returns {boolean} 是否成功受理（存在/已挂载/可聚焦/未禁用；真正的转移按 JSDoc
     *   "during the next frame rendering" 排到下一帧）。受理失败不动焦点。
     */
    function requestFocus(target) {
      if (typeof document === 'undefined') return false;
      /** @type {HTMLElement|null} */
      let el = null;
      if (typeof target === 'string') {
        el = document.getElementById(target);
        if (!el) {
          // key(value) 绑定：通用兜底落 data-key，值是 JSON.stringify 产物——字符串会带
          // 引号（'"rf-by-key"'），比对前先解包；解不开（本就是裸串）则按原串比对
          const keyed = document.querySelectorAll('[data-key]');
          for (let i = 0; i < keyed.length; i++) {
            const k = /** @type {HTMLElement} */ (keyed[i]);
            const raw = k.getAttribute('data-key');
            /** @type {any} */ let val = raw;
            if (raw && raw.charAt(0) === '"') {
              try { val = JSON.parse(raw); } catch (e) { /* 保持原串 */ }
            }
            if (val === target || raw === target) { el = k; break; }
          }
        }
      } else if (target && (/** @type {any} */ (target)).nodeType === 1) {
        el = /** @type {HTMLElement} */ (target);
      }
      if (!el || !el.isConnected || focusExcluded(el) || !focusSignal(el)) return false;
      const targetEl = el;
      focusSyncTabIndex(targetEl);   // div 基座镜像 tabIndex，.focus() 才生效
      ensureFocusStyle();
      // "下一帧" 的双通道实现：rAF（真浏览器的下一帧）+ setTimeout(16) 帧间隔兜底，先到
      // 先执行、后到幂等。为什么留兜底：rAF 在 headless + --virtual-time-budget 下触发时机
      // 不稳（main.js:1861 同款实测结论——滚动合并为此改用 setTimeout），不兜底测试页会
      // 偶发拿不到焦点。16ms ≈ 60fps 一帧，语义仍是"下一帧"量级。
      const seq = ++focusReqSeq;
      let transferred = false;
      const apply = () => {
        // 双保险：transferred 挡同一受理的 rAF/setTimeout 二连发；seq 挡【过期受理】的
        // 迟到回调覆盖更新一次的受理（只有最新请求有权转移焦点）
        if (transferred || seq !== focusReqSeq) return;
        transferred = true;
        // 转移前复检：帧间隙里目标可能被移除/禁用（真实场景：条件渲染）
        if (targetEl.isConnected && !focusExcluded(targetEl)
          && typeof targetEl.focus === 'function') targetEl.focus();
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
      setTimeout(apply, 16);
      return true;
    }

    /**
     * 当前 Tab 链（结果可直接断言顺序/成员）。
     * @param {ParentNode=} [container] 扫描根，缺省 document
     * @returns {HTMLElement[]} 链
     */
    function tabChain(container) {
      ensureFocusStyle();
      return buildFocusChain(container);
    }

    /**
     * 当前焦点元素（document.activeElement 的事实即语义；无显式焦点时是 body）。
     * @returns {HTMLElement|null} 焦点元素
     */
    function active() {
      if (typeof document === 'undefined') return null;
      const a = document.activeElement;
      return a instanceof HTMLElement ? a : null;
    }

    // document 级 Tab/Shift+Tab 派发：preventDefault 后自己驱动 focus()（原生 Tab 序
    // ≠ ArkUI 链序）。其余按键一律不碰（不抢焦点）；Ctrl/Alt/Meta 组合让给浏览器/系统。
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'Tab') return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        ensureFocusStyle();
        const chain = buildFocusChain(undefined);
        if (!chain.length) return;   // 空链放行原生（无可选项时浏览器自理）
        const cur = document.activeElement;
        const idx = (cur && cur instanceof HTMLElement)
          ? chain.indexOf(/** @type {HTMLElement} */ (cur)) : -1;
        // 尾回绕/头回绕；当前不在链上（初始 body / 链外元素）：Tab 从头进、Shift+Tab 从尾进
        /** @type {HTMLElement|undefined} */
        const next = e.shiftKey
          ? chain[(idx <= 0 ? chain.length : idx) - 1]
          : chain[(idx + 1) % chain.length];
        e.preventDefault();
        if (next && typeof next.focus === 'function') next.focus();
      });
    }

    // 挂命名空间（任务口径：requestFocus / tabChain / active）
    g.__arkui_dom_focus = {
      requestFocus: requestFocus,
      tabChain: tabChain,
      active: active,
    };
  })();
