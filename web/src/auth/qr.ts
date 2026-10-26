import qrcode from "qrcode-generator";

/** The modules of a QR code as one SVG path (1 unit per module), so a page can draw it without injecting HTML. */
export function qrSvgPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M"); // type 0 = smallest that fits, error correction M
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, d };
}
