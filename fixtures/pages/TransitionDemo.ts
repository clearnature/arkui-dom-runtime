if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TransitionDemo_Params {
    showA?: boolean;
    showB?: boolean;
    showC?: boolean;
    showD?: boolean;
    showE?: boolean;
    fin?: string;
    n?: number;
}
class TransitionDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__showA = new ObservedPropertySimplePU(true, this, "showA");
        this.__showB = new ObservedPropertySimplePU(true, this, "showB");
        this.__showC = new ObservedPropertySimplePU(false, this, "showC");
        this.__showD = new ObservedPropertySimplePU(true, this, "showD");
        this.__showE = new ObservedPropertySimplePU(true, this, "showE");
        this.__fin = new ObservedPropertySimplePU('', this, "fin");
        this.__n = new ObservedPropertySimplePU(0, this, "n");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TransitionDemo_Params) {
        if (params.showA !== undefined) {
            this.showA = params.showA;
        }
        if (params.showB !== undefined) {
            this.showB = params.showB;
        }
        if (params.showC !== undefined) {
            this.showC = params.showC;
        }
        if (params.showD !== undefined) {
            this.showD = params.showD;
        }
        if (params.showE !== undefined) {
            this.showE = params.showE;
        }
        if (params.fin !== undefined) {
            this.fin = params.fin;
        }
        if (params.n !== undefined) {
            this.n = params.n;
        }
    }
    updateStateVars(params: TransitionDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__showA.purgeDependencyOnElmtId(rmElmtId);
        this.__showB.purgeDependencyOnElmtId(rmElmtId);
        this.__showC.purgeDependencyOnElmtId(rmElmtId);
        this.__showD.purgeDependencyOnElmtId(rmElmtId);
        this.__showE.purgeDependencyOnElmtId(rmElmtId);
        this.__fin.purgeDependencyOnElmtId(rmElmtId);
        this.__n.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__showA.aboutToBeDeleted();
        this.__showB.aboutToBeDeleted();
        this.__showC.aboutToBeDeleted();
        this.__showD.aboutToBeDeleted();
        this.__showE.aboutToBeDeleted();
        this.__fin.aboutToBeDeleted();
        this.__n.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __showA: ObservedPropertySimplePU<boolean>;
    get showA() {
        return this.__showA.get();
    }
    set showA(newValue: boolean) {
        this.__showA.set(newValue);
    }
    private __showB: ObservedPropertySimplePU<boolean>;
    get showB() {
        return this.__showB.get();
    }
    set showB(newValue: boolean) {
        this.__showB.set(newValue);
    }
    private __showC: ObservedPropertySimplePU<boolean>;
    get showC() {
        return this.__showC.get();
    }
    set showC(newValue: boolean) {
        this.__showC.set(newValue);
    }
    private __showD: ObservedPropertySimplePU<boolean>;
    get showD() {
        return this.__showD.get();
    }
    set showD(newValue: boolean) {
        this.__showD.set(newValue);
    }
    private __showE: ObservedPropertySimplePU<boolean>;
    get showE() {
        return this.__showE.get();
    }
    set showE(newValue: boolean) {
        this.__showE.set(newValue);
    }
    private __fin: ObservedPropertySimplePU<string>;
    get fin() {
        return this.__fin.get();
    }
    set fin(newValue: string) {
        this.__fin.set(newValue);
    }
    private __n: ObservedPropertySimplePU<number>;
    get n() {
        return this.__n.get();
    }
    set n(newValue: number) {
        this.__n.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.showA) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('a')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            // ① TransitionOptions：type 默认 All；opacity/translate 描述"偏离态"
                            Text.create('A');
                            // ① TransitionOptions：type 默认 All；opacity/translate 描述"偏离态"
                            Text.id('a');
                            // ① TransitionOptions：type 默认 All；opacity/translate 描述"偏离态"
                            Text.transition({ opacity: 0, translate: { x: 0, y: 40 } });
                        }, Text);
                        // ① TransitionOptions：type 默认 All；opacity/translate 描述"偏离态"
                        Text.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.showB) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('b')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            // ② TransitionEffect：combine 两段 + animation 自带参数（不依赖 animateTo）
                            Text.create('B');
                            // ② TransitionEffect：combine 两段 + animation 自带参数（不依赖 animateTo）
                            Text.id('b');
                            // ② TransitionEffect：combine 两段 + animation 自带参数（不依赖 animateTo）
                            Text.transition(TransitionEffect.OPACITY
                                .combine(TransitionEffect.translate({ x: 20, y: 0 }))
                                .animation({ duration: 200, curve: Curve.Linear }));
                        }, Text);
                        // ② TransitionEffect：combine 两段 + animation 自带参数（不依赖 animateTo）
                        Text.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.showC) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('c')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            // ③ asymmetric + onFinish 重载：出现/消失用不同效果，结束时回调带 transitionIn
                            Text.create('C');
                            // ③ asymmetric + onFinish 重载：出现/消失用不同效果，结束时回调带 transitionIn
                            Text.id('c');
                            // ③ asymmetric + onFinish 重载：出现/消失用不同效果，结束时回调带 transitionIn
                            Text.transition(TransitionEffect.asymmetric(TransitionEffect.OPACITY.animation({ duration: 150 }), TransitionEffect.scale({ x: 0.2, y: 0.2 }).combine(TransitionEffect.OPACITY).animation({ duration: 250 })), (transitionIn: boolean) => { this.fin = this.fin + (transitionIn ? 'I;' : 'D;'); });
                        }, Text);
                        // ③ asymmetric + onFinish 重载：出现/消失用不同效果，结束时回调带 transitionIn
                        Text.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('fin=' + this.fin);
            Text.id('fin');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('n=' + this.n);
            Text.id('n');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.showD) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('d')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            // ④ 显式 type: Insert —— 只该在【出现】时动，删除时要立刻消失（不拖时间）
                            Text.create('D');
                            // ④ 显式 type: Insert —— 只该在【出现】时动，删除时要立刻消失（不拖时间）
                            Text.id('d');
                            // ④ 显式 type: Insert —— 只该在【出现】时动，删除时要立刻消失（不拖时间）
                            Text.transition({ type: TransitionType.Insert, opacity: 0 });
                        }, Text);
                        // ④ 显式 type: Insert —— 只该在【出现】时动，删除时要立刻消失（不拖时间）
                        Text.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.showE) {
                this.ifElseBranchUpdateFunction(0, () => {
                    if (!If.canRetake('e')) {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            // ⑤ 显式 type: Delete —— 只该在【消失】时动，插入时不带过渡
                            Text.create('E');
                            // ⑤ 显式 type: Delete —— 只该在【消失】时动，插入时不带过渡
                            Text.id('e');
                            // ⑤ 显式 type: Delete —— 只该在【消失】时动，插入时不带过渡
                            Text.transition({ type: TransitionType.Delete, opacity: 0 });
                        }, Text);
                        // ⑤ 显式 type: Delete —— 只该在【消失】时动，插入时不带过渡
                        Text.pop();
                    }
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('flipA');
            Button.id('btn-a');
            Button.onClick(() => {
                // A 的插入/删除发生在 animateTo 里 —— TransitionOptions 的时长就取这里
                Context.animateTo({ duration: 300, curve: Curve.EaseInOut }, () => {
                    this.showA = !this.showA;
                    this.n = this.n + 1;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('flipB');
            Button.id('btn-b');
            Button.onClick(() => {
                // B 不在 animateTo 里 —— TransitionEffect 自带 animation 参数，应当照样动
                this.showB = !this.showB;
                this.n = this.n + 1;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('flipC');
            Button.id('btn-c');
            Button.onClick(() => {
                this.showC = !this.showC;
                this.n = this.n + 1;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('flipD');
            Button.id('btn-d');
            Button.onClick(() => {
                Context.animateTo({ duration: 300, curve: Curve.Linear }, () => {
                    this.showD = !this.showD;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('flipE');
            Button.id('btn-e');
            Button.onClick(() => {
                Context.animateTo({ duration: 300, curve: Curve.Linear }, () => {
                    this.showE = !this.showE;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('reA');
            Button.id('btn-reA');
            Button.onClick(() => {
                // 只改 n（A 的 if 条件不变）→ A 应当**不**被插入/删除，也就没有转场
                this.n = this.n + 1;
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "TransitionDemo";
    }
}
registerNamedRoute(() => new TransitionDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/TransitionDemo", pageFullPath: "entry/src/main/ets/pages/TransitionDemo", integratedHsp: "false", moduleType: "followWithHap" });
