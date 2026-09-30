if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface BatchInputDemo_Params {
    cgLog?: string;
    plLog?: string;
    ctrl?: PatternLockController;
}
class BatchInputDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__cgLog = new ObservedPropertySimplePU('', this, "cgLog");
        this.__plLog = new ObservedPropertySimplePU('', this, "plLog");
        this.ctrl = new PatternLockController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: BatchInputDemo_Params) {
        if (params.cgLog !== undefined) {
            this.cgLog = params.cgLog;
        }
        if (params.plLog !== undefined) {
            this.plLog = params.plLog;
        }
        if (params.ctrl !== undefined) {
            this.ctrl = params.ctrl;
        }
    }
    updateStateVars(params: BatchInputDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__cgLog.purgeDependencyOnElmtId(rmElmtId);
        this.__plLog.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__cgLog.aboutToBeDeleted();
        this.__plLog.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __cgLog: ObservedPropertySimplePU<string>;
    get cgLog() {
        return this.__cgLog.get();
    }
    set cgLog(newValue: string) {
        this.__cgLog.set(newValue);
    }
    private __plLog: ObservedPropertySimplePU<string>;
    get plLog() {
        return this.__plLog.get();
    }
    set plLog(newValue: string) {
        this.__plLog.set(newValue);
    }
    private ctrl: PatternLockController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
            CheckboxGroup.create({ group: 'fruits' });
            // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
            CheckboxGroup.id('cg1');
            // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
            CheckboxGroup.selectAll(false);
            // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
            CheckboxGroup.selectedColor('#007dff');
            // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
            CheckboxGroup.checkboxShape(CheckBoxShape.CIRCLE);
            // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
            CheckboxGroup.onChange((res: CheckboxGroupResult) => {
                this.cgLog = this.cgLog + 'CG' + res.name.length + '/' + res.status + ';';
            });
        }, CheckboxGroup);
        // ① CheckboxGroup：全选母节点 + 两个组员（组员自态变化也要带动组 onChange）
        CheckboxGroup.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Checkbox.create({ name: 'apple', group: 'fruits' });
            Checkbox.id('cb-apple');
        }, Checkbox);
        Checkbox.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Checkbox.create({ name: 'banana', group: 'fruits' });
            Checkbox.id('cb-banana');
        }, Checkbox);
        Checkbox.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.create(this.ctrl);
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.id('pl1');
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.sideLength(240);
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.circleRadius(12);
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.pathColor('#ff6600');
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.autoReset(false);
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.onDotConnect((idx: number) => { this.plLog = this.plLog + 'D' + idx + ';'; });
            // ② PatternLock：9 点位手势锁（autoReset(false) 便于断言读序）+ 控制器
            PatternLock.onPatternComplete((input: Array<number>) => {
                this.plLog = this.plLog + 'P' + input.join('') + ';';
            });
        }, PatternLock);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.cgLog);
            Text.id('cg-log');
            Text.fontSize(12);
            Text.height(20);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.plLog);
            Text.id('pl-log');
            Text.fontSize(12);
            Text.height(20);
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
        return "BatchInputDemo";
    }
}
registerNamedRoute(() => new BatchInputDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/BatchInputDemo", pageFullPath: "entry/src/main/ets/pages/BatchInputDemo", integratedHsp: "false", moduleType: "followWithHap" });
