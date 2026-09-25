import { ConfigError } from "../config.ts";
import type { Env } from "../env.ts";
import type { Engine } from "./types.ts";

type EngineBuilder = (env: Env) => Engine;

let fallback: EngineBuilder | null = null;
let override: EngineBuilder | null = null;

/**
 * The composition root (`src/index.ts`) registers the SDK-backed engine as the default. Durable
 * Objects, queue consumers and routes all resolve it here.
 */
export function setDefaultEngine(builder: EngineBuilder): void {
  fallback = builder;
}

/** Replaces the default engine, whenever the Worker module loads; used by tests. */
export function provideEngine(builder: EngineBuilder): void {
  override = builder;
}

export function createEngine(env: Env): Engine {
  const builder = override ?? fallback;
  if (!builder) throw new ConfigError("no chain engine is provided to this Worker");
  return builder(env);
}
