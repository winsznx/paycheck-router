import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/** Build-time pages and icons are served from static assets; nothing here uses ISR. */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
