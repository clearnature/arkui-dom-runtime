// R65 测量/验证用页面：RichEditor（contenteditable）+ Video（HTML video 垫片）
//   ① RichEditor：contenteditable 基座；onReady 触发；placeholder
//   ② Video：src + controls(false) + autoPlay(false) + muted(true) → <video> 原生垫片
@Entry
@Component
struct RichVideoDemo {
  @State log: string = '';
  controller: VideoController = new VideoController();
  richCtrl: RichEditorController = new RichEditorController();

  build() {
    Column({ space: 8 }) {
      RichEditor({ controller: this.richCtrl })
        .id('re')
        .placeholder('edit here')
        .onReady(() => {
          this.log = this.log + 'RD;';
        })

      Video({ controller: this.controller })
        .id('vd')
        .controls(false)
        .autoPlay(false)
        .muted(true)

      Text(this.log).id('rv-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
