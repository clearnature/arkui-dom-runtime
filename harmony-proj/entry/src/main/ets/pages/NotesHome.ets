// R90 千节点真实应用样例：NotesDemo 首页——300 行备忘录列表 + 搜索过滤 + 剪贴板 + 设备信息
//   端到端集成验证：路由多页 / ForEach 大列表（~1200 节点）/ @State 驱动过滤 / 平台 API。
//   kit 导入（真编译器要求）；params 走字符串（R66 联合类型拒绝坑）。
import { router } from '@kit.ArkUI';
import { pasteboard, deviceInfo } from '@kit.BasicServicesKit';

interface NoteItem {
  title: string;
  body: string;
  date: string;
}

@Entry
@Component
struct NotesHome {
  @State notes: NoteItem[] = []
  @State keyword: string = ''
  @State deviceLine: string = ''
  @State copyLog: string = ''

  aboutToAppear() {
    const arr: NoteItem[] = [];
    for (let i = 0; i < 300; i++) {
      arr.push({ title: 'Note ' + i, body: 'Body of Note ' + i + ' for copy test', date: '2026-09-26' });
    }
    this.notes = arr;
    this.deviceLine = deviceInfo.productModel + ' / ' + deviceInfo.osFullName;
  }

  filtered(): NoteItem[] {
    const out: NoteItem[] = [];
    for (const n of this.notes) {
      if (this.keyword === '' || n.title.indexOf(this.keyword) >= 0) {
        out.push(n);
      }
    }
    return out;
  }

  build() {
    Column({ space: 4 }) {
      Text('Notes ' + this.deviceLine).id('home-title').fontSize(14)
      TextInput({ placeholder: 'search' }).id('search-box').onChange((v: string) => {
        this.keyword = v;
      })
      Button('copy-first').id('btn-copy').onClick(() => {
        const pb = pasteboard.getSystemPasteboard();
        pb.setData(pasteboard.createData('text/plain', this.notes[0].body)).then(() => {
          this.copyLog = 'copied';
        });
      })
      Text('copyLog=' + this.copyLog).id('copy-log').fontSize(11)
      Text('count=' + this.filtered().length).id('note-count').fontSize(11)
      List({ space: 2 }) {
        ForEach(this.filtered(), (n: NoteItem, idx: number) => {
          ListItem() {
            Row() {
              Text(n.title).fontSize(14).fontColor('#222222')
              Text(n.date).fontSize(11).fontColor('#888888').margin({ left: 8 })
            }
            .width('90%')
            .padding(6)
            .onClick(() => {
              router.pushUrl({ url: 'pages/NotesDetail', params: { idx: String(idx), title: n.title } });
            })
          }
        }, (n: NoteItem, idx: number) => 'n' + idx)
      }
      .width('100%')
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
