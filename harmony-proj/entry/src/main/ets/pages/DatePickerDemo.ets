// R51 测量/验证用页面：DatePicker 三列滚轮选择器（start/end 钳制 + 跨列联动 + 双事件）
//   ① dp1：start 2020-01-01 / end 2024-12-31 / selected 2024-01-15——基础渲染+wheel 步进+边界钳制
//   ② dp2：2023-02（平年 28 天）；dp3：2024-02（闰年 29 天）——闰年天数对照
//   ③ dp4：selected 2024-01-31——月滚到 2 月时 day 夹取到 29（2024 闰年）
//   ④ dp5：YEAR_AND_MONTH——day 列隐藏
//   ⑤ dp6：lunar(true)——记警告+data-*（不实现农历换算，如实）
@Entry
@Component
struct DatePickerDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      DatePicker({ start: new Date(2020, 0, 1), end: new Date(2024, 11, 31), selected: new Date(2024, 0, 15) })
        .id('dp1')
        .onChange((v: DatePickerResult) => {
          this.log = this.log + 'CHG' + v.year + '-' + v.month + '-' + v.day + ';';
        })
        .onDateChange((d: Date) => {
          this.log = this.log + 'DCHG' + d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + ';';
        })

      DatePicker({ start: new Date(2023, 1, 1), end: new Date(2023, 1, 28), selected: new Date(2023, 1, 10) })
        .id('dp2')

      DatePicker({ start: new Date(2024, 1, 1), end: new Date(2024, 1, 29), selected: new Date(2024, 1, 28) })
        .id('dp3')

      DatePicker({ start: new Date(2024, 0, 31), end: new Date(2024, 11, 31), selected: new Date(2024, 0, 31) })
        .id('dp4')
        .onChange((v: DatePickerResult) => {
          this.log = this.log + 'CHG' + v.year + '-' + v.month + '-' + v.day + ';';
        })

      DatePicker({ start: new Date(2020, 0, 1), end: new Date(2024, 11, 31), selected: new Date(2024, 0, 15), mode: DatePickerMode.YEAR_AND_MONTH })
        .id('dp5')

      DatePicker({ selected: new Date(2024, 0, 15) })
        .id('dp6')
        .lunar(true)

      Button('bump').id('btn-b').onClick(() => { this.log = this.log + 'B;'; })
      Text(this.log).id('dp-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
