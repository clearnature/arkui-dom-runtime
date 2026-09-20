# R24 —— ets-loader 产出 JS 与产出 `.abc` 的语义差异调研

> 任务：**ets-loader 产出 JS 与产出 `.abc` 之间，有没有会让"我们这套 JS 运行时"的结论失真的语义差异？**
> 性质：**纯调研**。本文件是唯一新增文件；`/tmp/arkvm-research/` 下的一切都是可丢的中间产物（tmpfs，重启即失效），
> 因此**每条证据都内联了"命令 + 原始输出"**，可照着重跑。

---

## 0. 结论（一句话）

**有，但只有一处是"协议级"的，且对我们现有实现无害；另有一处机制级差异不构成对现有结论的证伪，只是把"结论适用范围"钉死：**

1. **装饰器调用协议不同（真实、可复现）**：同一份带装饰器的 `.ts`，**tsc 4.9.5** 的 `__decorate` 助手把类装饰器编译成 `C = D(C) || C`、把**字段声明**装饰器编译成 `D(Proto, "k", undefined)`（**3 实参**）；而**官方 es2abc 把 `.ts` 直接编译**时自己实现装饰器，发的是 `D(Proto, "k")`（**2 实参**），`__decorate` 在字节码里**一次都不出现**。
   → 我们的运行时 `v2Field = (kind) => function (target, key) {...}` **只读前两个参数**，所以这条差异**对当前实现无害**。但它意味着"我们按 `__decorate` 的形状写装饰器"这件事**只在 JS 路径成立**，是 JS 路径的人工产物，不是真机的协议。
2. **模块系统的接线方式不同（结构级）**：`.abc` 走 **ESM 模块记录**（`MODULE_REQUEST_ARRAY` / `ModuleTag` / `import_name: default` / `ldexternalmodulevar`），并由 `npmEntries.txt` 把 `@ohos.curves` 之类**重定向到 `@native.*` 原生模块记录**；JS 路径走 **CommonJS 仿真**（`__arkui_dom_defineCommonJS(id, function(require, exports, module){...})` + `require("@ohos:xxx").default`）。
   → 凡是**断言 `@ohos:*` 模块行为**的用例，其结论都是**关于 `runtime/ohos-shims.js` 的**，与真机原生模块无关。这是本项目**最大的一类"只对 JS 路径成立"的结论**。
3. **其余列在任务里的风险点，逐项实测后与 JS 语义一致或可忽略**：自由变量（`tryldglobalbyname` / `ldglobal`）、原型访问器（`definegettersetterbyvalue`）、字符串/数值/BigInt/正则/`try-catch`/`async`、`new Function`、`globalThis`、`static {}` 块——**没有发现会让现有测试结论失真的分叉**。
4. **未验证的硬边界**：CLT 里**没有 ArkVM**（无 `ark_js_vm`），`.abc` **在本地无法执行**；ArkUI 状态管理的真机实现（`stateMgmt.js` / `ObservedObject.createNew`）**不在 SDK 里**。所以下面所有"语义一致"都是**字节码级的同构判断**，不是**执行级的等价证明**。

---

## 1. 问题

路线是：官方 `ets-loader` 把 `.ets` 编译成 **JS**（`.ts` → 经 tsc 去类型 → JS），我们的运行时在浏览器/Electron 里执行那份 JS。**真机执行的是 `.abc`**。

所以只要问一句：**ets-loader 的降级/改写手法，在"喂给 es2abc"与"喂给 tsc"这两条路上，语义是否分叉？**

---

## 2. 工具与路径（**先核实，与原任务描述有出入**）

原任务给的路径有两处不对，实际路径如下（`command-line-tools/` 这一层是原描述漏掉的）：

```bash
$ ls /data/training/cli/commandline-tools-linux-x64-26.0.0.821/
command-line-tools                                    # ← 多一层

$ B=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
$ ls $B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build/bin/
ark_aot_compiler  es2abc  libhilog_linux.so  libhmicui18n.so  libhmicuuc.so
libsec_shared.so  merge_abc  panda_guard  profdump

$ find $B/sdk -maxdepth 6 \( -name 'es2abc' -o -name 'ark_disasm' \) 2>/dev/null
$B/sdk/default/openharmony/toolchains/ark_disasm
（es2abc 不在 find 的 maxdepth 内，上面 ls 已给出绝对路径）
```

| 用途 | 路径 |
|---|---|
| JS/TS → `.abc` | `$B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build/bin/es2abc` |
| 反汇编 | `$B/sdk/default/openharmony/toolchains/ark_disasm` |
| protoBin 合并 | `$B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build/bin/merge_abc` |
| 官方构建驱动 | `$B/bin/hvigorw`（**注意：`bin/` 下没有 `devecocli`**，只有 `hvigorw / ohpm / codelinter / hstack / arktsdoc / Emulator`） |

**关键发现：CLT 里没有 ArkVM。**

```bash
$ find $B -maxdepth 8 -type f \( -name 'ark_js_vm' -o -name '*js_vm*' -o -name 'ark' -o -name 'etsc' \) 2>/dev/null
（空）
```

→ **`.abc` 无法在本机执行**，一切结论只能是字节码级的。这条是硬边界，下面所有"一致"都要按这个前提读。

---

## 3. 方法

两条线并行，最后交叉验证。

**线 A —— 考古"冻结的官方产物"。**
`harmony-proj/entry/build/default/intermediates/loader_out/default/ets/modules.abc`（官方 hvigor 构建留下的**真 `.abc`**，67860 B）。
先证实 `fixtures/` 确实是同一管线、同一工具链的产物，再把这个 `.abc` 反汇编，看 ets-loader 的改写手法在字节码里长什么样。

**线 B —— 用官方管线复现一份"带装饰器"的 `.abc`。**
线 A 的 6 个页面（Index/AnimDemo/GestureDemo/Callee/MeasNotify/PromptAct）**恰好全是不带类装饰器的 V1 页面**（`@State` 之类在 ets-loader 阶段就被消解成 `extends ViewPU`），所以它们证不了装饰器。
→ 把 `harmony-proj` **整份复制到 `/tmp`**（不碰仓库），加一个带 `@Observed / @ObservedV2 / @Trace / @Local / @Param / @Once / @Event / @Monitor / @Computed / @Provider / @Consumer` 的探针页，**用官方 `hvigorw` 构建**，看真 `.abc` 里装饰器怎么落地。

> 纪律说明：仓库内**零改动**。新增的探针页只存在于 `/tmp/arkvm-research/hm2/`，仓库的 `fixtures/**`、`runtime/**`、`harmony-proj/**`、`docs/**` 全部未动。

---

## 4. 证据 A：先确认 `fixtures/` 是同一管线的真产物

```bash
$ C=/data/training/cli/arkui-dom-runtime/harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets/pages
$ F=/data/training/cli/arkui-dom-runtime/fixtures/pages
$ for p in Index AnimDemo GestureDemo Callee MeasNotify PromptAct; do
>   diff -q $C/$p.ts $F/$p.ts >/dev/null 2>&1 && echo "IDENTICAL  $p.ts" || echo "DIFFER     $p.ts"; done
DIFFER     Index.ts
IDENTICAL  AnimDemo.ts
IDENTICAL  GestureDemo.ts
IDENTICAL  Callee.ts
IDENTICAL  MeasNotify.ts
IDENTICAL  PromptAct.ts

$ diff -u $C/Index.ts $F/Index.ts | grep -E '^[-+@]' | grep -v '^+++\|^---'
@@ -45,7 +45,7 @@
-            Text.fontSize({ "id": 16777224, "type": 10002, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
+            Text.fontSize({ "id": 16777224, "type": 10002, params: [], "bundleName": "com.example.hmtest", "moduleName": "entry" });
@@ -67,4 +67,4 @@
-registerNamedRoute(() => new Index(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/Index", pageFullPath: "entry/src/main/ets/pages/Index", integratedHsp: "false", moduleType: "followWithHap" });
+registerNamedRoute(() => new Index(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/Index", pageFullPath: "entry/src/main/ets/pages/Index", integratedHsp: "false", moduleType: "followWithHap" });
```

→ **6 个页面里 5 个字节相同**，唯一差异是两处 `bundleName`（`fixtures` 来自更早的 `com.example.hmtest`）。**`fixtures/` 是官方管线的真产物**，不是手抄的。

反汇编那份真 `.abc`：

```bash
$ $B/sdk/default/openharmony/toolchains/ark_disasm --verbose real-modules.abc real-modules.pa   # exit 0
$ wc -l real-modules.pa
15781 real-modules.pa
$ grep -c '^\.record' real-modules.pa ; grep -c '^\.function' real-modules.pa
20
200
```

---

## 5. 证据 B：管线判定 —— 喂给 es2abc 的**就是那份 `.ts`**，中间**没有 tsc**

这是本节最重要的一条，因为它决定了 B 线实验是否有意义。

**(1) 构建缓存里只有 `.ts` + `.protoBin`，页面的 `.js` 一个都没有。**

```bash
$ ls -la $C
-rw-rw-r-- 1 yanli yanli 47088 AnimDemo.protoBin
-rw-rw-r-- 1 yanli yanli  6451 AnimDemo.ts
-rw-rw-r-- 1 yanli yanli 14939 Callee.protoBin
-rw-rw-r-- 1 yanli yanli  1726 Callee.ts
... （6 个页面各一对，无 .js）
```

整个 cache 里唯一的 `.js` 是 `entry/build/default/generated/r/default/ResourceTable.js`（hvigor 由资源生成的，不是页面）。

**(2) hvigor 的构建日志直接写出驱动的进程与文件。**

```bash
$ grep -n "ts2abc\|ets-loader/bin\|target-api-version" harmony-proj/.hvigor/outputs/build-logs/build.log | head -4
361:  '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node',
362:  '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/ts2abc.js',
363:  '--target-api-version',
364:  '26'
```

`bin/ark/ts2abc.js` 是个薄壳，唯一的职责是把 `--target-api-version` 转发给 `es2abc`：

```bash
$ cat $B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/ts2abc.js
...
es2abcArgs.push("--target-bc-version")
for (let index = 0 ; index < args.length; index += 2) {
    if (args[index] == "--target-api-version") {
        ... es2abcArgs.push("--target-api-version", args[index + 1]);
    } else if (args[index] == "--target-api-sub-version") { ... }
}
callEs2abc(es2abcArgs);
```

**(3) `filesInfo.txt` 把编译单元指成 `.ts`，`compileContextInfo.json` 把记录名列成 `&...&`。**

```bash
$ head -c 700 harmony-proj/entry/build/default/cache/.../debug/filesInfo.txt
/.../debug/entry/src/main/ets/pages/Index.ts;&entry/src/main/ets/pages/Index&;esm;
  entry|entry|1.0.0|src/main/ets/pages/Index.ts;entry;false;ets

$ head -c 400 harmony-proj/entry/build/default/cache/.../debug/compileContextInfo.json
{"hspPkgNames":[],"compileEntries":["&entry/build/generated/r/ResourceTable&",
 "&entry/src/main/ets/entryability/EntryAbility&", ... "&entry/src/main/ets/pages/AnimDemo&", ...]}
```

**(4) 旁证：`es2abc` 的确支持 `.ts` 作为输入，且 `--outputProto` 正好解释 `*.protoBin`。**

```bash
$ es2abc --help | grep -E 'extension|outputProto'
--extension: Parse the input as the given extension (options: js | ts | as | abc)
--outputProto: specify the output name for serializd protobuf file (.protoBin)
```

**结论**：官方管线是 `ets-loader 的 .ts` → `es2abc` → `*.protoBin` → `merge_abc` → `modules.abc`。**没有 tsc 这一环**。于是"装饰器会原样进 es2abc"这件事成立——而 es2abc 有它**自己的装饰器实现**（见下一节）。

---

## 6. 证据 C：装饰器协议的真实差异（本报告的核心）

### 6.1 先把"带装饰器的 `.ts`"造出来，并确认它真的是 ets-loader 产物

`fixtures/pages/V2.ts` 已经在仓库里，且它**保留了装饰器**（说明 ets-loader 不消解 V2/`@Observed` 装饰器）：

```bash
$ sed -n '13,20p' fixtures/pages/V2.ts
@ObservedV2
class TaskItem {
    @Trace
    name: string;
    @Trace
    done: boolean;
    id: number; // 刻意不加 @Trace：改它【不应】触发重渲染
```

```bash
$ grep -rn '^@\|^    @' fixtures/pages/*.ts fixtures/entryability/*.ts | ... | sort | uniq -c | sort -rn
     10 @Local
      3 @Param
      2 @Trace
      2 @Monitor
      2 @Computed
      1 @Provider
      1 @Once
      1 @ObservedV2
      1 @Observed
      1 @Event
      1 @Consumer
```

### 6.2 同一份源文件，两条路的产物形态

**(a) JS 路径** —— `tools/extract.mjs` 用的是 **ets-loader 自带的 TypeScript 4.9.5** 的 `transpileModule`：

```bash
$ sed -n '21,23p' tools/extract.mjs
const TS_PATH = path.join(
  CLT, 'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'
);
$ sed -n '50,61p' tools/extract.mjs
const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2021,
    // 无 import/export 的页面用 None（经典脚本，靠全局）；
    // 含 @ohos: import 的模块必须用 CommonJS，才能通过 require 垫片解析平台模块
    module: useCjs ? ts.ModuleKind.CommonJS : ts.ModuleKind.None,
    removeComments: false,
  },
  fileName: path.basename(src),
});

$ node -e "console.log(require(TS_PATH).version)"   # ets-loader 自带 TS 版本
4.9.5
```

产物 `build/v2.js` 里是 tsc 的遗产装饰器助手**逐字**（连注释里的"2 个实参"都在）：

```bash
$ sed -n '13,20p' runtime/arkui-dom-runtime.js        # 运行时侧的说明
  // 类装饰器：__decorate([Observed], Cls) 只有 2 个实参 → 助手把返回值当作类本身，
  // 所以这里【必须返回一个类】。用子类把构造返回值换成 Proxy。

$ sed -n '13,18p' build/v2.js
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
$ grep -n '__decorate\|TaskItem' build/v2.js | sed -n '4,12p'    # （节选，源码顺序）
40:    Trace
41:], TaskItem.prototype, "name", void 0);
43:    Trace
44:], TaskItem.prototype, "done", void 0);
45:TaskItem = __decorate([
46:    ObservedV2
47:], TaskItem);
```

即 JS 路径是 **`let TaskItem = class TaskItem {...}` + `TaskItem = __decorate([ObservedV2], TaskItem)`**（`let` 重绑定）。

**(b) ABC 路径** —— 用 es2abc 直接编译同一份 `fixtures/pages/V2.ts`（`$ES2ABC` / `$DISASM` 见 §2 的路径表）：

```bash
$ ES2ABC=$B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build/bin/es2abc
$ DISASM=$B/sdk/default/openharmony/toolchains/ark_disasm
$ $ES2ABC --module --extension ts --output V2.abc --source-file V2.ts V2.ts   # exit 0
$ $DISASM --verbose V2.abc V2.pa
$ for k in __decorate ObservedV2 Trace Param Local Monitor Computed defineProperty Proxy; do
>   printf '%-16s V2=%s Observe=%s\n' "$k" "$(grep -c -- "$k" V2.pa)" "$(grep -c -- "$k" Observe.pa)"; done
__decorate       V2=0 Observe=0          ← 整个字节码里一次都不出现
ObservedV2       V2=2 Observe=0
Trace            V2=3 Observe=0
Param            V2=16 Observe=0
Local            V2=11 Observe=0
Monitor          V2=6 Observe=0
Computed         V2=6 Observe=0
defineProperty   V2=5 Observe=0
Proxy            V2=0 Observe=0
```

字节码里的真实调用序列（`V2.pa`，节选）：

```asm
; class TaskItem { @Trace name; @Trace done; }   @ObservedV2 class TaskItem
ldhole
defineclasswithbuffer 0xf, #~@0=#TaskItem:(any,any,any,any,any), { 1 [ i32:0, ]}, 0x2, v0
sta v0
ldobjbyname 0x10, "prototype"
lda v0
stlexvar 0x0, 0x0
tryldglobalbyname 0x12, "Trace"                     ; ← 直接用全局名调装饰器
sta v0
ldlexvar 0x0, 0x0
throw.undefinedifholewithname "TaskItem"
lda v1
ldobjbyname 0x13, "prototype"
lda.str "name"
lda v0
callargs2 0x15, v1, v2                              ; Trace(TaskItem.prototype, "name")   ← 2 实参
tryldglobalbyname 0x17, "Trace"
...                                                 ; Trace(..., "done")
tryldglobalbyname 0x1c, "ObservedV2"
...
lda v0
callarg1 0x1d, v1                                   ; ObservedV2(TaskItem)                ← 1 实参
sta v0
callruntime.istrue 0x1f
jnez jump_label_3                                   ; if (r) 保留返回值 …
<jump_label_3>
...                                                 ; else 回落原类
stglobalvar / trystglobalbyname "TaskItem"          ; TaskItem = ...    ← 回写模块绑定
```

→ 语义即 **`TaskItem = ObservedV2(TaskItem) || TaskItem`**；方法/访问器装饰器额外做 `Object.getOwnPropertyDescriptor` + `Object.defineProperty` 记账（见下）。

### 6.3 用**官方 hvigor** 复核（不是我自己拼命令行）

B 线实验：复制工程到 `/tmp`，加探针页 `pages/DecoProbe.ets`（含 `@Observed / @ObservedV2 / @Trace / @Local / @Param / @Once / @Event / @Monitor / @Computed / @Provider / @Consumer`），跑官方构建：

```bash
$ cp -a harmony-proj /tmp/arkvm-research/hm2 && rm -rf /tmp/arkvm-research/hm2/entry/build /tmp/arkvm-research/hm2/.hvigor
$ # 加 pages/DecoProbe.ets 并登记到 main_pages.json（只在 /tmp 里改）
$ cd /tmp/arkvm-research/hm2 && timeout 560 $B/bin/hvigorw \
    --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
> hvigor Finished :entry:default@CompileArkTS... after 5 s 174 ms
> hvigor BUILD SUCCESSFUL in 10 s 69 ms
```

**产物的 `.ts` 仍然带着全部装饰器**：

```bash
$ D=/tmp/arkvm-research/hm2/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets
$ grep -n '^@\|^    @' $D/pages/DecoProbe.ts
6:@Observed   13:@ObservedV2   15:@Trace   17:@Trace   45:@Param
47:@Once      48:@Param        50:@Event   52:@Local   54:@Local
56:@Consumer('shared')        58:@Monitor('inner')        62:@Computed
112:@Local    114:@Local       116:@Provider('shared')
```

**而这个 `.ts` 之后就是 `es2abc`**（同前 §5），产物 `.abc` 里：

```bash
$ cp /tmp/arkvm-research/hm2/entry/build/default/intermediates/loader_out/default/ets/modules.abc \
     /tmp/arkvm-research/out/probe-modules.abc          # 80156 B
$ $DISASM --verbose probe-modules.abc probe-modules.pa        # 18735 行
$ grep -c '__decorate' probe-modules.pa
0
```

装饰器落地序列（`probe-modules.pa`，`&...DecoProbe&.func_main_0`，节选，逐条对应源码里的装饰器）：

```asm
; @Observed class ProbeMeta
defineclasswithbuffer 0xf, &...DecoProbe&.#~@0=#ProbeMeta:(any,any,any,any), { 1 [ i32:0, ]}, 0x1, v26
tryldglobalbyname 0x12, "Observed"
callarg1 0x13, v26                       ; Observed(ProbeMeta)
callruntime.istrue 0x15
jnez jump_label_3                        ; ProbeMeta = Observed(ProbeMeta) || ProbeMeta

; @Trace name / @Trace done  （字段声明装饰器 → 2 实参）
tryldglobalbyname 0x19, "Trace"
callargs2 0x1c, v25, v26                 ; Trace(ProbeItem.prototype, "name")
tryldglobalbyname 0x1e, "Trace"
lda.str "done"
callargs2 0x21, v25, v26                 ; Trace(ProbeItem.prototype, "done")

; @ObservedV2 class ProbeItem
tryldglobalbyname 0x23, "ObservedV2"
callarg1 0x24, v26                       ; ObservedV2(ProbeItem)
callruntime.istrue 0x26 / jnez           ; ProbeItem = ObservedV2(ProbeItem) || ProbeItem

; @Param readonly label / @Once @Param mode / @Event onPing / @Local inner,hits
tryldglobalbyname 0x35, "Param"   → callargs2 0x38, v25, v26   ; Param(Proto, "label")
tryldglobalbyname 0x3a, "Once"    → ...                        ; Once 先求值
tryldglobalbyname 0x3b, "Param"   → callargs2 0x3e, v25, v26   ; Param(Proto, "mode")
tryldglobalbyname 0x44, "Event"   → callargs2 0x47, v25, v26   ; Event(Proto, "onPing")
tryldglobalbyname 0x49, "Local"   → callargs2 0x4c, v25, v26   ; Local(Proto, "inner")
tryldglobalbyname 0x4e, "Local"   → callargs2 0x51, v25, v26   ; Local(Proto, "hits")

; @Consumer('shared') shared
tryldglobalbyname 0x53, "Consumer" → callarg1 0x54, v25        ; Consumer('shared')
...                               → callargs2 0x58, v25, v26   ; (Consumer('shared'))(Proto, "shared")

; @Monitor('inner') onInnerChange()   ← 方法装饰器：先取真描述符，再按返回值写回
tryldglobalbyname 0x5a, "Monitor" → callarg1 0x5b, v25                 ; Monitor('inner')
tryldglobalbyname 0x5d, "Object"
callthis2withname 0x62, "getOwnPropertyDescriptor", v25, v26, v27      ; Object.gOPD(Proto, "onInnerChange")
tryldglobalbyname 0x64, "Object"
lda.str "onInnerChange"
callargs3 0x6b, v30, v31, v32                                           ; Monitor('inner')(Proto, "onInnerChange", desc)
callruntime.istrue 0x6d / jnez
callthis3withname 0x6e, "defineProperty", v25, v26, v27, v28            ; Object.defineProperty(Proto, key, r) —— 仅当 r 为真

; @Computed get doubled()   ← 同方法装饰器形态
tryldglobalbyname 0x70, "Computed" → ... getOwnPropertyDescriptor("doubled") ...
callargs3 0x7f, v30, v31, v32  /  istrue / defineProperty
```

### 6.4 差异对照（协议级）

| 形态 | JS 路径（tsc 4.9.5 `__decorate`） | ABC 路径（es2abc 原生） | 等价？ |
|---|---|---|---|
| 类装饰器 `@Observed` / `@ObservedV2` | `C = D(C) \|\| C`（`c=2`，`r = target`，回写绑定） | `D(C)` → `istrue` → 真则用返回值、否则回落原类 → 回写模块绑定 | **等价** |
| **字段声明**装饰器 `@Local x` / `@Param x` / `@Trace x` / `@Event x` / `@Once` | `D(Proto, "x", undefined)` —— **3 实参**；无 `getOwnPropertyDescriptor`；`r` 为假则不 `defineProperty` | `D(Proto, "x")` —— **2 实参**；无 `getOwnPropertyDescriptor`；不 `defineProperty` | 值等价，**`arguments.length` 可区分** |
| 方法装饰器 `@Monitor('k') m(){}` | `desc===null` → `gOPD`；`D(Proto,"m",desc)`；`if(r) defineProperty` | 同：先 `gOPD` → `D(Proto,"m",desc)` → `istrue` → `defineProperty` | **等价** |
| 访问器装饰器 `@Computed get g(){}` | 同方法 | 同方法 | **等价** |
| 装饰器查找方式 | 由 `extract.mjs` 生成**作用域内**绑定：`const { Event, Monitor, ... } = globalThis.__arkui_dom_decorators` | `tryldglobalbyname "Event" / "Monitor" / ...`（**全局名查找**） | 接线不同、要求同名全局存在，**语义一致** |

**唯一可观测分叉**：字段声明装饰器的第三个实参（JS 有、ABC 无）。

### 6.5 这个分叉对我们的实现是否有害？——**没有**

```bash
$ sed -n '3378,3386p' runtime/arkui-dom-runtime.js
  const v2Field = (kind) => function (target, key) {
    if (typeof key === 'string') installV2Accessor(target, key, kind);
    return undefined;                                  // 属性装饰器的返回值被 __decorate 忽略
  };
  const Param = v2Field('param');
  const Local = v2Field('local');
  const Once  = v2Field('once');
  const Event = v2Field('event');
  const Trace = v2Field('trace');
```

`v2Field` **签名只声明 `(target, key)`、不读第三参、不查 `arguments.length`** → 2 实参/3 实参都对它无差别。
`Monitor = (...keys) => function (target, key, desc)` 与 `Computed(target, key, desc)` 读 `desc`，而 `desc` 在两条路上都是**真描述符**（都先 `gOPD`）→ 也一致。

**但**：这等于承认"我们按 `__decorate` 的形状实现装饰器"是**JS 路径的产物**。若将来真机语义要求靠第三参辨别"字段 vs 方法"，我们的实现会**静默走错分支**（因为它根本不看）。

**另一处潜在脆弱点**（读代码即得，不是我的推测）：`__decorate` 助手有一支短路分支
`if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(...)`。
即：**只要宿主定义了 `Reflect.decorate`，JS 路径就会整体切到"描述符式"装饰器协议**（与 tsc 的 legacy 分支是两套不同协议），而 ABC 路径**没有这个分支**。当前浏览器/Electron 都没有 `Reflect.decorate`，所以没触发；但它是一个"换宿主就可能变语义"的隐患。

---

## 7. 证据 D：其余风险点逐项实测

### 7.1 自由变量 —— 与 JS 同名查找，语义一致

`.abc` 里所有 ArkUI 全局都是**按名查找全局对象**：

```bash
$ grep -c 'tryldglobalbyname' real-modules.pa
265
$ grep -n 'tryldglobalbyname.*"ViewPU"' real-modules.pa | head -3
5483:	tryldglobalbyname 0x0, "ViewPU"   # offset: 0x6a56
5502:	tryldglobalbyname 0x9, "ViewPU"   # offset: 0x6a81
5514:	tryldglobalbyname 0xf, "ViewPU"   # offset: 0x6aa5
$ for k in ObservedPropertySimplePU SubscriberManager Column Row Text Button Reflect.set; do
>   printf '%-26s %s\n' "$k" "$(grep -c -- "$k" real-modules.pa)"; done
ObservedPropertySimplePU       14
SubscriberManager              7
Column                         30
Row                            43
Text                           63
Button                         26
Reflect.set                    0        ← `Reflect.set(...)` 不是独立指令（但 `Reflect` 本身是全局名，见下）
$ grep -n 'tryldglobalbyname.*"Reflect"' real-modules.pa | head -1
5497:	tryldglobalbyname 0x6, "Reflect"   # offset: 0x6a73
```

→ `ViewPU / ObservedPropertySimplePU / SubscriberManager / Column / Text / Reflect …` 在两条路上**都要求存在同名全局**（`tryldglobalbyname` 找不到就抛 `ReferenceError`，与 JS 一致）。**我们的运行时把它们挂 `globalThis` 的做法与真机同构。**

**`globalThis.X` 是个特例，但结论相同**：`globalThis` 编译成 `ldglobal`（全局对象本身），后接**动态属性查找**：

```bash
$ grep -c 'globalThis' probe-modules.pa
0
$ grep -o 'ldglobal[a-z]*' probe-modules.pa | sort | uniq -c
     10 ldglobal
    317 ldglobalbyname
$ sed -n '10587,10601p' probe-modules.pa
	ldglobal                                          ; ← globalThis
	sta v8
	lda v8
	ldobjbyname 0x19, "Gesture"                       ; globalThis.Gesture
	sta v7
	lda v7
	ldobjbyname 0x1b, "create"
	sta v6
	tryldglobalbyname 0x1d, "GesturePriority"         ; GesturePriority 是**按名**全局查找
	sta v8
	lda v8
	ldobjbyname 0x1e, "Low"
	sta v8
	lda v6
	callthis1withname 0x20, "create", v7, v8
```

即 **`Gesture` 是全局对象上的*属性*（动态），`GesturePriority` 是*具名全局*（静态）**。真机要求 `globalThis.Gesture` 可写；我们的运行时也提供 `globalThis.Gesture` → **同构**。

**顺带纠正一处仓库里的说法**：`fixtures/pages/GestureDemo.ts` 里的 `globalThis.Gesture.create(...)` **不是**页面作者写的，是 **ets-loader 生成的**：

```bash
$ grep -c 'globalThis' harmony-proj/entry/src/main/ets/pages/GestureDemo.ets     # 源码
0
$ grep -c 'globalThis.Gesture' $C/GestureDemo.ts                                 # 产物
10
```

**`Event` 撞名问题**：装饰器 `Event` 在 ABC 里也是 `tryldglobalbyname "Event"`，浏览器里 `Event` 是 DOM 构造器 → 我们的 `extract.mjs` 用**作用域内**绑定规避（见 §6.2 的 `build/v2.js` 前 14 行）。**这条已经处理好了，不是新问题。**

### 7.2 原型访问器 —— `definegettersetterbyvalue`，无分叉证据

`@State` 被 ets-loader 改写成 `get/set` 访问器，在字节码里是**在原型上装访问器**，而不是 `Object.defineProperty`：

```asm
; &...AnimDemo&.func_main_0  （real-modules.pa 5518-5580）
ldobjbyname 0x11, "prototype"
sta v8
lda.str "w"
definemethod 0x13, &...AnimDemo&.#~@0>#w:(any,any,any), 0x0     ; getter
sta v11
ldfalse
definegettersetterbyvalue v8, v9, v11, v10                      ; 装 getter（setter 位 = undefined）
lda.str "w"
definemethod 0x14, &...AnimDemo&.#~@0>#w^1:(any,any,any,any), 0x1 ; setter
sta v11
definegettersetterbyvalue v8, v9, v10, v11                      ; 装 setter
```

```bash
$ for k in definegettersetterbyname definegettersetterbyvalue definepropertybyname; do
>   printf '%-30s %s\n' "$k" "$(grep -c -- "$k" real-modules.pa)"; done
definegettersetterbyname       0
definegettersetterbyvalue      26
definepropertybyname           27
```

`definepropertybyname` 在这里用于**对象字面量**里"值不是编译期常量"的字段（例如 `.align(Alignment.Center)` 之类），**不是**类访问器。

**分叉判断**：`definegettersetterbyvalue` 与 JS 的 `get x(){}` 都产出原型访问器，且 `@Computed` 那条路两条都先 `Object.getOwnPropertyDescriptor` 再 `defineProperty`（§6.3 已实测）→ **`configurable` 至少足以让装饰器重写成功**，否则真机自己也跑不起来。**没有发现会让现有结论失真的分叉**；但访问器的 `enumerable` 未取证（见 §10）。

### 7.3 `@Observed` 的 Proxy —— 机制在框架里，**取不到证据**

```bash
$ grep -c '"Proxy"' final-modules.pa ; grep -c '"Proxy"' real-modules.pa
0
0
```

`.abc` 里 **`Proxy` 一次都不出现**。我们的运行时是用 `Proxy` + "子类替换构造返回值"实现的（`runtime/arkui-dom-runtime.js:184-193`）。真机的 `ObservedObject.createNew` 实现在 **ArkUI 的 `stateMgmt.js`**，**整个 CLT 里都没有这个文件**：

```bash
$ timeout 60 find $B -iname '*stateMgmt*' 2>/dev/null | head          # 空
$ timeout 60 grep -rl 'ObservedPropertySimplePU\|SynchedPropertyNesedObjectPU' \
      $B/sdk/default/openharmony/ets/api $B/sdk/default/openharmony/js/api 2>/dev/null | head
（空）
```

（补充核对的准确说法：`SynchedPropertyNesedObjectPU` 这个名字在 CLT 里**只出现在 ets-loader 的"发射器"里**——
`$EL/lib/pre_define.js` 与 `$EL/lib/process_component_member.js`（即**决定发哪个名字**的地方），
以及 `legacy_api8/` 下打包的 TypeScript 编译器（无关字符串）。
**没有任何一处是这些状态类的实现体**；真机实现不在 CLT 里。）

（旁注：`legacy_api8/src/index.js` 里出现 `__decorate` 是因为它**打包了 TypeScript 编译器**——`decorateHelper={name:"typescript:decorate",importName:"__decorate",...}`。这与"老管线经 tsc 所以有 `__decorate`"的说法一致，但这是**推断**，我没跑过 API 8 的构建。）

→ `@Observed` 的 Proxy 语义（`instanceof`、序列化、属性枚举、Proxy 不变式）**本地无法验证**。`docs/CAPABILITY.md:240` 里"`@Observed` 经 Proxy 实现，**未验证**对 `instanceof`、序列化…"这句话**在 R24 之后依然是准确的**。

### 7.4 字面量 / 语句 / 其它语法

在**官方构建**里实测跑通（探针页 `pages/SyntaxProbe3.ets`，`BUILD SUCCESSFUL`）并反汇编核对：

```bash
$ for k in ldbigint try_begin handler_begin 'tryldglobalbyname.*"RegExp"' \
             'tryldglobalbyname.*"Function"' 'tryldglobalbyname.*"Error"'; do
>   printf '%-40s %s\n' "$k" "$(grep -c -- "$k" final-modules.pa)"; done
ldbigint                                 2
try_begin                                38
handler_begin                            32
tryldglobalbyname.*"RegExp"              1
tryldglobalbyname.*"Function"            1
tryldglobalbyname.*"Error"               1
$ grep -o 'ldglobal[a-z]*' final-modules.pa | sort | uniq -c
     11 ldglobal          # 裸 ldglobal = globalThis / 全局对象本身（与真产物同为 10~11 次）
    335 ldglobalbyname    # 是 tryldglobalbyname 的后半段（按名查全局）
$ grep -c 'tryldglobalbyname' final-modules.pa
335
```

**正则字面量有真实分叉**（值得记一笔）：字面量被降级成**运行期 `new RegExp(...)`**：

```asm
; &...SyntaxProbe3&.#*#re3   （源码：const re = /ab+c/gi;）
tryldglobalbyname 0x0, "RegExp"
lda.str "ab+c"
lda.str "gi"
newobjrange 0x1, 0x3, v5          ; new RegExp("ab+c", "gi")
```

⇒ 在 V8 里 `/ab+c/gi` 是**每个字面量位置共享同一个对象**（`f() === f()` 为真），在 ArkVM 里**每次求值都新建**。
若某用例断言 `re1 === re2` 或依赖 `lastIndex` 跨调用保留 —— **结论只对 JS 路径成立**。本项目现有用例没有这种断言（`grep -rn 'lastIndex' fixtures/` 为空）。

其余实测一致：`BigInt`（`ldbigint`）、`try/catch`（`try_begin`/`handler_begin`/`.catchall`）、`async/await`（`asyncfunctionenter` / `suspendgenerator` / `resumegenerator`）、`new Function`（`tryldglobalbyname "Function"` + `newobjrange`）、`static {}` 块、`globalThis`。逐条节选：

```asm
; try/catch
try_begin_label_0:
	tryldglobalbyname 0x0, "Error"
	newobjrange 0x1, 0x2, v4
	throw
try_end_label_0:
	jmp handler_end_label_0_0
handler_begin_label_0_0:
	sta v4
	lda.str "caught"
	return
.catchall try_begin_label_0, try_end_label_0, handler_begin_label_0_0, handler_end_label_0_0

; async
asyncfunctionenter
	...
	asyncfunctionawaituncaught v4
	suspendgenerator v4
	resumegenerator
	getresumemode
```

### 7.5 **ArkTS 检查器**的接受/拒绝名单（真机路线的额外闸门）

`.abc` 不只是 es2abc 编出来的，前面还有 **ArkTS 1.1 的 linter/checker**。它拒绝的东西，**在任何 JS 运行时里都不会出现**（因为 `.ets` 页面根本编不过）。实测（探针页报错原文）：

| 构造 | 结果 | 原始报错 |
|---|---|---|
| `try/catch`、`BigInt` 字面量、正则字面量 | ✅ 通过 | — |
| `new Function(...)` | ✅ **通过** | — |
| `globalThis`（`typeof` / 成员访问） | ✅ 通过 | — |
| `static {}` 块、`async/await` | ✅ 通过 | — |
| `eval('1+1')` | ❌ | `Usage of standard library is restricted (arkts-limited-stdlib)` @14:21 |
| `Object.defineProperty(...)` | ❌ | `Usage of standard library is restricted (arkts-limited-stdlib)` @40:3 |
| `Reflect` 当对象用 | ❌ | `Namespaces cannot be used as objects (arkts-no-ns-as-obj)` @45:17 |
| `Symbol('k')` | ❌ | `"Symbol()" API is not supported (arkts-no-symbol)` @34:10 |
| `function* gen(){}` | ❌ | `Generator functions are not supported (arkts-no-generators)` @42:1 |
| `class { #n }` 私有字段 | ❌ | `Private "#" identifiers are not supported (arkts-no-private-identifiers)` @29:3 |
| 无类型对象字面量 `{ a: 1 }` | ❌ | `Object literal must correspond to some explicitly declared class or interface (arkts-no-untyped-obj-literals)` @33:37 |

**含义**：用户写的 `.ets` 里**不可能**有 `eval` / `Proxy` / `Object.defineProperty` / `Symbol` / 生成器 / `#private`。
所以 *"JS 路径能跑的某些语法，真机路线的源文件根本写不出来"* —— 但我们的 `fixtures/*.ts` 是 **ets-loader 的产物**，**不经过 ArkTS 检查器**，因此产物里出现这些（例如编译器自己发的 `Object.defineProperty`）是合法的。**不要把"产物里能出现"误读成"页面能写"。**

### 7.6 模块系统 —— 结构不同（见结论 2）

**ABC（ESM）**：每个模块是 `&entry.src.main.ets.pages.X&` 记录，导入是**模块记录 + `ldexternalmodulevar`**：

```bash
$ sed -n '97,119p' real-modules.pa
23 0x367d { 1 [
	MODULE_REQUEST_ARRAY: {
		0 : @ohos:notificationManager,
	};
	ModuleTag: REGULAR_IMPORT, local_name: notificationManager, import_name: default, module_request: @ohos:notificationManager;
]}
31 0xdc4 { 4 [
	MODULE_REQUEST_ARRAY: {
		0 : @ohos:app.ability.ConfigurationConstant,
		1 : @ohos:app.ability.UIAbility,
		2 : @ohos:hilog,
	};
	ModuleTag: REGULAR_IMPORT, local_name: ConfigurationConstant, import_name: default, module_request: @ohos:app.ability.ConfigurationConstant;
	ModuleTag: REGULAR_IMPORT, local_name: UIAbility, import_name: default, module_request: @ohos:app.ability.UIAbility;
	ModuleTag: REGULAR_IMPORT, local_name: hilog, import_name: default, module_request: @ohos:hilog;
	ModuleTag: LOCAL_EXPORT, local_name: EntryAbility, export_name: default;
]}
36 0x3da1 { 1 [
	MODULE_REQUEST_ARRAY: {
		0 : @ohos:promptAction,
	};
	ModuleTag: REGULAR_IMPORT, local_name: promptAction, import_name: default, module_request: @ohos:promptAction;
]}
```

（`23 / 31 / 36` 是字面量数组下标；`MODULE_REQUEST_ARRAY` 的顺序就是 `ldexternalmodulevar 0x0/0x1/…` 的索引。这三块分别对应 `fixtures/pages/MeasNotify.ts:9`（`@ohos:notificationManager`）、`fixtures/entryability/EntryAbility.ts`、`fixtures/pages/PromptAct.ts:10`（`@ohos:promptAction`）。）

`@ohos.*` / `@system.*` 里有一部分被**重定向到原生模块**（`npmEntries.txt`，由 loader 生成，我的复现工程内容完全一致）：

```bash
$ cat harmony-proj/entry/build/default/cache/.../debug/npmEntries.txt
@system.app:@native.system.app
@ohos.app:@native.ohos.app
@system.router:@native.system.router
@system.curves:@native.system.curves
@ohos.curves:@native.ohos.curves
@system.matrix4:@native.system.matrix4
@ohos.matrix4:@native.ohos.matrix4
```

对应地，真 `.abc` 里有这些**原生别名记录**：

```bash
$ grep -n '^\.record @' real-modules.pa          # 每条记录体内的 u8 行已折叠展示
255:.record @ohos.app      { u8 @native.ohos.app = 0x0 }
260:.record @ohos.curves   { u8 @native.ohos.curves = 0x0 }
265:.record @ohos.matrix4  { u8 @native.ohos.matrix4 = 0x0 }
270:.record @system.app    { u8 @native.system.app = 0x0 }
275:.record @system.curves { u8 @native.system.curves = 0x0 }
280:.record @system.matrix4{ u8 @native.system.matrix4 = 0x0 }
285:.record @system.router { u8 @native.system.router = 0x0 }
# 真实形态（未折叠）举例：
$ sed -n '255,257p' real-modules.pa
.record @ohos.app { # offset: 0x4035, size: 0x0023 (35)
	u8 @native.ohos.app = 0x0                                                       # offset: 0x404c
}
```

**JS 路径（CommonJS 仿真）**：`extract.mjs --cjs` 把 tsc 的 CommonJS 产物包一层注册：

```bash
$ sed -n '1,8p' build/promptact-module.js
// 自动生成：把 PromptAct.ts 注册为 CommonJS 模块 "PromptAct"
__arkui_dom_defineCommonJS("PromptAct", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
const _ohos_promptAction_1 = require("@ohos:promptAction");
```

由 `runtime/ohos-shims.js` 提供实现：

```bash
$ sed -n '4,5p' runtime/ohos-shims.js
 * 转换产物里的 `import X from "@ohos:xxx"` 经 CommonJS 转译后变成
 * `require("@ohos:xxx").default`。本文件把这些平台模块按需实现出来。
```

**分叉**：`@ohos:promptAction` 在真机上是**操作系统提供的模块**（NAPI），在 JS 上是**我们写的 JS 垫片**。下游"有没有、什么时候返回、错误码长什么样"全部由垫片决定。

---

## 8. 对项目的影响判断

### 8.1 结论**只对 JS 路径成立**、需要在报告/文档里点名的

| # | 现有结论（出处） | 为什么只对 JS 路径成立 | 严重度 |
|---|---|---|---|
| 1 | **所有 `@ohos:*` / `@system:*` 平台模块用例**（`netfile`、`realfs`、`asyncio`、`promptaction`、`measure`、`router` 等） | 真机走原生模块（`@native.*` 或 ohos 模块管理器），JS 走 `runtime/ohos-shims.js`。断言的是**垫片行为**。 | 高（但项目已在 `CAPABILITY.md:258/261` 承认过一部分：如 preferences 格式自定、无 ArkVM） |
| 2 | **V2 装饰器"接口形状"来自 `__decorate`**（`docs/ARCHITECTURE.md` §3.4（第 232 行起）、`runtime/arkui-dom-runtime.js:3248-3265`） | 真机是 es2abc 的原生装饰器协议；字段声明装饰器**少一个实参**。当前实现不看第三参 → 无害，但这条"依据"本身是 JS 路径的。 | 中（结论仍可用，依据需标注） |
| 3 | **`@Observed` 用 Proxy + 子类替换构造返回值**（`runtime/arkui-dom-runtime.js:184-193`、`docs/ARCHITECTURE.md:342`"真机也是这个做法：`ObservedObject.createNew` 返回 Proxy"） | 我**无法验证** ArkUI 的 `ObservedObject`（`stateMgmt.js` 不在 CLT） | 中（`CAPABILITY.md:240` 已标"未验证"） |
| 4 | **正则字面量对象身份 / `lastIndex` 共享** | 真机降级为运行期 `new RegExp(...)` | 低（现有用例无此断言） |
| 5 | 任何依赖 `Reflect.decorate` 不存在的用例 | `__decorate` 助手会在宿主有 `Reflect.decorate` 时**整体换协议**；ABC 无此分支 | 低（当前宿主没有） |

### 8.2 判定为**无影响**的（逐条有证据）

- **装饰器的"装饰结果"语义**：类/方法/访问器装饰器在两条路上逐条同构（§6.4 表）；唯一分叉是字段声明装饰器的第 3 实参，而我们的实现不读它（§6.5）。
- **自由变量**（`ViewPU`/`Column`/`Curve`/`PlayMode`/`Reflect`/`Context`…）：两条路都要求同名全局存在，`tryldglobalbyname` 与 JS 全局查找同语义（§7.1）。
- **`globalThis.Gesture`**：两条路都是"全局对象上的动态属性"（`ldglobal` + `ldobjbyname`），要求一致（§7.1）。
- **原型访问器 / `Object.defineProperty` 记账**：`definegettersetterbyvalue` 与 JS 类访问器 + `gOPD`/`defineProperty` 形态同构（§7.2、§6.3）。
- **`try/catch`、`BigInt`、`new Function`、`globalThis`、`static{}`、`async/await`**：官方构建实测可编，且字节码指令形态与 JS 语义相符（§7.4）。
- **`__Common__` / `registerNamedRoute` / `observeComponentCreation2` 等编译器合成名**：在字节码里都是 `tryldglobalbyname`，与 JS 路径"挂全局"同构（§7.1 的同类证据）。

**一句话**：**R24 的答案是"对被调研的语法面，本项目的 JS 运行时结论成立；但"装饰器协议"和"平台模块"这两块的依据/结论属于 JS 路径专属，应在文档里显式标注，而不是当成真机事实。**

---

## 9. 可复现命令速查（照抄即重跑）

```bash
B=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
ES2ABC=$B/sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark/build/bin/es2abc
DISASM=$B/sdk/default/openharmony/toolchains/ark_disasm
REPO=/data/training/cli/arkui-dom-runtime
CACHE=$REPO/harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets

# ① 真产物（真 .abc）反汇编，确认 __decorate 为 0
#    ⚠️ 前提：harmony-proj 已经构建过（`entry/build/**` 是 gitignored 的构建产物目录；
#       没构建过、或构建正在进行时，loader_out/default/ets/ 可能是空的）。
#       若这里失败，直接跳到 ④ 自己构建一份。
cp $REPO/harmony-proj/entry/build/default/intermediates/loader_out/default/ets/modules.abc /tmp/m.abc
$DISASM --verbose /tmp/m.abc /tmp/m.pa && grep -c __decorate /tmp/m.pa        # → 0

# ② 单文件：同一份 .ts 走 es2abc，看装饰器直呼（只依赖 fixtures/，不依赖任何构建产物）
$ES2ABC --module --extension ts --output /tmp/V2.abc --source-file V2.ts $REPO/fixtures/pages/V2.ts
$DISASM --verbose /tmp/V2.abc /tmp/V2.pa
grep -n 'callarg1\|callargs2\|ObservedV2\|"Trace"' /tmp/V2.pa | head
grep -c __decorate /tmp/V2.pa                                                  # → 0

# ③ JS 路径对照：tsc 4.9.5 产出 __decorate
node $REPO/tools/extract.mjs $REPO/fixtures/pages/V2.ts /tmp/v2.js
grep -n '__decorate\|TaskItem = ' /tmp/v2.js | head

# ④ 官方管线复现（带装饰器页）——只在 /tmp 里改工程
cp -a $REPO/harmony-proj /tmp/hm2 && rm -rf /tmp/hm2/entry/build /tmp/hm2/.hvigor
#   （加 pages/DecoProbe.ets 并登记 main_pages.json）
cd /tmp/hm2 && timeout 560 $B/bin/hvigorw --mode module -p product=default \
  -p module=entry@default -p buildMode=debug assembleHap --no-daemon
$DISASM --verbose /tmp/hm2/entry/build/default/intermediates/loader_out/default/ets/modules.abc /tmp/dp.pa
grep -c __decorate /tmp/dp.pa                                                  # → 0
grep -n 'tryldglobalbyname.*"ObservedV2"\|tryldglobalbyname.*"Trace"' /tmp/dp.pa | head
```

---

## 10. 不确定性与未验证项（明确写出，不掩盖）

| # | 未验证的东西 | 原因 |
|---|---|---|
| 1 | **`.abc` 的实际执行语义** | CLT **没有 ArkVM**（`find … -name ark_js_vm` 为空）。本报告一切"等价/同构"都是**字节码级**判断；`try/catch` 的 `finally`、`isTrue`/`falsy` 的真值表、`ldbigint` 的运算精度等都**没有执行级证据**。 |
| 2 | **ArkUI 状态管理的真机实现**（`ObservedObject.createNew`、`ObservedPropertySimplePU`、`SynchedPropertyNesedObjectPU`、V2 装饰器函数体） | `stateMgmt*` 在 CLT 里找不到（`find $B -iname '*stateMgmt*'` 为空）；这几个名字只出现在 ets-loader 的**发射器**（`lib/pre_define.js`、`lib/process_component_member.js`）里，**没有任何实现体**。所以"`@Observed` 真机也用 Proxy"**仍是未证事实**（仓库里此说法出处见 `docs/ARCHITECTURE.md:342`，标注方式同 `CAPABILITY.md:240`）。 |
| 3 | **`definegettersetterbyvalue` 产出的 `enumerable` / `configurable`** | 需要执行 `.abc` 或 ArkVM 源码；没有。只能间接推断"必须可配置，否则真机自己的 `defineProperty` 记账会抛"。 |
| 4 | **`tryldglobalbyname` 在"全局记录 vs 全局对象"上的回退次序** | 需要 ArkVM 源码/执行。仅确认了它**会**抛 `ReferenceError`（与 JS 同名查找同构）这一层的形态。 |
| 5 | **`merge_abc` 复现 `.protoBin` 失败** | `merge_abc --input X.protoBin --output Y.abc` 只产出 120 B 的空壳（对**官方自己的** protoBin 也一样），说明我用的参数形状不对（大概要配 `--compile-context-info` / `--suffix` 或 es2abc 的 `--merge-abc`）。**这一步没做成**，但 §5 的管线判定不依赖它。 |
| 6 | **API 8 legacy 管线是否真的经 tsc** | 只观测到 `legacy_api8/src/index.js` 打包了 TypeScript 编译器（含 `decorateHelper … importName:"__decorate"`）。**没跑过 API 8 构建**。 |
| 7 | **`fixtures/` 里非 6 个真页面的产物**（如 `Observe.ts`/`V2.ts` 的实际 hvigor 构建） | 这些 `.ets` 源不在 `harmony-proj` 里（仓库只保留了 `fixtures/` 快照）。我用**同一份 `.ts` 直接过 es2abc** 得到等价结论（§6.2），并用 DecoProbe 在官方管线里做了**同量级的复核**（§6.3）。 |
| 8 | 装饰器在**子类继承 / 同名重复装饰 / 热重载**下的行为 | 未设计实验。 |
| 9 | 本报告未覆盖 `Symbol.toPrimitive`、`BigInt` 与 Number 混算、`Map/Set` 迭代序、`JSON` 边界等 | 时间预算；且这些在现有 `fixtures/` 中未出现（`grep` 确认 `BigInt`/`eval` 在 27 个 fixture 中为 0）。 |
| 10 | **快照时效** | 本报告的实测快照取于 **2026-09-21 07:01–07:17**。`harmony-proj/entry/build/**` 与 `.hvigor/**` 是**构建产物目录（gitignored）**，会被后续构建**覆盖甚至清空**（本次收尾复核时 `loader_out/default/ets/` 已被另一次构建清成空目录），所以 §4 的 diff 与 §9 步骤 ① 可能一时跑不出；**只依赖 `fixtures/` 的 §9 步骤 ②③ 与自建产物的 ④ 不受影响**。同期还有别的任务在改 `harmony-proj`（例：`pages/TransitionDemo.ets` 与 `main_pages.json` 的登记**不是本任务改的**），本任务对仓库的唯一改动就是新增 `docs/ARKVM-RESEARCH.md`。 |

---

## 11. 给后续行动的两条建议（不含代码改动）

1. **把"依据来源"写进文档，而不是把 JS 路径的依据当结论**。具体：`docs/ARCHITECTURE.md` §3.4 与 `runtime/arkui-dom-runtime.js` 的装饰器层注释，当前把"TS 4.9 的 `__decorate` 决定了各装饰器的调用形态"当作**唯一可靠依据**（`DEVELOPING.md` 步骤 1 原话："**这是唯一可靠的依据**"）。R24 的测量表明：**真机不是这个形态**（字段声明少一个实参），所以更准确的说法是"我们**选择**按 `__decorate` 的形态实现，因为这是 JS 路径实际收到的形态；真机形态见 `docs/ARKVM-RESEARCH.md`"。
2. **把 `.abc` 作为"回归基线"而不是"可执行目标"**。既然本地没有 ArkVM，可行的加固是：**在新增/修改页面的流程里加一步"产物 `.abc` 断言"**（例如"该页面的 `.abc` 里 `__decorate` 必须为 0"、"新出现的全局名必须能在 `runtime/` 里找到同名提供者"）。这类断言不需要执行字节码，只需 `es2abc + ark_disasm`，却能把"跑偏到 tsc 语义"这类回归挡住。
