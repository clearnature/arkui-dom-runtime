// E2-2 万节点压测页：3300 行 × 3 组件/行（嵌套 Row+双 Text，共 ~9905 节点，~33000 条属性语句）
//   R79 千节点页（Stress1kDemo，1055 节点）的十倍规模对照点：验证创建路径线性度与
//   R75/R76 优化（属性守卫+行复用）在万节点级的保持性，为 E2-1 增量走查提供基线。
//   写法完全对齐 Stress1kDemo.ets（不引入新语法），仅数据规模 350 → 3300 行。
@Entry
@Component
struct Stress10kDemo {
  @State items: string[] = []
  @State upper: boolean = false
  @State hot: number = 0

  aboutToAppear() {
    const arr: string[] = [];
    for (let i = 0; i < 3300; i++) {
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
        for (let i = 0; i < 3300; i++) {
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
