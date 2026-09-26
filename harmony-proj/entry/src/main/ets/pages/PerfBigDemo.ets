// R73 规模化基线页：200 行 ForEach（203 节点）+ 批量翻转按钮
//   为模板编译器立项建立"百节点级"验收基准（R71 结论：小页面框架成本仅 3.5ms，
//   编译器收益必须在大页面验证）。
//   翻转 row/ROW 用 index 作 key（键稳定 → 走 ForEach 原地更新路径，而非整树重建）。
//   R75：每行加 4 个静态属性（fontSize/width/padding/fontColor）——800 条属性重放语句，
//   供 arkui-optimizer 的静态/动态分裂前后对照。
@Entry
@Component
struct PerfBigDemo {
  @State items: string[] = []
  @State upper: boolean = false

  aboutToAppear() {
    const arr: string[] = [];
    for (let i = 0; i < 200; i++) {
      arr.push('row ' + i);
    }
    this.items = arr;
  }

  build() {
    Column({ space: 2 }) {
      Button('toggle').id('btn-toggle').onClick(() => {
        this.upper = !this.upper;
        const up = this.upper;
        const arr: string[] = [];
        for (let i = 0; i < 200; i++) {
          arr.push(up ? ('ROW ' + i) : ('row ' + i));
        }
        this.items = arr;
      })
      Text('n=' + this.items.length).id('big-count')
      ForEach(this.items, (it: string) => {
        Text(it).fontSize(14).width('90%').padding(4).fontColor('#333333')
      }, (it: string, idx: number) => 'k' + idx)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
