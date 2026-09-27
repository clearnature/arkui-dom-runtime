// R108：@ohos.cjk 的编译期类型声明
// 运行时实现见 runtime/ohos-shims.js 的 cjk 垫片与 kernel/shared/protocol/kernel_abi.h
declare module '@ohos.cjk' {
  type CjkValue = number | string | boolean | null;
  type CjkResponse = Record<string, CjkValue>;
  const cjk: {
    isAvailable(): Promise<boolean>;
    call(method: string, params: Record<string, CjkValue>): Promise<CjkResponse | null>;
    add(a: number, b: number): Promise<number>;
    echo(input: string): Promise<string>;
    ping(): Promise<number>;
    lastError(): Promise<string>;
  };
  export default cjk;
}
