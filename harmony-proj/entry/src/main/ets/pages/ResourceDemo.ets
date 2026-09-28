// R128 真实资源解析验证页：$r 各类型 + resourceManager 同步 API
//
// 让官方编译器把 $r 的产物形态暴露出来（app.* 资源是否被 loader 展开成 Resource 字面量、
// 带什么 id/type——这决定运行时解析器按什么键查表）。同步 API 走 aboutToAppear 落 @State。
import { resourceManager } from '@kit.LocalizationKit';

@Entry
@Component
struct ResourceDemo {
  @State slog: string = '';
  private resMgr: resourceManager.ResourceManager = getContext().resourceManager;

  aboutToAppear(): void {
    // 同步 API（resourceManager.d.ts 实测面）：字符串双形态 + 颜色(number) + 媒体
    const s1: string = this.resMgr.getStringByNameSync('res_hello');
    const s2: string = this.resMgr.getStringSync($r('app.string.res_desc'));
    const c1: number = this.resMgr.getColorByNameSync('res_brand');
    const m1: Uint8Array = this.resMgr.getMediaByNameSync('startIcon');
    this.slog = s1 + '|' + s2 + '|' + c1 + '|' + m1.byteLength;
  }

  build() {
    Column({ space: 6 }) {
      Text($r('app.string.res_hello'))
        .fontSize(18)
        .id('t-str')
      Text($r('app.string.res_desc'))
        .fontColor($r('app.color.res_brand'))
        .id('t-color')
      Text('float')
        .fontSize($r('app.float.res_icon_size'))
        .id('t-float')
      Image($r('app.media.startIcon'))
        .width(32)
        .height(32)
        .id('img-media')
      Text(this.slog)
        .id('t-slog')
    }
    .width('100%')
  }
}
