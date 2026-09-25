// R66 测量/验证用页面：batch-media 六件（ContainerSpan / ImageSpan / RichText /
//      SymbolGlyph / SymbolSpan / Web）
//   ① Text 内联族：ContainerSpan 包裹 Span + ImageSpan，textBackgroundStyle 统一背景圆角
//   ② SymbolGlyph：独立符号图标（名字/字号/首色/renderingStrategy/effectStrategy）
//   ③ SymbolSpan：Text 内联符号子段（继承父 Text 字体）
//   ④ RichText：HTML 内容独立渲染 + onStart/onComplete
//   ⑤ Web：src 加载 + onPageBegin/onPageEnd/onTitleReceive + WebController.runJavaScript
//   断言面见 test/batchmediademo.html（log 流：IC7x3 / RS / RC / WB / WE / WTprobe / WJ2）
@Entry
@Component
struct BatchMediaDemo {
  @State log: string = '';
  webCtrl: WebController = new WebController();

  build() {
    Column({ space: 8 }) {
      // ① 内联族：ContainerSpan 统一背景圆角，ImageSpan 内联图，SymbolSpan 内联符号
      Text() {
        ContainerSpan() {
          Span('A')
            ImageSpan('/test-assets/known-7x3.png')
            .id('is1')
            .width(40)
            .height(24)
            .verticalAlign(ImageSpanAlignment.CENTER)
            .objectFit(ImageFit.Contain)
            .onComplete((res: ImageLoadResult) => {
              this.log = this.log + `IC${res.width}x${res.height};`;
            })
          SymbolSpan($r('sys.symbol.ohos_star'))
            .id('ss1')
            .fontSize(20)
        }
        .id('cs1')
        .textBackgroundStyle({ color: '#ffe0b2', radius: 6 })
        Span('B')
      }
      .id('t1')
      .fontSize(14)

      // ② 独立符号图标
      SymbolGlyph($r('sys.symbol.ohos_wifi'))
        .id('sg1')
        .fontSize(24)
        .fontColor(['#ff0000'])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)
        .effectStrategy(SymbolEffectStrategy.SCALE)

      // ③ HTML 内容独立渲染
      RichText('<p id="rt-p">hi</p>')
        .id('rt1')
        .width('100%')
        .height(48)
        .onStart(() => {
          this.log = this.log + 'RS;';
        })
        .onComplete(() => {
          this.log = this.log + 'RC;';
        })

      // ④ Web 页面加载 + 控制器
      Web({ src: '/test-assets/web-probe.html', controller: this.webCtrl })
        .id('wb1')
        .width('100%')
        .height(80)
        .onPageBegin(() => {
          this.log = this.log + 'WB;';
        })
        .onPageEnd(() => {
          this.log = this.log + 'WE;';
        })
        .onTitleReceive((e: OnTitleReceiveEvent) => {
          this.log = this.log + `WT${e.title};`;
        })
        .onControllerAttached(() => {
          const r: string = this.webCtrl.runJavaScript('1+1') as string;
          this.log = this.log + `WJ${r};`;
        })

      Text(this.log)
        .id('bm-log')
        .fontSize(12)
    }
    .width('100%')
    .padding(8)
  }
}
