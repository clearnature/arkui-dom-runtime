// R30 测量/验证用页面：**UIContext**（`this.getUIContext()` 的现代 API 面）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① this.getUIContext() —— 编译后是组件实例上的普通方法调用
//   ② uiContext.animateTo(param, fn) —— 与 Context.animateTo 同源的显式动画
//   ③ uiContext.getRouter() —— 路由面（runtime 已有 router 垫片）
//   ④ uiContext.runScopedTask(cb) —— 立即执行的闭包
//
// 现状（docs/CAPABILITY 已记录的限制）：getUIContext 在 ViewPU 实例上不存在，
// 调用即 TypeError —— 本轮关掉这个限制。
@Entry
@Component
struct UiContextDemo {
  @State log: string = '';
  @State msg: string = 'A';

  build() {
    Column({ space: 8 }) {
      Button('go').id('go-btn').onClick(() => {
        const ui = this.getUIContext();
        // ① 拿到的是对象面（typeof object = 1）
        this.log = this.log + 'UI' + (typeof ui === 'object' ? 1 : 0) + ';';
        // ② animateTo 走显式动画管道
        ui.animateTo({ duration: 200 }, () => { this.msg = 'B'; });
        // ③ getRouter 返回路由面（Router.pushUrl 可用性即真值）
        const router = ui.getRouter();
        this.log = this.log + 'RT' + (typeof router.pushUrl === 'function' ? 1 : 0) + ';';
        // ④ runScopedTask 立即执行
        ui.runScopedTask(() => { this.log = this.log + 'SC;'; });
      })
      Text(this.msg).id('uc-msg')
      Text(this.log).id('uc-log')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
