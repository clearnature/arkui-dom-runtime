// R66 测量/验证用页面：导航垫片批次——NavRouter / Navigator / PageTransitionEnter·Exit /
//   ToolBarItem / UIPickerComponent
//   ① NavRouter({name,param})：点击自动路由（mode PUSH），onStateChange(true/false)
//   ② Navigator({target,type})：active/type/target/params，点击跳转
//   ③ pageTransition()：PageTransitionEnter/Exit 规格 + onEnter 逐帧回调
//   ④ ToolBarItem({placement})：标题栏工具项（TOP_BAR_LEADING / TOP_BAR_TRAILING）
//   ⑤ UIPickerComponent({selectedIndex})：滚轮选择器 + onChange/onScrollStop + 指示器
//
// ⚠️ 运行时差异（已与垫片实现约定）：
//   - 真机编译产物里 PageTransitionEnter(...) 是【裸调用】（接口带调用签名）；本运行时的
//     组件对象只有 .create 工厂形态，所以这里也按 .create 写（fixture .ts 同）。
//   - 真机由框架回调 pageTransition()；本运行时没有该钩子，aboutToAppear 里显式调一次。
@Entry
@Component
struct NavShimDemo {
  @State log: string = '';
  private stack: NavPathStack = new NavPathStack();

  aboutToAppear() {
    this.pageTransition()
  }

  pageTransition() {
    PageTransitionEnter.create({ type: RouteType.Push, duration: 300 })
      .slide(SlideEffect.Left)
      .onEnter((t: RouteType, p: number) => {
        this.log = this.log + 'PT' + Math.round(p * 10) + ';'
      })
    PageTransitionExit.create({ type: RouteType.Push, duration: 300 })
      .slide(SlideEffect.Left)
  }

  PageMap(name: string, param: string) {
    NavDestination() {
      Column({ space: 4 }) {
        Text('dest:' + name).id('dest-' + name)
        Text('param:' + param).fontSize(12)
        Button('dpop')
          .onClick(() => {
            this.stack.pop()
            this.log = this.log + 'POP;'
          })
      }
      .alignItems(HorizontalAlign.Start)
    }
    .title(name)
  }

  build() {
    Column({ space: 8 }) {
      Navigation(this.stack) {
        NavRouter({ name: 'detail', param: 'p1' }) {
          Text('entry').id('nr-entry')
          // d.ts 要求第二个子组件必须是 NavDestination；本运行时的目的地只能由 PageMap
          // 建出，内联这份会挂成 display:none 并记一条 layoutWarning（结构性差异，非缺陷）
          NavDestination() {
            Text('inline dest')
          }
        }
        .id('nr')
        .mode(NavRouteMode.PUSH)
        .onStateChange((on: boolean) => {
          this.log = this.log + 'NS' + (on ? 1 : 0) + ';'
        })

        Navigator({ target: 'pages/NavTarget', type: NavigationType.Push }) {
          Text('go target')
        }
        .id('nv')
        .params({ from: 'shim' })

        Row({ space: 8 }) {
          ToolBarItem()
            .id('tb0')
          ToolBarItem({ placement: ToolBarItemPlacement.TOP_BAR_TRAILING })
            .id('tb1')
        }
        .id('tb')

        UIPickerComponent({ selectedIndex: 1 }) {
          Text('Alpha')
          Text('Bravo')
          Text('Charlie')
          Text('Delta')
          Text('Echo')
        }
        .id('pk')
        .displayedItemCount(5)
        .selectionIndicator({ type: PickerIndicatorType.DIVIDER, strokeWidth: 2 })
        .onChange((i: number) => {
          this.log = this.log + 'P' + i + ';'
        })
        .onScrollStop((i: number) => {
          this.log = this.log + 'S' + i + ';'
        })

        Text(this.log).id('log').fontSize(12)
      }
      .navDestination(this.PageMap)
      .mode(NavigationMode.Stack)
      .id('nav')
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
