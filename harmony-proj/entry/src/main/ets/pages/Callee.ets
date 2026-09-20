// R20 测量用页面：被 startAbilityForResult 启动的 ability 的窗口内容。
// 单独的页面是为了证明"真的起了第二个 ability 窗口"，而不是把调用方的页面再渲染一遍。
@Entry
@Component
struct Callee {
  build() {
    Column() {
      Text('被启动的 ability 窗口').id('calleeText')
    }
    .width('100%')
    .height('100%')
  }
}
