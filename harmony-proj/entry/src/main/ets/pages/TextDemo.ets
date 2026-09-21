// R34 测量/验证用页面：输入收官 **TextInput / TextArea / Search** + **Hyperlink**
//
// ⚠️ 先测量再实现：本页让官方编译器暴露下列 API 的产物形态：
//   ① TextInput({placeholder, text, controller}) + .maxLength(n) / .caretColor / .onChange /
//      .onSubmit((enterKey, event) => …) —— onChange 双参（value + previewText，text_common.d.ts）
//   ② TextArea({placeholder}) 同族
//   ③ Search({value, placeholder}) —— input[type=search]
//   ④ Hyperlink(address, content?) —— 链接面（<a> 语义）
//
// 现状画像：TextInput → input[type=text]、TextArea → textarea、Search → input[type=search]、
// Hyperlink → div（本轮映射 <a>）。语义层：placeholder、maxLength 截断、onChange 双参、
// caretColor、controller。
@Entry
@Component
struct TextDemo {
  @State log: string = '';
  @State inputVal: string = 'seed';
  submitCtrl: TextInputController = new TextInputController();

  build() {
    Column({ space: 8 }) {
      // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
      TextInput({ placeholder: 'please type', text: this.inputVal })
        .id('ti1')
        .maxLength(4)
        .caretColor(Color.Red)
        .onChange((v: string) => { this.log = this.log + 'TI' + v + ';'; })
        .onSubmit((k: EnterKeyType, ev: SubmitEvent) => { this.log = this.log + 'SUB' + k + ';'; })
        .onEditChanged((editing: boolean) => { this.log = this.log + 'EDIT' + editing + ';'; })

      // ② TextArea：placeholder + onChange
      TextArea({ placeholder: 'long text here' })
        .id('ta1')
        .onChange((v: string) => { this.log = this.log + 'TA' + v + ';'; })
        .width('100%')

      // ③ Search：value + onChange
      Search({ value: 'hello' })
        .id('se1')
        .onChange((v: string) => { this.log = this.log + 'SE' + v + ';'; })

      // ④ Hyperlink：address + content
      Hyperlink('https://example.com/doc', 'open doc')
        .id('hl1')
        .color('#0066cc')

      Text(this.log).id('txt-log')
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
