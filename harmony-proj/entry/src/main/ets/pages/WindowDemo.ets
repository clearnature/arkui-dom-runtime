// R80 窗口 API 用例页：@ohos.window v1 子集（桌面主目标）
//   语义验证窗口：getLastWindow → setBackgroundColor/resize/moveTo/show/minimize →
//   on('windowSizeChange') → off；destroy 在测试驱动下被主进程拒绝（防 harness 假死）。
//   注意真编译源用 kit 形式导入（@kit.ArkUI），产物转成 @ohos:window（与运行时垫片对接）。
import { window } from '@kit.ArkUI';

@Entry
@Component
struct WindowDemo {
  @State log: string = ''
  @State lastSize: string = ''

  build() {
    Column({ space: 6 }) {
      Button('bg').id('btn-bg').onClick(() => {
        window.getLastWindow(getContext(this)).then((w: window.Window) => {
          return w.setWindowBackgroundColor('#223344');
        }).then(() => {
          this.log = this.log + 'bg;';
        });
      })
      Button('resize').id('btn-resize').onClick(() => {
        window.getLastWindow(getContext(this)).then((w: window.Window) => {
          return w.resize(600, 500);
        }).then(() => {
          this.log = this.log + 'resize;';
        });
      })
      Button('move').id('btn-move').onClick(() => {
        window.getLastWindow(getContext(this)).then((w: window.Window) => {
          return w.moveTo(40, 40);
        }).then(() => {
          this.log = this.log + 'move;';
        });
      })
      Button('listen').id('btn-listen').onClick(() => {
        window.getLastWindow(getContext(this)).then((w: window.Window) => {
          w.on('windowSizeChange', (sz: window.Size) => {
            this.lastSize = sz.width + 'x' + sz.height;
          });
          this.log = this.log + 'listen;';
        });
      })
      Text('log=' + this.log).id('win-log')
      Text('size=' + this.lastSize).id('win-size')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
