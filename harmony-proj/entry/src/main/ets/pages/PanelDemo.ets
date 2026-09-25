// R63 测量/验证用页面：Panel 底部滑出面板（mode + dragBar + onChange/onHeightChange）
//   ① 基座：mode Half（半屏）、dragBar true；面板从底部弹出
//   ② onChange(mode: PanelMode) / onHeightChange(height: number) 事件
@Entry
@Component
struct PanelDemo {
  @State log: string = '';
  @State hVal: number = 0;

  build() {
    Column({ space: 8 }) {
      Panel(true) {
        Text('panel body').id('pn-body')
      }
      .id('pn')
      .mode(PanelMode.Half)
      .dragBar(true)
      .onChange((mode: PanelMode) => {
        this.log = this.log + 'M' + mode + ';';
      })
      .onHeightChange((h: number) => {
        this.hVal = h;
      })

      Text('h=' + this.hVal).id('pn-h').fontSize(12)
      Text(this.log).id('pn-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
