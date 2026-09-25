import { api } from "@paycheck-router/shared";
import { describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import { FORK_MANIFEST } from "../../../src/proof/generated/fork-bundle.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";

describe("/proof from the committed fork bundle", () => {
  it("serves totals and slices re-derived by the bundle verifier", async () => {
    const env = testEnv({ PROOF_SOURCE: "bundle" });
    const { db } = await createTestDb();
    const app = testApp(db, createChainClient(chainEndpoints(env)));
    const res = await app.request("/proof", {}, env);
    expect(res.status).toBe(200);
    const proof = api.ProofResponse.parse(await res.json());
    expect(proof.fork).toBe(true);
    expect(proof.bundle?.runId).toBe(FORK_MANIFEST.runId);
    expect(proof.bundle?.pass).toBe(true);
    expect(proof.bundle?.slices.map((slice) => [slice.symbol, slice.state])).toEqual(
      FORK_MANIFEST.legs.map((leg) => [leg.symbol, leg.state]),
    );
    const verified = proof.recentLegs.filter((leg) => leg.verification?.matches);
    expect(verified.length).toBe(proof.campaign.slicesVerified);

    const first = proof.recentLegs[0];
    if (!first) throw new Error("the canonical bundle has an executed slice");
    const leg = await app.request(`/proof/legs/${first.signature}`, {}, env);
    expect(api.ProofLeg.parse(await leg.json()).signature).toBe(first.signature);
    expect((await app.request(`/proof/legs/${"1".repeat(88)}`, {}, env)).status).toBe(404);
  });
});
