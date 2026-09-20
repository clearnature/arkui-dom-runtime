// R20 测量/验证用页面：@ohos.promptAction（showToast / showDialog）
// 注意：.d.ts 明确 "This module cannot be used in the file declaration of the UIAbility …
// the APIs of this module can be used only after a component instance is created" ——
// 所以提示类 API 只在【页面】里调，不能在 UIAbility 的生命周期里调。
import { promptAction } from '@kit.ArkUI';

@Entry
@Component
struct PromptAct {
  @State toastState: string = '';
  @State toastErr: string = '';
  @State dialogState: string = '';
  @State dialogErr: string = '';

  aboutToAppear(): void {
    // ① showToast 返回 void（.d.ts 原文：function showToast(options: ShowToastOptions): void）
    //    且 @throws 401 —— 编译器对 void 版会警告 "Function may throw exceptions. Special handling
    //    is required."（promise 版不警告）→ 即 void API 是【同步抛】，必须 try/catch
    try {
      promptAction.showToast({ message: '提示甲', duration: 1500 });
      // ② duration 越界行为（.d.ts 原文：Default value 1500；range [1500, 10000]；
      //    <1500 用默认值，>10000 取上限）—— 两条都越界，看实现是否照做
      promptAction.showToast({ message: '提示乙', duration: 100 });
      promptAction.showToast({ message: '提示丙', duration: 999999 });
      this.toastState = 'toast3;';
      // ③ 负向：缺 message → 同步抛 401
      promptAction.showToast({} as promptAction.ShowToastOptions);
      this.toastErr = 'unexpected-ok;';
    } catch (e) {
      this.toastErr = (this.toastState === '' ? 'first-throw:' : 'throw:') + (e as Error).message;
    }

    // ④ showDialog（Promise 形态）：点按钮后 resolve 出被点按钮的 index（从 0 起）。
    //    编译器【没有】对它警告 "may throw" → promise 版的 401 走 reject（调用方用 .catch）
    promptAction.showDialog({
      title: '对话框标题',
      message: '对话框正文',
      buttons: [{ text: '取消', color: '#666666' }, { text: '确定', color: '#007DFF' }]
    }).then((r: promptAction.ShowDialogSuccessResponse) => {
      this.dialogState = 'idx=' + r.index + ';';
    }).catch((e: Error) => {
      this.dialogErr = 'dialog-rej:' + e.message;
    });

    // ⑤ 负向：buttons 为空 —— 本实现要求非空（没有按钮的对话框无法用点击结束，
    //    与其造一个"永远点不掉"的假对话框，不如响亮失败；见 docs 已知限制）
    promptAction.showDialog({ title: '无按钮标题', message: '无按钮正文' })
      .then(() => {
        this.dialogErr = 'nobtn-unexpected-ok;';
      })
      .catch((e: Error) => {
        this.dialogErr = 'nobtn:' + e.message;
      });
  }

  build() {
    Column({ space: 2 }) {
      Text('toastState=' + this.toastState).id('toast')
      Text('toastErr=' + this.toastErr).id('toasterr')
      Text('dialogState=' + this.dialogState).id('dlg')
      Text('dialogErr=' + this.dialogErr).id('dlgerr')
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
