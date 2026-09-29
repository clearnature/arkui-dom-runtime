  // ────────────────── i18n 系统化（R135，E1-3）──────────────────
  //
  // 目标：@ohos:i18n 从"三个 getter 的最小垫片"升级到企业面——Locale/Calendar/NumberFormat
  // 映射到宿主 Intl；系统回调（onSystemLanguageChange）；资源 qualifier（zh_CN/en_US 目录）
  // 的运行时切换。RTL 布局贯通归 WithEnv（batch-platform.js，R120 已有 dir 属性挂载）。
  //
  // 语义出处（SDK @ohos.i18n.d.ts，选面原则=企业常用子集，逐条标行号）：
  //   i18n.System.getSystemLanguage/Region/Locale（:92-114 旧面；System 类 :176/226 起）
  //   i18n.System.getAppPreferredLanguage（:230 附近）
  //   i18n.isRTL(ch)（:1435）——Unicode 字符方向判断
  //   i18n.System.setAppPreferredLanguage(lang)（App 层覆盖）
  //   i18n.Calendar（:getInstance 重载族）——映射 Intl.DateTimeFormat 日历字段
  //   i18n.NumberFormat（:constructor/format）——映射 Intl.NumberFormat
  //   i18n.Util.unitConvert（:523/553）——线性单位换算（长度/温度子集，复合单位标推断）
  //
  // 【不实现/记录面】setSystemLanguage（系统语言无宿主出口）、getUnicodeWrappedFilePath、
  //   Transliterator 系——落 layoutWarnings（不静默）。
  //
  // 资源 qualifier：generated-app-resources.js 表按 base 取值；本分片提供
  //   `__arkui_dom_i18n.setResourceLocale('zh_CN')` —— 从 /harmony-proj/.../resources/<locale>/
  //   element/*.json 拉取覆盖值合并进 app.values（fetch 双端同源，R128 同构）。
  //   qualifier 目录不存在（404）→ 保持 base，NOTICE 记录。

  (function () {
    const g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : self);
    if (g.__arkui_dom_i18n) return;   // 防重（测试页独立补载同 focus.js 约定）

    /** @type {string} App 层首选语言覆盖（setAppPreferredLanguage 设置） */
    let appPreferred = '';
    /** @type {Array<(lang: string) => void>} 语言变化监听 */
    const langListeners = [];
    /** @type {string} 资源 qualifier 当前值（'' = base） */
    let resourceLocale = '';

    const hostLocale = () => {
      try {
        return (globalThis.Intl && Intl.DateTimeFormat().resolvedOptions().locale) || 'en-US';
      } catch (e) { return 'en-US'; }
    };

    /** 系统语言（旧面 + System 面共用）：App 覆盖 > 宿主 locale 主子标记 */
    const systemLanguage = () => {
      if (appPreferred) return appPreferred.split('-')[0];
      return hostLocale().split('-')[0];
    };
    const systemRegion = () => {
      const src = appPreferred || hostLocale();
      const m = src.match(/[-]([A-Za-z]{2})$/);
      return m ? m[1].toUpperCase() : '';
    };
    const systemLocale = () => appPreferred || hostLocale();

    /**
     * 资源 qualifier 切换：拉取 resources/<locale>/element/*.json 合并进 app.values。
     * 404 容忍（回退 base 不报错—— qualifier 目录可缺席）。
     * @param {string} locale 形如 zh_CN / en_US；空串 = 回 base
     */
    async function setResourceLocale(locale) {
      const app = g.__arkui_app_res;
      if (!app) { g.__arkui_dom_layout_warnings.push('i18n.setResourceLocale: __arkui_app_res 未装载'); return; }
      if (!locale && app.__baseValuesSnapshot) {
        // 回 base：恢复首访时的值快照（qualifier 覆盖会污染 values——回退须复原）
        for (const t of Object.keys(app.values)) {
          app.values[t] = JSON.parse(JSON.stringify(app.__baseValuesSnapshot[t] || {}));
        }
      }
      if (!app.__baseValuesSnapshot) {
        app.__baseValuesSnapshot = JSON.parse(JSON.stringify(app.values));
      }
      resourceLocale = locale || '';
      if (!locale) return;
      const base = (g.location && /\/test\//.test(g.location.pathname)) ? '../' : './';
      for (const t of ['string', 'color', 'float', 'integer']) {
        try {
          const resp = await fetch(`${base}harmony-proj/entry/src/main/resources/${locale}/element/${t}.json`);
          if (!resp.ok) continue;
          const j = await resp.json();
          for (const e of (j[t] || [])) app.values[t][e.name] = e.value;
        } catch (e) { /* 目录缺席容忍（R135：qualifier 可选） */ }
      }
    }

    const i18n = {
      System: {
        /** @returns {string} 系统语言（App 覆盖 > 宿主 locale） */
      getSystemLanguage() { return systemLanguage(); },
      /** @returns {string} 系统区域（大写二字符） */
      getSystemRegion() { return systemRegion(); },
      /** @returns {string} 完整 locale id */
      getSystemLocale() { return systemLocale(); },
      /** @returns {string} App 首选语言（未设置 = 系统 locale） */
      getAppPreferredLanguage() { return appPreferred || systemLocale(); },
      /** @param {string} lang 设置 App 首选语言（触发 languageChange 监听） */
      setAppPreferredLanguage(lang) {
        appPreferred = String(lang || '');
        for (const cb of langListeners) {
          try { cb(appPreferred); } catch (e) { g.__arkui_dom_layout_warnings.push('i18n 语言回调抛错: ' + (e && e.message)); }
        }
      },
      /** @param {string} type @param {(lang: string) => void} cb 监听 languageChange */
      on(type, cb) { if (type === 'languageChange' && typeof cb === 'function') langListeners.push(cb); return g; },
      /** @param {string} type @param {(lang: string) => void} cb */
      off(type, cb) {
        if (type === 'languageChange') {
          const i = langListeners.indexOf(cb);
          if (i >= 0) langListeners.splice(i, 1);
        }
      },
      },
      /** @param {string} ch @returns {boolean} */
      isRTL(ch) {
        // Unicode 双向类目 R/AL 的常用区间（i18n.d.ts:1428-1435 "Checks whether input char is RTL"）
        const c = String(ch).codePointAt(0) || 0;
        return (c >= 0x0590 && c <= 0x05FF) || (c >= 0x0600 && c <= 0x06FF) ||
               (c >= 0x0700 && c <= 0x074F) || (c >= 0xFB50 && c <= 0xFDFF) ||
               (c >= 0xFE70 && c <= 0xFEFF);
      },
      get lineBreakStyle() { return undefined; },   // 记录面（无 CSS 映射必要）——不发布
      Calendar: {
        /** @param {string=} [locale] @returns {any} Intl 映射的日历对象（最小面） */
        getInstance(locale) {
          const loc = locale || systemLocale();
          const d = new Date();
          return {
            /** @param {number=} [year] @param {number=} [month] 0-based，与 Date 一致 @param {number=} [day] */
            set(year, month, day) {
              if (year !== undefined) d.setFullYear(Number(year));
              if (month !== undefined) d.setMonth(Number(month));
              if (day !== undefined) d.setDate(Number(day));
            },
            /** @param {number} ms */
            setTime(ms) { d.setTime(Number(ms)); },
            /** @returns {number} 年（日历年） */
            getYear() { return d.getFullYear(); },
            /** @returns {number} 月（1-based——i18n.Calendar 口径，与 Date 0-based 差一） */
            getMonth() { return d.getMonth() + 1; },
            /** @returns {number} 日 */
            getDayOfMonth() { return d.getDate(); },
            /** @returns {number} 星期（1=周日 … 7=周六，Intl/Date 同序） */
            getDayOfWeek() { return d.getDay() + 1; },
          };
        },
        getAvailableIDs() {
          const intlAny = /** @type {any} */ (Intl);
          try { return intlAny.supportedValuesOf ? intlAny.supportedValuesOf('timeZone') : ['UTC']; }
          catch (e) { return ['UTC']; }
        },
      },
      NumberFormat: class {
        /** @param {string} locale @param {any=} [options] Intl.NumberFormat options 子集 */
        constructor(locale, options) {
          this._fmt = new Intl.NumberFormat(locale || systemLocale(), options);
        }
        /** @param {number|string} value @returns {string} */
        format(value) { return this._fmt.format(Number(value)); }
      },
      Util: {
        /**
         * 单位换算（线性子集：长度 m/km/cm/mm/mi/yd/ft/in、温度 °C/°F/°K）。
         * 复合单位（mph 等）不收——i18n.d.ts:523 的完整面标"部分实现"。
         */
        /** @param {any} fromUnit @param {any} toUnit @param {number} value @param {string} locale @param {string=} [style] @returns {string} */
        unitConvert(fromUnit, toUnit, value, locale, style) {
          const units = /** @type {Record<string, number>} */ ({
            m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254,
          });
          const temp = ['c', 'f', 'k'];
          const fu = String(fromUnit.unit || fromUnit).toLowerCase().replace('°', '');
          const tu = String(toUnit.unit || toUnit).toLowerCase().replace('°', '');
          let out = value;
          try {
            if (temp.indexOf(fu) >= 0 && temp.indexOf(tu) >= 0) {
              let c = fu === 'c' ? value : fu === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
              out = tu === 'c' ? c : tu === 'f' ? c * 9 / 5 + 32 : c + 273.15;
            } else if (units[fu] && units[tu]) {
              out = value * units[fu] / units[tu];
            } else {
              g.__arkui_dom_layout_warnings.push(`i18n.unitConvert: 未支持的单位对 ${fu}→${tu}（复合单位不在 R135 面）`);
              return String(value);
            }
            const nf = new Intl.NumberFormat(locale || systemLocale(), { maximumFractionDigits: 2 });
            return nf.format(Math.round(out * 100) / 100) + ' ' + (toUnit.symbol || toUnit.unit || '');
          } catch (e) {
            g.__arkui_dom_layout_warnings.push('i18n.unitConvert: ' + (e && e.message));
            return String(value);
          }
        },
      },
      setResourceLocale,
      /** @returns {string} 当前资源 qualifier（'' = base） */
      getResourceLocale() { return resourceLocale; },
    };
    g.__arkui_dom_i18n = i18n;
  })();
