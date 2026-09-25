// R64 测量/验证用页面：GridRow/GridCol 响应式网格（12 列系统 + span/offset）
//   ① 基座：GridRow columns=12, gutter=8；GridCol span=6（半宽）/ span=12（全宽）
//   ② DOM 映射：display:grid grid-template-columns:repeat(12,1fr) gap:8px
//   ③ GridCol span → grid-column: span N；offset → margin-left 偏移
@Entry
@Component
struct GridRowDemo {
  build() {
    Column({ space: 8 }) {
      GridRow({ columns: 12, gutter: 8 }) {
        GridCol({ span: 6 }) {
          Text('a').id('gc-a')
        }
        GridCol({ span: 6 }) {
          Text('b').id('gc-b')
        }
        GridCol({ span: 4 }) {
          Text('c').id('gc-c')
        }
        GridCol({ span: 4 }) {
          Text('d').id('gc-d')
        }
        GridCol({ span: 4 }) {
          Text('e').id('gc-e')
        }
        GridCol({ span: 12 }) {
          Text('f').id('gc-f')
        }
      }
      .id('gr')
      .width('100%')

      Text('done').id('done-marker')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
