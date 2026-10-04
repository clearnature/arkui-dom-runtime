// R19 测量/验证用页面：@ohos.notificationManager
import { notificationManager } from '@kit.NotificationKit';

@Entry
@Component
struct MeasNotify {
  @State published: string = '';
  @State err: string = '';
  @State badErr: string = '';

  aboutToAppear() {
    // ① 基本文本通知（带显式 content type）
    notificationManager.publish({
      id: 1,
      content: {
        notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
        normal: { title: '标题A', text: '正文A' }
      }
    }).then(() => {
      this.published = this.published + 'p1;';
    }).catch((e: Error) => {
      this.err = 'e1:' + e.message;
    });

    // ② 第二条（不带 content type —— 看编译器是否接受）
    // R163 真机实录（第六端对拍首个真发现）：真机参数校验是【同步抛 401 Invalid
    // parameter】——.catch 接不住同步抛，异常穿出 aboutToAppear → jscrash 进程终止
    //（故障日志 MeasNotify.ets:26:25）。sync 兜底保探针本意：编译器仍看无 type 形态，
    // 运行时差异记进 err 通道（真机记 e2s:，垫片路径仍走 e2:/p2;）
    try {
      notificationManager.publish({
        id: 2,
        content: {
          normal: { title: '标题B', text: '正文B' }
        }
      }).then(() => {
        this.published = this.published + 'p2;';
      }).catch((e: Error) => {
        this.err = 'e2:' + e.message;
      });
    } catch (e) {
      this.err = 'e2s:' + (e as Error).message;
    }

    // ③ 取消一条
    notificationManager.cancel(1).then(() => {
      this.published = this.published + 'c1;';
    }).catch((e: Error) => {
      this.err = 'e3:' + e.message;
    });

    // ④ 取消全部
    notificationManager.cancelAll().then(() => {
      this.published = this.published + 'ca;';
    }).catch((e: Error) => {
      this.err = 'e4:' + e.message;
    });

    // ⑤ 负向：content 是空的 —— 必须被拒绝（不是静默成功）
    // R163 同族：真机也是【同步抛 401】（故障日志 MeasNotify.ets:60:25——②修完⑤成为
    // 新栈），.catch 接不住；sync 兜底记录同 badErr 通道（真机同步拒绝 = 负向探针成立）
    try {
      notificationManager.publish({ id: 3, content: {} }).then(() => {
        this.published = this.published + 'p3-bad;';
      }).catch((e: Error) => {
        this.badErr = e.message;
      });
    } catch (e) {
      this.badErr = (e as Error).message;
    }
  }

  build() {
    Column({ space: 2 }) {
      Text('published=' + this.published).id('pub')
      Text('err=' + this.err).id('err')
      Text('badErr=' + this.badErr).id('badErr')
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
