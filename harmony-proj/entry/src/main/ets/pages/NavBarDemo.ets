// R12 收口测量/验证用页面：Navigation 的**标题栏 / 工具栏 / 分栏模式**
//
// ⚠️ 先测量再实现：本页是为了让官方编译器把下列 API 的产物形态暴露出来。
// 覆盖：
//   ① title 的四种形态：string / NavigationCommonTitle{main,sub} / CustomBuilder / NavigationCustomTitle{builder,height}
//   ② titleMode：Full / Mini / Free（每种都与 height 有关，见 .d.ts 的 JSDoc 数字）
//   ③ hideTitleBar / hideBackButton / backButtonIcon
//   ④ menus（标题栏右侧菜单）+ ToolbarItem（NavDestination 底部工具栏）与它们的 action 回调
//   ⑤ mode：Split / Auto / Stack + navBarWidth + navBarPosition + minContentWidth
//
// 触发方式：每个 Navigation 的根内容里放按钮（合成 click 即可驱动），栈里的目的地共用 PageMap。
@Entry
@Component
struct NavBarDemo {
  @State log: string = '';
  s1: NavPathStack = new NavPathStack();
  s2: NavPathStack = new NavPathStack();
  s3: NavPathStack = new NavPathStack();
  s4: NavPathStack = new NavPathStack();
  s5: NavPathStack = new NavPathStack();
  s6: NavPathStack = new NavPathStack();
  s7: NavPathStack = new NavPathStack();
  s8: NavPathStack = new NavPathStack();
  s9: NavPathStack = new NavPathStack();
  s10: NavPathStack = new NavPathStack();

  // CustomBuilder 形态的标题
  @Builder SynthTitle() {
    Text('BUILT').id('synth-title-text')
  }

  // 栈里目的地：d1 带工具栏 + 菜单；d2 关掉返回键；d3 带自定义 backButtonIcon
  @Builder PageMap(name: string, param: object) {
    if (name === 'd1') {
      NavDestination() {
        Text('body1').id('body1')
      }
      .title('DT1')
      .menus([{ value: 'M1', action: (): void => { this.log = this.log + 'M1;'; } }])
      .toolbarConfiguration([
        { value: 'T1', action: (): void => { this.log = this.log + 'T1;'; } },
        { value: 'T2', action: (): void => { this.log = this.log + 'T2;'; } }
      ])
    }
    if (name === 'd2') {
      NavDestination() {
        Text('body2').id('body2')
      }
      .title('DT2')
      .hideBackButton(true)
    }
    if (name === 'd3') {
      NavDestination() {
        Text('body3').id('body3')
      }
      .title('DT3')
      .backButtonIcon('/img/back.png')
    }
  }

  build() {
    Column({ space: 4 }) {
      // ① title: string + titleMode(Full)
      Navigation(this.s1) {
        Button('push1').id('push1').onClick(() => { this.s1.pushPathByName('d1', undefined); })
        Text('root1').id('root1')
      }
      .id('nb-t1')
      .width(300)
      .height(170)
      .title('T1')
      .titleMode(NavigationTitleMode.Full)
      .navDestination(this.PageMap)

      // ② title: {main, sub} + titleMode(Free)
      Navigation(this.s2) {
        Text('root2').id('root2')
      }
      .id('nb-t2')
      .width(300)
      .height(170)
      .title({ main: 'M2', sub: 'S2' })
      .titleMode(NavigationTitleMode.Free)
      .navDestination(this.PageMap)

      // ③ title: CustomBuilder + options（backgroundColor）
      Navigation(this.s3) {
        Text('root3').id('root3')
      }
      .id('nb-t3')
      .width(300)
      .height(120)
      .title(this.SynthTitle, { backgroundColor: '#eeeeee' })
      .titleMode(NavigationTitleMode.Mini)
      .navDestination(this.PageMap)

      // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
      Navigation(this.s4) {
        Text('root4').id('root4')
      }
      .id('nb-t4')
      .width(300)
      .height(120)
      .title({ builder: this.SynthTitle, height: TitleHeight.MainWithSub })
      .titleMode(NavigationTitleMode.Mini)
      .navDestination(this.PageMap)

      // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
      Navigation(this.s5) {
        Text('root5').id('root5')
      }
      .id('nb-t5')
      .width(300)
      .height(80)
      .title('T5')
      .hideTitleBar(true)
      .navDestination(this.PageMap)

      // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
      Navigation(this.s6) {
        Button('push6').id('push6').onClick(() => { this.s6.pushPathByName('d1', undefined); })
        Text('root6').id('root6')
      }
      .id('nb-t6')
      .width(700)
      .height(140)
      .title('T6')
      .mode(NavigationMode.Split)
      .navBarWidth(200)
      .navBarPosition(NavBarPosition.Start)
      .navDestination(this.PageMap)

      // ⑦ Split + navBarPosition(End)
      Navigation(this.s7) {
        Text('root7').id('root7')
      }
      .id('nb-t7')
      .width(700)
      .height(120)
      .title('T7')
      .mode(NavigationMode.Split)
      .navBarWidth(180)
      .navBarPosition(NavBarPosition.End)
      .navDestination(this.PageMap)

      // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
      Navigation(this.s8) {
        Text('root8').id('root8')
      }
      .id('nb-t8')
      .width(700)
      .height(120)
      .title('T8')
      .mode(NavigationMode.Auto)
      .navDestination(this.PageMap)

      // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
      Navigation(this.s9) {
        Text('root9').id('root9')
      }
      .id('nb-t9')
      .width(400)
      .height(120)
      .title('T9')
      .mode(NavigationMode.Auto)
      .navDestination(this.PageMap)

      // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
      Navigation(this.s10) {
        Button('push10').id('push10').onClick(() => { this.s10.pushPathByName('d3', undefined); })
        Button('push10d2').id('push10d2').onClick(() => { this.s10.pushPathByName('d2', undefined); })
        Text('root10').id('root10')
      }
      .id('nb-t10')
      .width(300)
      .height(120)
      .title('T10')
      .navDestination(this.PageMap)

      Text('log=' + this.log).id('nblog')
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
