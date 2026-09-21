// R26 测量/验证用页面：SVG 形状族 **Circle / Ellipse / Rect / Line / Path / Polygon / Polyline + Shape 容器**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① create 参数形态：Circle({width,height}) / Rect({width,height,radiusWidth,radiusHeight}) /
//      Ellipse({width,height}) / Line({width,height,startPoint,endPoint}) /
//      Path({width,height,commands})
//   ② 属性方法形态：.fill(Color.Red)（枚举自由变量）/ .fill('#hex')（字符串）/
//      .stroke / .strokeWidth / .fillOpacity / .strokeOpacity
//   ③ Polygon/Polyline 的 .points([[x,y],…])
//   ④ Shape 容器：嵌套子形状 + .viewPort({x,y,width,height}) + 容器自身的 fill/stroke
//
// 语义锚点（circle.d.ts 等的 JSDoc 原文，实现时照抄）：
//   fill 默认 Color.Black；stroke 默认 Color.Transparent（"the default stroke opacity is 0"）；
//   CircleOptions 的 width/height 默认 0。
@Entry
@Component
struct ShapeDemo {
  build() {
    Column({ space: 8 }) {
      // ① 枚举颜色 + 描边。⚠️ 非正方形：80×60 的内切圆 r=30 —— r=min(w,h)/2 的取值方向
      // 只有非正方形才能测出来（正方形下 min=max，破坏验证会空转，R13 坑 2 的翻版）
      Circle({ width: 80, height: 60 })
        .id('c1')
        .fill(Color.Red)
        .stroke(Color.Blue)
        .strokeWidth(3)

      // ② 圆角矩形 + 字符串颜色
      Rect({ width: 120, height: 60, radiusWidth: 12, radiusHeight: 12 })
        .id('r1')
        .fill(Color.Green)
        .stroke('#333333')
        .strokeWidth(2)

      // ③ 椭圆
      Ellipse({ width: 100, height: 50 })
        .id('e1')
        .fill('#ffcc00')

      // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
      Line({ width: 100, height: 40 })
        .id('l1')
        .startPoint([0, 20])
        .endPoint([100, 20])
        .stroke(Color.Red)
        .strokeWidth(2)

      // ⑤ 路径：commands 原样进 d
      Path({ width: 100, height: 100, commands: 'M0 0 L50 50 L100 0' })
        .id('p1')
        .stroke('#0066cc')
        .strokeWidth(2)
        .fillOpacity(0)

      // ⑥ 多边形：points
      Polygon({ width: 80, height: 80 })
        .id('pg1')
        .points([[40, 0], [80, 80], [0, 80]])
        .fill('#cc6600')

      // ⑦ 折线：points + 不填充
      Polyline({ width: 100, height: 60 })
        .id('pl1')
        .points([[0, 40], [50, 0], [100, 40]])
        .stroke('#990099')
        .strokeWidth(3)
        .fillOpacity(0)

      // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
      Shape() {
        Rect().width('100%').height('100%')
        Circle({ width: 40, height: 40 })
      }
      .id('sh1')
      .width(120)
      .height(80)
      .viewPort({ x: 0, y: 0, width: 120, height: 80 })
      .fill('#eeeeee')
      .stroke('#222222')
      .strokeWidth(1)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
