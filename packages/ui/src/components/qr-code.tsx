import qrcode from "qrcode-generator";

export type QrCodeProps = {
  value: string;
  label: string;
};

/** Server-renderable SVG QR code; dark modules on a white quiet zone so any scanner reads it. */
export function QrCode({ value, label }: QrCodeProps) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return (
    <svg
      className="pr-qr"
      viewBox={`0 0 ${count} ${count}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#0a0a0f" />
    </svg>
  );
}
