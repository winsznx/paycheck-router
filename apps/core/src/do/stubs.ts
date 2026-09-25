import type { Env } from "../env.ts";
import type { RateGate } from "./rate-gate.ts";
import type { UserHub } from "./user-hub.ts";

/** Stub helpers kept apart from the classes so routes never import `cloudflare:workers`. */
export function userHubFor(env: Env, userId: string): DurableObjectStub<UserHub> {
  return env.USER_HUB.get(env.USER_HUB.idFromName(userId));
}

export function rateGateFor(env: Env, upstream: string): DurableObjectStub<RateGate> {
  return env.RATE_GATE.get(env.RATE_GATE.idFromName(upstream));
}
