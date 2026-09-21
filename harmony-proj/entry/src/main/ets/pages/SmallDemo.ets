// R36 测量/验证用页面：**Flex / Span / LoadingProgress / Blank**（小件收官第一批）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① Flex({direction, wrap, justifyContent, alignItems}) —— 与 CSS 同名对齐
//   ② Span（Text 内联子段）—— fontColor/fontSize/decoration
//   ③ LoadingProgress —— color/enableLoading（spinner）
//   ④ Blank —— flex 占位（Row/Column 里的空白填充）
@Entry
@Component
struct SmallDemo {
  build() {
    Column({ space: 8 }) {
      Flex({ direction: FlexDirection.Row, justifyContent: FlexAlign.SpaceBetween, alignItems: ItemAlign.Center }) {
        Text('L').id('fx-l')
        Blank().id('fx-blank')
        Text('R').id('fx-r')
      }
      .id('fx1')
      .width(200)
      .backgroundColor('#f0f0f0')

      Text() {
        Span('normal')
        Span(' red').id('sp1').fontColor(Color.Red).fontSize(18)
        Span(' under').id('sp2').decoration({ type: TextDecorationType.Underline, color: Color.Blue })
      }
      .id('tx1')

      LoadingProgress()
        .id('lp1')
        .width(48)
        .height(48)
        .color(Color.Blue)

      Blank()
        .id('bk1')
        .color('#00ff00')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
