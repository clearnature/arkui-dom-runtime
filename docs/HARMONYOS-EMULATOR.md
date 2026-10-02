# 鸿蒙官方套件与模拟器通路（官方 oracle）

> 状态：**2026-10-02 实测全通**——起机 → hdc → 装包 → 启动 → 首帧 → 截图，六步一次打通。
> 本文是汇总统稿：三个本地官方套件的角色、Previewer 之死的反汇编证据、Device Emulator
> 复跑配方（含四个坑）、实例/镜像资产台账、第六端差分计划。演进历史与验收的权威仍在
> `docs/ROADMAP.md`（R159.2 条目）。最后更新：2026-10-02。

---

## 1. 三个本地套件的角色

| 本机路径 | 是什么 | 对本项目 |
|---|---|---|
| `/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools` | 官方 CLT：hvigorw / ohpm / SDK / hdc / **Emulator** / ark_aot_compiler | fixtures 构建（DEVELOPING §8）+ **鸿蒙模拟器**（本文主角）+ AOT 编译 |
| `/data/training/cli/arkts-shim` | 自建垫片（260K）：`libhilog.so` 软链（SDK 自带 `libhilog_linux.so` 的官方同名件）+ `libshared_libz.so`（zlib+minizip 合并垫片，补 3 个 minizip-ng 风格符号） | 修复 CLT 缺库——`ark_aot_compiler` 完全可用（能出真 AOT ELF）；**修不好 Previewer**（见 §2，它的 README 自己有更正） |
| `/data/training/cli/devecostudio-linux` | 社区 PKGBUILD：把 Mac 版 DevEco Studio 移植到 Linux（JetBrains 启动器 + JBR） | IDE 自用；其 `DETAILS.md` 是"Previewer 在 Linux 不可用"的证据源 |

## 2. Previewer 在 Linux 是死的（别再花时间试）

**两处独立反汇编互证**（`devecostudio-linux/DETAILS.md` §"Previewer: unavailable on
Linux (how we know)" + `arkts-shim/README.md` §"重要更正（2026-09-19 复核）"）：

- CLT 的 `sdk/default/openharmony/previewer/common/bin/Previewer` 里，**debug 预览路径被
  `#ifdef` 编译成了桩**：`RunDebugAbility` 全部指令只有 45 字节——拼好
  `"JsApp::Run ability start failed.Linux is not supported."` 打一条日志就返回；
  紧邻的 `RunNormalAbility`（1302 字节）才是真实现。
- IDE 预览**总是传 `-d`** → 必然命中桩；命令行去掉 `-d` 走真实现，则在
  `RSUIContextManager` 构造里 SIGSEGV——那是 Rosen 渲染服务客户端，
  **只存在于鸿蒙设备/模拟器系统里**。
- 本项目 R91 时代的实测（GLFW 窗口真开、崩在 RSUIContextManager）与此完全吻合。

结论：缺库修复（arkts-shim）是**必要不充分**；预览器通路在 Linux 被上游堵死，
不是打包能解决的。

## 3. Device Emulator 是另一个组件——它可用

CLT 自带 `command-line-tools/emulator/Emulator`（131MB 原生 ELF + 自带
Qt5/GLFW/libavcodec 依赖），**与 Previewer 无关**：

- `-imageList` 可查服务端镜像档（2026-10-02 实测 **70 档**）：`2in1` / `phone` /
  `foldable` / `tablet` / `wearable`… 全系 `HarmonyOS 7.0.0(26.0.0)`。
- 内置自动化原语：`-click` / `-slide` / `-fill` / `-screenshot` / `-rotation` /
  `-gps` / `-battery` …；`-start` 支持 `-noWindow`（无窗后台跑）。
- KVM 加速自动探测（`/dev/kvm` ACL 放行时打印 `KVM is supported and accessible`）。

## 4. 复跑配方（2026-10-02 实测六步）

```bash
EMU=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/emulator/Emulator
HDC=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/sdk/default/openharmony/toolchains/hdc

# ① 起机（无窗；首次冷启动约 1-2 分钟）
$EMU -start hmtest_phone \
     -instancePath /data/training/cli/emulator-images/instances \
     -imageRoot    /data/training/cli/emulator-images \
     -noWindow &

# ② hdc 连靶（模拟器监听 127.0.0.1:5557）
export HDC_SERVER_PORT=5557
$HDC tconn 127.0.0.1:5557          # → "Target is connected"
$HDC list targets                   # → 127.0.0.1:5557

# ③ 装包（unsigned HAP 直接收）
$HDC install -r harmony-proj/entry/build/default/outputs/default/entry-default-unsigned.hap

# ④ 启动我们的应用
$HDC shell aa start -b com.example.arkuidomprobe -a EntryAbility

# ⑤ 确认渲染（WMS 首帧 = 我们的页面真的画出来了）
$HDC shell "hilog -x | grep -i arkuidomprobe | tail"
#   期望看到 C04202/WMSMain: NotifyCompleteFirstFrameDrawing: ... app info:
#   [com.example.arkuidomprobe entry EntryAbility]

# ⑥ 截图（screenshotPath 的目录必须已存在，否则落到 ~/图片/）
mkdir -p /data/tmp/hm-shots
$EMU -instance hmtest_phone -screenshot -screenshotPath /data/tmp/hm-shots \
     -instancePath /data/training/cli/emulator-images/instances \
     -imageRoot    /data/training/cli/emulator-images
```

**四个坑（每个都实测撞过）：**

| 坑 | 症状 | 正解 |
|---|---|---|
| `-imageRoot` 传了 `…/emulator-images/system-image` | ErrorCode 00801008「system-image文件缺失」 | **传父目录** `…/emulator-images`——实例 config 的 `imageSubPath=system-image/HarmonyOS-7.0.0/phone_all_x86/` 会自己拼接 |
| hdc 连不上 | `hdc list targets` 空 | 必须 `export HDC_SERVER_PORT=5557`（模拟器只监听 `127.0.0.1:5557`）；hdc 二进制在 CLT 的 `sdk/default/openharmony/toolchains/` 下 |
| `-list` 显示 `[Empty]` | 以为没起起来 | `-list` 同样要带 `-instancePath`（默认查的是 `~/Library/...` 下的空目录） |
| 截图"路径不存在" | 文件落到 `~/图片/` | `-screenshotPath` 的**目录必须预先存在** |

停机：`$EMU -stop hmtest_phone -instancePath … -imageRoot …`。
负载纪律：起它之前 pkill 掉 Android 模拟器（qemu 抢核会让冷启动显著变慢）。

## 5. 实例与镜像资产台账

| 资产 | 路径 | 说明 |
|---|---|---|
| 实例 `hmtest_phone` | `/data/training/cli/emulator-images/instances/hmtest_phone` | HarmonyOS 7.0.0.106（API 26.0.0）、phone、x86_64、4 核、560dpi、RAM 4G；2026-09-19 创建 |
| 系统镜像 | `…/emulator-images/system-image/HarmonyOS-7.0.0/phone_all_x86/` | bzImage + system.img + vendor/ramdisk 等，随实例同批下载（合计 5.6G） |
| 许可 | `~/Library/Caches/Huawei/Emulator26.0/.emu_config` | 两份协议 2026-09-19 已接受 |
| 2in1 镜像 | **服务端有、本机未下载** | `-install -deviceType 2in1 -osVersion "HarmonyOS 7.0.0(26.0.0)"`（GB 级下载）——桌面窗口语义（R91 那批）的真值来源 |

**历史教训**：实例和镜像 09-19 就建好了、09-21 跑过，但配方**没有写进任何文档/记忆**，
10-02 重新发现时多踩了一遍 00801008。环境类发现必须当轮落盘（本文件即补账）。

## 6. 第六端差分（官方 oracle）计划

定位：语义验证从「对真机 C++ 源码逐式对齐」升级为「对官方镜像实测对齐」。
管线与拆片：

1. **脚本化冒烟**（小切片）：把 §4 六步收进 `tools/hm-run.sh`（start→tconn→install→
   `aa start`→hilog 首帧判定→screenshot 留档），先只跑 Index 页。
2. **逐页驱动器**（标准切片）：遍历产物里 `registerNamedRoute` 的全部页面
   （router 跳转或 `aa start` 带 page 参数）→ 断言通道两选一：页面 hilog 埋点输出
   PASS 行（与浏览器驱动同构），或模拟器自动化（`-click/-slide`）+ uitest 读屏。
   产出 `build/assert-counts-hm.tsv`，与五端结果对拍。
3. **2in1 桌面语义对拍**：下载 2in1 镜像建第二实例，对拍 R91 的
   maximize/restore/isFocused/windowEvent 13 条断言（当前按 d.ts 校准，
   DEVICE-DIFF 里标注"与真机窗口管理器仍有宿主差异"的那批）。
4. **门禁接入**：先做非门禁脚本（`tools/`，缺席显式跳过——同 webkit 第 6c 步先例），
   稳定后再议成为门禁第 12 步。

## 7. 边界与风险（如实记档）

- **软渲染**：本机 amdgpu 初始化失败（`ACCEL_WORKING failed (-13)`）回退软渲，
  冷启动 1-2 分钟、动画面 slower——验证语义够用，验证性能不行（性能权威仍在
  Electron 端 §6 基线）。
- **unsigned HAP 可装是模拟器宽容**：真机大概率要求签名——上真机时需要
  DevEco 的 debug 签名链路，届时另记。
- **CLT 升级需重验本文件全部命令**（同 arkts-shim 的提醒：升级后先跑一遍 §4）。
- 镜像下载走华为服务端，`-imageList` 实测本机网络可达；若在隔离网段需要
  `-http_proxy` 参数。
