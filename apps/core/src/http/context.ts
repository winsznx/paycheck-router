import type { Context } from "hono";
import type { ChainClient } from "../chain/client.ts";
import type { Db } from "../db/client.ts";
import type { Engine } from "../engine/types.ts";
import type { Env } from "../env.ts";

export type Session = { userId: string; wallet: string };

/** Everything a handler needs beyond bindings; built once per request. */
export type Services = {
  db: Db;
  chain: ChainClient;
  /** The SDK-backed chain engine, built on first use. */
  engine: () => Engine;
  now: () => Date;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    services: Services;
    session: Session | null;
  };
};

export type AppContext = Context<AppEnv>;
