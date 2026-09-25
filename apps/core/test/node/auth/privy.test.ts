import { generateKeyPairSync } from "node:crypto";
import { api } from "@paycheck-router/shared";
import { importPKCS8, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyPrivyToken } from "../../../src/auth/privy.ts";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";

const APP_ID = "cltestappid000000000000";
const NOW = new Date("2026-09-25T16:00:00Z");

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function privyToken(
  privatePem: string,
  claims: { sub?: string; aud?: string; iss?: string; exp?: number },
) {
  const key = await importPKCS8(privatePem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(claims.sub ?? "did:privy:clabc123")
    .setIssuer(claims.iss ?? "privy.io")
    .setAudience(claims.aud ?? APP_ID)
    .setIssuedAt(Math.floor(NOW.getTime() / 1000) - 10)
    .setExpirationTime(claims.exp ?? Math.floor(NOW.getTime() / 1000) + 3600)
    .sign(key);
}

describe("Privy token verification", () => {
  const signer = keyPair();
  const config = { appId: APP_ID, appSecret: "unused", verificationKey: signer.publicPem };

  it("accepts a token from this app and returns the DID", async () => {
    expect(await verifyPrivyToken(config, await privyToken(signer.privatePem, {}), NOW)).toBe(
      "did:privy:clabc123",
    );
  });

  it.each([
    ["another app", { aud: "someone-else" }],
    ["another issuer", { iss: "evil.example" }],
    ["an expired token", { exp: Math.floor(NOW.getTime() / 1000) - 1 }],
    ["a subject that is not a Privy DID", { sub: "user-1" }],
  ])("rejects %s", async (_label, claims) => {
    expect(await verifyPrivyToken(config, await privyToken(signer.privatePem, claims), NOW)).toBe(
      null,
    );
  });

  it("rejects a token signed by another key", async () => {
    const other = keyPair();
    expect(await verifyPrivyToken(config, await privyToken(other.privatePem, {}), NOW)).toBe(null);
  });
});

describe("POST /auth/privy", () => {
  let app: ReturnType<typeof testApp>;
  const env = testEnv();

  beforeAll(async () => {
    const { db } = await createTestDb();
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  it("answers 503 not_configured without Privy keys", async () => {
    const res = await app.request(
      "/auth/privy",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "x" }),
      },
      env,
    );
    expect(res.status).toBe(503);
    expect(api.Problem.parse(await res.json()).code).toBe("not_configured");
  });
});
