// R52 测量/验证用页面：TimePicker 时间选择器（hour/minute(/second) 滚轮列）
//   ① tp1：HOUR_MINUTE_SECOND 格式 + selected 14:05:03 + onChange
//   ② tp2：useMilitaryTime(false) 12h 对照
//   ③ tp3：无前导零对照（selected 5:07）
@Entry
@Component
struct TimePickerDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      TimePicker({ selected: new Date(2026, 8, 15, 14, 5, 3), format: TimePickerFormat.HOUR_MINUTE_SECOND })
        .id('tp1')
        .useMilitaryTime(true)
        .width(300)
        .onChange((v: TimePickerResult) => {
          this.log = this.log + 'C' + v.hour + ':' + v.minute + ';';
        })

      TimePicker({ selected: new Date(2026, 8, 15, 0, 30, 0) })
        .id('tp2')
        .useMilitaryTime(false)
        .width(300)

      TimePicker({ selected: new Date(2026, 8, 15, 5, 7, 0) })
        .id('tp3')
        .useMilitaryTime(true)
        .width(300)

      Text(this.log).id('tp-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
