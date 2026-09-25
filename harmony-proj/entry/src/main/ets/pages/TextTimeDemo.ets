// R59 测量/验证用页面：TextClock + TextTimer（时间文本双件）
//   ① TextClock：format('HH:mm:ss') 渲染当前时间（结构性断言：格式形状，不锁墙钟值）
//   ② TextTimer 倒计时：startTime 5000、format 'HH:mm:ss.SS'、controller start/pause/reset
//      —— elapsed 由 setInterval 累积驱动，headless 虚拟时间下确定性最好
//   ③ TextTimer 正计时：startTime 0 → elapsed 增长，onTimer(utc, elapsedTime) 每 tick 触发
@Entry
@Component
struct TextTimeDemo {
  @State log: string = '';
  clockCtrl: TextClockController = new TextClockController();
  timerCtrl: TextTimerController = new TextTimerController();

  build() {
    Column({ space: 8 }) {
      TextClock({ controller: this.clockCtrl })
        .id('tck')
        .format('HH:mm:ss')

      TextTimer({ controller: this.timerCtrl, startTime: 5000, isCountDown: true })
        .id('ttd')
        .format('HH:mm:ss.SS')
        .onTimer((utc: number, elapsedTime: number) => {
          this.log = this.log + 'TD' + elapsedTime + ';';
        })

      TextTimer({ controller: new TextTimerController(), startTime: 0, isCountDown: false })
        .id('ttu')
        .format('mm:ss.SS')
        .onTimer((utc: number, elapsedTime: number) => {
          this.log = this.log + 'TU' + elapsedTime + ';';
        })

      Button('start').id('btn-start').onClick(() => {
        this.timerCtrl.start();
      })
      Button('pause').id('btn-pause').onClick(() => {
        this.timerCtrl.pause();
      })
      Button('reset').id('btn-reset').onClick(() => {
        this.timerCtrl.reset();
      })
      Text(this.log).id('tt-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
