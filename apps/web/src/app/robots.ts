import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env.ts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api"] }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
