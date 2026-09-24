// R46 测量/验证用页面：Scroll 滚动容器（真实 overflow 基座 + Scroller 控制器 + 滚动条）
//   ① 基座：200px 视口装 12×40px 内容 → 可滚 280px；scrollBar(Off) 隐藏滚动条
//   ② Scroller：scrollTo({xOffset,yOffset}) / scrollBy / scrollEdge(Edge.Top) / currentOffset
//   ③ 事件：onScroll(x,y) / onScrollEdge(side) / onScrollEnd（DOM 化收口为滚动静默 80ms）
// 行高与视口都是固定值，断言数字可精确预期。
@Entry
@Component
struct ScrollDemo {
  @State log: string = '';
  scroller: Scroller = new Scroller();

  build() {
    Column({ space: 8 }) {
      Scroll(this.scroller) {
        Column({ space: 0 }) {
          Text('row-0').id('r0').height(40).width(200)
          Text('row-1').height(40).width(200)
          Text('row-2').height(40).width(200)
          Text('row-3').height(40).width(200)
          Text('row-4').height(40).width(200)
          Text('row-5').height(40).width(200)
          Text('row-6').height(40).width(200)
          Text('row-7').height(40).width(200)
          Text('row-8').height(40).width(200)
          Text('row-9').height(40).width(200)
          Text('row-10').height(40).width(200)
          Text('row-11').id('r11').height(40).width(200)
        }
      }
      .id('sc1')
      .width(240)
      .height(200)
      .scrollable(ScrollDirection.Vertical)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      .onScroll((xOffset: number, yOffset: number) => {
        this.log = this.log + 'S' + Math.round(yOffset) + ';';
      })
      .onScrollEdge((side: Edge) => {
        this.log = this.log + 'E:' + side + ';';
      })
      .onScrollEnd(() => {
        this.log = this.log + 'END;';
      })

      Button('toBottom').id('btn-b').onClick(() => {
        this.scroller.scrollTo({ xOffset: 0, yOffset: 9999 });
      })
      Button('by60').id('btn-by').onClick(() => {
        this.scroller.scrollBy(0, 60);
      })
      Button('toTop').id('btn-t').onClick(() => {
        this.scroller.scrollEdge(Edge.Top);
      })
      Button('where').id('btn-w').onClick(() => {
        const o = this.scroller.currentOffset();
        this.log = this.log + '@' + Math.round(o.yOffset) + ';';
      })
      Text(this.log).id('sc-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
