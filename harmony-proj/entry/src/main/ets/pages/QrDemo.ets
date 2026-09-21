// R33 测量/验证用页面：信息展示收官 **QRCode**（真实编码器 + 独立解码交叉验证）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① QRCode(value: ResourceStr) —— 最多 512 字符（超出取前 512，JSDoc 原文）
//   ② color 默认 '#ff000000'／backgroundColor 默认 '#ffffffff'（API 11+，JSDoc 原文）／
//      contentOpacity 默认 1，范围 [0,1]
//
// 编码器来自移植的第三方库（global.ArkuiVendorQrcode，runtime/vendor/qrcode-1.5.4.js，
// 见 THIRD-PARTY-NOTICES §3b）；解码器来自**另一个独立第三方** jsQR（test/vendor/jsqr-1.4.0.js，
// 由测试页加载）——两者互为独立实现，"画出来的码能被独立解码器读回原文"才是有牙齿的断言。
@Entry
@Component
struct QrDemo {
  build() {
    Column({ space: 8 }) {
      QRCode('https://example.com/qr-test-123')
        .id('qr1')
        .width(180)
        .height(180)

      // 含非 ASCII（UTF-8 多字节）与数字：字节模式编码的对照
      QRCode('你好 QR 码 123')
        .id('qr2')
        .width(160)
        .height(160)

      // 颜色定制
      QRCode('https://example.com/colored')
        .id('qr3')
        .width(160)
        .height(160)
        .color('#1234aa')
        .backgroundColor('#eeeeff')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
