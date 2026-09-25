import type { Env } from "../env.ts";
import type { InflowWatcher } from "./inflow-watcher.ts";
import type { RateGate } from "./rate-gate.ts";
import type { RouterActor } from "./router-actor.ts";
import type { UserHub } from "./user-hub.ts";

/** Stub helpers kept apart from the classes so routes never import `cloudflare:workers`. */
export function userHubFor(env: Env, userId: string): DurableObjectStub<UserHub> {
  return env.USER_HUB.get(env.USER_HUB.idFromName(userId));
}

export function rateGateFor(env: Env, upstream: string): DurableObjectStub<RateGate> {
  return env.RATE_GATE.get(env.RATE_GATE.idFromName(upstream));
}

export function routerActorFor(env: Env, routerId: string): DurableObjectStub<RouterActor> {
  return env.ROUTER_ACTOR.get(env.ROUTER_ACTOR.idFromName(routerId));
}

export function inflowWatcher(env: Env): DurableObjectStub<InflowWatcher> {
  return env.INFLOW_WATCHER.get(env.INFLOW_WATCHER.idFromName("global"));
}
