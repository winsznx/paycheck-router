import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { BRAND_ACCENT, BRAND_BG } from "@/lib/brand-mark.tsx";

/** PRD 14.2 dark series colours, in slot order. */
const SERIES = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];
const WARN = "#fab219";

type Segment = { ticker: string; weightBps: number; slot: number; waiting: boolean };

/** `s=SPYx:7000:1,OpenAI:1000:4:w` → ticker, weight in bps, series slot, optional waiting flag. */
function parseSegments(raw: string | null): Segment[] {
  if (!raw) return [];
  return raw
    .split(",")
    .slice(0, 8)
    .flatMap((part) => {
      const [ticker = "", weight = "", slot = "", flag] = part.split(":");
      const weightBps = Number(weight);
      const slotNumber = Number(slot);
      if (!ticker || !Number.isFinite(weightBps) || weightBps <= 0) return [];
      if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 8) return [];
      return [{ ticker: ticker.slice(0, 16), weightBps, slot: slotNumber, waiting: flag === "w" }];
    });
}

async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`;
  try {
    const css = await (await fetch(url)).text();
    const source = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!source) return null;
    const response = await fetch(source);
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** PRD 14.8: 1200 × 630, Syne title, JetBrains Mono detail line, the split bar in series colours. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = (params.get("title") ?? "Paycheck Router").slice(0, 140);
  const detail = (params.get("detail") ?? "").slice(0, 120);
  const segments = parseSegments(params.get("s"));
  const labelText = segments.map((s) => s.ticker).join("");

  const [syne, mono] = await Promise.all([
    loadGoogleFont("Syne", 800, `${title}Paycheck Router`),
    loadGoogleFont("JetBrains+Mono", 500, `${detail}${labelText}0123456789%`),
  ]);
  const fonts = [
    ...(syne ? [{ name: "Syne", data: syne, weight: 800 as const, style: "normal" as const }] : []),
    ...(mono
      ? [{ name: "JetBrains Mono", data: mono, weight: 500 as const, style: "normal" as const }]
      : []),
  ];
  const total = segments.reduce((sum, s) => sum + s.weightBps, 0);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BRAND_BG,
        color: "#f2f2f5",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 40 }}>
          <div style={{ width: 12, height: 17, background: BRAND_ACCENT }} />
          <div style={{ width: 12, height: 27, background: BRAND_ACCENT }} />
          <div style={{ width: 12, height: 38, background: BRAND_ACCENT }} />
        </div>
        <div style={{ fontFamily: "Syne", fontSize: 30, fontWeight: 800 }}>Paycheck Router</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontFamily: "Syne",
            fontSize: 64,
            lineHeight: 1.06,
            fontWeight: 800,
            letterSpacing: "-0.03em",
          }}
        >
          {title}
        </div>
        {detail ? (
          <div style={{ fontFamily: "JetBrains Mono", fontSize: 30, color: "#a3a3b2" }}>
            {detail}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 4, height: 40 }}>
          {total > 0 ? (
            segments.map((segment) => {
              const color = SERIES[segment.slot - 1] ?? BRAND_ACCENT;
              return (
                <div
                  key={segment.ticker}
                  style={{
                    flexGrow: segment.weightBps,
                    background: segment.waiting
                      ? `repeating-linear-gradient(45deg, ${WARN} 0px, ${WARN} 6px, transparent 6px, transparent 14px)`
                      : color,
                    border: segment.waiting ? `3px solid ${WARN}` : "none",
                  }}
                />
              );
            })
          ) : (
            <div style={{ flexGrow: 1, background: BRAND_ACCENT }} />
          )}
        </div>
        {total > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 28,
              fontFamily: "JetBrains Mono",
              fontSize: 24,
              color: "#a3a3b2",
            }}
          >
            {segments.map((segment) => (
              <div key={segment.ticker} style={{ display: "flex" }}>
                {`${segment.ticker} ${Math.round((segment.weightBps / total) * 100)}%`}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );
}
