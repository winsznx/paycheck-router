import type { MetadataRoute } from "next";

/** PRD 16.5. Icons are served by app/icon.tsx through generateImageMetadata. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paycheck Router",
    short_name: "Paycheck",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    theme_color: "#0a0a0f",
    background_color: "#0a0a0f",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
