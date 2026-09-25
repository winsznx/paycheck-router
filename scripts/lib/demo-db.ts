import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export type DemoDatabase = {
  url: string;
  port: number;
  stop(): Promise<void>;
};

/**
 * The `demo` environment's database: Postgres 17 (PGlite) served over the Postgres wire protocol
 * on the port Hyperdrive's `localConnectionString` points at, built from the same
 * `supabase/migrations` and `seed.sql` that Supabase applies in staging and production.
 */
export async function startDemoDatabase(options: {
  repoRoot: string;
  port?: number;
}): Promise<DemoDatabase> {
  const port = options.port ?? 54322;
  const supabase = resolve(options.repoRoot, "supabase");
  const db = await PGlite.create();
  const migrations = readdirSync(resolve(supabase, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await db.exec(readFileSync(resolve(supabase, "migrations", file), "utf8"));
  }
  await db.exec(readFileSync(resolve(supabase, "seed.sql"), "utf8"));
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 16 });
  await server.start();
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    port,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
