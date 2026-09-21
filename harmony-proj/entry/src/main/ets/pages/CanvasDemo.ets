// R31 测量/验证用页面：表层类 **Canvas**（真实 2D context）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① Canvas(this.context) —— create 参数是 CanvasRenderingContext2D 对象
//   ② new CanvasRenderingContext2D(settings) —— settings 来自 RenderingContextSettings
//   ③ Canvas.onReady(cb) —— 画布可用后触发（绘制必须等它）
//   ④ ctx.fillStyle/fillRect/getImageData/toDataURL —— CanvasRenderer 通用 2D 面
//
// DOM 映射目标：手写 Canvas → 原生 <canvas>；ctx 转发到原生 2D context——
// 像素断言（getImageData 读回）天然有牙齿。
@Entry
@Component
struct CanvasDemo {
  @State log: string = '';
  settings: RenderingContextSettings = new RenderingContextSettings(true);
  context: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);

  build() {
    Column({ space: 8 }) {
      Canvas(this.context)
        .id('cv1')
        .width(200)
        .height(100)
        .onReady(() => {
          // 像素断言的两块矩形：红块与绿块（坐标钉在测试里）
          this.context.fillStyle = '#ff0000';
          this.context.fillRect(10, 20, 30, 40);
          this.context.fillStyle = '#00cc00';
          this.context.fillRect(100, 10, 20, 20);
          this.log = this.log + 'RDY;';
        })

      Button('probe').id('probe-btn').onClick(() => {
        // getImageData 读回像素（填充区/背景区各采一点）
        const r = this.context.getImageData(15, 25, 1, 1);
        this.log = this.log + 'R' + r.data[0] + '/' + r.data[1] + '/' + r.data[2] + ';';
        const g = this.context.getImageData(110, 15, 1, 1);
        this.log = this.log + 'G' + g.data[1] + ';';
        const url = this.context.toDataURL();
        this.log = this.log + 'URL' + (url.indexOf('data:image/png;base64,') === 0 ? 1 : 0) + ';';
      })

      Text(this.log).id('cv-log')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
