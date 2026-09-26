  // ────────── R84：DOM 可行骨架批量转真语义（batch-platform，10 个）──────────
  // 来源：stats.mjs"骨架·仅 data-* 33"名单中经语义判定有合理 DOM 对应物的组件。
  // 其余 23 个（Camera/Component3D/Particle/RemoteWindow/Plugin/UIExtension/Embedded/
  // Security/ArcSegmentButton/Ability/Form 系/Screen/WindowScene/RootScene/Isolated/
  // Dynamic/Effect/ContentSlot/NodeContainer/Piece/WithEnv/Distortion/Depth 等）在浏览器
  // 形态没有合理 DOM 对应物——硬转语义=造假，保持骨架（R72/R48 平台判定方法论）。
  //
  // 权威来源：ets-loader/components/*.json 属性面；Arc 系为穿戴设备组件，无独立 d.ts，
  // 语义按同族组件类比（Swiper/ScrollBar/AlphabetIndexer），标注"近似"。
  //
  //   ArcSwiper        轮播（Swiper 子集）：index/indicator/duration/vertical/onChange；
  //                    子项按栈序收集（pop 收尾，Tabs 同款），显隐切换。
  //   ArcListItem      列表项（ListItem 子集）：autoScale 按压缩放、swipeAction 水平拖动。
  //   ArcScrollBar     滚动条：thumb 随比例移动（__arkui_dom_arcScrollThumb 驱动）。
  //   ArcAlphabetIndexer 同 AlphabetIndexer（R60）+ usePopup 简化为 title。
  //   DotMatrix        点阵显示：.text() 5×7 字形网格渲染，dotSpacing 控间距。
  //   MediaCachedImage 缓存图（Image 子集）：objectFit/interpolation/fillColor/renderMode
  //                    等直透 CSS/属性，onComplete/onError 挂原生事件。
  //   LocationButton/PasteButton/SaveButton
  //                    安全按钮三件套：默认样式（d.ts 默认值）+ onClick 直通 +
  //                    SecurityComponentOptions 常用样式段。
  //   Skeleton2d       加载骨架屏（脉冲动画条），无 attr 面。
  {
    /** @param {HTMLElement} el @param {string} kind @param {Record<string, (n: any, v: any, extra?: any) => void>} attrs */
    const markPlatform = (el, kind, attrs) => {
      (/** @type {any} */ (el)).__arkuiPlatform = kind;
      (/** @type {any} */ (el)).__platformAttrs = attrs;
    };
    // area.js 分派入口（挂在 batch 段通用标记上）
    (/** @type {any} */ (global)).__arkui_dom_platformDispatch =
      /** @param {any} node @param {string} prop @param {any} value @param {any} extra */ (node, prop, value, extra) => {
      const attrs = node && node.__platformAttrs;
      if (attrs && Object.prototype.hasOwnProperty.call(attrs, prop)) {
        attrs[prop](node, value, extra);
        return true;
      }
      return false;
    };

    // ── ArcSwiper ──
    /** @param {any} n @param {number} i */
    function arcSwiperShow(n, i) {
      const st = n.__arcSwiper;
      st.index = i;
      st.children.forEach((/** @type {any} */ k, /** @type {number} */ ki) => {
        k.style.display = ki === i ? 'block' : 'none';
      });
      if (st.onIndexChange && arguments[2] !== 'silent') {
        try { st.onIndexChange(i); } catch (e) { layoutWarnings.push('ArcSwiper.onChange: ' + e.message); }
      }
    }
    /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
    const ARCSWIPER_ATTRS = {
      index: (n, v) => { arcSwiperShow(n, Number(v) || 0, 'silent'); },
      indicator: (n, v) => { n.dataset.indicator = String(v); },
      duration: (n, v) => { n.style.transitionDuration = (Number(v) || 300) + 'ms'; },
      vertical: (n, v) => { n.dataset.vertical = String(v); },
      disableSwipe: (n, v) => { n.dataset.disableSwipe = String(v); },
      onChange: (n, v) => { n.__arcSwiper.onIndexChange = v; },
      onAnimationStart: (n, v) => { n.__arcSwiper.onAnimStart = v; },
      onAnimationEnd: (n, v) => { n.__arcSwiper.onAnimEnd = v; },
      onGestureSwipe: (n, v) => { n.__arcSwiper.onGesture = v; },
      effectMode: (n, v) => { n.dataset.effectMode = String(v); },
      customContentTransition: (n, v) => { n.__arcSwiper.customTransition = v; },
      disableTransitionAnimation: (n, v) => { n.style.transitionDuration = v ? '0ms' : ''; },
      digitalCrownSensitivity: () => {},     // 穿戴专属，DOM 无对应
    };
    const ArcSwiper = ensureComponent('ArcSwiper', (args) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;overflow:hidden;width:100%;height:100%';
      (/** @type {any} */ (el)).__arcSwiper = { index: (args && args[0]) || 0, children: [], onIndexChange: null };
      markPlatform(el, 'ArcSwiper', ARCSWIPER_ATTRS);
      return el;
    });
    {
      const prevPop = ArcSwiper.pop;
      /** @param {...any} args */
      ArcSwiper.pop = function (...args) {
        const top = ViewStackProcessor.top();
        prevPop.apply(null, args);
        if (top && /** @type {any} */ (top).__arcSwiper) {
          const st = /** @type {any} */ (top).__arcSwiper;
          st.children = [...top.children].filter((/** @type {any} */ c) => c.getAttribute && c.getAttribute('data-arkui-comp'));
          arcSwiperShow(top, st.index, 'silent');
        }
      };
    }

    // ── ArcListItem ──
    /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
    const ARCLISTITEM_ATTRS = {
      autoScale: (n, v) => {
        if (!v) { n.style.transform = ''; return; }
        n.onpointerdown = () => { n.style.transform = 'scale(0.96)'; };
        n.onpointerup = n.onpointerleave = () => { n.style.transform = ''; };
      },
      swipeAction: (n, v) => {
        // 真机：滑出操作区（builder 提供）。DOM 简化：水平拖动 translateX ≤ 0。
        if (!v) { n.onpointerdown = n.onpointermove = n.onpointerup = null; return; }
        let sx = 0;
        n.onpointerdown = (/** @type {any} */ e) => { sx = e.clientX; };
        n.onpointermove = (/** @type {any} */ e) => {
          if (!sx) return;
          n.style.transform = 'translateX(' + Math.min(0, e.clientX - sx) + 'px)';
        };
        n.onpointerup = () => { sx = 0; };
      },
    };
    const ArcListItem = ensureComponent('ArcListItem', (args) => {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;transition:transform 150ms';
      markPlatform(el, 'ArcListItem', ARCLISTITEM_ATTRS);
      return el;
    });

    // ── ArcScrollBar ──
    const ArcScrollBar = ensureComponent('ArcScrollBar', (args) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:8px;min-height:40px;background:rgba(0,0,0,0.15);border-radius:4px';
      const thumb = document.createElement('div');
      thumb.style.cssText = 'position:absolute;top:0;width:100%;height:20%;background:rgba(0,0,0,0.4);border-radius:4px';
      el.appendChild(thumb);
      (/** @type {any} */ (el)).__arcThumb = thumb;
      markPlatform(el, 'ArcScrollBar', {});
      return el;
    });
    // json attrs 为空——比例驱动走全局助手（测试/上层手动）
    /** @param {any} n @param {number} ratio */
    (/** @type {any} */ (global)).__arkui_dom_arcScrollThumb =
      /** @param {any} n @param {number} ratio */ (n, ratio) => {
      if (n && n.__arcThumb) n.__arcThumb.style.top = Math.max(0, Math.min(0.8, Number(ratio) || 0)) * 100 + '%';
    };

    // ── ArcAlphabetIndexer ──
    /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
/** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
    const ARCIDX_ATTRS = {
      selected: (n, v) => {
        const st = n.__arcIdx; st.selected = Number(v) || 0;
        [...n.children].forEach((k, ki) => { k.style.color = ki === st.selected ? '#007dff' : ''; k.style.fontWeight = ki === st.selected ? 'bold' : ''; });
      },
      onSelect: (n, v) => { n.__arcIdx.onSelect = v; },
      usePopup: (n, v) => { n.title = v ? 'popup' : ''; },
      font: (n, v) => { if (v && v.size) n.style.fontSize = Number(v.size) + 'px'; },
      itemSize: (n, v) => { if (v) n.style.minHeight = Number(v) + 'px'; },
      color: (n, v) => { n.dataset.color = String(v); },
      selectedColor: (n, v) => { n.dataset.selectedColor = String(v); },
      popupColor: () => {}, popupBackground: () => {}, popupFont: () => {},
      selectedBackgroundColor: () => {}, selectedFont: () => {},
      popupBackgroundBlurStyle: () => {}, autoCollapse: () => {}, marginOption: () => {},
    };
    const ArcAlphabetIndexer = ensureComponent('ArcAlphabetIndexer', (args) => {
      const arr = (args && args[0]) || [];
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;overflow-y:auto';
      const st = /** @type {{ selected: number, onSelect: ((i: number) => void) | null }} */ ({ selected: (args && args[1]) || 0, onSelect: null });
      (/** @type {any} */ (el)).__arcIdx = st;
      arr.forEach((/** @type {any} */ ch, /** @type {number} */ i) => {
        const c = document.createElement('div');
        c.textContent = String(ch);
        c.style.cssText = 'font-size:12px;cursor:pointer;padding:1px 4px';
        c.setAttribute('data-arc-idx-item', String(i));
        c.onclick = () => {
          const selFn = /** @type {any} */ (ARCIDX_ATTRS.selected);
          selFn(el, i);
          if (st.onSelect) { try { st.onSelect(i); } catch (e) { layoutWarnings.push('ArcAlphabetIndexer.onSelect: ' + e.message); } }
        };
        el.appendChild(c);
      });
      markPlatform(el, 'ArcAlphabetIndexer', ARCIDX_ATTRS);
      return el;
    });

    // ── DotMatrix（5×7 字形点阵）──
    /** @type {Record<string, string>} */
    const DOT_GLYPHS = {
      '0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111',
      '4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001001001001',
      '8':'111101111101111','9':'111101111001111','A':'010101111101101','B':'110101110101110',
      'C':'011100100100011','D':'110101101101110','E':'111100111100111','F':'111100111100100',
      'G':'011100101101011','H':'101101111101101','I':'111010010010111','J':'001001001101010',
      'K':'101101110101101','L':'100100100100111','M':'101111111101101','N':'110101101101101',
      'O':'010101101101010','P':'111101111100100','Q':'010101101111011','R':'110101110101101',
      'S':'011100010001110','T':'111010010010010','U':'101101101101111','V':'101101101101010',
      'W':'101101111111101','X':'101101010101101','Y':'101101010010010','Z':'111001010100111',
    };
    /** @param {any} n */
    function dotMatrixRender(n) {
      const st = n.__dot;
      n.innerHTML = '';
      const cols = Math.max(1, st.text.length * 3 + Math.max(0, st.text.length - 1));
      n.style.gridTemplateColumns = 'repeat(' + cols + ', 4px)';
      n.style.gap = st.spacing + 'px';
      for (const ch of st.text.toUpperCase()) {
        const g = DOT_GLYPHS[ch] || '000000000000000';
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 3; c++) {
            const d = document.createElement('div');
            d.style.cssText = 'width:4px;height:4px;border-radius:50%;background:'
              + (g[r * 3 + c] === '1' ? '#222' : 'rgba(0,0,0,0.08)');
            n.appendChild(d);
          }
        }
      }
    }
    /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
    const DOT_ATTRS = {
      dotSpacing: (n, v) => { n.__dot.spacing = Number(v) || 2; dotMatrixRender(n); },
      dotMatrixEffects: (n, v) => { n.dataset.effects = JSON.stringify(v); },
      onEffectChanged: (n, v) => { n.__dot.onEffect = v; },
      text: (n, v) => { n.__dot.text = String(v == null ? '' : v); dotMatrixRender(n); },
    };
    const DotMatrix = ensureComponent('DotMatrix', (args) => {
      const el = document.createElement('div');
      el.style.cssText = 'display:grid;gap:2px';
      (/** @type {any} */ (el)).__dot = { text: (args && args[0]) || '', spacing: 2 };
      markPlatform(el, 'DotMatrix', DOT_ATTRS);
      dotMatrixRender(el);
      return el;
    });

    // ── MediaCachedImage（img 同构）──
    /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
    const MCI_ATTRS = {
      objectFit: (n, v) => { n.style.objectFit = String(v); },
      matchTextDirection: (n, v) => { n.dataset.mtd = String(v); },
      fitOriginalSize: (n, v) => { if (v) { n.style.width = 'auto'; n.style.height = 'auto'; } },
      objectRepeat: (n, v) => { n.dataset.repeat = String(v); },
      interpolation: (n, v) => { n.style.imageRendering = Number(v) >= 3 ? 'auto' : 'pixelated'; },
      fillColor: (n, v) => { n.style.filter = v ? 'drop-shadow(0 0 0 ' + v + ')' : ''; },
      sourceSize: (n, v) => { if (v && v.width) n.style.width = Number(v.width) + 'px'; },
      autoResize: (n, v) => { n.dataset.autoResize = String(v); },
      renderMode: (n, v) => { if (Number(v) === 1) n.style.filter = 'brightness(0) invert(1)'; },
      onComplete: (n, v) => {
        n.onload = () => { try { v({ loadingStatus: 1, width: n.naturalWidth, height: n.naturalHeight }); } catch (e) { layoutWarnings.push('MediaCachedImage.onComplete: ' + e.message); } };
      },
      onError: (n, v) => { n.onerror = () => { try { v(); } catch (e) { layoutWarnings.push('MediaCachedImage.onError: ' + e.message); } }; },
      onFinish: () => {},
    };
    const MediaCachedImage = ensureComponent('MediaCachedImage', (args) => {
      const img = document.createElement('img');
      img.style.cssText = 'object-fit:contain';
      img.alt = '';
      if (args && args[0] !== undefined) img.src = String(resolveResource(args[0]));
      markPlatform(img, 'MediaCachedImage', MCI_ATTRS);
      return img;
    });

    // ── 安全按钮三件套 ──
    /** @param {string} name @param {string} label @param {string} icon */
    const makeSecurityButton = (name, label, icon) => {
      /** @type {Record<string, (n: any, v: any, extra?: any) => void>} */
      const ATTRS = {
        onClick: (n, v) => { n.onclick = () => { try { v(); } catch (e) { layoutWarnings.push(name + '.onClick: ' + e.message); } }; },
        fontSize: (n, v) => { n.style.fontSize = Number(v) + 'px'; },
        fontColor: (n, v) => { n.style.color = String(v); },
        fontFamily: (n, v) => { n.style.fontFamily = String(v); },
        fontStyle: (n, v) => { n.style.fontStyle = Number(v) === 1 ? 'italic' : ''; },
        fontWeight: (n, v) => { n.style.fontWeight = String(v); },
        backgroundColor: (n, v) => { n.style.backgroundColor = String(v); },
        borderRadius: (n, v) => { n.style.borderRadius = Number(v) + 'px'; },
        borderWidth: (n, v) => { n.style.borderWidth = Number(v) + 'px'; },
        borderColor: (n, v) => { n.style.borderColor = String(v); },
        borderStyle: (n, v) => { n.style.borderStyle = Number(v) === 0 ? 'dotted' : Number(v) === 1 ? 'dashed' : 'solid'; },
        padding: (n, v) => {
          const p = /** @type {any} */ (v);
          if (p && typeof p === 'object') {
            n.style.padding = [p.top, p.right, p.bottom, p.left].map((x) => Number(x) || 0).join('px ') + 'px';
          } else if (v) { n.style.padding = Number(v) + 'px'; }
        },
        iconSize: (n, v) => { n.dataset.iconSize = String(v); },
        layoutDirection: (n, v) => { n.style.flexDirection = v === 0 ? 'column' : 'row'; },
        position: (n, v) => { n.style.position = 'absolute'; n.style.left = Number((/** @type {any} */ (v)).x || 0) + 'px'; n.style.top = Number((/** @type {any} */ (v)).y || 0) + 'px'; },
        markAnchor: (n, v) => { n.dataset.markAnchor = JSON.stringify(v); },
        offset: (n, v) => { n.dataset.offset = JSON.stringify(v); },
        textIconSpace: (n, v) => { n.style.gap = Number(v) + 'px'; },
        iconColor: (n, v) => { n.dataset.iconColor = String(v); },
        key: (n, v) => { n.dataset.secKey = String(v); },
      };
      const B = ensureComponent(name, (args) => {
        const b = document.createElement('button');
        b.style.cssText = 'display:inline-flex;align-items:center;gap:4px;border:none;color:#fff;'
          + 'background:#007dff;font-size:16px;border-radius:20px;padding:6px 14px;cursor:pointer';
        b.textContent = icon + label;
        b.setAttribute('data-security-btn', name);
        const opt = args && args[0];
        if (opt && typeof opt.click === 'function') {
          b.onclick = () => { try { opt.click(); } catch (e) { layoutWarnings.push(name + '.click: ' + e.message); } };
        }
        markPlatform(b, name, ATTRS);
        return b;
      });
      return B;
    };
    (/** @type {any} */ (global)).LocationButton = makeSecurityButton('LocationButton', '位置', '📍');
    (/** @type {any} */ (global)).PasteButton = makeSecurityButton('PasteButton', '粘贴', '📋');
    (/** @type {any} */ (global)).SaveButton = makeSecurityButton('SaveButton', '保存', '💾');

    // ── Skeleton2d（脉冲骨架条）──
    const Skeleton2d = ensureComponent('Skeleton2d', (args) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:100%;height:16px;border-radius:8px;'
        + 'background:linear-gradient(90deg,#eee 25%,#f7f7f7 50%,#eee 75%);'
        + 'background-size:200% 100%;animation:arkui-skel 1.2s infinite';
      if (!document.getElementById('arkui-skel-style')) {
        const style = document.createElement('style');
        style.id = 'arkui-skel-style';
        style.textContent = '@keyframes arkui-skel{0%{background-position:200% 0}100%{background-position:-200% 0}}';
        document.head.appendChild(style);
      }
      markPlatform(el, 'Skeleton2d', {});
      return el;
    });

    // 归档全局（产物自由变量引用；registerGeneratedComponents 的手写优先逻辑会跳过它们）
    (/** @type {any} */ (global)).ArcSwiper = ArcSwiper;
    (/** @type {any} */ (global)).ArcListItem = ArcListItem;
    (/** @type {any} */ (global)).ArcScrollBar = ArcScrollBar;
    (/** @type {any} */ (global)).ArcAlphabetIndexer = ArcAlphabetIndexer;
    (/** @type {any} */ (global)).DotMatrix = DotMatrix;
    (/** @type {any} */ (global)).MediaCachedImage = MediaCachedImage;
    (/** @type {any} */ (global)).Skeleton2d = Skeleton2d;
  }
