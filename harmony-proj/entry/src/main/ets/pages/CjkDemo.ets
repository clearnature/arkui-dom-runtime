// R108：CjkDemo —— 真实 ArkTS 页面消费 @ohos.cjk（进程内仓颉内核）
// 断言页 test/cjkdemo.html 经本页的编译产物驱动：桌面端走真内核（typed add / fib），
// 浏览器端走垫片降级（isAvailable=false）。页面只管渲染结果，不感知端差异。
/// <reference path="../cjk.d.ts" />
import cjk from '@ohos.cjk';

@Entry
@Component
struct CjkDemo {
  @State sum: number = 0
  @State fibN: number = 0
  @State echoText: string = ''
  @State kernelMode: string = 'checking'

  aboutToAppear(): void {
    this.runKernel()
  }

  async runKernel(): Promise<void> {
    const available: boolean = await cjk.isAvailable()
    if (!available) {
      this.kernelMode = 'degraded'
      return
    }
    this.kernelMode = 'kernel-live'
    this.sum = await cjk.add(20, 22)
    const f = await cjk.call('fib', { n: 12 })
    if (f !== null) {
      const v: number = Number(f['result'])
      if (!Number.isNaN(v)) {
        this.fibN = v
      }
    }
    this.echoText = await cjk.echo('arkts-to-cangjie')
  }

  build() {
    Column({ space: 8 }) {
      Text('R108 CjkDemo')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
      Text(this.kernelMode)
        .id('kernel-mode')
        .fontSize(14)
      Text('sum=' + this.sum)
        .id('sum-out')
        .fontSize(14)
      Text('fib=' + this.fibN)
        .id('fib-out')
        .fontSize(14)
      Text('echo=' + this.echoText)
        .id('echo-out')
        .fontSize(14)
    }
    .width('100%')
    .padding(12)
    .alignItems(HorizontalAlign.Start)
  }
}
