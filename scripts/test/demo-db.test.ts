import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DemoDatabase, startDemoDatabase } from "../lib/demo-db.ts";

describe("demo database wire server", () => {
  let database: DemoDatabase;

  beforeAll(async () => {
    database = await startDemoDatabase({
      repoRoot: resolve(import.meta.dirname, "../.."),
      port: 55999,
    });
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
  });

  it("answers parameterised queries from many connections at once", async () => {
    const clients = Array.from({ length: 5 }, () =>
      postgres(database.url, { max: 4, prepare: true, fetch_types: false }),
    );
    try {
      const queries = clients.flatMap((sql, client) =>
        Array.from({ length: 20 }, (_, index) =>
          sql`select ${client}::int as client, ${index}::int as index, symbol from assets where mint = ${"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"}`.then(
            (rows) => rows[0],
          ),
        ),
      );
      const rows = await Promise.all(queries);
      expect(rows).toHaveLength(100);
      rows.forEach((row, position) => {
        expect(row).toEqual({
          client: Math.floor(position / 20),
          index: position % 20,
          symbol: "NVDAx",
        });
      });
    } finally {
      await Promise.all(clients.map((sql) => sql.end()));
    }
  }, 60_000);
});
