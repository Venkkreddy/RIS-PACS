declare module "jpeg-lossless-decoder-js" {
  export class Decoder {
    decode(
      buf: ArrayBuffer | ArrayBufferLike,
      offset?: number,
      length?: number,
    ): Uint8Array | Uint16Array | number[];
  }
}
