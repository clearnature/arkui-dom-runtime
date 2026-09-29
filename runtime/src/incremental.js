  // ────────────────── 增量走查（R139，E2-1）──────────────────
  //
  // 现状瓶颈（R79 遗留账）：rerenderElmt 每次尾部跑 4 个全树 querySelectorAll('*')
  //（syncAlignRules/syncDrawings/syncAreas/syncNavChrome）——单组件更新也 O(全树)。
  // 万节点页（stress10k 实测 bulk_flush 22ms）里这 4 次遍历就是主要成本。
  //
  // 方案：**登记表驱动**。能力挂上时登记元素（WeakRef 保活弱引用，摘除后靠惰性清扫
  // 剔除）；flush 尾部的 4 个 sync 改为【只遍历各自登记集】，不再 querySelectorAll。
  // 语义等价性论证：
  //   · syncAreas 关心 __areaCbs 元素 → 登记点=onAreaChange 挂回调处（area.js:160）
  //   · syncDrawings 关心 __drawKind/__arkuiQrPending → 登记点=draw.js 四处赋值 +
  //     show.js QRCode pending 处
  //   · syncAlignRules 关心 __alignRules/__guideLines → 登记点=alignRules 属性应用处 +
  //     guideline 创建处（guideLines 挂在锚点判断时才需要——保守起见 guideline 声明也登记）
  //   · syncNavChrome 关心 __navState/__navDest/[data-arkui-comp=Navigation|NavDestination]
  //     → 登记点=Navigation/NavDestination 挂载处（mountNode 的 data-arkui-comp 已有——
  //     由 a11yApplyRole 同款思路在 mountNode 检查 comp 名登记）
  // 风险与护栏：查询发现 vs 登记发现的差异面 = "能力标记被运行时之外手工赋值"——测试
  // 全矩阵是硬护栏；errbound demo 等直接赋 __areaCbs 的路径在登记点内（同文件）。

  // tsconfig lib=es2020 无 WeakRef（ES2021 引入）——不升 lib（连带风险），改用
  // Set<HTMLElement> 强引用 + 惰性清扫（isConnected=false 即剔除）：稳态下集合收敛于
  // 「仍挂树的登记元素」，不无界增长；节点重复挂载（路由回切）由 Set 天然去重。
  /** @type {Set<HTMLElement>} */
  const areaReg = new Set();
  /** @type {Set<HTMLElement>} */
  const drawReg = new Set();
  /** @type {Set<HTMLElement>} */
  const alignReg = new Set();
  /** @type {Set<HTMLElement>} */
  const navReg = new Set();

  /**
   * 清扫已断开元素；返回仍挂树的元素数组。
   * @param {Set<HTMLElement>} reg
   * @returns {HTMLElement[]}
   */
  function incSweep(reg) {
    const live = [];
    for (const el of reg) {
      if (!el.isConnected) { reg.delete(el); continue; }
      live.push(el);
    }
    return live;
  }

  // ── 登记点 API（各分片在能力挂上时调用；函数声明提升，include 顺序无关）──
  /** @param {HTMLElement} el onAreaChange 挂上时 */
  function incRegArea(el) { if (el) areaReg.add(el); }
  /** @param {HTMLElement} el __drawKind/__arkuiQrPending 挂上时 */
  function incRegDraw(el) { if (el) drawReg.add(el); }
  /** @param {HTMLElement} el __alignRules 挂上时 */
  function incRegAlign(el) { if (el) alignReg.add(el); }
  /** @param {HTMLElement} el Navigation/NavDestination 挂上时 */
  function incRegNav(el) { if (el) navReg.add(el); }
