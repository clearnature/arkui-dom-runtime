// R22 收口测量/验证用页面：transition（组件**出现/消失**时的转场动画）
//
// ⚠️ 先测量再实现：本页是为了让官方编译器把 `.transition(...)` 的产物形态暴露出来。
// 覆盖两种机制（它们的**时长来源不同**，这是实现要点）：
//   ① TransitionOptions（type/opacity/translate/scale）—— 自己没有 duration/curve 字段，
//      时间参数来自【外层 animateTo】；
//   ② TransitionEffect（静态构造 + combine + animation）—— 自带 animation({duration, curve})，
//      **不需要** animateTo 包着。
// 另有 transition(effect, onFinish) 重载：onFinish 收到 transitionIn（插入=true / 删除=false）。
//
// 触发方式：`if` 分支切换 = 组件被插入/删除（这是 transition 唯一起作用的时机）。
@Entry
@Component
struct TransitionDemo {
  @State showA: boolean = true;
  @State showB: boolean = true;
  @State showC: boolean = false;
  @State showD: boolean = true;
  @State showE: boolean = true;
  @State fin: string = '';
  @State n: number = 0;

  build() {
    Column({ space: 6 }) {
      if (this.showA) {
        // ① TransitionOptions：type 默认 All；opacity/translate 描述"偏离态"
        Text('A').id('a').transition({ opacity: 0, translate: { x: 0, y: 40 } })
      }
      if (this.showB) {
        // ② TransitionEffect：combine 两段 + animation 自带参数（不依赖 animateTo）
        Text('B').id('b').transition(
          TransitionEffect.OPACITY
            .combine(TransitionEffect.translate({ x: 20, y: 0 }))
            .animation({ duration: 200, curve: Curve.Linear })
        )
      }
      if (this.showC) {
        // ③ asymmetric + onFinish 重载：出现/消失用不同效果，结束时回调带 transitionIn
        Text('C').id('c').transition(
          TransitionEffect.asymmetric(
            TransitionEffect.OPACITY.animation({ duration: 150 }),
            TransitionEffect.scale({ x: 0.2, y: 0.2 }).combine(TransitionEffect.OPACITY).animation({ duration: 250 })
          ),
          (transitionIn: boolean) => { this.fin = this.fin + (transitionIn ? 'I;' : 'D;'); }
        )
      }
      Text('fin=' + this.fin).id('fin')
      Text('n=' + this.n).id('n')
      if (this.showD) {
        // ④ 显式 type: Insert —— 只该在【出现】时动，删除时要立刻消失（不拖时间）
        Text('D').id('d').transition({ type: TransitionType.Insert, opacity: 0 })
      }
      if (this.showE) {
        // ⑤ 显式 type: Delete —— 只该在【消失】时动，插入时不带过渡
        Text('E').id('e').transition({ type: TransitionType.Delete, opacity: 0 })
      }
      Button('flipA').id('btn-a').onClick(() => {
        // A 的插入/删除发生在 animateTo 里 —— TransitionOptions 的时长就取这里
        animateTo({ duration: 300, curve: Curve.EaseInOut }, () => {
          this.showA = !this.showA;
          this.n = this.n + 1;
        })
      })
      Button('flipB').id('btn-b').onClick(() => {
        // B 不在 animateTo 里 —— TransitionEffect 自带 animation 参数，应当照样动
        this.showB = !this.showB;
        this.n = this.n + 1;
      })
      Button('flipC').id('btn-c').onClick(() => {
        this.showC = !this.showC;
        this.n = this.n + 1;
      })
      Button('flipD').id('btn-d').onClick(() => {
        animateTo({ duration: 300, curve: Curve.Linear }, () => {
          this.showD = !this.showD;
        })
      })
      Button('flipE').id('btn-e').onClick(() => {
        animateTo({ duration: 300, curve: Curve.Linear }, () => {
          this.showE = !this.showE;
        })
      })
      Button('reA').id('btn-reA').onClick(() => {
        // 只改 n（A 的 if 条件不变）→ A 应当**不**被插入/删除，也就没有转场
        this.n = this.n + 1;
      })
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
