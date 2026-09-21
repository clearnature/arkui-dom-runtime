// R35 测量/验证用页面：平台模块收官 **@ohos.multimedia.media**（AVPlayer → HTMLAudioElement）
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① media.createAVPlayer() —— Promise 面
//   ② avPlayer.url = '…' → 状态机 'initialized' → prepare() → 'prepared'
//   ③ avPlayer.play() → 'playing'／pause() → 'paused'
//   ④ avPlayer.duration／currentTime（随真实播放时钟推进——headless 探明）
//   ⑤ avPlayer.on('stateChange', (state, reason) => …)
//
// DOM 映射（垫片在 ohos-shims.js）：AVPlayer → HTMLAudioElement；状态机映射如实记录。
import media from '@ohos.multimedia.media';
import { BusinessError } from '@ohos.base';

@Entry
@Component
struct MediaDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      Button('run').id('run-btn').onClick(() => {
        media.createAVPlayer().then((player) => {
          const av = player as media.AVPlayer;
          // ⚠️ 订阅先行：stateChange 的监听必须在 url 赋值【之前】（真机语义），
          // 否则 'initialized' 在订阅前发生、被丢（首跑实测：log 里没有 S:initialized）
          av.on('stateChange', (state: media.AVPlayerState) => {
            this.log = this.log + 'S:' + state + ';';
          });
          av.url = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
          av.prepare().then(() => {
            this.log = this.log + 'PREP;';
            av.play().then(() => {
              setTimeout(() => {
                this.log = this.log + 'T' + Math.round(av.currentTime * 10) + ';';
                av.pause().then(() => {
                  this.log = this.log + 'P' + (av.state === 'paused' ? 1 : 0) + ';';
                });
              }, 300);
            });
          }).catch((e: Error) => {
            this.log = this.log + 'ERR;';
          });
        }).catch((e: Error) => {
          this.log = this.log + 'ERR;';
        });
      })
      Text(this.log).id('media-log')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
