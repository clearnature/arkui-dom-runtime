// R23 测量/验证用页面：手势（Pan / Tap / LongPress / Swipe / Pinch）
//
// 验收重点：合成一次 pan 序列，回调里的 offsetX/offsetY 要接近合成位移。
@Entry
@Component
struct GestureDemo {
  @State log: string = '';
  @State pan: string = '';

  build() {
    Column({ space: 4 }) {
      Row()
        .width(160)
        .height(80)
        .backgroundColor('#3366cc')
        .id('pad')
        .gesture(
          PanGesture({ fingers: 1, direction: PanDirection.All, distance: 5 })
            .onActionStart((e: GestureEvent) => {
              this.log = this.log + 'PS;';
            })
            .onActionUpdate((e: GestureEvent) => {
              this.pan = 'upd=' + Math.round(e.offsetX) + ',' + Math.round(e.offsetY);
            })
            .onActionEnd((e: GestureEvent) => {
              this.log = this.log + 'PE;';
              this.pan = 'end=' + Math.round(e.offsetX) + ',' + Math.round(e.offsetY);
            })
        )

      Row()
        .width(120)
        .height(40)
        .backgroundColor('#228833')
        .id('tap')
        .gesture(
          TapGesture({ count: 2, fingers: 1 })
            .onAction((e: GestureEvent) => {
              this.log = this.log + 'T' + (e.repeat ? 'R' : 'F') + ';';
            })
        )

      Row()
        .width(120)
        .height(40)
        .backgroundColor('#aa6622')
        .id('press')
        .gesture(
          LongPressGesture({ repeat: false, duration: 300 })
            .onAction((e: GestureEvent) => {
              this.log = this.log + 'L' + (e.repeat ? 'R' : 'F') + ';';
            })
        )

      Row()
        .width(120)
        .height(40)
        .backgroundColor('#883399')
        .id('swipe')
        .gesture(
          SwipeGesture({ fingers: 1, direction: SwipeDirection.Horizontal, speed: 100 })
            .onAction((e: GestureEvent) => {
              this.log = this.log + 'W' + Math.round(e.angle) + 'v' + Math.round(e.speed / 100) + ';';
            })
        )

      Row()
        .width(120)
        .height(40)
        .backgroundColor('#117799')
        .id('pinch')
        .gesture(
          PinchGesture({ fingers: 2, distance: 5 })
            .onActionStart((e: GestureEvent) => {
              this.log = this.log + 'KS;';
            })
            .onActionUpdate((e: GestureEvent) => {
              this.pan = 'scale=' + e.scale.toFixed(2);
            })
            .onActionEnd((e: GestureEvent) => {
              this.log = this.log + 'KE;';
            })
        )

      Text('pan=' + this.pan).id('pan')
      Text('log=' + this.log).id('glog')
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
