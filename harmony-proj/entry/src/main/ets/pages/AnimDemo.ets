// R22 测量/验证用页面：animateTo / animateToImmediately / Curve / PlayMode
//
// ⚠️ .d.ts 明确警告："Avoid using animateTo in aboutToAppear" ——
// 那时组件还没 build 出来，没有初值可动画。所以这里一律由【点击】触发（测试点按钮）。
@Entry
@Component
struct AnimDemo {
  @State w: number = 100;
  @State op: number = 1;
  @State fin: string = '';

  build() {
    Column({ space: 6 }) {
      Row().width(this.w).height(20).backgroundColor('#3366cc').id('box')
      Text('w=' + this.w).id('w')
      Text('op=' + this.op).id('op')
      Text('fin=' + this.fin).id('fin')
      Button('anim').id('btn-anim').onClick(() => {
        // ① duration>0：动画窗口包住状态变更；onFinish 要真的被调
        animateTo({
          duration: 300, curve: Curve.EaseInOut, delay: 0,
          onFinish: () => { this.fin = this.fin + 'A;'; }
        }, () => {
          this.w = 220;
          this.op = 0.5;
        });
      })
      Button('zero').id('btn-zero').onClick(() => {
        // ② duration: 0 —— 目标值要变，但【不进动画】（不带 transition）
        animateTo({
          duration: 0,
          onFinish: () => { this.fin = this.fin + 'Z;'; }
        }, () => {
          this.op = 0.8;
        });
      })
      Button('imm').id('btn-imm').onClick(() => {
        // ③ animateToImmediately（.d.ts since 12）
        animateToImmediately({
          duration: 250, curve: Curve.Linear,
          onFinish: () => { this.fin = this.fin + 'I;'; }
        }, () => {
          this.w = 260;
        });
      })
      Button('loop').id('btn-loop').onClick(() => {
        // ④ CSS transition 表达不了的参数（iterations/playMode）—— 必须出声，不能静默
        animateTo({
          duration: 200, iterations: 3, playMode: PlayMode.Alternate
        }, () => {
          this.w = 300;
        });
      })
      Button('delay').id('btn-delay').onClick(() => {
        // ⑤ delay 要真的进 transition-delay
        animateTo({ duration: 150, delay: 120, curve: Curve.Linear }, () => {
          this.op = 0.2;
        });
      })
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
