// R90 NotesDemo 详情页：router.getParams 接收首页参数 + back 返回
import { router } from '@kit.ArkUI';

@Entry
@Component
struct NotesDetail {
  @State idx: number = -1
  @State title: string = ''

  onPageShow() {
    const p = router.getParams() as Record<string, string>;
    if (p) {
      this.idx = Number(p.idx);
      this.title = String(p.title);
    }
  }

  build() {
    Column({ space: 6 }) {
      Text('detail idx=' + this.idx).id('detail-idx').fontSize(15)
      Text('title=' + this.title).id('detail-title').fontSize(13)
      Button('back').id('btn-back').onClick(() => {
        router.back();
      })
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
