// R82 文件选择器用例页：@ohos.file.picker v1（桌面主目标）
//   DocumentViewPicker.select/save（d.ts：返回 Promise<Array<string>>）+
//   PhotoViewPicker.select（返回 Promise<PhotoSelectResult{ photoUris }>）。
//   注意 kit 导入（真编译器要求）；getContext(this) 供 picker 构造形参。
import { picker } from '@kit.CoreFileKit';

@Entry
@Component
struct PickerDemo {
  @State log: string = ''
  @State picked: string = ''

  build() {
    Column({ space: 6 }) {
      Button('doc-select').id('btn-doc').onClick(() => {
        const doc = new picker.DocumentViewPicker(getContext(this));
        doc.select({ maxSelectNumber: 2, fileSuffixFilters: ['.txt'] }).then((uris: Array<string>) => {
          this.picked = uris.join('|');
          this.log = this.log + 'doc;';
        });
      })
      Button('doc-save').id('btn-save').onClick(() => {
        const doc = new picker.DocumentViewPicker(getContext(this));
        doc.save({ newFileNames: ['saved.txt'] }).then((uris: Array<string>) => {
          this.picked = uris.length ? uris[0] : 'null';
          this.log = this.log + 'save;';
        });
      })
      Button('photo-select').id('btn-photo').onClick(() => {
        const ph = new picker.PhotoViewPicker(getContext(this));
        ph.select().then((r: picker.PhotoSelectResult) => {
          this.picked = r.photoUris.join('|');
          this.log = this.log + 'photo;';
        });
      })
      Text('log=' + this.log).id('pk-log')
      Text('picked=' + this.picked).id('pk-picked')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
