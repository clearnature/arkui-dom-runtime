# @clearnature/arkui-dom-runtime — 接入指南

让 ArkUI 页面跑在浏览器与 Electron 上：复用官方 ets-loader 工具链的 ViewPU 中间产物，
在 DOM/CSS 上执行 ArkUI 运行时。本包是运行时引擎 + 编译器 CLI，不含任何项目页面。

> 术语口径：ArkTS 源码（.ets，声明式 `@Component`）→ **官方 hvigorw/ets-loader 编译**
> → ViewPU 中间产物（.ts，`class XxxPage extends ViewPU`）→ **本包 `arkui-extract`**
> → 浏览器可跑的 JS module。`.ets → ViewPU` 前端始终是华为官方工具链，本包不复制它。

## 安装

```bash
npm install @clearnature/arkui-dom-runtime
```

GitHub Packages 源（项目 `.npmrc` 或全局配置一次）：

```
@clearnature:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<read:packages PAT>
```

> 可见性：GPR 包发布后默认 private——维护者在 GitHub → Packages → 包设置里
> 一次性切 Public 后，`<read:packages PAT>` 即可换成任意账号的 PAT（匿名安装
> 不可用是 GPR 平台限制）。npmjs.org 公共源待维护者提供 NPM_TOKEN 后接入。

## 包内容

| 路径 | 是什么 |
|---|---|
| `runtime/arkui-dom-runtime.js` | 引擎内核（`runtime/src/` 分片拼接产物） |
| `runtime/generated-components.js` | 组件声明面（生成物） |
| `runtime/ohos-shims.js` | `@ohos.*` 平台能力垫片 |
| `bin/arkui-extract.mjs` | 编译器 CLI（ViewPU .ts → JS module） |
| `test/vendor/typescript-4.9.5-r4.lib.cjs` | 编译器内嵌 TS（华为补丁版，Apache-2.0） |

运行时零 npm 依赖；宿主是任意现代浏览器（Chromium/Firefox/WebKit）或 Electron。

## 接入四步

**① 编译页面**：把 hvigorw 产出的 ViewPU .ts 交给 CLI：

```bash
npx arkui-extract pages/MyPage.ts build/my-page-module.js --cjs --register MyPage
```

（`--register <Name>` 把产物包成 `__arkui_dom_defineCommonJS` 自注册模块，
运行时经 `requireModule('MyPage')` 取用；产物内的 `registerNamedRoute(...)` 完成
`pages/MyPage` 路由登记。）

**② 宿主 HTML**：三件 runtime 脚本 + 编译产物按序直挂：

```html
<div id="root"></div>
<script src="node_modules/@clearnature/arkui-dom-runtime/runtime/arkui-dom-runtime.js"></script>
<script src="node_modules/@clearnature/arkui-dom-runtime/runtime/generated-components.js"></script>
<script src="node_modules/@clearnature/arkui-dom-runtime/runtime/ohos-shims.js"></script>
<script src="build/my-page-module.js"></script>
<script>
  __arkui_dom_requireModule('MyPage');
  __arkui_dom_loadRoute('pages/MyPage', document.getElementById('root'));
</script>
```

**③ 状态管理**：页面内 `@State/@Prop/@Link/@Provide/@Consume/@Observed/@ObjectLink`
与 V2（`@Local/@Param/@Trace/@Monitor/@Computed/@Reusable`）语义由引擎实现——
写法与鸿蒙侧一致（产自同一编译链），无需本包侧处理。

**④ 平台能力**：`@ohos.router/@ohos.promptAction/@ohos.file.fs/@ohos.media…` 等
垫片面见引擎仓 `docs/CAPABILITY.md`（逐条断言出处）；不支持面（platform-only）
如实列在 `docs/DEVICE-DIFF.md`。

## 版本与兼容

- 版本随引擎仓 tag（1.0.0 = 首个里程碑）；patch 只修不破。
- 引擎仓五端矩阵（Chromium/Electron/Firefox/WebKitGTK/Android WebView）+
  Windows CI 每提交全绿；Linux runner Ubuntu 26.04。

## License

MIT（engine）；内嵌 vendor TypeScript 为 Apache-2.0（见 THIRD-PARTY-NOTICES.md）。
