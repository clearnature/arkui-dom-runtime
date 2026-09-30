// R66 测量/验证用页面：批量输入 **CheckboxGroup / PatternLock**（R147 裁定：
//   SelectionContainer / ColorPicker / ColorPickerDialog / Option 四族不在 CLT 26
//   SDK（页头原注释已预言"编译期报红按头注逐块注释"）——裁段后登记 main_pages
//   重构建入阵；被裁组件在 runtime/src/batch-input.js 仍有语义层与 batchverify 覆盖）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① CheckboxGroup({group}) + selectAll/selectedColor/checkboxShape +
//      onChange({name: string[], status})；组员 Checkbox({name, group})
//   ② PatternLock(controller) + sideLength/circleRadius/pathColor/autoReset +
//      onDotConnect(i) / onPatternComplete(Array<number>)；控制器 reset/setChallengeResult
//
// 现状画像：组件此前只有 149 骨架表的 div 空壳；R66 补语义层（runtime/src/batch-input.js）。
@Entry
@Component
struct BatchInputDemo {
  @State cgLog: string = '';
  @State plLog: string = '';
  private ctrl: PatternLockController = new PatternLockController();

  build() {
    Column({ space: 8 }) {
      // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
      CheckboxGroup({ group: 'fruits' })
        .id('cg1')
        .selectAll(false)
        .selectedColor('#007dff')
        .checkboxShape(CheckBoxShape.CIRCLE)
        .onChange((res: CheckboxGroupResult) => {
          this.cgLog = this.cgLog + 'CG' + res.name.length + '/' + res.status + ';';
        })
      Checkbox({ name: 'apple', group: 'fruits' })
        .id('cb-apple')
      Checkbox({ name: 'banana', group: 'fruits' })
        .id('cb-banana')

      // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
      PatternLock(this.ctrl)
        .id('pl1')
        .sideLength(240)
        .circleRadius(12)
        .pathColor('#ff6600')
        .autoReset(false)
        .onDotConnect((idx: number) => { this.plLog = this.plLog + 'D' + idx + ';'; })
        .onPatternComplete((input: Array<number>) => {
          this.plLog = this.plLog + 'P' + input.join('') + ';';
        })

      Text(this.cgLog).id('cg-log').fontSize(12).height(20)
      Text(this.plLog).id('pl-log').fontSize(12).height(20)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
