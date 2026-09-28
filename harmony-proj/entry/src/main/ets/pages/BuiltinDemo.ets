// R125 内置手势验证页：Swiper 拖拽翻页 / Tabs 内容区滑动 / Scroll+List 拖拽滚动
//
// 让官方编译器把下列产物形态暴露出来（断言对象是编译器强制的调用序）：
//   ① Swiper(controller) + .loop(false) + .duration(120) + onChange/onAnimationStart/
//      onAnimationEnd/onGestureSwipe —— 内置拖拽的回调族（三参动画签名）
//   ② Tabs + TabContent —— 内容区滑动翻 TabContent（scrollable 默认 true，不写即为开）
//   ③ Scroll / List —— 拖拽滚动 + 惯性（Scroll.fling 真惯性）
// 触发方式：合成 pointer 事件（与 GestureDemo 同一套 pev/drag）。
@Entry
@Component
struct BuiltinDemo {
  @State slog: string = '';
  @State tlog: string = '';
  // 控制器不能 @State（ArkTS 硬规则——编译器当场抓的，别凭直觉加）
  ctrl: SwiperController = new SwiperController();

  build() {
    Column({ space: 6 }) {
      Swiper(this.ctrl) {
        Text('P0').width(160).height(80).backgroundColor('#ddeeff').id('sp0')
        Text('P1').width(160).height(80).backgroundColor('#ffddaa').id('sp1')
        Text('P2').width(160).height(80).backgroundColor('#aaffcc').id('sp2')
      }
      .id('sw')
      .loop(false)
      .indicator(true)
      .duration(120)
      .onChange((i: number) => {
        this.slog = this.slog + 'C' + i + ';';
      })
      .onAnimationStart((i: number, target: number, e: SwiperAnimationEvent) => {
        this.slog = this.slog + 'A' + target + ';';
      })
      .onAnimationEnd((i: number, e: SwiperAnimationEvent) => {
        this.slog = this.slog + 'E' + i + ';';
      })
      .onGestureSwipe((i: number, e: SwiperAnimationEvent) => {
        this.slog = this.slog + 'G';
      })

      Tabs() {
        TabContent() {
          Text('T0').width(120).height(60).id('tc0')
        }
        .tabBar('tab0')
        TabContent() {
          Text('T1').width(120).height(60).id('tc1')
        }
        .tabBar('tab1')
        TabContent() {
          Text('T2').width(120).height(60).id('tc2')
        }
        .tabBar('tab2')
      }
      .id('tb')
      .onChange((i: number) => {
        this.tlog = this.tlog + 'C' + i + ';';
      })

      Scroll() {
        Column() {
          Text('S0').height(40).id('sc0')
          Text('S1').height(40).id('sc1')
          Text('S2').height(40).id('sc2')
        }
      }
      .width(160)
      .height(90)
      .id('scr')

      List({ space: 4 }) {
        ListItem() {
          Text('L0').height(36).id('li0')
        }
        ListItem() {
          Text('L1').height(36).id('li1')
        }
        ListItem() {
          Text('L2').height(36).id('li2')
        }
      }
      .width(160)
      .height(90)
      .id('lst')
    }
    .width('100%')
  }
}
