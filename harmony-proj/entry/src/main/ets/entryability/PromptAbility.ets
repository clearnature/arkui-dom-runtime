// R20 测量/验证用 ability：startAbilityForResult + terminateSelfWithResult + terminateSelf
//
// 同一个类扮演三种角色（用 want.parameters.role 区分）：
//   · caller       —— 发起两次 startAbilityForResult，把结果写进 hilog
//   · callee       —— 载入自己的页面后 terminateSelfWithResult（带回 resultCode 与 want）
//   · callee-plain —— 载入自己的页面后 terminateSelf()（不给结果）
// 结果是【由 want 算出来的】（resultCode = 200 + q、answer = q × 2），不是常量，
// 这样"把结果写死"的错误实现会被断言抓住。
import { AbilityConstant, UIAbility, Want, common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN = 0x0001;

export default class PromptAbility extends UIAbility {
  private role: string = 'caller';
  private q: number = 0;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const p: Record<string, Object> | undefined = want.parameters;
    if (p !== undefined) {
      const role: Object | undefined = p['role'];
      const q: Object | undefined = p['q'];
      if (role !== undefined) {
        this.role = role.toString();
      }
      if (q !== undefined) {
        this.q = parseInt(q.toString(), 10);
      }
    }
    hilog.info(DOMAIN, 'testTag', 'onCreate role=%{public}s q=%{public}d', this.role, this.q);
    if (this.role !== 'caller') {
      return;                       // 被启动方：等 windowStage 就绪后再结束自己
    }

    const ctx: common.UIAbilityContext = this.context as common.UIAbilityContext;

    // ① Promise 形态：被启动方带结果结束
    ctx.startAbilityForResult({
      bundleName: 'com.example.arkuidomprobe',
      abilityName: 'PromptAbility',
      parameters: { 'role': 'callee', 'q': 7 }
    }, { windowMode: 1 }).then((res: common.AbilityResult) => {
      hilog.info(DOMAIN, 'testTag', 'promise-formed: code=%{public}d answer=%{public}s',
        res.resultCode, this.answerOf(res));
    }).catch((e: Error) => {
      hilog.error(DOMAIN, 'testTag', 'promise-formed failed: %{public}s', e.message);
    });

    // ② 被启动方 terminateSelf() 结束、不给结果 —— 调用方不能挂住
    ctx.startAbilityForResult({
      bundleName: 'com.example.arkuidomprobe',
      abilityName: 'PromptAbility',
      parameters: { 'role': 'callee-plain', 'q': 11 }
    }).then((res: common.AbilityResult) => {
      hilog.info(DOMAIN, 'testTag', 'no-result-formed: code=%{public}d', res.resultCode);
    }).catch((e: Error) => {
      hilog.error(DOMAIN, 'testTag', 'no-result-formed failed: %{public}s', e.message);
    });
  }

  private answerOf(res: common.AbilityResult): string {
    const w: Want | undefined = res.want;
    if (w === undefined || w.parameters === undefined) {
      return '-';
    }
    const a: Object | undefined = w.parameters['answer'];
    return a === undefined ? '-' : a.toString();
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    const page: string = this.role === 'caller' ? 'pages/PromptAct' : 'pages/Callee';
    windowStage.loadContent(page, (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'loadContent ok: %{public}s', page);
      const ctx: common.UIAbilityContext = this.context as common.UIAbilityContext;
      if (this.role === 'callee') {
        ctx.terminateSelfWithResult({
          resultCode: 200 + this.q,
          want: { parameters: { 'answer': this.q * 2 } }
        }).then(() => {
          hilog.info(DOMAIN, 'testTag', '%{public}s', 'callee terminateSelfWithResult returned');
        }).catch((e: Error) => {
          hilog.error(DOMAIN, 'testTag', 'callee terminateSelfWithResult failed: %{public}s', e.message);
        });
      } else if (this.role === 'callee-plain') {
        ctx.terminateSelf().then(() => {
          hilog.info(DOMAIN, 'testTag', '%{public}s', 'callee terminateSelf returned');
        }).catch((e: Error) => {
          hilog.error(DOMAIN, 'testTag', 'callee terminateSelf failed: %{public}s', e.message);
        });
      }
    });
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
