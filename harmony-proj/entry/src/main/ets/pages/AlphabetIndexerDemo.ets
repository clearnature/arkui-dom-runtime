// R60 测量/验证用页面：AlphabetIndexer 字母索引条（配 List 长列表）
//   ① 基座：arrayValue A~E、selected 0、itemSize 24；点击 → onSelect(index) 记 log
//   ② selected(index) 属性：@State idx 驱动 rerender 重放（程序化改选中，不发 onSelect）
//   ③ DOM 映射：纵向 flex 条，每项一格；选中项高亮（selectedBackgroundColor）
@Entry
@Component
struct AlphabetIndexerDemo {
  @State log: string = '';
  @State idx: number = 0;
  private arr: string[] = ['A', 'B', 'C', 'D', 'E'];

  build() {
    Column({ space: 8 }) {
      AlphabetIndexer({ arrayValue: this.arr, selected: 0 })
        .id('aix')
        .itemSize(24)
        .selectedBackgroundColor('#0a59f7')
        .selected(this.idx)
        .onSelect((index: number) => {
          this.idx = index;
          this.log = this.log + 'SEL' + index + ';';
        })

      Button('toC').id('btn-toc').onClick(() => {
        this.idx = 2;
      })

      Text(this.idx + '').id('aix-idx').fontSize(12)
      Text(this.log).id('aix-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
