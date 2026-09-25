import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner, type KeyPairSigner, signBytes } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { siwsMessageText } from "../helpers/siws.ts";

type App = ReturnType<typeof testApp>;

async function signIn(app: App, env: ReturnType<typeof testEnv>, signer: KeyPairSigner) {
  const nonceRes = await app.request("/auth/nonce", {}, env);
  expect(nonceRes.status).toBe(200);
  const nonce = api.NonceResponse.parse(await nonceRes.json());
  expect(nonce.chainId).toBe("localnet");
  const message = siwsMessageText({
    domain: nonce.domain,
    address: signer.address,
    uri: nonce.uri,
    chainId: nonce.chainId,
    nonce: nonce.nonce,
    issuedAt: new Date().toISOString(),
  });
  const signature = await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(message));
  const body = {
    address: signer.address,
    message,
    signature: Buffer.from(signature).toString("base64"),
  };
  const res = await app.request(
    "/auth/siws",
    { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
    env,
  );
  return { res, body };
}

describe("auth routes", () => {
  const env = testEnv();
  let app: App;

  beforeAll(async () => {
    const { db } = await createTestDb();
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  it("signs in with SIWS, issues a session and reads /me", async () => {
    const signer = await generateKeyPairSigner();
    const { res } = await signIn(app, env, signer);
    expect(res.status).toBe(200);
    const session = api.SessionResponse.parse(await res.json());
    expect(session.wallet).toBe(signer.address);
    expect(session.user.eligibilityStatus).toBe("pending");
    expect(res.headers.get("set-cookie")).toContain("pr_access=");

    const me = await app.request(
      "/me",
      { headers: { authorization: `Bearer ${session.accessToken}` } },
      env,
    );
    expect(me.status).toBe(200);
    const profile = api.Me.parse(await me.json());
    expect(profile.wallets).toEqual([{ address: signer.address, kind: "external" }]);

    const again = await signIn(app, env, signer);
    const second = api.SessionResponse.parse(await again.res.json());
    expect(second.user.id).toBe(session.user.id);
  });

  it("refuses a replayed nonce", async () => {
    const signer = await generateKeyPairSigner();
    const { res, body } = await signIn(app, env, signer);
    expect(res.status).toBe(200);
    const replay = await app.request(
      "/auth/siws",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("refuses a signature from another key", async () => {
    const signer = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    const nonce = api.NonceResponse.parse(await (await app.request("/auth/nonce", {}, env)).json());
    const message = siwsMessageText({
      domain: nonce.domain,
      address: signer.address,
      uri: nonce.uri,
      chainId: nonce.chainId,
      nonce: nonce.nonce,
      issuedAt: new Date().toISOString(),
    });
    const signature = await signBytes(other.keyPair.privateKey, new TextEncoder().encode(message));
    const res = await app.request(
      "/auth/siws",
      {
        method: "POST",
        body: JSON.stringify({
          address: signer.address,
          message,
          signature: Buffer.from(signature).toString("base64"),
        }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const signer = await generateKeyPairSigner();
    const session = api.SessionResponse.parse(await (await signIn(app, env, signer)).res.json());
    const refresh = (token: string) =>
      app.request(
        "/auth/refresh",
        {
          method: "POST",
          body: JSON.stringify({ refreshToken: token }),
          headers: { "content-type": "application/json" },
        },
        env,
      );
    const rotated = await refresh(session.refreshToken);
    expect(rotated.status).toBe(200);
    const next = api.SessionResponse.parse(await rotated.json());
    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(next.wallet).toBe(signer.address);

    expect((await refresh(session.refreshToken)).status).toBe(401);
    expect((await refresh(next.refreshToken)).status).toBe(401);
  });

  it("answers problems as RFC 9457 JSON", async () => {
    const res = await app.request("/me", {}, env);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const problem = api.Problem.parse(await res.json());
    expect(problem.requestId).toBeTruthy();

    const invalid = await app.request(
      "/auth/siws",
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(api.Problem.parse(await invalid.json()).code).toBe("validation_failed");
  });

  it("records the eligibility attestation", async () => {
    const signer = await generateKeyPairSigner();
    const session = api.SessionResponse.parse(await (await signIn(app, env, signer)).res.json());
    const attest = (body: object) =>
      app.request(
        "/eligibility/attest",
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            "content-type": "application/json",
          },
        },
        env,
      );
    const ok = await attest({
      countryDeclared: "NG",
      usPerson: false,
      tosVersion: "2026-09-25",
      riskAckVersion: "2026-09-25",
    });
    expect(ok.status).toBe(200);
    const eligibility = api.EligibilityResponse.parse(await ok.json());
    expect(eligibility.status).toBe("eligible");
    expect(eligibility.sanctions).toEqual([{ address: signer.address, status: "not_configured" }]);

    const blocked = await attest({
      countryDeclared: "NG",
      usPerson: true,
      tosVersion: "2026-09-25",
      riskAckVersion: "2026-09-25",
    });
    expect(api.EligibilityResponse.parse(await blocked.json()).status).toBe("blocked_us");
  });
});
