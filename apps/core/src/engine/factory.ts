import { ConfigError } from "../config.ts";
import type { Env } from "../env.ts";
import type { Engine } from "./types.ts";

type EngineBuilder = (env: Env) => Engine;

let builder: EngineBuilder | null = null;

/**
 * The composition root (`src/index.ts`) provides the SDK-backed engine; tests provide their own.
 * Durable Objects, queue consumers and routes all resolve it here.
 */
export function provideEngine(next: EngineBuilder): void {
  builder = next;
}

export function createEngine(env: Env): Engine {
  if (!builder) throw new ConfigError("no chain engine is provided to this Worker");
  return builder(env);
}
