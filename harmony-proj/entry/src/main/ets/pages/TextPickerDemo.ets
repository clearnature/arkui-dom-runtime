// R56 测量/验证用页面：TextPicker 文本选择器（选择器三部曲收官：DatePicker/TimePicker/TextPicker）
//   ① 入口：create({range: string[], selected}) 单列；滚轮同步单步（R51/R52 同族已确证时序）
//   ② 事件：onChange(value, index)（真机 textpicker_pattern.cpp:803 FireChangeEvent）
//   ③ selectedIndex 属性：create 之后的 selected 覆盖（.d.ts:842）
//   ④ defaultPickerItemHeight：行高（缺省 40，.d.ts:464）
@Entry
@Component
struct TextPickerDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      // ① 基础：四季 range，selected 1（'夏'）
      TextPicker({ range: ['春', '夏', '秋', '冬'], selected: 1 })
        .id('tx1')
        .defaultPickerItemHeight(40)
        .onChange((value: string | string[], index: number | number[]) => {
          const v = Array.isArray(value) ? value.join('/') : value;
          const i = Array.isArray(index) ? index.join('/') : index;
          this.log = this.log + 'CHG' + v + ':' + i + ';';
        })

      // ② selectedIndex 属性覆盖：create selected 0 → 属性压成 2
      TextPicker({ range: ['甲', '乙', '丙'], selected: 0 })
        .id('tx2')
        .selectedIndex(2)

      // ③ 对象形态 range（TextPickerRangeContent[]）：取 .text
      TextPicker({ range: [{ text: '红' }, { text: '绿' }], selected: 0 })
        .id('tx3')

      Text(this.log).id('tx-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
