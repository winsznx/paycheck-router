import { serwist } from "@serwist/next/config";

/** Configurator mode: `serwist build` writes public/sw.js after `next build` (Turbopack-safe). */
export default serwist({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  globIgnores: ["public/sw.js", "public/sw.js.map"],
});
