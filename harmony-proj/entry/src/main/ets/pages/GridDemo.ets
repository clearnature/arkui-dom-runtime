// R57 测量/验证用页面：Grid 网格（columnsTemplate 两列 + GridItem + 滚动事件族）
//   ① 基座：display:grid + 2×'1fr' 列、6 个 GridItem（高 60）→ 内容 180、视口 150、可滚 30
//   ② 事件：onScrollIndex(first,last) 区间变才发；onReachEnd 过境判定（WaterFlow 同族收口）
//   ③ GridItem 跨列：columnStart/columnEnd → CSS grid-column（第 6 项跨满两列）
@Entry
@Component
struct GridDemo {
  @State log: string = '';
  scroller: Scroller = new Scroller();

  build() {
    Column({ space: 8 }) {
      Grid(this.scroller) {
        GridItem() {
          Text('g0').id('g0')
        }.height(60)
        GridItem() {
          Text('g1')
        }.height(60)
        GridItem() {
          Text('g2')
        }.height(60)
        GridItem() {
          Text('g3')
        }.height(60)
        GridItem() {
          Text('g4')
        }.height(60)
        GridItem() {
          Text('g5').id('g5')
        }
        .height(60)
        .columnStart(1)
        .columnEnd(2)
      }
      .id('gd')
      .width(240)
      .height(150)
      .columnsTemplate('1fr 1fr')
      .columnsGap(0)
      .rowsGap(0)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      .onScrollIndex((first: number, last: number) => {
        this.log = this.log + 'I' + first + ',' + last + ';';
      })
      .onReachEnd(() => {
        this.log = this.log + 'RE;';
      })

      Button('by60').id('btn-by').onClick(() => {
        this.scroller.scrollBy(0, 60);
      })
      Button('toEnd').id('btn-end').onClick(() => {
        this.scroller.scrollEdge(Edge.Bottom);
      })
      Text(this.log).id('gd-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
