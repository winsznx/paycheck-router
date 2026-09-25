import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";

/** Owns the watched pay-in address set and dedupes inflow candidates (section 8.1). */
export class InflowWatcher extends DurableObject<Env> {}
