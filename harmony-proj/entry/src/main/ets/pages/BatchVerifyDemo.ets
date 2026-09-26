// R67 综合验证页：批量组件抽样覆盖（只收进 SDK d.ts 且能过编译器的组件）
//   本页覆盖 13 个：FolderStack GridContainer PatternLock ContainerSpan ImageSpan
//   RichText SymbolSpan Web NavRouter Navigator ScrollBar MenuItemGroup WithTheme
//   Calendar 无 SDK 声明（Cannot find name 'Calendar'）→ 归入 batch-verify.html 的
//   runtime-only 结构验证。
//   嵌套约束按编译器强制重排（R67-① 定路径的实证）：
//     ContainerSpan 只能在 Text 内、子只 Span/ImageSpan；SymbolSpan 只在 Text 内；
//     MenuItemGroup 子只能 MenuItem；Web 必填 controller；ScrollBar 必填 scroller；
//     WithTheme 必填 options 且无 universal .id（用内层 Text 定位）
@Entry
@Component
struct BatchVerifyDemo {
  webCtrl: WebController = new WebController()
  scroller: Scroller = new Scroller()
  build() {
    Column({ space: 8 }) {
      // A: FolderStack + GridContainer
      FolderStack() {
        Text('fs').id('v-fs')
      }
      .id('v-fs-w')
      GridContainer() {
        Text('gc').id('v-gc')
      }
      .id('v-gc-w')

      // B: PatternLock
      PatternLock()
        .id('v-pl')

      // C: 文本系（编译器强制的嵌套约束）
      Text() {
        ContainerSpan() {
          ImageSpan('/test-assets/test.png')
        }
      }
      .id('v-cs-text')
      RichText('<b>rt</b>')
        .id('v-rt')
      Text() {
        SymbolSpan($r('sys.symbol.ohos_lungs'))
      }
      .id('v-ss-text')
      Web({ src: 'about:blank', controller: this.webCtrl })
        .id('v-web')

      // D: NavRouter + Navigator
      NavRouter() {
        Text('nr').id('v-nr')
      }
      .id('v-nr-w')
      Navigator()
        .id('v-nav')

      // E: ScrollBar（scroller 必填）
      ScrollBar({ scroller: this.scroller })
        .id('v-sb')

      // F: MenuItemGroup（子只能 MenuItem）+ WithTheme（无 universal .id）
      MenuItemGroup({ header: 'grp' }) {
        MenuItem({ content: 'mi1' }).id('v-mig-1')
        MenuItem({ content: 'mi2' }).id('v-mig-2')
      }
      .id('v-mig-w')
      WithTheme({}) {
        Text('wt').id('v-wt')
      }
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
