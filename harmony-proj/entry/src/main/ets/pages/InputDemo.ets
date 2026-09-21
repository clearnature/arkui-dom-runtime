// R27 测量/验证用页面：输入类 **Checkbox / Radio / Toggle / Slider**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① create 参数形态：Checkbox(name?) / Radio({name, value, group}) /
//      Toggle({type}) / Slider({value, min, max, step, style})
//   ② 属性方法形态：Checkbox.select(bool) / .selectedColor(Color) / .unselectedColor /
//      Radio.checked(bool) / Toggle.select(bool) / Slider 的 blockColor/trackColor/showTips
//   ③ onChange 的回调参数形态（Checkbox→bool、Slider→{value, mode}）
//   ④ ToggleType / SliderStyle 枚举是不是自由变量
//
// 现状画像（生成的骨架）：已映射原生控件 —— Checkbox/Radio → input[type=checkbox/radio]、
// Toggle → input[type=checkbox]、Slider → input[type=range]。本轮要做的是 ArkUI 语义层：
// 选中态/颜色/回调参数/枚举。
@Entry
@Component
struct InputDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
      Checkbox({ name: 'cb1' })
        .id('ck1')
        .select(true)
        .selectedColor(Color.Red)
        .onChange((on: boolean) => { this.log = this.log + 'CK' + on + ';'; })

      // ② Checkbox 编程切换（测试点 change(false)）
      Checkbox({ name: 'ck2' })
        .id('ck2')
        .onChange((b: boolean) => { this.log = this.log + 'CK' + b + ';'; })

      // ③ Radio：组内互斥（两个同 group）。⚠️ RadioOptions = {value, group}，没有 name（编译期实测）
      Radio({ value: 'a', group: 'g1' })
        .id('rd1')
        .checked(true)
        .onChange((b: boolean) => { this.log = this.log + 'RD' + b + ';'; })
      Radio({ value: 'b', group: 'g1' })
        .id('rd2')
        .onChange((b: boolean) => { this.log = this.log + 'RD' + b + ';'; })

      // ④ Toggle：Switch 形态。⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn
      Toggle({ type: ToggleType.Switch, isOn: true })
        .id('tg1')
        .selectedColor(Color.Green)
        .onChange((b: boolean) => { this.log = this.log + 'TG' + b + ';'; })

      // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
      Slider({ value: 40, min: 0, max: 100, step: 10 })
        .id('sl1')
        .blockColor(Color.Blue)
        .trackColor('#dddddd')
        .selectedColor(Color.Orange)
        .showTips(true)
        .onChange((v: number, mode: SliderChangeMode) => { this.log = this.log + 'SL' + v + '/' + mode + ';'; })
        .width(200)

      Text(this.log).id('in-log').fontSize(12).height(24)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
