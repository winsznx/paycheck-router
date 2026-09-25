import { type ChainClient, createChainClient } from "../chain/client.ts";
import { ConfigError, chainEndpoints } from "../config.ts";
import { createDb, type Db } from "../db/client.ts";
import { createEngine } from "../engine/factory.ts";
import type { Env } from "../env.ts";
import type { Services } from "../http/context.ts";

/**
 * Per-request services. The database and chain clients are built on first use, so routes that
 * need neither (prices, bundle proof) work where no Hyperdrive is bound, and routes that need the
 * database fail as "not configured" there.
 */
export function createServices(env: Env): Services {
  let db: Db | null = null;
  let chain: ChainClient | null = null;
  return {
    get db(): Db {
      if (!env.HYPERDRIVE) throw new ConfigError("the database (Hyperdrive) is not configured");
      db ??= createDb(env.HYPERDRIVE);
      return db;
    },
    get chain(): ChainClient {
      chain ??= createChainClient(chainEndpoints(env));
      return chain;
    },
    engine: () => createEngine(env),
    now: () => new Date(),
  };
}
