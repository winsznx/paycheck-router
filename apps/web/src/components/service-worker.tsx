"use client";

import { SerwistProvider } from "@serwist/next/react";
import type { ReactNode } from "react";

/** Registers public/sw.js in production builds; `next dev` has no service worker. */
export function ServiceWorker({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV !== "production"}>
      {children}
    </SerwistProvider>
  );
}
