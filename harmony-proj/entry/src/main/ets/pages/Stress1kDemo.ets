// R79 千节点压测页：350 行 × 10 静态属性（嵌套 Row+双 Text，共 ~1055 节点，~3500 条属性语句）
//   规模曲线 third 点：203(4.8ms) → 304(11.2ms) → 1055(?)——验证创建路径线性度与
//   R75/R76 优化在千节点级的保持性。
@Entry
@Component
struct Stress1kDemo {
  @State items: string[] = []
  @State upper: boolean = false
  @State hot: number = 0

  aboutToAppear() {
    const arr: string[] = [];
    for (let i = 0; i < 350; i++) {
      arr.push('item ' + i);
    }
    this.items = arr;
  }

  build() {
    Column({ space: 2 }) {
      Button('flip').id('btn-flip').onClick(() => {
        this.upper = !this.upper;
        const up = this.upper;
        const arr: string[] = [];
        for (let i = 0; i < 350; i++) {
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
