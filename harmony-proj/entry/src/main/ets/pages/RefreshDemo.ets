// R50 测量/验证用页面：Refresh 下拉刷新（pointer 驱动状态机 + 事件顺序 + 阈值/上限/禁触发）
//   ① rf1：默认参数（refreshOffset 64）——小拖回弹 / 超阈值刷新 / 子组件位移 / 停止刷新
//   ② rf2：refreshOffset(50) + maxPullDownDistance(80) + pullDownRatio(1)——阈值与上限精确
//   ③ rf3：pullToRefresh(false)——拖拽状态照发、松手不触发刷新
// 事件顺序（真机 refresh_pattern.cpp:704-710）：回写 → onRefreshing → onStateChange；
// onOffsetChange 单位 vp、值变化才发。鼠标拖拽被真机禁用（refresh.d.ts:248）→ 只收 touch。
@Entry
@Component
struct RefreshDemo {
  @State log: string = '';
  @State rf1On: boolean = false;

  build() {
    Column({ space: 8 }) {
      Refresh({ refreshing: this.rf1On }) {
        Column({ space: 4 }) {
          Text('card-A').id('ca').height(60).width('100%')
        }
        .width('100%')
      }
      .id('rf1')
      .width(300)
      .height(200)
      .onStateChange((state) => {
        this.log = this.log + 'A' + state + ';';
      })
      .onRefreshing(() => {
        this.log = this.log + 'AR;';
        // 真机 app 模式：onRefreshing 里回写 refreshing=true，定时后 false 结束刷新
        this.rf1On = true;
        setTimeout(() => { this.rf1On = false; }, 600);
      })
      .onOffsetChange((off) => {
        this.log = this.log + 'AO' + Math.round(off) + ';';
      })

      Button('stop').id('btn-stop').onClick(() => {
        this.rf1On = false;
      })

      Refresh({ refreshing: false }) {
        Text('card-B').id('cb').height(60).width('100%')
      }
      .id('rf2')
      .width(300)
      .height(120)
      .refreshOffset(50)
      .maxPullDownDistance(80)
      .pullDownRatio(1)
      .onStateChange((state) => {
        this.log = this.log + 'B' + state + ';';
      })
      .onRefreshing(() => {
        this.log = this.log + 'BR;';
      })
      .onOffsetChange((off) => {
        this.log = this.log + 'BO' + Math.round(off) + ';';
      })

      Refresh({ refreshing: false }) {
        Text('card-C').id('cc').height(60).width('100%')
      }
      .id('rf3')
      .width(300)
      .height(120)
      .pullToRefresh(false)
      .onStateChange((state) => {
        this.log = this.log + 'C' + state + ';';
      })

      Text(this.log).id('rf-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
