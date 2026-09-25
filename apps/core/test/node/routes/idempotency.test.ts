import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

describe("Idempotency-Key", () => {
  const env = testEnv();
  let app: ReturnType<typeof testApp>;

  beforeAll(async () => {
    const { db } = await createTestDb();
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  const attest = (session: api.SessionResponse, key: string, usPerson: boolean) =>
    app.request(
      "/eligibility/attest",
      {
        method: "POST",
        headers: {
          ...bearer(session),
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({
          countryDeclared: "NG",
          usPerson,
          tosVersion: "2026-09-25",
          riskAckVersion: "2026-09-25",
        }),
      },
      env,
    );

  it("replays the first response for the same key and body", async () => {
    const session = await sessionFor(app, env, await generateKeyPairSigner());
    const first = await attest(session, "attest-once-0001", false);
    expect(first.status).toBe(200);
    const again = await attest(session, "attest-once-0001", false);
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await again.json()).toEqual(await first.json());
  });

  it("refuses the same key with a different body", async () => {
    const session = await sessionFor(app, env, await generateKeyPairSigner());
    expect((await attest(session, "attest-twice-0001", false)).status).toBe(200);
    const changed = await attest(session, "attest-twice-0001", true);
    expect(changed.status).toBe(422);
    expect(api.Problem.parse(await changed.json()).code).toBe("idempotency_conflict");
  });

  it("scopes keys per caller", async () => {
    const first = await sessionFor(app, env, await generateKeyPairSigner());
    const second = await sessionFor(app, env, await generateKeyPairSigner());
    expect((await attest(first, "shared-key-00001", false)).status).toBe(200);
    const other = await attest(second, "shared-key-00001", true);
    expect(other.status).toBe(200);
    expect(api.EligibilityResponse.parse(await other.json()).status).toBe("blocked_us");
  });
});
