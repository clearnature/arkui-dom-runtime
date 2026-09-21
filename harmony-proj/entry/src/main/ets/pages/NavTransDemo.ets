// R25 收口测量/验证用页面：Navigation 的 **push/pop 转场动画** 与 **onTitleModeChange 滚动联动**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① .onTitleModeChange(cb) —— NavigationAttribute 上的事件注册形态
//   ② pushPathByName 的第 4 参 animated（显式 false 的对照组）与 pop()
//   ③ NavPathStack.disableAnimation(true) —— 全局关动画的调用形态
//   ④ Free 模式滚动联动的载体：List 超过一屏（navigation.d.ts Free JSDoc 的主场景：
//      "When the content is more than one screen in a scrollable component, the main title
//       shrinks as the content scrolls down ... and restores as the content scrolls up to the top."）
//
// 覆盖：
//   n1：title('ScrollTitle') + Free + List(50 项) + onTitleModeChange 记录到 log + push（默认动画）
//   n2：title('FullTitle') + Full + onTitleModeChange 也挂着（联动必须【不】触发，对照）
//       + push2 用 animated=false 的四参形态
//   n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小的载体）+ dis 按钮（disableAnimation 后 push）
//   n4：builder 标题 + Free —— Free JSDoc："If title is set to any other value type, the main
//       title changes in mere location when pulled down"（内容不缩，只有高度收）
//   目的地 d1/d2：转场动画的载体，返回走标题栏返回键（自动回所属栈，不用页面里写 pop）
@Entry
@Component
struct NavTransDemo {
  @State log: string = '';
  s1: NavPathStack = new NavPathStack();
  s2: NavPathStack = new NavPathStack();
  s3: NavPathStack = new NavPathStack();
  s4: NavPathStack = new NavPathStack();
  items1: number[] = [];
  items2: number[] = [];
  items3: number[] = [];
  items4: number[] = [];

  aboutToAppear(): void {
    for (let i = 0; i < 50; i++) { this.items1.push(i); }
    for (let i = 0; i < 10; i++) { this.items2.push(i); }
    for (let i = 0; i < 30; i++) { this.items3.push(i); }
    for (let i = 0; i < 15; i++) { this.items4.push(i); }
  }

  // n4 的自定义标题（builder 形态）
  @Builder SynthTitle() {
    Text('BUILT4').id('synth4')
  }

  // 栈里目的地：返回键用运行时画的标题栏返回键（回所属栈），页面内只放内容
  @Builder PageMap(name: string, param: object) {
    if (name === 'd1') {
      NavDestination() {
        Text('detail-body').id('detail-body')
      }
      .title('DT1')
    }
    if (name === 'd2') {
      NavDestination() {
        Text('detail2-body').id('detail2-body')
      }
      .title('DT2')
    }
  }

  build() {
    Column() {
      // n1：Free + List 滚动联动 + push（默认动画）
      Navigation(this.s1) {
        Column() {
          Button('push1').id('push1').onClick(() => { this.s1.pushPathByName('d1', undefined); })
          List({ space: 4 }) {
            ForEach(this.items1, (it: number) => {
              ListItem() {
                Text('item' + it).fontSize(16)
              }
              .id('li1-' + it)
              .height(40)
            }, (it: number) => 'i' + it)
          }
          .id('list1')
          .width('100%')
          .height(150)
        }
        .width('100%')
        .height('100%')
      }
      .id('nt-n1')
      .width(320)
      .height(240)
      .title('ScrollTitle')
      .titleMode(NavigationTitleMode.Free)
      .onTitleModeChange((m: NavigationTitleMode) => { this.log = this.log + 'TMC' + m + ';'; })
      .navDestination(this.PageMap)

      // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
      Navigation(this.s2) {
        Column() {
          Button('push2').id('push2').onClick(() => { this.s2.pushPathByName('d2', undefined, undefined, false); })
          List({ space: 4 }) {
            ForEach(this.items2, (it: number) => {
              ListItem() {
                Text('f' + it).fontSize(16)
              }
              .id('li2-' + it)
              .height(40)
            }, (it: number) => 'f' + it)
          }
          .id('list2')
          .width('100%')
          .height(150)
        }
        .width('100%')
        .height('100%')
      }
      .id('nt-n2')
      .width(320)
      .height(240)
      .title('FullTitle')
      .titleMode(NavigationTitleMode.Full)
      .onTitleModeChange((m: NavigationTitleMode) => { this.log = this.log + 'FULL' + m + ';'; })
      .navDestination(this.PageMap)

      // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
      Navigation(this.s3) {
        Column() {
          Button('dis').id('dis-btn').onClick(() => {
            this.s3.disableAnimation(true);
            this.s3.pushPathByName('d1', undefined);
          })
          List({ space: 4 }) {
            ForEach(this.items3, (it: number) => {
              ListItem() {
                Text('c' + it).fontSize(16)
              }
              .id('li3-' + it)
              .height(40)
            }, (it: number) => 'c' + it)
          }
          .id('list3')
          .width('100%')
          .height(150)
        }
        .width('100%')
        .height('100%')
      }
      .id('nt-n3')
      .width(320)
      .height(240)
      .title({ main: 'M3', sub: 'S3' })
      .titleMode(NavigationTitleMode.Free)
      .navDestination(this.PageMap)

      // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
      Navigation(this.s4) {
        Column() {
          List({ space: 4 }) {
            ForEach(this.items4, (it: number) => {
              ListItem() {
                Text('b' + it).fontSize(16)
              }
              .id('li4-' + it)
              .height(40)
            }, (it: number) => 'b' + it)
          }
          .id('list4')
          .width('100%')
          .height(150)
        }
        .width('100%')
        .height('100%')
      }
      .id('nt-n4')
      .width(320)
      .height(240)
      .title(this.SynthTitle)
      .titleMode(NavigationTitleMode.Free)
      .navDestination(this.PageMap)

      Text(this.log).id('tmc-log').fontSize(12).height(30)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
