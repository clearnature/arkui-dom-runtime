  // ────────────────── @ohos:data.relationalStore（E1-2 结构化存储）──────────────────
  //
  // 目标：企业数据面要"真 SQL + 事务"。@ohos.data.preferences 垫片是自定 JSON 格式
  // （与真机不通用），本分片给出关系库面：SQL 语义由 sql.js（SQLite 编译为 WASM）执行，
  // 持久化借现有 file.fs 垫片后端（Electron=nodeFs 真盘 / 浏览器=localStorage）。
  //
  // 【选型裁决：sql.js（WASM），不用 better-sqlite3（原生模块）】
  //   · 本项目双端矩阵（浏览器 + Electron）必须同构——原生 .node 模块浏览器跑不了；
  //   · better-sqlite3 还有 Electron ABI 绑定问题（electron/runtime 的 ABI 与 node 不一定
  //     一致，需 electron-rebuild，打包还要随包带 .node）；
  //   · sql.js 零原生依赖；落盘代价 = db.export() 字节 → base64 → 走 file.fs 真后端，
  //     与 preferences 垫片的"JSON 文本落盘"约定同构（/vfs/files/rdb_<name>.json）。
  //
  // 语义出处（SDK @ohos.data.relationalStore.d.ts，26.0.0.821）：
  //   ValueType（:224）/ ValuesBucket（:232）/ StoreConfig（:283，name :295、securityLevel :305、
  //   encrypt :320）/ SecurityLevel（:1066，S1..S4 = 1..4）/ ConflictResolution（:1473，0..5）/
  //   ResultSet（:2485，成员行号见各成员处注释）/ RdbStore（:3789，version :3813、insert :3922/:3956、
  //   querySql :4820、executeSql :5218、beginTransaction :5351、commit :5409、rollBack :5467、
  //   close :6181）/ getRdbStore（:7497）/ deleteRdbStore（:7631）
  // 错误码（同文件 @throws 注释）：14800000 Inner error（:2594）、14800012 ResultSet 空/游标越界
  //   （:2662）、14800013 列下标越界（:2591）、14800014 实例已关闭（:2573）、14800019 SQL 必须是
  //   查询语句（:2574）、14800021 SQLite Generic error（:2575）。
  //
  // 【不静默纪律】sql.js WASM 缺席时 getRdbStore 显式抛 14800000，message 给出可操作安装步骤；
  //   绝不用"内存 Map + 伪 SQL"冒充执行（那是假绿，见 docs/DEVELOPING.md 持久化原则）。
  //   WASM 安装步骤也可用 node tools/check-sqljs.mjs 诊断。

  (function () {
    const g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : self);
    if (g.__arkui_dom_relationalstore) return;   // 防重（测试页独立补载，同 i18n.js 约定）

    /**
     * 业务错误（对齐真机 BusinessError：{ code, message }）。
     * @param {number} code
     * @param {string} message
     */
    function rdbErr(code, message) { return Object.assign(new Error(message), { code }); }

    /**
     * 观测留痕（对齐 ohos-shims 的 __arkui_dom_logs 约定）。
     * @param {Record<string, any>} entry
     */
    function note(entry) {
      try {
        if (!g.__arkui_dom_logs) g.__arkui_dom_logs = [];
        g.__arkui_dom_logs.push(entry);
      } catch (e) { /* 日志免疫：绝不因记录失败改变业务语义 */ }
    }

    // ── 枚举面（值逐条对 d.ts）──
    const SecurityLevel = { S1: 1, S2: 2, S3: 3, S4: 4 };                                     // d.ts:1066-1103
    const ConflictResolution = {                                                              // d.ts:1473-1525
      ON_CONFLICT_NONE: 0, ON_CONFLICT_ROLLBACK: 1, ON_CONFLICT_ABORT: 2,
      ON_CONFLICT_FAIL: 3, ON_CONFLICT_IGNORE: 4, ON_CONFLICT_REPLACE: 5,
    };

    // ── sql.js 加载器 ──
    // 候选来源（按序探测，命中即用）：
    //   ① g.__arkui_dom_sqljs_factory —— 测试/宿主显式注入 initSqlJs 工厂（单测钩子）
    //   ② g.initSqlJs                —— 页面自己 <script> 引过 sql-wasm.js
    //   ③ 动态注入 <script> 到 runtime/vendor/sqljs/（文档规定的安装位；Node 下走 require 同目录 UMD）
    // WASM 缺席 → 抛 14800000 + 安装步骤（不静默、不降级伪实现）。
    const INSTALL_STEPS =
      '安装步骤：\n' +
      '  1. npm i sql.js@1.8.0 --no-save   # 版本须与 runtime/vendor/sqljs 的发行包一致\n' +
      '  2. mkdir -p runtime/vendor/sqljs\n' +
      '  3. cp node_modules/sql.js/dist/sql-wasm.js   runtime/vendor/sqljs/\n' +
      '  4. cp node_modules/sql.js/dist/sql-wasm.wasm runtime/vendor/sqljs/\n' +
      '  5. node tools/check-sqljs.mjs   # 自检在位状态\n' +
      '（或从 https://github.com/sql-js/sql.js/releases 取 dist/ 同名两文件；\n' +
      '  仓库内留有 runtime/vendor/sqljs/sql.js-1.8.0.tgz 可直接解包取 dist/）';

    /** @returns {string} vendor 目录 URL（相对当前页面），测试页在 /test/ 下需回退一级（同 i18n.js :72 的 base 技巧） */
    function vendorBase() {
      if (typeof g.__arkui_dom_sqljs_base === 'string' && g.__arkui_dom_sqljs_base) {
        return g.__arkui_dom_sqljs_base.endsWith('/') ? g.__arkui_dom_sqljs_base : g.__arkui_dom_sqljs_base + '/';
      }
      const inTest = !!(g.location && /\/test\//.test(String(g.location.pathname)));
      return inTest ? '../runtime/vendor/sqljs/' : 'runtime/vendor/sqljs/';
    }

    /** @type {any} 已解析的 SQL 工厂（initSqlJs 的返回：{ Database, … }），缓存防重复加载 */
    let sqlFactory = null;

    /**
     * 解析 sql.js（真 SQLite WASM）。
     * @returns {Promise<any>} sql.js 的 SQL 命名空间（new SQL.Database(...) 可用）
     * @throws {Error} code=14800000：WASM 缺席或初始化失败（message 含安装步骤）
     */
    async function loadSqlJs() {
      if (sqlFactory) return sqlFactory;
      // ① 显式注入（测试/宿主钩子）
      if (typeof g.__arkui_dom_sqljs_factory === 'function') {
        try { sqlFactory = await g.__arkui_dom_sqljs_factory(); return sqlFactory; }
        catch (e) { throw rdbErr(14800000, '[arkui-dom] __arkui_dom_sqljs_factory 初始化失败：' + (e && e.message)); }
      }
      // ② 页面已自行加载（sql-wasm.js 暴露全局 initSqlJs）
      if (typeof g.initSqlJs === 'function') {
        try { sqlFactory = await g.initSqlJs(); return sqlFactory; }
        catch (e) { throw rdbErr(14800000, '[arkui-dom] initSqlJs() 失败：' + (e && e.message) + '\n' + INSTALL_STEPS); }
      }
      // ③ vendor 目录
      const base = vendorBase();
      // Node/Electron(有 nodeIntegration)：sql-wasm.js 是 UMD，可直接 require（locateFile 指到同目录取 wasm）。
      // 刻意走 g.require 而不是裸 require / import()：产物是经典 <script>，import.meta 是解析期语法错误；
      // 且类型门禁是纯 DOM lib，裸 require/process/Buffer 都过不了 tsc。全部经 g（globalThis）取。
      if (typeof g.require === 'function') {
        try {
          const initSqlJs = g.require(base + 'sql-wasm.js');
          sqlFactory = await initSqlJs({ locateFile: (/** @type {string} */ f) => base + f });
          return sqlFactory;
        } catch (e) {
          throw rdbErr(14800000, '[arkui-dom] sql.js 未安装在 ' + base + '（' + (e && e.message) + '）\n' + INSTALL_STEPS);
        }
      }
      if (g.document && typeof g.document.createElement === 'function') {
        // 浏览器/Electron 渲染进程：动态注入 UMD 脚本，随后全局 initSqlJs 就位
        try {
          await new Promise((resolve, reject) => {
            const s = g.document.createElement('script');
            s.src = base + 'sql-wasm.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('script 加载失败: ' + s.src));
            g.document.head.appendChild(s);
          });
          if (typeof g.initSqlJs !== 'function') throw new Error('脚本已载入但 initSqlJs 未暴露');
          sqlFactory = await g.initSqlJs({ locateFile: (/** @type {string} */ f) => base + f });
          return sqlFactory;
        } catch (e) {
          throw rdbErr(14800000, '[arkui-dom] sql.js 未安装在 ' + base + '（' + (e && e.message) + '）\n' + INSTALL_STEPS);
        }
      }
      throw rdbErr(14800000, '[arkui-dom] 当前宿主既无 initSqlJs 也无 vendor 目录，无法提供真 SQL\n' + INSTALL_STEPS);
    }

    // ── 持久化后端（惰性解析：分片装载早于 ohos-shims.js，不能在装载期取 file.fs）──
    // 优先级：① __arkui_dom_nodeFs（Electron preload 真盘，text utf8 同步）
    //         ② file.fs 垫片模块（后端 = node-fs / opfs / localStorage，由 shims 确定性选择）
    //         ③ g.localStorage 直连（无 shims 的极简浏览器宿主）
    //         ④ 内存（volatile=true，明示不持久——只发生在无任何宿主存储的裸 Node 验证台）
    /** @type {{kind: string, exists: (p: string) => boolean, readText: (p: string) => string, writeText: (p: string, c: string) => number, unlink: (p: string) => void, volatile: boolean} | null} */
    let persistBackend = null;

    /** @returns {NonNullable<typeof persistBackend>} */
    function resolvePersist() {
      if (persistBackend) return persistBackend;
      const nodeFs = g.__arkui_dom_nodeFs;                       // Electron：真磁盘（text utf8）
      if (nodeFs) {
        persistBackend = {
          kind: 'node-fs',
          exists: (p) => !!nodeFs.existsSync(p),
          readText: (p) => String(nodeFs.readTextSync(p)),
          writeText: (p, c) => Number(nodeFs.writeTextSync(p, c)),
          unlink: (p) => nodeFs.unlinkSync(p),
          volatile: false,
        };
        return persistBackend;
      }
      try {
        const fsMod = typeof g.__arkui_dom_require === 'function' ? g.__arkui_dom_require('file.fs') : null;
        if (fsMod) {
          // file.fs 的同步 API：写是 write-behind（见 ohos-shims.js :957 注释），落盘队列由
          // __arkui_dom_fs.pending() 收口；这里提供 flush 钩子让 close 后真正排空。
          const fsMirror = g.__arkui_dom_fs;
          persistBackend = {
            kind: (fsMirror && fsMirror.backend) || 'file.fs',
            exists: (p) => { try { fsMod.accessSync(p); return true; } catch (e) { return false; } },
            readText: (p) => String(fsMod.readTextSync(p)),
            writeText: (p, c) => {
              const fd = fsMod.openSync(p, 64 | 512 /* CREATE|TRUNC */);
              // 【契约】ohos-shims 的 writeSync(fdNumber) 按【数字 fd】查 handles 表
              // （ohos-shims.js :932 `handles.get(fd)`）——传 openSync 返回的对象会 13900008
              const n = fsMod.writeSync(fd.fd, c);
              fsMod.closeSync(fd);
              return n;
            },
            unlink: (p) => fsMod.unlinkSync(p),
            volatile: false,
          };
          return persistBackend;
        }
      } catch (e) { /* file.fs 未注册（shims 未载入）→ 继续降级 */ }
      if (g.localStorage && typeof g.localStorage.setItem === 'function') {
        persistBackend = {
          kind: 'localStorage',
          exists: (p) => g.localStorage.getItem(p) !== null,
          readText: (p) => {
            const v = g.localStorage.getItem(p);
            if (v === null) throw rdbErr(13900002, 'No such file: ' + p);
            return v;
          },
          writeText: (p, c) => { g.localStorage.setItem(p, c); return c.length; },
          unlink: (p) => g.localStorage.removeItem(p),
          volatile: false,
        };
        return persistBackend;
      }
      // 兜底：无任何宿主存储（裸 Node 单测）。【如实自报 volatile】，不冒充持久化。
      const mem = new Map();
      persistBackend = {
        kind: 'memory',
        exists: (p) => mem.has(p),
        readText: (p) => { if (!mem.has(p)) throw rdbErr(13900002, 'No such file: ' + p); return String(mem.get(p)); },
        writeText: (p, c) => { mem.set(p, c); return c.length; },
        unlink: (p) => { mem.delete(p); },
        volatile: true,
      };
      note({ t: 'rdb.volatile', reason: '宿主无 nodeFs/file.fs/localStorage，库文件不落盘（仅本进程）' });
      return persistBackend;
    }

    // ── 字节 ↔ base64（落盘约定：fs 桥全是 text utf8，SQLite 字节必须编码后落盘）──
    /** @param {Uint8Array} bytes @returns {string} */
    function b64enc(bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return typeof g.btoa === 'function' ? g.btoa(bin) : g.Buffer.from(bytes).toString('base64');
    }
    /** @param {string} b64 @returns {Uint8Array} */
    function b64dec(b64) {
      const bin = typeof g.atob === 'function' ? g.atob(b64) : g.Buffer.from(b64, 'base64').toString('binary');
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    // ── 存储路径：与 preferences 垫片同约定（/vfs/files/pref_<name>.json → rdb_<name>.json）──
    const RDB_DIR = '/vfs/files';
    /** @param {string} name */
    const dbPath = (name) => `${RDB_DIR}/rdb_${name}.json`;
    /** @type {Map<string, any>} 同名库进程内唯一（d.ts:285-287：同进程禁止建两个同名库） */
    const rdbStores = new Map();

    /**
     * 落盘当前库字节。
     * @param {string} name
     * @param {any} db
     */
    function persistDb(name, db) {
      const backend = resolvePersist();
      const bytes = /** @type {Uint8Array} */ (db.export());
      const doc = JSON.stringify({ format: 'arkui-rdb-v1', engine: 'sql.js', bytes: b64enc(bytes) });
      backend.writeText(dbPath(name), doc);
      note({ t: 'rdb.persist', name, bytes: bytes.length, backend: backend.kind });
    }

    /** @param {number} code 14800021 族 → SQLite 错误换码 @param {string} message */
    function sqliteErr(code, message) { return rdbErr(code, '[SQLite] ' + message); }

    // ── ValuesBucket → 绑定参数（boolean → 1/0；Uint8Array → blob 直传；其余透传）──
    /** @param {Record<string, any>} values @returns {{cols: string[], qs: string[], params: any[]}} */
    function bucketToSql(values) {
      const cols = Object.keys(values);
      const qs = cols.map(() => '?');
      const params = cols.map((k) => {
        const v = values[k];
        if (typeof v === 'boolean') return v ? 1 : 0;
        return v === undefined ? null : v;
      });
      return { cols, qs, params };
    }

    /**
     * ResultSet（d.ts:2485）。sql.js 游标不能随机寻址，这里一次性物化行数组再游标化：
     * 语义按真机——rowIndex 初始 -1（:2515），goToNextRow 到尾返回 false 且 isEnded=true（:2546）。
     * @param {any} stmt sql.js Statement（已 bind 未 step）
     * @param {string[]} colNames
     */
    function makeResultSet(stmt, colNames) {
      const rows = /** @type {any[]} */ ([]);   // 物化行（每行 = 原始值数组）
      while (stmt.step()) rows.push(/** @type {any[]} */ (stmt.get()));
      stmt.free();
      let rowIndex = -1;
      let closed = false;
      const assertOpen = () => { if (closed) throw rdbErr(14800014, 'The target instance is already closed.'); };
      /** @param {number} columnIndex 列下标守卫（d.ts:2591 14800013） */
      const assertCol = (columnIndex) => {
        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= colNames.length) {
          throw rdbErr(14800013, `Column index is out of bounds: ${columnIndex} (columns=${colNames.length})`);
        }
      };
      /** 当前行守卫（d.ts:2662 14800012） */
      const assertRow = () => {
        if (rowIndex < 0 || rowIndex >= rows.length) {
          throw rdbErr(14800012, 'ResultSet is empty or pointer index is out of bounds.');
        }
      };
      return {
        columnNames: colNames.slice(),       // :2495
        columnCount: colNames.length,        // :2503
        rowCount: rows.length,               // :2511
        get rowIndex() { return rowIndex; }, // :2521
        get isAtFirstRow() { return rowIndex === 0; },           // :2530
        get isAtLastRow() { return rows.length > 0 && rowIndex === rows.length - 1; },  // :2538
        get isEnded() { return rowIndex >= rows.length; },       // :2546
        get isStarted() { return rowIndex >= 0; },               // :2554
        get isClosed() { return closed; },                       // :2562
        getColumnNames() { assertOpen(); return colNames.slice(); },                       // :2584
        /** @param {string} columnName */
        getColumnIndex(columnName) { assertOpen(); const i = colNames.indexOf(columnName);   // :2616
          if (i < 0) throw rdbErr(14800000, `Column not found: ${columnName}`); return i; },
        /** @param {number} columnIndex */
        getColumnName(columnIndex) { assertOpen(); assertCol(columnIndex); return colNames[columnIndex]; },  // :2648
        /** @param {number} offset */
        goTo(offset) { assertOpen(); rowIndex += Number(offset);                             // :2752
          if (rowIndex < 0) rowIndex = -1; return rowIndex >= 0 && rowIndex < rows.length; },
        goToFirstRow() { assertOpen(); rowIndex = rows.length ? 0 : -1; return rows.length > 0; },  // :2811
        goToLastRow() { assertOpen(); rowIndex = rows.length - 1; return rows.length > 0; },  // :2839
        goToNextRow() { assertOpen(); rowIndex += 1; return rowIndex < rows.length; },        // :2867
        /** @param {number} columnIndex */
        getBlob(columnIndex) { assertOpen(); assertRow(); assertCol(columnIndex);            // :2930
          const v = rows[rowIndex][columnIndex];
          return v instanceof Uint8Array ? v : new TextEncoder().encode(v == null ? '' : String(v)); },
        /** @param {number} columnIndex */
        getString(columnIndex) { assertOpen(); assertRow(); assertCol(columnIndex);          // :2967
          const v = rows[rowIndex][columnIndex];
          if (v == null) return '';
          return v instanceof Uint8Array ? new TextDecoder().decode(v) : String(v); },
        /** @param {number} columnIndex */
        getLong(columnIndex) { assertOpen(); assertRow(); assertCol(columnIndex);            // :3009
          const v = rows[rowIndex][columnIndex]; return v == null ? 0 : Math.trunc(Number(v)); },
        /** @param {number} columnIndex */
        getDouble(columnIndex) { assertOpen(); assertRow(); assertCol(columnIndex);          // :3044
          const v = rows[rowIndex][columnIndex]; return v == null ? 0 : Number(v); },
        /** @param {number} columnIndex */
        getValue(columnIndex) { assertOpen(); assertRow(); assertCol(columnIndex);           // :3147
          return rows[rowIndex][columnIndex]; },
        /** @param {number} columnIndex */
        isColumnNull(columnIndex) { assertOpen(); assertRow(); assertCol(columnIndex);       // :3325
          return rows[rowIndex][columnIndex] == null; },
        close() { closed = true; },                                                          // :3335
      };
    }

    /**
     * RdbStore（d.ts:3789）。构造即持有 sql.js Database；所有写操作 write-through 落盘
     * （真机语义是 WAL 落盘，垫片以"每次写后导出字节"对齐"进程崩溃不丢已提交数据"）。
     * @param {string} name @param {any} db @param {{persisted: boolean}} meta
     */
    function makeRdbStore(name, db, meta) {
      let closed = false;
      let inTx = false;
      const assertOpen = () => { if (closed) throw rdbErr(14800014, 'The target instance is already closed.'); };
      /** 提交点：事务内不落盘（等 commit），事务外每次写即落 */
      const checkpoint = () => { if (!inTx && meta.persisted) persistDb(name, db); };

      const store = {
        /** version 读写（d.ts:3813；语义 = PRAGMA user_version，必须 >0 整数） */
        get version() {
          assertOpen();
          const r = db.exec('PRAGMA user_version');
          return r.length ? Number(r[0].values[0][0]) : 0;
        },
        /** @param {number} v */
        set version(v) {
          assertOpen();
          if (!Number.isInteger(v) || v <= 0) throw rdbErr(401, `version 必须是 >0 的整数，收到 ${v}`);
          db.run(`PRAGMA user_version = ${Number(v)}`);
          checkpoint();
        },

        /**
         * executeSql（d.ts:5218）：DDL/DML。签名对齐 d.ts 返回 Promise<void>；
         * 影响行数/rowid 以 promise 附加属性 + rdb.executeSql 留痕透出（附加属性是垫片扩展，不进签名）。
         * @param {string} sql
         * @param {any[]=} [bindArgs]
         * @returns {Promise<void> & {rowsAffected?: number, insertId?: number}}
         */
        executeSql(sql, bindArgs) {
          assertOpen();
          try {
            db.run(String(sql), bindArgs || []);
            const rowsAffected = Number(db.getRowsModified());
            let insertId;
            try { insertId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]); } catch (e) { /* 非插入语境 */ }
            note({ t: 'rdb.executeSql', name, sql: String(sql), rowsAffected, insertId, inTx });
            const p = /** @type {Promise<void> & {rowsAffected?: number, insertId?: number}} */ (Promise.resolve(undefined));
            p.rowsAffected = rowsAffected;
            p.insertId = insertId;
            checkpoint();
            return p;
          } catch (e) {
            note({ t: 'rdb.executeSqlFailed', name, sql: String(sql), message: e && e.message });
            throw sqliteErr(14800021, `${e && e.message} | sql=${sql}`);
          }
        },

        /**
         * querySql（d.ts:4820）：必须是查询语句（非 SELECT → 14800019，d.ts:2574）。
         * @param {string} sql
         * @param {any[]=} [bindArgs]
         * @returns {Promise<any>} ResultSet
         */
        async querySql(sql, bindArgs) {
          assertOpen();
          /** @type {any} */ let stmt = null;
          try {
            stmt = db.prepare(String(sql));
            if (bindArgs && bindArgs.length) stmt.bind(bindArgs);
            if (stmt.getColumnNames().length === 0) {
              throw rdbErr(14800019, 'The SQL must be a query statement. | sql=' + sql);
            }
            return makeResultSet(stmt, stmt.getColumnNames());
          } catch (e) {
            try { if (stmt) stmt.free(); } catch (e2) { /* 免疫 */ }
            if (e && /** @type {any} */ (e).code === 14800019) throw e;
            note({ t: 'rdb.querySqlFailed', name, sql: String(sql), message: e && e.message });
            throw sqliteErr(14800021, `${e && e.message} | sql=${sql}`);
          }
        },

        /**
         * insert（d.ts:3922/:3956）：ValuesBucket → INSERT，返回 rowid；失败 -1 语义由异常面承担
         * （真机冲突抛 14800021 族，这里同样抛而不是吞）。
         * @param {string} table
         * @param {Record<string, any>} values
         * @param {number=} [conflict] ConflictResolution（:1473；REPLACE/IGNORE 映射 INSERT OR …）
         * @returns {Promise<number>} rowId
         */
        async insert(table, values, conflict) {
          assertOpen();
          const { cols, qs, params } = bucketToSql(values || {});
          if (!cols.length) throw rdbErr(401, 'insert: valuesBucket 为空');
          const prefix = conflict === ConflictResolution.ON_CONFLICT_REPLACE ? 'INSERT OR REPLACE INTO '
            : conflict === ConflictResolution.ON_CONFLICT_IGNORE ? 'INSERT OR IGNORE INTO ' : 'INSERT INTO ';
          const sql = `${prefix}"${String(table)}" (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${qs.join(', ')})`;
          try {
            db.run(sql, params);
            let rowId = -1;                                     // d.ts:3826「returns -1 otherwise」
            try { rowId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0]); } catch (e) { /* 无 rowid 表 */ }
            note({ t: 'rdb.insert', name, table, rowId, rowsAffected: Number(db.getRowsModified()), inTx });
            checkpoint();
            return rowId;
          } catch (e) {
            note({ t: 'rdb.insertFailed', name, table, message: e && e.message });
            throw sqliteErr(14800021, `${e && e.message} | sql=${sql}`);
          }
        },

        /** beginTransaction（d.ts:5351）：同步；嵌套 BEGIN 在真机也是错的 → 14800000 */
        beginTransaction() {
          assertOpen();
          if (inTx) throw rdbErr(14800000, `already in transaction: ${name}`);
          db.run('BEGIN');
          inTx = true;
          note({ t: 'rdb.begin', name });
        },
        /** commit（d.ts:5409）：同步；提交后落盘（事务的持久化边界） */
        commit() {
          assertOpen();
          if (!inTx) throw rdbErr(14800021, 'cannot commit - no transaction is active');
          db.run('COMMIT');
          inTx = false;
          note({ t: 'rdb.commit', name });
          checkpoint();
        },
        /** rollBack（d.ts:5467）：同步；回滚后同样落盘（丢弃到磁盘态对齐） */
        rollBack() {
          assertOpen();
          if (!inTx) throw rdbErr(14800021, 'cannot rollback - no transaction is active');
          db.run('ROLLBACK');
          inTx = false;
          note({ t: 'rdb.rollback', name });
          checkpoint();
        },

        /** close（d.ts:6181）：落盘 → 关库 → 后续操作抛 14800014 */
        async close() {
          if (closed) return;
          if (inTx) { try { db.run('ROLLBACK'); } catch (e) { /* 免疫 */ } inTx = false; }
          if (meta.persisted) persistDb(name, db);
          try { db.close(); } catch (e) { note({ t: 'rdb.closeFailed', name, message: e && e.message }); }
          closed = true;
          rdbStores.delete(name);
          note({ t: 'rdb.closed', name });
        },
        /** @returns {boolean} 自省面（垫片扩展，测试用） */
        isClosed() { return closed; },
        /** @returns {boolean} 自省面：当前是否在事务中（垫片扩展，测试用） */
        inTransaction() { return inTx; },
      };
      return store;
    }

    // ── 模块面 ──
    /** @type {any} */
    const relationalStore = {
      SecurityLevel,
      ConflictResolution,
      /**
       * getRdbStore（d.ts:7497）。同名库进程内复用同一实例（d.ts:285 约束）。
       * @param {any} _context Context（垫片忽略；真机用于定 sandbox 目录）
       * @param {{name: string, securityLevel?: number, encrypt?: boolean}} config StoreConfig（:283）
       * @returns {Promise<any>} RdbStore
       * @throws {Error} 401 config.name 缺失；14800000 sql.js WASM 缺席（含安装步骤）
       */
      async getRdbStore(_context, config) {
        if (!config || typeof config.name !== 'string' || !config.name) {
          throw rdbErr(401, 'StoreConfig.name is required');
        }
        if (rdbStores.has(config.name)) return rdbStores.get(config.name);
        const SQL = await loadSqlJs();
        const backend = resolvePersist();
        const path = dbPath(config.name);
        /** @type {any} */
        let db;
        let persisted = !backend.volatile;
        if (backend.exists(path)) {
          // 已有库：读回字节重建（跨进程持久化成立的关键路径）
          const doc = JSON.parse(backend.readText(path));
          if (!doc || doc.format !== 'arkui-rdb-v1' || typeof doc.bytes !== 'string') {
            throw rdbErr(14800011, `库文件损坏（非 arkui-rdb-v1 格式）: ${path}`);
          }
          db = new SQL.Database(b64dec(doc.bytes));
          note({ t: 'rdb.loaded', name: config.name, backend: backend.kind, path });
        } else {
          db = new SQL.Database();
          if (persisted) persistDb(config.name, db);            // 首建即落盘，存在性可被下个进程看见
          note({ t: 'rdb.created', name: config.name, backend: backend.kind, path });
        }
        const store = makeRdbStore(config.name, db, { persisted });
        rdbStores.set(config.name, store);
        return store;
      },
      /**
       * deleteRdbStore（d.ts:7631）。内存实例若有：先关（不落盘），再删库文件。
       * @param {any} _context Context
       * @param {any} config StoreConfig 或 string（d.ts:7602 的 name 重载）
       * @returns {Promise<void>}
       */
      async deleteRdbStore(_context, config) {
        const name = typeof config === 'string' ? config : (config && config.name);
        if (!name) throw rdbErr(401, 'deleteRdbStore: 需要 StoreConfig.name');
        const store = rdbStores.get(name);
        if (store) { rdbStores.delete(name); await store.close(); }
        const backend = resolvePersist();
        try { backend.unlink(dbPath(name)); } catch (e) { /* 文件本来不存在，容忍 */ }
        note({ t: 'rdb.deleted', name, backend: backend.kind });
      },
    };

    g.__arkui_dom_relationalstore = relationalStore;
    defineOhosModule('data.relationalStore', relationalStore);
  })();
