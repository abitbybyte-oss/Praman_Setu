/** Minimal typing for the parts of `qrcode` the report uses. */
declare module 'qrcode' {
  export interface QRCodeMatrix {
    modules: { size: number; get(x: number, y: number): number | boolean };
  }
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): QRCodeMatrix;
  const QRCode: { create: typeof create };
  export default QRCode;
}
