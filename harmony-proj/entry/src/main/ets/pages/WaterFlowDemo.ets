// R53 测量/验证用页面：WaterFlow 瀑布流（JS 绝对定位排布复刻真机换列算法）
//   ① 基座：240×150 视口、columnsTemplate('1fr 1fr') 两列 120px、默认 scrollBar Off / edgeEffect None
//   ② 换列：空列优先 → 累计主轴严格最小 → 平高保左列（water_flow_layout_info.cpp:271-298）
//   ③ 高度 60/90/60/40/80/50/70/70 → 列0=[f0,f2,f4,f7]end270 列1=[f1,f3,f5,f6]end250，内容高 270、可滚 120
//   ④ 事件时序照真机 TriggerPostLayoutEvents：onScroll → onScrollIndex → onReachStart/onReachEnd；
//      onScrollIndex/onReachStart 首帧必发；onScrollStart/Stop 为 DOM 近似（首个滚动事件 / 80ms 静默收口）
@Entry
@Component
struct WaterFlowDemo {
  @State log: string = '';
  scroller: Scroller = new Scroller();

  build() {
    Column({ space: 8 }) {
      WaterFlow({ scroller: this.scroller }) {
        FlowItem() {
          Text('f0').id('f0')
        }.height(60).width(120)
        FlowItem() {
          Text('f1')
        }.height(90).width(120)
        FlowItem() {
          Text('f2')
        }.height(60).width(120)
        FlowItem() {
          Text('f3')
        }.height(40).width(120)
        FlowItem() {
          Text('f4').id('f4')
        }.height(80).width(120)
        FlowItem() {
          Text('f5')
        }.height(50).width(120)
        FlowItem() {
          Text('f6')
        }.height(70).width(120)
        FlowItem() {
          Text('f7')
        }.height(70).width(120)
      }
      .id('wf')
      .width(240)
      .height(150)
      .columnsTemplate('1fr 1fr')
      .columnsGap(0)
      .rowsGap(0)
      .edgeEffect(EdgeEffect.None)
      .onScrollIndex((first: number, last: number) => {
        this.log = this.log + 'I' + first + ',' + last + ';';
      })
      .onReachStart(() => {
        this.log = this.log + 'RS;';
      })
      .onReachEnd(() => {
        this.log = this.log + 'RE;';
      })
      .onScroll((offset: number, state: ScrollState) => {
        this.log = this.log + 'D' + Math.round(offset) + ';';
      })
      .onScrollStart(() => {
        this.log = this.log + 'SS;';
      })
      .onScrollStop(() => {
        this.log = this.log + 'SE;';
      })

      Button('by60').id('btn-by').onClick(() => {
        this.scroller.scrollBy(0, 60);
      })
      Button('idx4').id('btn-idx').onClick(() => {
        this.scroller.scrollToIndex(4);
      })
      Button('toTop').id('btn-top').onClick(() => {
        this.scroller.scrollEdge(Edge.Top);
      })
      Button('toBot').id('btn-bot').onClick(() => {
        this.scroller.scrollEdge(Edge.Bottom);
      })
      Button('where').id('btn-w').onClick(() => {
        const o = this.scroller.currentOffset();
        this.log = this.log + '@' + Math.round(o.yOffset) + ';';
      })
      Text(this.log).id('wf-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
