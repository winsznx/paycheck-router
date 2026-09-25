/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** PRD 16.5: last-known portfolio, paychecks and assets render offline. */
const OFFLINE_READS = /^\/(?:portfolio|paychecks(?:\/[^/]+)?|assets(?:\/[^/]+)?)$/;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => !sameOrigin && OFFLINE_READS.test(url.pathname),
      handler: new StaleWhileRevalidate({ cacheName: "api-reads" }),
    },
    {
      // Auth, transaction builders, submit and realtime are never cached.
      matcher: ({ sameOrigin }) => !sameOrigin,
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
