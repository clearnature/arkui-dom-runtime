// R62 测量/验证用页面：RowSplit + ColumnSplit（分隔容器双件，无自有属性）
//   ① RowSplit：水平排列 + 子组件按 width 分配（flex row 基座）
//   ② ColumnSplit：垂直排列 + 子组件按 height 分配（flex column 基座）
//   ③ 断言几何：子组件 offsetLeft/offsetTop 按排布序
@Entry
@Component
struct SplitDemo {
  build() {
    Column({ space: 8 }) {
      RowSplit() {
        Text('L').id('rs-l').width(120).height(60).backgroundColor('#eef')
        Text('R').id('rs-r').width(120).height(60).backgroundColor('#fee')
      }
      .id('rs')
      .width(240)
      .height(60)

      ColumnSplit() {
        Text('T').id('cs-t').width(120).height(40).backgroundColor('#efe')
        Text('B').id('cs-b').width(120).height(40).backgroundColor('#ffe')
      }
      .id('cs')
      .width(120)
      .height(80)

      Text('done').id('done-marker')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
