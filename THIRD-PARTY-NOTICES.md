# 第三方组件与许可清单（THIRD-PARTY NOTICES）

> **这个文件是"入向合规"记录**：我们**消费/派生**了哪些外部东西、它们各自的许可状态是什么。
> 它**不是**本项目的许可证——本项目的出向授权见文末 §6（**本地开发期间不需要决定**）。
>
> 本文件只记录**可核验的事实**（许可文件原文、字段值、文件路径），并给出复现命令。
> 涉及法律判断的段落已明确标注"需自行确认"，不是法律意见。

最后核对：2026-09-20，对照 HarmonyOS CLT **26.0.0.821**。

---

## 1. 本仓库自研部分（完全自有）

`runtime/arkui-dom-runtime.js`、`runtime/ohos-shims.js`、`tools/`、`test/`、`run.sh`、
`electron/`（`main.js`/`preload.js`/`run.sh`，不含 `runtime/`）、`docs/`、`README.md`。

核验：这些文件里**没有**任何第三方版权头。

```bash
grep -l "Huawei Device" runtime/*.js tools/*.* test/*.html run.sh electron/*.js electron/*.sh
# 期望：无输出
```

对 OpenHarmony SDK 的 `.d.ts` 声明，我们**只阅读其接口形状作为实现依据，未复制其代码**：

```bash
grep -c "IMonitorValue\|IMonitor" runtime/arkui-dom-runtime.js   # 2 —— 仅出现接口名
```

---

## 2. 入库的派生产物（**需要如实标注出处**）

### 2.1 `runtime/generated-components.js`

| 项 | 值 |
|---|---|
| 生成方式 | `node tools/gen-components.mjs` |
| 派生自 | `<CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/components/*.json`（**150 个**） |
| 派生内容 | 组件**名字清单、`attrs` 属性名清单、`children` 清单**（即 API 表面）；DOM 画像规则（标签/基础样式）为本项目自研 |
| **上游许可状态** | ⚠️ **未声明**。这些 JSON 内**没有** `license` 或 `copyright` 字段 |

```bash
CLT=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
for f in $CLT/sdk/default/openharmony/ets/build-tools/ets-loader/components/text.json \
         $CLT/sdk/default/openharmony/ets/build-tools/ets-loader/components/common_attrs.json; do
  echo "$(basename $f): license=$(grep -c -i '\"license\"' $f) copyright=$(grep -c -i copyright $f)"
done
# 期望：license=0 copyright=0
```

**因此：本文件不得标注为 Apache-2.0。** 它的许可状态应描述为"派生自华为工具链中未声明许可的元数据"。

### 2.2 `fixtures/`（14 个 `.ts`）

| 项 | 值 |
|---|---|
| 生成方式 | 在 HarmonyOS 工程里 `devecocli build`，从 hvigor 缓存取 ets-loader 的转换产物 |
| 输入 | **我们自己写的 `.ets`**（`Index.ets` 例外，见下） |
| 输出 | ets-loader 的转换结果 |
| 输出里的版权头 | **无**——ets-loader 生成时剥掉了输入文件的头部注释 |

```bash
grep -rl "Huawei Device" fixtures/ | wc -l    # 期望：0
```

⚠️ 一个例外需要记录：`Index.ets` 源自 **DevEco 工程模板**，模板文件带
`Copyright (c) 2026 Huawei Device Co., Ltd.` + Apache-2.0 头。其余页面（`Rich`/`Layout`/`Provide`/`V2`/`Observe` …）
为本项目自行编写，不带该头。

```bash
grep -c "Huawei Device" /tmp/hmtest/app/entry/src/main/ets/pages/{Index,Provide,V2,Observe}.ets
# 期望：Index 有（模板），其余为 0
```

---

## 3. 构建/运行期使用、但**不入库**的外部组件

这些不是本仓库的再分发内容（`.gitignore` 已排除或根本不在仓库内），但用到了就该记录。

| 组件 | 许可 | 本仓库中的位置 | 是否入库 |
|---|---|---|---|
| **HarmonyOS CLT / DevEco Studio 工具链**（`devecocli`、`hvigorw`、`ets-loader`、`ohpm`…） | ⚠️ **专有 EULA**：《HUAWEI DevEco Studio 使用协议》（见 `<CLT>/LICENSE.txt`），**非开源许可** | 硬编码路径引用（`run.sh`、`tools/*.mjs`） | ❌ 否 |
| Electron 44.2.0 | MIT | `electron/runtime/`（283 MB） | ❌ 否（`.gitignore`） |
| Chromium / Chrome | BSD-3-Clause 等（见 Electron 包内 `LICENSES.chromium.html`） | `/opt/google/chrome/chrome`、Electron 内置 | ❌ 否 |
| Node.js | MIT | `<CLT>/tool/node/bin/node` | ❌ 否 |

**关于 EULA 的 1.6 条**（原文摘录，供参考）：

> 华为授予您全球范围内有限的、非独家、免费的、不可转让、不可分许可及可撤销的许可……
> 您仅能为了开发在 OpenHarmony 兼容设备上和/或 HarmonyOS 上运行的应用程序和/或原子化服务的目的
> 下载、安装、复制、集成、运行华为软件。

⚠️ **需自行确认**：本项目的用途（让 ArkTS 应用跑在 Electron/浏览器的 DOM 上）是否落在该条所述目的范围内，
以及在**对外分发**本仓库时是否受影响。本文件不作法律判断。

---

## 3b. 入库的第三方源码（QRCode 组件的编码器 + 测试侧独立解码器）

### 3b.1 真机 QR 编码器 `arkui-qrcodegen`（R41 起，替换 R33 的 node-qrcode）

| 入库文件 | 出处 | 许可 | 用途 |
|---|---|---|---|
| `runtime/vendor/arkui-qrcodegen/src/*.cpp,*.h`（7 cpp + 8 h，88.5KB） | OpenHarmony `arkui_qrcodegen` 仓库 `frameworks/` + `interfaces/`（本机参考树 `/data/work/compiler/Ark/arkui_qrcodegen`），**逐字复制零修改**（md5 对源校验） | Apache-2.0（原文：`runtime/vendor/arkui-qrcodegen/LICENSE`） | `QRCode` 组件的**真实编码器**——与真机设备同一份 C++ 实现 |
| `runtime/vendor/arkui-qrcodegen/glue/securec.h` + `securec_glue.cpp` | 本地附加（非 Huawei 原件） | 本项目 | securec 的 `memset_s`/`memcpy_s`/`memmove_s` 最小兼容层（3 个标准函数签名搬运，算法零涉及） |
| `runtime/vendor/arkui-qrcodegen.js` | `src/` + `glue/` 经 emscripten 编译的独立 WASM（24KB，base64 内嵌）+ 同步加载器 | 见上（WASM 由 Apache-2.0 源码产出） | 页面加载入口：`globalThis.ArkuiQrcodegen.encode(text, ecc)`；未加载时组件记警告并降级（不静默） |

- **复现**：`bash runtime/vendor/arkui-qrcodegen/build.sh`（需要 emsdk，缺省找
  `/data/training/cli/emsdk`；`EMSDK_DIR` 可覆盖）。
- **ECC**：真机组件硬编码 `QRCODE_ECC_MEDIUM`（`qrcode_modifier.cpp:44`），加载器第二参
  0=MEDIUM / 1=HIGH（真机枚举只有这两档）。
- **历史**：R33~R40 用的是 node-qrcode@1.5.4（MIT）——当时"ECC L 级"的注记是误判
  （node-qrcode 默认即 M，恰与真机一致）；R41 换成真机同源实现后已删除该 vendor。

### 3b.2 测试侧独立解码器 jsQR（R33 起）

| 入库文件 | 出处 | 许可 | 用途 |
|---|---|---|---|
| `test/vendor/jsqr-1.4.0.js` | npm `jsqr@1.4.0`（jsQR，cozmo），`dist/jsQR.js` webpack UMD，**原样拷贝** | Apache-2.0（原文：`test/vendor/jsqr-1.4.0.LICENSE`） | **测试侧独立解码器**——与编码器互为独立实现，qrdemo 用例的交叉验证（画出来的码能被独立解码器读回） |

- **复现**：

```bash
B=/home/yanli/.bun/install/cache
cp "$B/jsqr@1.4.0@@@1/dist/jsQR.js" test/vendor/jsqr-1.4.0.js
cp "$B/jsqr@1.4.0@@@1/LICENSE" test/vendor/jsqr-1.4.0.LICENSE
# 编码器（R41 起）：见 runtime/vendor/arkui-qrcodegen/build.sh（emscripten 编译真机 C++ 源码）
```

### 3b.3 SQLite WASM 引擎 sql.js（E1-2 起，`@ohos.data.relationalStore` 的执行后端）

| 入库文件 | 出处 | 许可 | 用途 |
|---|---|---|---|
| `runtime/vendor/sqljs/sql-wasm.js` + `runtime/vendor/sqljs/sql-wasm.wasm` | npm `sql.js@1.8.0`（sql.js，lojjic/enuit（sql-js 组织），SQLite 3.x 经 emscripten 编译为 WASM），`dist/` 两文件**原样拷贝**；发行包原件留在 `runtime/vendor/sqljs/sql.js-1.8.0.tgz` | **MIT**（原文：`runtime/vendor/sqljs/LICENSE`，"Copyright (c) 2017 sql.js authors"） | `data.relationalStore` 垫片（`runtime/src/relationalstore.js`）的**真 SQL 执行引擎**：建表/insert/querySql/事务/PRAGMA 全走真 SQLite，无伪实现 |

- **加载面**：页面先自行 `<script>` 引入（全局 `initSqlJs`）或由垫片动态注入
  `runtime/vendor/sqljs/sql-wasm.js`；缺席时垫片显式抛 14800000（带安装步骤），**不静默降级**。
- **自检/复现**：`node tools/check-sqljs.mjs`（在位校验 + 魔数 + Node 冒烟 `SELECT 1+1`）；
  或 `tar -xzf runtime/vendor/sqljs/sql.js-1.8.0.tgz -C runtime/vendor/sqljs --strip-components=1 package/dist/*`。
- **落盘约定**：库字节 `db.export()` → base64 → JSON（`arkui-rdb-v1`）→ `/vfs/files/rdb_<name>.json`，
  走 file.fs 既有后端（Electron=nodeFs 真盘 / 浏览器=localStorage）。

---

## 4. 仅作参考阅读的上游（**开源**，可放心引用其接口形状）

| 来源 | 许可 | 我们如何使用 |
|---|---|---|
| `<CLT>/sdk/default/openharmony/ets/component/*.d.ts`（**121 个，121/121 声明 Apache-2.0**） | **Apache License 2.0** | 查组件/属性的权威签名 |
| `<CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/common.d.ts` | **Apache License 2.0** | 查运行时接口权威形状（如 `IMonitor`/`IMonitorValue`） |

```bash
CLT=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
n=$(grep -rl "Apache License, Version 2.0" $CLT/sdk/default/openharmony/ets/component/ | wc -l)
t=$(ls $CLT/sdk/default/openharmony/ets/component/*.d.ts | wc -l)
echo "$n / $t 个 component/*.d.ts 声明 Apache-2.0"     # 期望：121 / 121
head -3 $CLT/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/common.d.ts
```

---

## 5. 结论：需要留意的两点

1. **`ets-loader` 本体与 `components/*.json` 没有任何 OSS 许可声明。**
   它们既不在 Apache-2.0 之下（`.d.ts` 在，但它们不在），也未提供独立 LICENSE 文件；
   `package.json` 的 `license` 字段为 `null`。

   ```bash
   python3 -c "import json;d=json.load(open('$CLT/sdk/default/openharmony/ets/build-tools/ets-loader/package.json'));print('name:',d.get('name'),' license:',d.get('license'))"
   # 期望：name: compilier  license: None
   ls $CLT/sdk/default/openharmony/ets/build-tools/ets-loader | grep -i licen   # 期望：无输出
   ```

2. **因此本仓库的许可状态是"混合"的**：自研部分完全自有；`generated-components.js` 派生自
   **未声明许可**的上游元数据；而消费这些材料的工具链本身受 **DevEco EULA** 约束。

   → **在对外分发本仓库之前**，需要先把第 1 点问清楚（例如向华为确认
     `ets-loader` / `components/*.json` 的可用许可），再决定出向授权。
   → **纯本地开发不受影响。**

---

## 6. 出向授权（本项目的 `LICENSE`）—— 尚未决定，且**本地开发不需要**

本仓库目前**没有** `LICENSE` 文件，这是**有意为之**，不是遗漏：

- 只要不对外分发（`package.json` 已 `"private": true`），就没有需要授权的对象；
- 一旦决定分发，选择会受 §5 第 2 点影响，**不宜在未厘清上游状态前先定**。

**决定它之前，先把 §5 的问题问清楚。** 在那之前，仓库内文件默认"保留所有权利"。

---

## 附：如何自己复核本文件的所有结论

```bash
cd /data/training/cli/arkui-dom-runtime
CLT=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools

# 1. 自研代码无第三方版权头
grep -rl "Huawei Device" runtime/*.js tools/*.* test/*.html run.sh electron/*.js electron/*.sh | wc -l   # 0

# 2. fixtures 无版权头
grep -rl "Huawei Device" fixtures/ | wc -l                                                              # 0

# 3. 组件 JSON 无许可声明
grep -c -i '"license"' $CLT/sdk/default/openharmony/ets/build-tools/ets-loader/components/text.json      # 0

# 4. ets-loader 未声明许可
python3 -c "import json;print(json.load(open('$CLT/sdk/default/openharmony/ets/build-tools/ets-loader/package.json')).get('license'))"   # None

# 5. SDK 声明是 Apache-2.0
grep -rl "Apache License, Version 2.0" $CLT/sdk/default/openharmony/ets/component/ | wc -l               # 121

# 6. 入库内容只有自研 + 上述派生产物
git ls-files
```

### 3b.3 无障碍审计器 axe-core（R136 接入需求，R140 落库）

| 文件 | 来源与形态 | 许可 | 用途 |
|---|---|---|---|
| `test/vendor/axe.min.js` | npm `axe-core@4.10.2`（Deque），`axe.min.js` **原样拷贝** | MPL-2.0（原文：`test/vendor/axe-core.LICENSE`） | **测试侧无障碍审计器**——a11ydemo 用它对运行时产出的 ARIA 映射做真实规则扫描（严重违规=0 断言）；仅在测试页加载，不进运行时产物 |

- **复现**：`cd /data/tmp && npm pack axe-core@4.10.2` → 解包取 `package/axe.min.js` + `package/LICENSE` 拷入 `test/vendor/`。
- axe-core 自身的第三方清单见 `LICENSE-3RD-PARTY.txt`（npm 包内，未随拷——审计器仅在测试侧运行）。