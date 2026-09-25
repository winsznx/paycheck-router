import { ImageResponse } from "next/og";
import { BrandMark, brandMarkSvg } from "@/lib/brand-mark.tsx";

type IconId = "svg" | "192" | "512" | "maskable-512";

/** PRD 14.8: an SVG favicon plus the PWA manifest's 192, 512 and maskable 512 PNGs. */
export function generateImageMetadata() {
  return [
    { id: "svg", contentType: "image/svg+xml", size: { width: 32, height: 32 } },
    { id: "192", contentType: "image/png", size: { width: 192, height: 192 } },
    { id: "512", contentType: "image/png", size: { width: 512, height: 512 } },
    { id: "maskable-512", contentType: "image/png", size: { width: 512, height: 512 } },
  ] satisfies ReadonlyArray<{
    id: IconId;
    contentType: string;
    size: { width: number; height: number };
  }>;
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const iconId = String(await id) as IconId;
  if (iconId === "svg") {
    return new Response(brandMarkSvg(32, 3), {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  const size = iconId === "192" ? 192 : 512;
  const padding = iconId === "maskable-512" ? Math.round(size * 0.2) : Math.round(size * 0.12);
  return new ImageResponse(<BrandMark size={size} padding={padding} />, {
    width: size,
    height: size,
  });
}
