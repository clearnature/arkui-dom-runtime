// R68 性能基线页：30 行静态列表 + @State 计数按钮
//   首渲染 = loadRoute 到 rAF 稳定；rerender = click 到 count 文本更新（最小脏区）
//   数字只在 Electron 端有意义（浏览器端 virtual-time 计时不可信，仅作冒烟）
@Entry
@Component
struct PerfDemo {
  @State count: number = 0
  @State items: string[] = []

  aboutToAppear() {
    for (let i = 0; i < 30; i++) {
      this.items.push('row ' + i);
    }
  }

  build() {
    Column({ space: 4 }) {
      Button('inc').id('btn-inc').onClick(() => {
        this.count++;
      })
      Text('count=' + this.count).id('perf-count')
      ForEach(this.items, (it: string) => {
        Text(it)
      }, (it: string) => it)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
