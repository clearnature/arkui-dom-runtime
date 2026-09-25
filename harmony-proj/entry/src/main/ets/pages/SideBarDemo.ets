// R61 测量/验证用页面：SideBarContainer 侧边栏容器（嵌入式 + 控制按钮 + showSideBar）
//   ① 基座：Embed 类型（侧栏与内容并排）；侧栏 200px、内容自适应
//   ② showSideBar(false) → 隐藏侧栏、内容区扩展；onChange(value) 记录显隐
//   ③ controlButton：内置控制按钮（图标 + 位置），点击切显隐
@Entry
@Component
struct SideBarDemo {
  @State log: string = '';
  @State show: boolean = true;

  build() {
    Column({ space: 8 }) {
      SideBarContainer(SideBarContainerType.Embed) {
        Column() {
          Text('menu').id('sb-menu')
        }
        .width(200)
        .backgroundColor('#f4f6f8')

        Column() {
          Text('content').id('sb-content')
        }
        .backgroundColor('#e8f0fe')
      }
      .id('sbc')
      .showSideBar(this.show)
      .sideBarWidth(200)
      .controlButton({
        left: 8,
        top: 8,
        icons: {
          shown: '→',
          hidden: '←',
        }
      })
      .showControlButton(true)
      .onChange((value: boolean) => {
        this.log = this.log + 'CHG' + (value ? '1' : '0') + ';';
      })
      .width('100%')
      .height(200)

      Button('toggle').id('btn-toggle').onClick(() => {
        this.show = !this.show;
      })
      Text(this.log).id('sb-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
