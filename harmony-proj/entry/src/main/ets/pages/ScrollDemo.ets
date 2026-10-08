// R46 测量/验证用页面：Scroll 滚动容器（真实 overflow 基座 + Scroller 控制器 + 滚动条）
//   ① 基座：200px 视口装 12×40px 内容 → 可滚 280px；scrollBar(Off) 隐藏滚动条
//   ② Scroller：scrollTo({xOffset,yOffset}) / scrollBy / scrollEdge(Edge.Top) / currentOffset
//   ③ 事件：onScroll(x,y) / onScrollEdge(side) / onScrollEnd（DOM 化收口为滚动静默 80ms）
//   ④ R172：sc2 + 600 行 ForEach → 过 C1-v2 窗口化闸门；scrollToIndex 经引擎
//      meta.windowItems 取窗口行对齐（隔离在独立 scroller2，不污染 sc1 事件日志）
// 行高与视口都是固定值，断言数字可精确预期。
@Entry
@Component
struct ScrollDemo {
  @State log: string = '';
  @State big: string[] = [];
  scroller: Scroller = new Scroller();
  scroller2: Scroller = new Scroller();

  aboutToAppear() {
    const arr: string[] = [];
    for (let i = 0; i < 600; i++) {
      arr.push('fs' + i);
    }
    this.big = arr;
  }

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

      Scroll(this.scroller2) {
        Column({ space: 0 }) {
          ForEach(this.big, (it: string) => {
            Text(it).id(it).height(40).width(200)
          }, (it: string) => it)
        }
      }
      .id('sc2')
      .width(240)
      .height(200)
      .scrollable(ScrollDirection.Vertical)
      .scrollBar(BarState.Off)

      Button('si500').id('btn-si').onClick(() => {
        this.scroller2.scrollToIndex(500);
      })
      Text(this.log).id('sc-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
