// R29 测量/验证用页面：弹出类 **Select / Menu + MenuItem**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① Select(options: SelectOption[]) —— create 单参数（selected 走属性方法）
//   ② Select.selected(i) / Select.value(str) / Select.onSelect((index, value) => …)
//   ③ Menu 容器 + MenuItem({content}) + MenuItem.selected(bool) + MenuItem.onChange(cb)
//
// 现状画像：Select 已映射原生 <select>；Menu/MenuItem 是 flex div 骨架。本轮补语义层：
// options → <option>、选中态、回调双参、菜单项的选择/互斥。
@Entry
@Component
struct PopDemo {
  @State log: string = '';
  @State mlog: string = '';

  build() {
    Column({ space: 8 }) {
      // ① Select：三选项，初始选中第 1 项
      Select([
        { value: 'A' },
        { value: 'B' },
        { value: 'C' }
      ])
        .id('sel1')
        .selected(1)
        .fontColor('#0066cc')
        .onSelect((i: number, v: string) => { this.log = this.log + 'SEL' + i + '/' + v + ';'; })

      // ② Select：selected(2) + value('B→X') 覆盖显示
      Select([
        { value: 'X' },
        { value: 'Y' }
      ])
        .id('sel2')
        .selected(0)
        .value('Choosed')

      // ③ Menu 容器 + MenuItem：多选菜单（selected + onChange）
      Menu() {
        MenuItem({ content: 'item1' })
          .id('mi1')
          .selected(false)
          .onChange((on: boolean) => { this.mlog = this.mlog + 'I1' + on + ';'; })
        MenuItem({ content: 'item2' })
          .id('mi2')
          .selected(true)
          .onChange((on: boolean) => { this.mlog = this.mlog + 'I2' + on + ';'; })
      }
      .id('mn1')

      Text(this.log).id('pop-log').fontSize(12).height(24)
      Text(this.mlog).id('menu-log').fontSize(12).height(24)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
