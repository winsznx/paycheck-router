import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.ts";

/**
 * Locale routing for the public site only. `/app` and `/admin` have no locale prefix.
 * This stays `middleware.ts` (edge) rather than Next 16's `proxy.ts`: OpenNext Cloudflare
 * 1.20 supports Node proxies only experimentally, with a much larger bundle.
 */
export default createMiddleware(routing);

export const config = {
  matcher: [
    "/((?!app(?:/|$)|admin(?:/|$)|api(?:/|$)|_next|_vercel|icon|apple-icon|manifest\\.webmanifest|sw\\.js|.*\\..*).*)",
  ],
};
