import "server-only";
import type { z } from "zod";
import { apiUrl } from "@/lib/env.ts";

/** Server-side reads may use another base (e.g. a service URL); read at runtime, not inlined. */
const serverApiUrl = (process.env.CORE_API_URL ?? apiUrl).replace(/\/$/, "");

export type PublicResult<T> = { ok: true; data: T } | { ok: false; status: number };

/** Server-side read of a public core API endpoint, validated against its shared schema. */
export async function fetchPublic<S extends z.ZodType>(
  path: string,
  schema: S,
  revalidateSecs = 30,
): Promise<PublicResult<z.infer<S>>> {
  try {
    const response = await fetch(`${serverApiUrl}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: revalidateSecs },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: 503 };
  }
}
