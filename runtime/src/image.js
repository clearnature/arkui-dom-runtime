  // ────────────────── Image 组件（R45）：真实 <img> 基座 ──────────────────
  //
  // 产物形态（实测 fixtures/pages/ImageDemo.ts）：
  //   Image.create('test-assets/known-7x3.png');   ← create 单参（ResourceStr）
  //   Image.objectFit(ImageFit.Contain);           ← ImageFit 是自由变量（数值 0..5/7..16）
  //   Image.alt('…'); Image.onError(cb); Image.onComplete(cb); Image.syncLoad(true);
  //
  // DOM 映射：根 = div（position:relative），内含主 <img> + alt 占位 <img>（绝对定位垫底，
  // 主图加载成功前/失败时可见——真机 alt 语义："placeholder image displayed during loading"）。
  // objectFit → CSS object-fit（Contain→contain / Cover→cover / Fill→fill / ScaleDown→
  // scale-down / None→none——枚举语义与 CSS 关键字一一同名对齐；Auto 记 data-* 不映射；
  // 对齐族 7..16 → object-position；MATRIX 记警告）。事件：load → onComplete（载荷含真实
  // 解码尺寸）→ onLoad、error → onError。syncLoad 只记 data-*（浏览器默认即主线程解码）。
  // 回调经 __imgCbs 闭包间接引用（覆盖语义，坑 88 同族）；图已缓存完成时补派发（定时器
  // 收口，坑 ⑧ 同思想）。
  /** @type {Record<string, string>} */
  const IMAGE_FIT_CSS = { 0: 'contain', 1: 'cover', 3: 'fill', 4: 'scale-down', 5: 'none' };
  /** @type {Record<string, (n: any, v: any, opts?: any) => void>} */
  const IMAGE_ATTRS = {
    objectFit: (n, v) => {
      const fit = Number(resolveResource(v));
      n.dataset.objectFit = String(fit);
      const css = IMAGE_FIT_CSS[fit];
      const main = n.querySelector('[data-arkui-img-main]');
      const altImg = n.querySelector('[data-arkui-img-alt]');
      if (css) {
        if (main) main.style.objectFit = css;
        if (altImg) altImg.style.objectFit = css;
      } else if (fit >= 7 && fit <= 15) {
        layoutWarnings.push(`Image.objectFit 的对齐档位 ${fit} 未实现（需 object-position 组合，记 data-*）`);
      } else if (fit === 16) {
        layoutWarnings.push('Image.objectFit MATRIX 未实现（记 data-*）');
      }
      // Auto(2)：真机"自适应"，取基座默认 stretch——如实不映射
    },
    alt: (n, v) => {
      const altImg = n.__arkuiImgEnsureAlt();
      altImg.src = String(resolveResource(v));
      n.dataset.alt = String(resolveResource(v));
      n.__arkuiImgTryAlt();
    },
    syncLoad: (n, v) => { n.dataset.syncLoad = String(!!resolveResource(v)); },
    draggable: (n, v) => { n.dataset.draggable = String(!!resolveResource(v)); },
    interpolate: (n, v) => { n.dataset.interpolate = String(!!resolveResource(v)); },
    onLoad: (n, v) => { (/** @type {any} */ (n.__imgCbs = n.__imgCbs || {})).load = v; (/** @type {() => void} */ (n.__arkuiImgFireIfDone))(); },
    onComplete: (n, v) => { (/** @type {any} */ (n.__imgCbs = n.__imgCbs || {})).complete = v; (/** @type {() => void} */ (n.__arkuiImgFireIfDone))(); },
    onError: (n, v) => { (/** @type {any} */ (n.__imgCbs = n.__imgCbs || {})).error = v; (/** @type {() => void} */ (n.__arkuiImgFireIfDone))(); },
  };
  const Image = ensureComponent('Image', (args) => {
    const el = document.createElement('div');
    el.__arkuiImage = true;
    el.dataset.image = '';
    el.style.position = 'relative';
    el.style.overflow = 'hidden';
    const main = document.createElement('img');
    main.setAttribute('data-arkui-img-main', '');
    main.style.display = 'block';
    main.style.width = '100%';
    main.style.height = '100%';
    // alt 占位图**惰性创建**（R45 教训：预插的无 src <img> 会被页面的 querySelector('img')
    // 命中、getAttribute('src') 为 null——widgets 页的旧断言就是这么红的）
    /** @type {any} */ let altImg = null;
    const ensureAlt = () => {
      if (!altImg) {
        altImg = document.createElement('img');
        altImg.setAttribute('data-arkui-img-alt', '');
        altImg.style.display = 'none';
        altImg.style.position = 'absolute';
        altImg.style.inset = '0';
        altImg.style.width = '100%';
        altImg.style.height = '100%';
        el.insertBefore(altImg, main);
      }
      return altImg;
    };
    el.appendChild(main);
    const s0 = args && args[0] !== undefined && args[0] !== null ? resolveResource(args[0]) : null;
    if (s0 != null) {
      main.src = String(s0);
    } else if (args && args[0] !== undefined) {
      // Resource 形态解析不出 URL：如实记 data-src，不伪造 src='null'
      el.dataset.src = String(args[0]);
      layoutWarnings.push(`Image.create 的资源参数无法解析为 URL（${String(args[0])}），记 data-src`);
    }
    el.__arkuiImgEnsureAlt = ensureAlt;
    el.__arkuiImgTryAlt = () => {
      // alt 语义：主图还没成功加载（含加载失败）→ 占位图顶上
      if (altImg && altImg.src && !main.complete) {
        altImg.style.display = 'block';
      }
    };
    if (altImg) el.__arkuiImgTryAlt();
    // 事件收口（坑 ⑧ 同思想）：load/error 都可能晚于属性挂载到达——回调经 __imgCbs 间接
    // 引用（覆盖语义）；img.complete 已成立时用定时器补派发，动画事件只当见证
    main.addEventListener('load', () => {
      if (altImg) altImg.style.display = 'none';
      el.__arkuiImgLoaded = true;
      (/** @type {() => void} */ (el.__arkuiImgFireIfDone))();
    });
    main.addEventListener('error', () => {
      el.__arkuiImgFailed = true;
      if (altImg && altImg.src) altImg.style.display = 'block';
      (/** @type {() => void} */ (el.__arkuiImgFireIfDone))();
    });
    el.__arkuiImgFireIfDone = () => {
      const cbs = el.__imgCbs;
      if (!cbs) return;
      /** @param {any} name @param {any} arg */
      const fire = (name, arg) => {
        if (typeof cbs[name] !== 'function') return;
        const cb = cbs[name];
        cbs[name] = undefined;   // 同步认领：双事件（load+补派发）只会真正跑一次
        setTimeout(() => {
          try { cb(arg); }
          catch (e) { layoutWarnings.push(`Image.${name} 回调抛错：${e && e.message}`); }
        }, 0);
      };
      if (el.__arkuiImgLoaded) {
        fire('complete', {
          loadingStatus: 0,
          width: main.naturalWidth,
          height: main.naturalHeight,
          componentWidth: el.offsetWidth,
          componentHeight: el.offsetHeight,
          contentWidth: main.naturalWidth,
          contentHeight: main.naturalHeight,
        });
        fire('load', undefined);
        cbs.complete = undefined;   // 载荷回调只在加载完成时发一次（重渲染重挂安全）
        cbs.load = undefined;
      } else if (el.__arkuiImgFailed) {
        fire('error', undefined);
        cbs.error = undefined;
      }
    };
    (/** @type {() => void} */ (el.__arkuiImgFireIfDone))();
    return el;
  });
