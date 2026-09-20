// R23 收口测量/验证用页面：手势分组、优先级与仲裁
//
// ⚠️ 先测量再实现：本页是为了让官方编译器把下列 API 的产物形态暴露出来，覆盖四类：
//   ① RotationGesture({fingers, angle}) —— 目前只在 GESTURE_TYPES 里登记、没有识别器
//   ② GestureGroup(mode, ...gesture) —— Sequence / Parallel / Exclusive 三态 + onCancel
//   ③ .priorityGesture(g, mask)      —— 父子同型手势时父优先
//   ④ .parallelGesture(g, mask)      —— 父子同时响应（不外传 = 不回冒）
// 另带 GestureMask.IgnoreInternal 变体，用来确认 mask 参有没有被产物带下来。
//
// 触发方式：全部走合成 pointer 事件（与 GestureDemo 同一套），父/子元素靠 DOM 包含关系区分。
@Entry
@Component
struct GestureGroupDemo {
  @State log: string = '';
  @State rot: string = '';
  @State grp: string = '';
  @State arb: string = '';

  build() {
    Column({ space: 6 }) {
      // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
      Row()
        .width(140)
        .height(60)
        .backgroundColor('#3366cc')
        .id('rot')
        .gesture(
          RotationGesture({ fingers: 2, angle: 1 })
            .onActionStart((e: GestureEvent) => {
              this.log = this.log + 'RS;';
            })
            .onActionUpdate((e: GestureEvent) => {
              this.rot = 'ang=' + Math.round(e.angle);
            })
            .onActionEnd((e: GestureEvent) => {
              this.log = this.log + 'RE;';
              this.rot = 'end=' + Math.round(e.angle);
            })
        )

      // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
      Row()
        .width(140)
        .height(40)
        .backgroundColor('#228833')
        .id('gx')
        .gesture(
          GestureGroup(GestureMode.Exclusive,
            TapGesture({ count: 1, fingers: 1 })
              .onAction((e: GestureEvent) => {
                this.grp = this.grp + 'X;';
              }),
            PanGesture({ fingers: 1, distance: 5 })
              .onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'UD;';
              })
          )
            .onCancel(() => {
              this.grp = this.grp + 'Xc;';
            })
        )

      // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
      //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
      Row()
        .width(140)
        .height(40)
        .backgroundColor('#aa6622')
        .id('gs')
        .gesture(
          GestureGroup(GestureMode.Sequence,
            LongPressGesture({ repeat: false, duration: 200 })
              .onAction((e: GestureEvent) => {
                this.grp = this.grp + 'S1;';
              }),
            PanGesture({ fingers: 1, distance: 5 })
              .onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'S2;';
              })
              .onActionEnd((e: GestureEvent) => {
                this.grp = this.grp + 'S2e;';
              })
          )
            .onCancel(() => {
              this.grp = this.grp + 'Sc;';
            })
        )

      // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
      //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
      Row()
        .width(140)
        .height(30)
        .backgroundColor('#775522')
        .id('gs2')
        .gesture(
          GestureGroup(GestureMode.Sequence,
            PanGesture({ fingers: 1, distance: 5 })
              .onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'U1;';
              })
              .onActionEnd((e: GestureEvent) => {
                this.grp = this.grp + 'U1e;';
              }),
            PanGesture({ fingers: 1, distance: 1 })
              .onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'U2;';
              })
              .onActionEnd((e: GestureEvent) => {
                this.grp = this.grp + 'U2e;';
              })
          )
            .onCancel(() => {
              this.grp = this.grp + 'Uc;';
            })
        )

      // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
      Row()
        .width(140)
        .height(40)
        .backgroundColor('#883399')
        .id('gp')
        .gesture(
          GestureGroup(GestureMode.Parallel,
            TapGesture({ count: 1, fingers: 1 })
              .onAction((e: GestureEvent) => {
                this.grp = this.grp + 'P1;';
              }),
            LongPressGesture({ repeat: false, duration: 200 })
              .onAction((e: GestureEvent) => {
                this.grp = this.grp + 'P2;';
              })
          )
            .onCancel(() => {
              this.grp = this.grp + 'Pc;';
            })
        )

      // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
      Column() {
        Row()
          .width(60)
          .height(30)
          .backgroundColor('#cc3333')
          .id('pc')
          .gesture(
            TapGesture({ count: 1, fingers: 1 })
              .onAction((e: GestureEvent) => {
                this.arb = this.arb + 'c;';
              })
          )
      }
      .width(140)
      .height(50)
      .backgroundColor('#333333')
      .id('pp')
      .priorityGesture(
        TapGesture({ count: 1, fingers: 1 })
          .onAction((e: GestureEvent) => {
            this.arb = this.arb + 'P;';
          })
      )

      // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
      Column() {
        Row()
          .width(60)
          .height(30)
          .backgroundColor('#117799')
          .id('lc')
          .gesture(
            TapGesture({ count: 1, fingers: 1 })
              .onAction((e: GestureEvent) => {
                this.arb = this.arb + 'd;';
              })
          )
      }
      .width(140)
      .height(50)
      .backgroundColor('#444444')
      .id('lp')
      .parallelGesture(
        TapGesture({ count: 1, fingers: 1 })
          .onAction((e: GestureEvent) => {
            this.arb = this.arb + 'L;';
          })
      )

      // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
      Column() {
        Row()
          .width(60)
          .height(20)
          .backgroundColor('#dddddd')
          .id('maskc')
          .gesture(
            TapGesture({ count: 1, fingers: 1 })
              .onAction((e: GestureEvent) => {
                this.grp = this.grp + 'm;';
              })
          )
      }
      .width(140)
      .height(40)
      .backgroundColor('#666666')
      .id('mask')
      .gesture(
        TapGesture({ count: 1, fingers: 1 })
          .onAction((e: GestureEvent) => {
            this.grp = this.grp + 'M;';
          }),
        GestureMask.IgnoreInternal
      )

      // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
      Column() {
        Row()
          .width(60)
          .height(20)
          .backgroundColor('#997700')
          .id('dc')
          .gesture(
            TapGesture({ count: 1, fingers: 1 })
              .onAction((e: GestureEvent) => {
                this.arb = this.arb + 'e;';
              })
          )
      }
      .width(140)
      .height(40)
      .backgroundColor('#555555')
      .id('dp')
      .gesture(
        TapGesture({ count: 1, fingers: 1 })
          .onAction((e: GestureEvent) => {
            this.arb = this.arb + 'D;';
          })
      )

      Text('rot=' + this.rot).id('grot')
      Text('grp=' + this.grp).id('ggrp')
      Text('arb=' + this.arb).id('garb')
      Text('log=' + this.log).id('glog')
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
