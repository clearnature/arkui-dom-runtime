// R28 测量/验证用页面：信息展示类 **Badge / Counter / Divider / Marquee**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① Badge({value, position}) —— 容器形态（子内容包在里面）；BadgePosition 枚举是不是自由变量
//   ② Counter —— 容器 + onInc/onDec 属性方法（内置 +/- 按钮的语义归属）
//   ③ Divider().vertical(true).color().strokeWidth()
//   ④ Marquee({src, loop}) + fontColor/fontSize + onStart/onFinish
//
// 本轮【不收】QRCode：真画需要完整 QR 编码器（Reed-Solomon 纠错编码），单列后续切片。
@Entry
@Component
struct ShowDemo {
  @State log: string = '';
  @State cnt: number = 5;

  build() {
    Column({ space: 8 }) {
      // ① Badge：value 形态 + 位置枚举。⚠️ BadgeStyle 字段是 color/fontSize/badgeColor…（编译期实测）
      Badge({
        count: 9,
        position: BadgePosition.RightTop,
        style: { badgeColor: Color.Red, color: Color.White, fontSize: 10 }
      }) {
        Text('msg').id('badge1-body')
      }
      .id('bd1')

      // ② Badge：style 定制（badgeColor/color/fontSize 都在 create 参数里 —— 没有 .style() 方法）
      Badge({
        value: '99',
        position: BadgePosition.Right,
        style: { badgeColor: '#1234ff', color: '#ffffff', fontSize: 12 }
      }) {
        Text('mail').id('badge2-body')
      }
      .id('bd2')

      // ③ Counter：容器 + 内置加减 + 事件归属
      Counter() {
        Text('5').id('counter-body')
      }
      .id('ct1')
      .onInc(() => { this.log = this.log + 'INC;'; })
      .onDec(() => { this.log = this.log + 'DEC;'; })

      // ④ Divider：横向默认 / 纵向 + 颜色粗细
      Divider()
        .id('dv1')
        .color('#888888')
        .strokeWidth(3)
      Divider()
        .id('dv2')
        .vertical(true)
        .strokeWidth(5)

      // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
      Marquee({ src: 'Hello marquee', start: true, loop: 2 })
        .id('mq1')
        .fontColor('#0066cc')
        .fontSize(16)
        .onStart(() => { this.log = this.log + 'MS;'; })
        .onFinish(() => { this.log = this.log + 'MF;'; })

      Text(this.log).id('show-log').fontSize(12).height(24)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
