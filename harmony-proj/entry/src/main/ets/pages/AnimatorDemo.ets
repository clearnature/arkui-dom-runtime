// R47 测量/验证用页面：ImageAnimator 帧动画（真实 <img> 基座 + 逐帧定时器）
//   ① 逐帧播放：3 帧 × 200ms、iterations(2) → 总时长 1200ms 后 onFinish
//   ② Paused：停表保持当前帧；恢复 Running 继续推进
//   ③ onStart 首次启动派发一次；onFinish 在最后一个迭代结束时派发
// 帧图用 test-assets 已知尺寸件（1×1 / 7×3 / 13×5），断言可核对 src。
@Entry
@Component
struct AnimatorDemo {
  @State log: string = '';
  @State st: AnimationStatus = AnimationStatus.Running;

  build() {
    Column({ space: 8 }) {
      ImageAnimator()
        .id('an1')
        .images([
          { src: '/test-assets/known-1x1.png' },
          { src: '/test-assets/known-7x3.png' },
          { src: '/test-assets/known-13x5.png' },
        ])
        .duration(200)
        .iterations(2)
        .state(this.st)
        .onStart(() => {
          this.log = this.log + 'START;';
        })
        .onFinish(() => {
          this.log = this.log + 'FIN;';
        })

      Button('pause').id('btn-p').onClick(() => {
        this.st = AnimationStatus.Paused;
      })
      Button('resume').id('btn-r').onClick(() => {
        this.st = AnimationStatus.Running;
      })
      Text(this.log).id('an-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
