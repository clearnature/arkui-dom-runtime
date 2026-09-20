if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface GestureGroupDemo_Params {
    log?: string;
    rot?: string;
    grp?: string;
    arb?: string;
}
class GestureGroupDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__rot = new ObservedPropertySimplePU('', this, "rot");
        this.__grp = new ObservedPropertySimplePU('', this, "grp");
        this.__arb = new ObservedPropertySimplePU('', this, "arb");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: GestureGroupDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.rot !== undefined) {
            this.rot = params.rot;
        }
        if (params.grp !== undefined) {
            this.grp = params.grp;
        }
        if (params.arb !== undefined) {
            this.arb = params.arb;
        }
    }
    updateStateVars(params: GestureGroupDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__rot.purgeDependencyOnElmtId(rmElmtId);
        this.__grp.purgeDependencyOnElmtId(rmElmtId);
        this.__arb.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__rot.aboutToBeDeleted();
        this.__grp.aboutToBeDeleted();
        this.__arb.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __log: ObservedPropertySimplePU<string>;
    get log() {
        return this.__log.get();
    }
    set log(newValue: string) {
        this.__log.set(newValue);
    }
    private __rot: ObservedPropertySimplePU<string>;
    get rot() {
        return this.__rot.get();
    }
    set rot(newValue: string) {
        this.__rot.set(newValue);
    }
    private __grp: ObservedPropertySimplePU<string>;
    get grp() {
        return this.__grp.get();
    }
    set grp(newValue: string) {
        this.__grp.set(newValue);
    }
    private __arb: ObservedPropertySimplePU<string>;
    get arb() {
        return this.__arb.get();
    }
    set arb(newValue: string) {
        this.__arb.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
            Row.create();
            // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
            Row.width(140);
            // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
            Row.height(60);
            // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
            Row.backgroundColor('#3366cc');
            // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
            Row.id('rot');
            globalThis.Gesture.create(GesturePriority.Low);
            RotationGesture.create({ fingers: 2, angle: 1 });
            RotationGesture.onActionStart((e: GestureEvent) => {
                this.log = this.log + 'RS;';
            });
            RotationGesture.onActionUpdate((e: GestureEvent) => {
                this.rot = 'ang=' + Math.round(e.angle);
            });
            RotationGesture.onActionEnd((e: GestureEvent) => {
                this.log = this.log + 'RE;';
                this.rot = 'end=' + Math.round(e.angle);
            });
            RotationGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        // ① RotationGesture：两指旋转，回调里的 angle 是累计转角（度）
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
            Row.create();
            // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
            Row.width(140);
            // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
            Row.height(40);
            // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
            Row.backgroundColor('#228833');
            // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
            Row.id('gx');
            globalThis.Gesture.create(GesturePriority.Low);
            GestureGroup.create(GestureMode.Exclusive);
            GestureGroup.onCancel(() => {
                this.grp = this.grp + 'Xc;';
            });
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.grp = this.grp + 'X;';
            });
            TapGesture.pop();
            PanGesture.create({ fingers: 1, distance: 5 });
            PanGesture.onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'UD;';
            });
            PanGesture.pop();
            GestureGroup.pop();
            globalThis.Gesture.pop();
        }, Row);
        // ② GestureGroup(Exclusive)：Tap 与 Pan 二选一，先认出者胜出
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
            //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
            Row.create();
            // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
            //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
            Row.width(140);
            // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
            //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
            Row.height(40);
            // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
            //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
            Row.backgroundColor('#aa6622');
            // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
            //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
            Row.id('gs');
            globalThis.Gesture.create(GesturePriority.Low);
            GestureGroup.create(GestureMode.Sequence);
            GestureGroup.onCancel(() => {
                this.grp = this.grp + 'Sc;';
            });
            LongPressGesture.create({ repeat: false, duration: 200 });
            LongPressGesture.onAction((e: GestureEvent) => {
                this.grp = this.grp + 'S1;';
            });
            LongPressGesture.pop();
            PanGesture.create({ fingers: 1, distance: 5 });
            PanGesture.onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'S2;';
            });
            PanGesture.onActionEnd((e: GestureEvent) => {
                this.grp = this.grp + 'S2e;';
            });
            PanGesture.pop();
            GestureGroup.pop();
            globalThis.Gesture.pop();
        }, Row);
        // ③ GestureGroup(Sequence)：必须按序全部认出，中途失败则后面不认
        //    长按(200ms) → 拖动：同一指针会话内可走完；只长按不拖 = 序列没走完
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
            //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
            Row.create();
            // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
            //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
            Row.width(140);
            // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
            //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
            Row.height(30);
            // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
            //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
            Row.backgroundColor('#775522');
            // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
            //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
            Row.id('gs2');
            globalThis.Gesture.create(GesturePriority.Low);
            GestureGroup.create(GestureMode.Sequence);
            GestureGroup.onCancel(() => {
                this.grp = this.grp + 'Uc;';
            });
            PanGesture.create({ fingers: 1, distance: 5 });
            PanGesture.onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'U1;';
            });
            PanGesture.onActionEnd((e: GestureEvent) => {
                this.grp = this.grp + 'U1e;';
            });
            PanGesture.pop();
            PanGesture.create({ fingers: 1, distance: 1 });
            PanGesture.onActionStart((e: GestureEvent) => {
                this.grp = this.grp + 'U2;';
            });
            PanGesture.onActionEnd((e: GestureEvent) => {
                this.grp = this.grp + 'U2e;';
            });
            PanGesture.pop();
            GestureGroup.pop();
            globalThis.Gesture.pop();
        }, Row);
        // ③b Sequence(两个 Pan)：验证【只有最后一个能收 onActionEnd】
        //     第 2 个 pan 的 distance=1 —— 位移 2px 时它本可以认出，但序列没轮到它 → 必须被挡住
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
            Row.create();
            // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
            Row.width(140);
            // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
            Row.height(40);
            // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
            Row.backgroundColor('#883399');
            // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
            Row.id('gp');
            globalThis.Gesture.create(GesturePriority.Low);
            GestureGroup.create(GestureMode.Parallel);
            GestureGroup.onCancel(() => {
                this.grp = this.grp + 'Pc;';
            });
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.grp = this.grp + 'P1;';
            });
            TapGesture.pop();
            LongPressGesture.create({ repeat: false, duration: 200 });
            LongPressGesture.onAction((e: GestureEvent) => {
                this.grp = this.grp + 'P2;';
            });
            LongPressGesture.pop();
            GestureGroup.pop();
            globalThis.Gesture.pop();
        }, Row);
        // ④ GestureGroup(Parallel)：各手势互不影响，同时有效
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
            Column.create();
            // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
            Column.width(140);
            // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
            Column.height(50);
            // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
            Column.backgroundColor('#333333');
            // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
            Column.id('pp');
            globalThis.Gesture.create(GesturePriority.High);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.arb = this.arb + 'P;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(60);
            Row.height(30);
            Row.backgroundColor('#cc3333');
            Row.id('pc');
            globalThis.Gesture.create(GesturePriority.Low);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.arb = this.arb + 'c;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        // ⑤ priorityGesture：父 priority + 子普通，同一次点击父应胜出
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
            Column.create();
            // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
            Column.width(140);
            // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
            Column.height(50);
            // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
            Column.backgroundColor('#444444');
            // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
            Column.id('lp');
            globalThis.Gesture.create(GesturePriority.Parallel);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.arb = this.arb + 'L;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(60);
            Row.height(30);
            Row.backgroundColor('#117799');
            Row.id('lc');
            globalThis.Gesture.create(GesturePriority.Low);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.arb = this.arb + 'd;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        // ⑥ parallelGesture：父 parallel + 子普通，同一次点击两者都应触发
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
            Column.create();
            // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
            Column.width(140);
            // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
            Column.height(40);
            // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
            Column.backgroundColor('#666666');
            // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
            Column.id('mask');
            globalThis.Gesture.create(GesturePriority.Low, GestureMask.IgnoreInternal);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.grp = this.grp + 'M;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(60);
            Row.height(20);
            Row.backgroundColor('#dddddd');
            Row.id('maskc');
            globalThis.Gesture.create(GesturePriority.Low);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.grp = this.grp + 'm;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        // ⑦ GestureMask.IgnoreInternal：确认 mask 参被产物带下来，且【子组件手势被禁用】
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
            Column.create();
            // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
            Column.width(140);
            // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
            Column.height(40);
            // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
            Column.backgroundColor('#555555');
            // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
            Column.id('dp');
            globalThis.Gesture.create(GesturePriority.Low);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.arb = this.arb + 'D;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(60);
            Row.height(20);
            Row.backgroundColor('#997700');
            Row.id('dc');
            globalThis.Gesture.create(GesturePriority.Low);
            TapGesture.create({ count: 1, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.arb = this.arb + 'e;';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        // ⑧ 默认对：父子都用普通 .gesture() → 按文档【子组件优先】
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('rot=' + this.rot);
            Text.id('grot');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('grp=' + this.grp);
            Text.id('ggrp');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('arb=' + this.arb);
            Text.id('garb');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.id('glog');
        }, Text);
        Text.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "GestureGroupDemo";
    }
}
registerNamedRoute(() => new GestureGroupDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/GestureGroupDemo", pageFullPath: "entry/src/main/ets/pages/GestureGroupDemo", integratedHsp: "false", moduleType: "followWithHap" });
