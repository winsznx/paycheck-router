import { binding } from "../config.ts";
import type { Env } from "../env.ts";
import type { InflowWatcher } from "./inflow-watcher.ts";
import type { RateGate } from "./rate-gate.ts";
import type { RouterActor } from "./router-actor.ts";
import type { UserHub } from "./user-hub.ts";

/** Stub helpers kept apart from the classes so routes never import `cloudflare:workers`. */
export function userHubFor(env: Env, userId: string): DurableObjectStub<UserHub> {
  const hubs = binding(env.USER_HUB, "USER_HUB");
  return hubs.get(hubs.idFromName(userId));
}

export function rateGateFor(env: Env, upstream: string): DurableObjectStub<RateGate> {
  const gates = binding(env.RATE_GATE, "RATE_GATE");
  return gates.get(gates.idFromName(upstream));
}

export function routerActorFor(env: Env, routerId: string): DurableObjectStub<RouterActor> {
  const actors = binding(env.ROUTER_ACTOR, "ROUTER_ACTOR");
  return actors.get(actors.idFromName(routerId));
}

export function inflowWatcher(env: Env): DurableObjectStub<InflowWatcher> {
  const watchers = binding(env.INFLOW_WATCHER, "INFLOW_WATCHER");
  return watchers.get(watchers.idFromName("global"));
}
