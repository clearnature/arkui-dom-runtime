// R163/R167 切片 3：2in1 桌面窗口语义对拍页（真机 oracle）
//   R91 的 maximize/restore/isFocused + windowEvent 13 断言当前按 d.ts 校准、
//   与真机窗口管理器「仍有宿主差异」待实证（DEVICE-DIFF 域七）。
//   自动序列（无按钮——免 uitest 点击）：订阅 windowEvent → maximize → isFocused
//   →（500ms）→ restore → isFocused → 日志呈现。事件码 SHOWN=1/ACTIVE=2/
//   INACTIVE=3/HIDDEN=4/DESTROYED=7（d.ts WindowEventType）。
import { window } from '@kit.ArkUI';

@Entry
@Component
struct WinSem {
  @State log: string = '';

  aboutToAppear() {
    window.getLastWindow(getContext(this)).then((w: window.Window) => {
      w.on('windowEvent', (t: window.WindowEventType) => {
        this.log = this.log + 'E' + Number(t) + ';';
      });
      w.maximize().then(() => {
        this.log = this.log + 'max:F' + (w.isFocused() ? 1 : 0) + ';';
        setTimeout(() => {
          w.restore().then(() => {
            this.log = this.log + 'res:F' + (w.isFocused() ? 1 : 0) + ';';
          }).catch((e: Error) => {
            this.log = this.log + 'ERRr:' + e.message + ';';
          });
        }, 500);
      }).catch((e: Error) => {
        this.log = this.log + 'ERRm:' + e.message + ';';
      });
    }).catch((e: Error) => {
      this.log = this.log + 'ERRw:' + e.message + ';';
    });
  }

  build() {
    Column({ space: 6 }) {
      Text('winsem log=' + this.log).id('ws-log');
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
