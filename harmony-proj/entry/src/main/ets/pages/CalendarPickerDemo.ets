// R54 测量/验证用页面：CalendarPicker 日期选择入口（三段文本 + 加减步进 + 月历弹层）
//   ① 入口：真机结构 = 年/月/日三段文本 + 加/减按钮（calendar_picker_model_ng.cpp LayoutPicker）
//   ② 弹层：月历网格首列周日（真机 startOfWeek_=64→log2=6→weekNumbers_[0]=SUN，
//      calendar_paint_method.cpp:531）；标题 `${y}年${m}月`；选中日圆形高亮（hintRadius 16）
//   ③ 时序：点日期 → onChange(Date) 同值不重发（CanReportChangeEvent 去重），弹层不自动关
//   ④ 2024-10 固定锚点：10/1 周二（首列周日 → 第 3 列，前置 2 格）、31 天、5 行
@Entry
@Component
struct CalendarPickerDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      // ① 基础：固定 selected 2024-10-08；markToday 只记 dataset（本月不含系统今天）
      CalendarPicker({ selected: new Date(2024, 9, 8), disabledDateRange: [{ start: new Date(2024, 9, 10), end: new Date(2024, 9, 12) }] })
        .id('cp1')
        .edgeAlign(CalendarAlign.START)
        .markToday(true)
        .onChange((d: Date) => {
          this.log = this.log + 'CHG' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ';';
        })

      // ② start/end 钳制：selected 2024-9-25 < start → 夹到 2024-10-05（真机 AdjustDateToRange）
      CalendarPicker({ selected: new Date(2024, 8, 25), start: new Date(2024, 9, 5), end: new Date(2024, 9, 20) })
        .id('cp2')

      // ③ 静态弹层 CalendarPickerDialog.show：onAccept/onCancel
      Button('dlg').id('btn-dlg').onClick(() => {
        CalendarPickerDialog.show({
          selected: new Date(2024, 9, 15),
          onAccept: (d: Date) => {
            this.log = this.log + 'ACC' + d.getDate() + ';';
          },
          onCancel: () => {
            this.log = this.log + 'CAN;';
          }
        });
      })

      Text(this.log).id('cp-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
