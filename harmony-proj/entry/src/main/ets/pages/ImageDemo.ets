// R45 测量/验证用页面：Image 组件（真实 <img> 基座 + objectFit + alt 占位 + 加载回调）
//   ① objectFit 对照：同一张 7:3 图放进 2:1 的框，Contain / Cover 呈现差异
//   ② alt 占位 + onError：404 的图 → onError 派发，alt 图顶上
//   ③ onComplete：真实解码尺寸进回调载荷（known-13x5.png = 13×5）
// 资产来自仓库 test-assets/（known-7x3.png 等为已知尺寸的测量件，见 measimage）。
@Entry
@Component
struct ImageDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      // ① objectFit 两档对照：7:3 的图放进 2:1 的框
      Image('/test-assets/known-7x3.png')
        .id('im1')
        .width(120)
        .height(60)
        .objectFit(ImageFit.Contain)

      Image('/test-assets/known-7x3.png')
        .id('im2')
        .width(120)
        .height(60)
        .objectFit(ImageFit.Cover)

      // ② 404 图：onError 派发 + alt 占位顶上
      Image('/test-assets/does-not-exist.png')
        .id('im3')
        .width(60)
        .height(60)
        .alt('/test-assets/known-1x1.png')
        .onError(() => {
          this.log = this.log + 'ERR;';
        })

      // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
      Image('/test-assets/known-13x5.png')
        .id('im4')
        .width(100)
        .height(50)
        .syncLoad(true)
        .onComplete((msg) => {
          if (msg) {
            this.log = this.log + 'C' + msg.width + 'x' + msg.height + ';';
          }
        })

      Text(this.log).id('im-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
