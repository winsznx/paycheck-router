import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const SUPABASE_DIR = resolve(import.meta.dirname, "../../../supabase");

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * Workers tests reach Postgres through Hyperdrive like production does; here the server is
 * PGlite with the Supabase migrations and seed applied.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await PGlite.create();
  const migrations = readdirSync(resolve(SUPABASE_DIR, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await db.exec(readFileSync(resolve(SUPABASE_DIR, "migrations", file), "utf8"));
  }
  await db.exec(readFileSync(resolve(SUPABASE_DIR, "seed.sql"), "utf8"));
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 16 });
  await server.start();
  project.provide("databaseUrl", `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
  return async () => {
    await server.stop();
    await db.close();
  };
}
