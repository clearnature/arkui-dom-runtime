# PLAN-WINDOWS-CI · Windows CI 接入原子分解（2026-10-03 定稿，编队待飞）

## 背景与差距

- 本地五端（Chromium/Electron/Firefox/WebKitGTK/Android WebView）**全部是 Linux 本机模拟**；
  CI 九条 reusable workflow 全部 `runs-on: ubuntu-24.04`（arkui-ci 实测 grep）。
- **Windows 上的运行时至今零真实验证**（无 Windows 机器，CI 是唯一通路）。
- 计费注意：Windows runner 按 2× 分钟计费——矩阵先单 node 版本。

## Windows 炸点清单（browser 腿，逐条实锚）

| # | 炸点 | 位置 | Windows 形态 |
|---|---|---|---|
| 1 | `CHROME` 默认值钉死 `/opt/google/chrome/chrome` | run.sh:29 | windows runner 预装 `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 2 | `timeout 60` 前缀 | run.sh:133,159 | Git Bash 可能解析到 System32 `timeout.exe`（语义完全不同，经典劫持坑）——需探测/参数化 |
| 3 | `python3` ×3（端口探针 :62、serve.py :103、结果解析 :140） | run.sh | windows runner 通常只有 `python` |
| 4 | MSYS 路径转换（profdir/`--screenshot=`/`--user-data-dir=`） | run.sh:78,133,159 | Git Bash 自动转换大多生效，残余风险留 T3 实测 |
| 5 | 字体（CJK） | browser.yml apt 段 | Windows 自带字族（微软雅黑）；文本断言基于 DOM/文本而非字形度量，风险低 |
| 6 | VTBUDGET/启动预算 | run.sh:117 | 虚拟时钟隔离 CPU 差异，但页面解析吃真实时间——Windows 慢 runner 可能需上调 |
| 7 | `--no-sandbox` | run.sh:133 | Windows 不需要，保留无害 |

**不炸的**：mktemp/TMPDIR 兜底（R159.3 已参数化）、/dev/null（Git Bash 支持）、kill 后台 serve.py、
Node 工具链（extract/assert-counts/stats 全跨平台）、零依赖纪律（无 node_modules 路径长度问题）。

## 一期：windows-browser 腿（4 个原子任务，T1/T2 可并行，T3 串行）

### T0 兼容垫层设计（本地，半天内）
- 盘点产出即上表（已完成）；定参数面：`PYTHON` / `TIMEOUT_BIN` / `CHROME`（已有 env）。
- **验收**：本任务只出设计不写码；全部改动必须满足「Linux 上零行为变化」。

### T1 run.sh 跨平台参数化（代码仓，Agent A 所有权：run.sh + 无他）
- T1.1 `PYTHON="${PYTHON:-python3}"` 替换三处 python3 调用点。
- T1.2 CHROME 默认值探测链：env 未设时依次探 `command -v google-chrome` → `command -v chrome` →
  Windows 预装路径（`/c/Program Files/Google/Chrome/Application/chrome.exe`）→ 旧默认兜底。
- T1.3 timeout 垫层：`TIMEOUT_BIN="${TIMEOUT_BIN:-$(command -v timeout || true)}"`；探测
  `$TIMEOUT_BIN --version` 失败（=System32 timeout.exe 劫持）时报清晰错误并给出
  `TIMEOUT_BIN=/usr/bin/timeout` 提示；调用点 `$TIMEOUT_BIN 60 ...`。
- T1.4 cygpath 处理**先不加**（T3 实测炸了再补；一次只改一个假设）。
- **验收**：`bash -n` + 本地 `npm run check` 门禁全绿（零行为变化证明）。

### T2 治理仓 browser-windows reusable（治理仓，Agent B 所有权：arkui-ci）
- T2.1 新增 `.github/workflows/browser-windows.yml`：`runs-on: windows-latest` +
  `defaults: { run: { shell: bash } }` + `env: CHROME` 指向预装路径 + **无 apt 段**；
  inputs 与 browser.yml 完全同构（node-version/setup-command/test-command/artifact-path）。
- T2.2 README.md reusable 表 + GOVERNANCE.md 补行。
- **验收**：治理仓 PR 走审核纪律；合并后本仓 bump `@SHA`（SHA 钉死纪律）。

### T3 本仓薄委托 + 首跑调优（主会话串行，CI 往返 2–5 轮预算）
- T3.1 ci.yml 加 `browser-windows` job：单 node "26"、`test-command: bash run.sh all`、
  `ARKUI_VIRTUAL_TIME_SKIP` 同既有清单、caller `@SHA` 同步 bump。
- T3.2 首跑目标=诊断透出不是全绿：失败即读 artifact + 日志，一次一个假设迭代。
- T3.3 预算调优：按需上调 VTBUDGET/RUN_TIMEOUT（Windows 慢盘/慢启动）。
- T3.4 断言差异裁定按既有纪律：引擎差异先 runtime 归一；真平台差异才容差化并进
  assert-counts `--overrides` 分端表 + DEVICE-DIFF.md 记档。
- **验收**：windows-browser 腿全量 ALL PASS + assert-counts 守门对齐。

### T4 收口（主会话）
- T4.1 DEVICE-DIFF.md 补 Windows Chromium 差异条目（带出处）。
- T4.2 ROADMAP 记 R160 实录；记忆坑沉淀（timeout.exe 劫持/MSYS 路径/字体）。

## 二期轮廓（一期跑绿后再原子化）

- **W2-1 electron-windows**：无 xvfb/metacity（真显示栈）；疑点=offscreen 截图在 Win 的 paint 行为；
  真实时钟 97 用例。
- **W2-2 firefox-windows**：geckodriver 官方 win64；ff-matrix.py 纯 python 本就跨平台。
- **W2-3 webkit-windows**：playwright Win WebKit——**语义口径=第三种 WebKit**（非 GTK 移植），
  覆盖不与 Linux WebKitGTK 划等号，记档先行。
- **W2-4 package-windows**：win-unpacked 便携 zip 或 NSIS；AppImage 是 Linux-only 格式不适用。

## 三期（建议进「明确不做」或远期池）

- kernel-contract / kernel-compilers 的 Windows 化：C addon `dlopen(.so)` → `LoadLibrary(.dll)`
  是移植工程；GHC/仓颉 Windows 运行时闭包形态完全不同。投入产出最差，除非出现真需求。

## 编队与轮次预算

- Agent A = T1（代码仓 run.sh，本地可完整验证）；Agent B = T2（治理仓，文件所有权互斥）；
  主会话 = T3/T4（CI 往返迭代必须串行看真实 runner）。
- T3 迭代纪律：**一次只改一个假设**；每轮先读全量日志再下结论（本轮 package 排障六轮的教训复用：
  取证设施已沉淀进 main.js/packager，Windows 腿首跑即有全量输出可用）。
