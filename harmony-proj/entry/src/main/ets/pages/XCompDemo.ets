// R32 测量/验证用页面：表层类另一半 **XComponent**（surface 占位 / onLoad / Controller rect）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① XComponent({id, type, controller}) —— create 三键；XComponentType 是自由变量枚举
//   ② XComponentController.getXComponentSurfaceId() —— surface id 字符串
//   ③ setXComponentSurfaceRect({offsetX, offsetY, surfaceWidth, surfaceHeight}) /
//      getXComponentSurfaceRect() —— JSDoc：不调用 set 则返回组件实际尺寸
//   ④ onLoad(cb)（surface 创建后触发）/ onDestroy(cb)
//
// DOM 映射：surface 占位 div（真机由原生图形栈持有；DOM 里如实记录"surface 可用"）。
@Entry
@Component
struct XCompDemo {
  @State log: string = '';
  controller: XComponentController = new XComponentController();

  build() {
    Column({ space: 8 }) {
      XComponent({ id: 'xc-main', type: XComponentType.SURFACE, controller: this.controller })
        .id('xc-main')
        .width(300)
        .height(200)
        .onLoad(() => {
          this.log = this.log + 'LOAD' + (this.controller.getXComponentSurfaceId().length > 0 ? 1 : 0) + ';';
        })
        .onDestroy(() => { this.log = this.log + 'DES;'; })

      Button('rect').id('rect-btn').onClick(() => {
        this.controller.setXComponentSurfaceRect({ offsetX: 0, offsetY: 0, surfaceWidth: 320, surfaceHeight: 240 });
        const r = this.controller.getXComponentSurfaceRect();
        this.log = this.log + 'RECT' + r.surfaceWidth + 'x' + r.surfaceHeight + ';';
      })

      Button('probe').id('probe-btn').onClick(() => {
        // 默认 rect = 组件实际尺寸（JSDoc：不调用 set 时返回组件尺寸）
        const r = this.controller.getXComponentSurfaceRect();
        this.log = this.log + 'DEF' + r.surfaceWidth + 'x' + r.surfaceHeight + ';';
      })

      Text(this.log).id('xc-log')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
