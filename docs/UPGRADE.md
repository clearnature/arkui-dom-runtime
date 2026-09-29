# ArkUI DOM Runtime —— 升级与部署指南（E1-7）

面向交付/运维。打包唯一入口：`node tools/package-app.mjs`（staging → packager/AppImage → 冒烟）。
背景：R74 fs 落盘根迁移、R81 打包固化、R127 hs 内核分发集、R134 app 资源随包；细节见 `docs/research/packaging-spike.md`。

## 1. 分发形态

| 形态 | 产物（默认输出 `/data/tmp/arkui-pkg-out`，`--out` 可改） | 体积 | 启动命令 |
|---|---|---|---|
| packager（默认） | `<out>/arkui-dom-electron-linux-x64/`，可执行 `arkui-dom-electron`，应用载荷在 `resources/app/`（明文，asar 关） | 目录 ~285M（tar.gz ~118M） | `cd <包目录> && ./arkui-dom-electron --no-sandbox` |
| appimage（`--mode appimage`） | `<out>/` 下 `*.AppImage` 单文件 | ~120M | `./arkui-dom-desktop.AppImage --no-sandbox`；无 libfuse2 的机器加 `--appimage-extract-and-run` |

- `--no-sandbox` 是硬前提：包内 chrome-sandbox 未设 setuid（R72 实测）；正式分发可 postinst 设 4755 后解除。
- 打包自带冒烟（页 `--page`，默认 perfdemo；`--kernel hs` 整包切 GHC 内核）：冒烟进程清空
  `CANGJIE_RT_LIB/ARKUI_KERNEL_LIB/LD_LIBRARY_PATH/GHC_LIB_DIR` 模拟无 SDK 机器，
  stdout 无 `ELECTRON_RESULT: PASS` 则打包判失败（exit 1）。
- 手工复验冒烟（升级后同法）：
  ```bash
  cd /opt/arkui/arkui-dom-electron-linux-x64
  ARKUI_TEST=perfdemo ARKUI_OFFSCREEN=1 ./arkui-dom-electron --no-sandbox --disable-gpu .
  # 末行 ELECTRON_RESULT: PASS、退出码 0 即通过
  ```
- 交付归档：`tar czf arkui-dom-desktop-<commit|日期>.tar.gz -C /data/tmp/arkui-pkg-out arkui-dom-electron-linux-x64`。

## 2. 升级策略（核心：全量替换 + userData 不动）

打包目录只读使用；**用户数据全部在包外 userData，不在包内**——升级覆盖包目录天然不碰用户数据。
打包态 userData 固定为 `~/.config/arkui-dom-desktop/`（productName 两形态一致），内容：

| 路径 | 内容 | 依据 |
|---|---|---|
| `~/.config/arkui-dom-desktop/data/` | fs 落盘根（`/vfs/x` 映射点；文件、SQLite 库、偏好） | R74：preload 经 `additionalArguments --arkui-fs-root=` 同步取根 |
| `~/.config/arkui-dom-desktop/logs/crash-YYYYMMDD.jsonl` | 崩溃/错误日志（按日分文件） | E0-2，见 §4 |

dev 态（`electron/run.sh`，未打包）fs 根仍是仓内 `electron/data/`，与升级流程无关。

### 2.1 升级步骤（原地覆盖式全量替换）

```bash
# ① 升级前基线：记录 crash 日志总行数
cat ~/.config/arkui-dom-desktop/logs/crash-*.jsonl 2>/dev/null | wc -l
# ② 旧目录保留一份（版本命名建议：-<commit|日期>，如 arkui-dom-electron-linux-x64-r137-20260928）
cp -r /opt/arkui/arkui-dom-electron-linux-x64 /opt/arkui/arkui-dom-electron-linux-x64-r137-20260928
# ③ userData 保险备份（本项目无 schema 迁移机制，这是唯一回滚保险）
tar czf ~/arkui-desktop-userdata-$(date +%Y%m%d).tgz -C ~/.config arkui-dom-desktop
# ④ 解包覆盖（或解到新目录后切换启动脚本指向）
tar xzf arkui-dom-desktop-<ver>.tar.gz -C /opt/arkui/
```

### 2.2 升级后检查清单

1. 启动冒烟：§1 的 perfdemo 命令 → `ELECTRON_RESULT: PASS`。
2. 存储页抽查（验证 userData 根迁移仍可写、旧库可读）：
   `ARKUI_TEST=rdbdemo ARKUI_OFFSCREEN=1 ./arkui-dom-electron --no-sandbox --disable-gpu .`
3. crash 日志核对：`ls ~/.config/arkui-dom-desktop/logs/ && tail -n5 ~/.config/arkui-dom-desktop/logs/crash-$(date +%Y%m%d).jsonl`
   ——升级后不应出现新条目；有则按 §4 定位。
4. 窗口页抽查（Electron 专属）：`ARKUI_TEST=multiwindemo …` 同法。

### 2.3 回滚

- 启动脚本/软链切回 ② 保留的旧目录即可；包目录无状态，回滚零残留。
- userData **向后兼容无保障**：无 schema 版本/迁移机制，新版本写入的新文件、新格式由旧版本
  按未知数据处理（读失败或忽略，不保证行为）。回滚后异常时解 ③ 的 tar 恢复：
  `tar xzf ~/arkui-desktop-userdata-<日期>.tgz -C ~/.config`。

## 3. 资源与代码的版本对应（产物-运行时契约）

- **app 资源随包（R134）**：`harmony-proj/entry/src/main/resources/base/` 全目录平拷进包内同路径；
  运行时 `resBase()` 探测（URL 含 `/test/` → base=`../`），`$r` 的 string/color/float/media 走包内真值。
- **同包同版本是硬契约**：`runtime/arkui-dom-runtime.js`（拼接产物）、`build/*.js`（页面模块）、
  `test/*.html` 必须出自**同一次** `package-app.mjs` staging。仓库内 `npm run check` 守"产物=源"，
  包内无此守门——跨包混拷 runtime 与页面模块属未定义行为，禁止热替换包内单文件。
- 包内 `package.json` version 恒 `0.1.0`（package-app.mjs 写死），不承载真实版本；
  版本识别以目录/归档命名（commit 或日期）为准。

## 4. 日志与诊断

- **crash JSONL（E0-2）**：`~/.config/arkui-dom-desktop/logs/crash-YYYYMMDD.jsonl`，每行一个 JSON：
  `{ts(ISO UTC), kind, message, stack(堆栈首行), extra}`；
  kind ∈ `uncaughtException | unhandledRejection | render-process-gone | renderer`；
  节流：同 kind 每分钟最多 20 条（超出丢弃是设计行为）。
- **启动失败诊断页（E0-6）**：did-fail-load → 自包含诊断页（错误码/描述/失败地址/日志目录/截图路径）
  + stdout `[boot-fail]` 摘要行，退出码 3；截图留存在包内
  `<包目录>/resources/app/build/electron-<page>.png`（packager 形态明文可直读）。
  生产形态另有空壳探针：加载"成功"但 `#root/#result` 双缺席 → 注入诊断覆盖层（白屏自证）。
- **soak 长跑（E0-4）**：`bash tools/soak.sh 200`（轮数可省，默认 200）——仓库侧脚本，offscreen
  驱动 errbounddemo 做"路由切换 × 组件 churn"，采样 `build/soak.csv`
  （`round,heapUsedMB,domNodes,elmtRecords`）；判据：heapUsed 无单调增长趋势（人工看 CSV）。
  soak.sh 固定驱动仓库内 electron，打包态稳定性以 §1 冒烟 + crash JSONL 为准。

## 5. 已知限制（如实声明）

- **清单驱动的运维侧更新（R143，零应用内网络入口）**：更新通道实现为【部署侧 shell 流程】
  而非应用内代码——运行时包内无任何更新网络入口（静态审计面为零）。流程：
  ```bash
  # 1) 清单（内网静态服务上的 update-manifest.json：{version,url,sha256,notes}）
  curl -fsS http://fileserver/update-manifest.json > /tmp/update-manifest.json
  # 2) 版本比对（与本地包目录命名；不同才继续）
  # 3) 下载全量包 + sha256 对账（清单 sha256 字段 vs sha256sum 实测）
  curl -fsSL -o /data/tmp/update.tar.gz "$(python3 -c "import json;print(json.load(open('/tmp/update-manifest.json'))['url'])")"
  echo "$(python3 -c "import json;print(json.load(open('/tmp/update-manifest.json'))['sha256'])")  /data/tmp/update.tar.gz" | sha256sum -c -
  # 4) 原子就位 → 按【升级策略】四步解包覆盖
  mv /data/tmp/update.tar.gz /data/tmp/update-ready.tar.gz
  ```
- 手动分发（同通道退化形态）：tar.gz + 共享目录/scp，传输完整性自校验：`sha256sum`
  分发方与目标机对账。
- **CSP 已知收紧项（E0-5）**：策略仅注入 http/https 响应，`file://` 兜底路径不设防；
  `script-src 'unsafe-eval'`（页面模块 CommonJS 仿真装载 + WASM 兜底）与 `'unsafe-inline'`
  （测试页内联脚本）、`style-src 'unsafe-inline'`（运行时大量内联样式）暂不可移除。
- **windowId 不互通（E1-5）**：桌面 win2 通道的 windowId 数值与真机 `@ohos.window` 不互通，
  仅桌面侧语义；真机行为以 docs/DEVICE-DIFF.md 为准。
