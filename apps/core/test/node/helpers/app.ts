import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createApp } from "../../../src/app.ts";
import type { ChainClient } from "../../../src/chain/client.ts";
import type { Db } from "../../../src/db/client.ts";
import * as schema from "../../../src/db/schema.ts";
import type { Engine } from "../../../src/engine/types.ts";
import type { Env } from "../../../src/env.ts";

const SUPABASE_DIR = resolve(import.meta.dirname, "../../../../../supabase");

/** A real Postgres (PGlite) with the Supabase migrations and registry seed applied. */
export async function createTestDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  const migrations = readdirSync(resolve(SUPABASE_DIR, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await pg.exec(readFileSync(resolve(SUPABASE_DIR, "migrations", file), "utf8"));
  }
  await pg.exec(readFileSync(resolve(SUPABASE_DIR, "seed.sql"), "utf8"));
  return { db: drizzle(pg, { schema }) as unknown as Db, pg };
}

/** KV test double backed by a Map. */
function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

/** Rate limiter test double that always admits. */
const openLimiter = { limit: async () => ({ success: true }) } as unknown as RateLimit;

export function sessionKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "test" });
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: "demo",
    PROGRAM_ID: "PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H",
    USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    SURFNET_RPC_URL: "http://127.0.0.1:38899",
    HERMES_URL: "https://hermes.pyth.network",
    JUPITER_BASE_URL: "https://api.jup.ag",
    APP_ORIGIN: "http://localhost:3000",
    SIWS_DOMAIN: "localhost:3000",
    SESSION_SIGNING_KEY: sessionKey(),
    REGISTRY: memoryKv(),
    USER_LIMITER: openLimiter,
    TX_LIMITER: openLimiter,
    QUOTE_LIMITER: openLimiter,
    PUBLIC_LIMITER: openLimiter,
    AUTH_LIMITER: openLimiter,
    PARTNER_LIMITER: openLimiter,
    ...overrides,
  } as Env;
}

export function testApp(
  db: Db,
  chain: ChainClient,
  engine: Engine | null = null,
  now: () => Date = () => new Date(),
) {
  return createApp(() => ({
    db,
    chain,
    engine: () => {
      if (!engine) throw new Error("this test provides no engine");
      return engine;
    },
    now,
  }));
}
