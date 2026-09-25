import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";

/** Serialises one router's lifecycle: candidates, records, leg attempts and alarms (section 8.3). */
export class RouterActor extends DurableObject<Env> {}
