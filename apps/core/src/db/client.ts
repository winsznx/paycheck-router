import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/**
 * One client per request or queue batch, over Hyperdrive's pooled connection string. Hyperdrive
 * pools upstream connections, so the per-invocation client stays small.
 */
export function createDb(hyperdrive: Hyperdrive): Db {
  const sql = postgres(hyperdrive.connectionString, {
    max: 5,
    connect_timeout: 10,
    fetch_types: false,
    prepare: true,
  });
  return drizzle(sql, { schema });
}

export { schema };
