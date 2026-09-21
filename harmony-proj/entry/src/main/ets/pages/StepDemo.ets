// R37 测量/验证用页面：**Stepper / StepperItem**（分步器）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① Stepper({index: 0}) —— 容器（StepperItem 子组件即分步页）
//   ② StepperItem.prevLabel/nextLabel/status —— status = ItemState（Normal/Skip/Waiting）
//   ③ onChange((prevIndex, index))／onNext/onPrevious/onFinish/onSkip 的事件归属与参数
//
// DOM 映射：Stepper → 容器 + 内置 ←/→ 导航条（点击切页派发回调）；StepperItem = 分步页。
// ItemState.Skip 的页：点 nextLabel 触发 onSkip 而非 onNext（.d.ts 原文语义）。
@Entry
@Component
struct StepDemo {
  @State log: string = '';
  @State idx: number = 0;

  build() {
    Column({ space: 8 }) {
      Stepper({ index: 0 }) {
        StepperItem() {
          Text('step0').id('st0')
        }
        .prevLabel('back0')
        .nextLabel('next0')

        StepperItem() {
          Text('step1').id('st1')
        }
        .nextLabel('next1')
        .status(ItemState.Skip)

        StepperItem() {
          Text('step2').id('st2')
        }
      }
      .id('sp1')
      .width(300)
      .height(200)
      .onChange((p: number, i: number) => { this.log = this.log + 'CHG' + p + '>' + i + ';'; this.idx = i; })
      .onNext((i: number, p: number) => { this.log = this.log + 'NEXT' + i + ',' + p + ';'; })
      .onPrevious((i: number, p: number) => { this.log = this.log + 'PREV' + i + ',' + p + ';'; })
      .onSkip(() => { this.log = this.log + 'SKIP;'; })
      .onFinish(() => { this.log = this.log + 'FIN;'; })

      Button('toLast').id('to-btn').onClick(() => {
        //Stepper 不暴露 controller；切换走内置导航
      })
      Text(this.log).id('st-log')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
