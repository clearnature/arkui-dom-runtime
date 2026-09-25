// R66 测量/验证用页面：批量输入收官 **CheckboxGroup / PatternLock / SelectionContainer
//   / ColorPicker / ColorPickerDialog / Option**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① CheckboxGroup({group}) + selectAll/selectedColor/checkboxShape +
//      onChange({name: string[], status})；组员 Checkbox({name, group})
//   ② PatternLock(controller) + sideLength/circleRadius/pathColor/autoReset +
//      onDotConnect(i) / onPatternComplete(Array<number>)；控制器 reset/setChallengeResult
//   ③ SelectionContainer({controller}) + copyOption/selectedBackgroundColor/textJoinStyle +
//      onTextSelectionChange(Array<string>) / onCopy(string)；子级 Span
//   ④ Option({value})（ets-loader option.json：parents=[Menu]，attrs=字体四件）——
//      ⚠️ 本 SDK 安装无 option.d.ts，若编译期报红按头注逐块注释（见 runtime/src/batch-input.js）
//   ⑤ ColorPicker + colors/onSelect/setColunms（SDK 原始拼写）—— 同上无 d.ts
//   ⑥ ColorPickerDialog + show —— 同上无 d.ts
//
// 现状画像：六组件此前只有 149 骨架表的 div 空壳；本轮补语义层（runtime/src/batch-input.js）。
@Entry
@Component
struct BatchInputDemo {
  @State cgLog: string = '';
  @State plLog: string = '';
  @State scLog: string = '';
  @State cpLog: string = '';
  @State showDlg: boolean = false;
  private ctrl: PatternLockController = new PatternLockController();
  private selCtrl: SelectionContainerController = new SelectionContainerController();

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

      // ③ SelectionContainer：可选中文本容器（多 Span 选择/复制）
      SelectionContainer({ controller: this.selCtrl })
        .id('sc1')
        .copyOption(CopyOptions.InApp)
        .selectedBackgroundColor('#b4d8ff')
        .textJoinStyle(SelectionContainerTextJoinStyle.DIRECT)
        .onTextSelectionChange((texts: Array<string>) => {
          this.scLog = this.scLog + 'S' + texts.length + ';';
        })
        .onCopy((content: string) => { this.scLog = this.scLog + 'C' + content + ';'; }) {
        Span('alpha').id('sp-alpha')
        Span('beta').id('sp-beta')
      }

      // ④ Option：Menu 内菜单项 + 字体四件（选中由点击落 data-*，事件冒泡给宿主）
      Menu() {
        Option({ value: 'opt-a' })
          .id('opt-a')
          .fontColor('#0066cc')
          .fontSize(14)
        Option({ value: 'opt-b' })
          .id('opt-b')
          .fontWeight(FontWeight.Bold)
      }
      .id('mn-opt')

      // ⑤ ColorPicker：色块阵 + 选择回调（setColunms 用 SDK 原始拼写）
      ColorPicker()
        .id('cp1')
        .colors(['#ff0000', '#00ff00', '#0000ff'])
        .setColunms(3)
        .onSelect((color: string) => { this.cpLog = this.cpLog + 'CP' + color + ';'; })

      // ⑥ ColorPickerDialog：遮罩对话框，show 由 @State 驱动（测试点按钮走真实属性路径）
      Button('dlg')
        .id('btn-dlg')
        .onClick(() => { this.showDlg = !this.showDlg; })
      ColorPickerDialog()
        .id('cpd1')
        .colors(['#123456', '#654321'])
        .show(this.showDlg)

      Text(this.cgLog).id('cg-log').fontSize(12).height(20)
      Text(this.plLog).id('pl-log').fontSize(12).height(20)
      Text(this.scLog).id('sc-log').fontSize(12).height(20)
      Text(this.cpLog).id('cp-log').fontSize(12).height(20)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
