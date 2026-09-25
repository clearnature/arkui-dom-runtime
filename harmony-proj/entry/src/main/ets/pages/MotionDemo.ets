// R66 测量/验证用页面：ScrollBar 滚动条（scroller 绑定 / 方向 / BarState / 嵌套滚动）
//   ① A：子组件滑块版（scroll_bar.d.ts Example 1 口径）——Text 16×48 即滑块，BarState.On 常显
//   ② B：默认样式版（API12+ 无子组件显示默认滑块）
//   ③ C：BarState.Off 关闭版（组件隐藏）
//   行高/视口均为固定值，断言数字可精确预期：
//     A 视口160 行320 可滚160，滑块48 → 行程112；scrollBy(0,80) → 位移 56px
//     B 视口120 行200 可滚80，滑块 max(24, 120×120/200)=72 → 行程48；scrollBy(0,80) → 位移 48px
//   （动效族 Animator/FrictionMotion/ScrollMotion/SpringMotion/SpringProp/GeometryView 为
//     atomic 原子件（ets-loader components/*.json，animator.json 标 systemApi），应用态源码
//     不可引用——由 test/motiondemo.html 直探运行时全局验证。）
@Entry
@Component
struct MotionDemo {
  @State log: string = '';
  scrollerA: Scroller = new Scroller();
  scrollerB: Scroller = new Scroller();
  scrollerC: Scroller = new Scroller();

  build() {
    Column({ space: 12 }) {
      Stack() {
        Scroll(this.scrollerA) {
          Column() {
            Text('A-0').height(40).width(200)
            Text('A-1').height(40).width(200)
            Text('A-2').height(40).width(200)
            Text('A-3').height(40).width(200)
            Text('A-4').height(40).width(200)
            Text('A-5').height(40).width(200)
            Text('A-6').height(40).width(200)
            Text('A-7').height(40).width(200)
          }
        }
        .id('sc-a')
        .width(200)
        .height(160)
        .scrollBar(BarState.Off)

        ScrollBar({ scroller: this.scrollerA, direction: ScrollBarDirection.Vertical, state: BarState.On }) {
          Text().width(16).height(48).borderRadius(8).backgroundColor('#C0C0C0')
        }
        .id('sb-a')
        .width(20)
        .height(160)
        .backgroundColor('#ededed')
        .enableNestedScroll(true)
      }

      Stack() {
        Scroll(this.scrollerB) {
          Column() {
            Text('B-0').height(40).width(200)
            Text('B-1').height(40).width(200)
            Text('B-2').height(40).width(200)
            Text('B-3').height(40).width(200)
            Text('B-4').height(40).width(200)
          }
        }
        .id('sc-b')
        .width(200)
        .height(120)
        .scrollBar(BarState.Off)

        ScrollBar({ scroller: this.scrollerB, direction: ScrollBarDirection.Vertical, state: BarState.On })
          .id('sb-b')
          .width(12)
          .height(120)
          .enableNestedScroll(true)
      }

      Stack() {
        Scroll(this.scrollerC) {
          Column() {
            Text('C-0').height(40).width(200)
            Text('C-1').height(40).width(200)
            Text('C-2').height(40).width(200)
          }
        }
        .id('sc-c')
        .width(200)
        .height(100)
        .scrollBar(BarState.Off)

        ScrollBar({ scroller: this.scrollerC, direction: ScrollBarDirection.Vertical, state: BarState.Off })
          .id('sb-c')
          .width(12)
          .height(100)
      }

      Text(this.log).id('md-log').fontSize(12)
    }
    .width('100%')
    .padding(8)
  }
}
