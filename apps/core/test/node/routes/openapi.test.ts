import { describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";

describe("GET /openapi.json", () => {
  it("documents every route from the shared contract", async () => {
    const env = testEnv();
    const { db } = await createTestDb();
    const app = testApp(db, createChainClient(chainEndpoints(env)));
    const res = await app.request("http://core.test/openapi.json", {}, env);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      servers: { url: string }[];
      paths: Record<string, Record<string, { requestBody?: unknown; parameters?: unknown[] }>>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0]?.url).toBe("http://core.test");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/auth/siws",
        "/routers/tx/create",
        "/tx/submit",
        "/paychecks/{id}",
        "/proof/legs/{signature}",
        "/realtime",
      ]),
    );
    expect(doc.paths["/routers/tx/create"]?.post?.requestBody).toBeDefined();
    expect(doc.paths["/quote/preview"]?.get?.parameters).toHaveLength(3);
  });
});
