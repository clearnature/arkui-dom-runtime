// R78 重属性大树基准页：100 行 × 10 静态属性（嵌套 Row+双 Text，共 ~304 节点）
//   为"编译器深化"建立重属性场景基准：批量翻转测属性重放占比，hot 单点测动态重渲染。
//   与 PerfBigDemo 的差异：节点多（304 vs 203）、属性重（~1006 条属性语句 vs 800）、
//   增加嵌套层级（Row 内双 Text）。
@Entry
@Component
struct AttrHeavyDemo {
  @State items: string[] = []
  @State upper: boolean = false
  @State hot: number = 0

  aboutToAppear() {
    const arr: string[] = [];
    for (let i = 0; i < 100; i++) {
      arr.push('item ' + i);
    }
    this.items = arr;
  }

  build() {
    Column({ space: 4 }) {
      Button('flip').id('btn-flip').onClick(() => {
        this.upper = !this.upper;
        const up = this.upper;
        const arr: string[] = [];
        for (let i = 0; i < 100; i++) {
          arr.push(up ? ('ITEM ' + i) : ('item ' + i));
        }
        this.items = arr;
      })
      Button('hot+').id('btn-hot').onClick(() => {
        this.hot++;
      })
      Text('hot=' + this.hot).id('hot-count')
      ForEach(this.items, (it: string) => {
        Row() {
          Text(it).fontSize(14).fontColor('#333333').maxLines(1)
          Text('tail').fontSize(12).fontColor('#888888').margin({ left: 8 })
        }
        .width('90%')
        .height(48)
        .padding(6)
        .backgroundColor('#f5f5f5')
      }, (it: string, idx: number) => 'a' + idx)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
