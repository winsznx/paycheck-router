/** The split-bar motif: three accent bars of rising height (PRD 14.8). Used by icons and OG. */
export const BRAND_BG = "#0a0a0f";
export const BRAND_ACCENT = "#00ff94";

const BARS = [0.42, 0.66, 0.9] as const;

export function brandMarkSvg(size: number, padding: number): string {
  const inner = size - padding * 2;
  const gap = inner * 0.08;
  const barWidth = (inner - gap * 2) / 3;
  const rects = BARS.map((ratio, index) => {
    const height = inner * ratio;
    const x = padding + index * (barWidth + gap);
    const y = padding + inner - height;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" fill="${BRAND_ACCENT}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${BRAND_BG}"/>${rects}</svg>`;
}

/** JSX version for ImageResponse (Satori renders flexbox, not SVG rects). */
export function BrandMark({ size, padding }: { size: number; padding: number }) {
  const inner = size - padding * 2;
  const gap = inner * 0.08;
  const barWidth = (inner - gap * 2) / 3;
  return (
    <div
      style={{
        width: size,
        height: size,
        background: BRAND_BG,
        display: "flex",
        alignItems: "flex-end",
        padding,
        gap,
      }}
    >
      {BARS.map((ratio) => (
        <div
          key={ratio}
          style={{ width: barWidth, height: inner * ratio, background: BRAND_ACCENT }}
        />
      ))}
    </div>
  );
}
