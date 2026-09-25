import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECS,
  sha256Hex,
  signAccessToken,
  verifyAccessToken,
} from "../../../src/auth/tokens.ts";

function signingKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "test" });
}

describe("session access tokens", () => {
  const secret = signingKey();
  const now = new Date("2026-09-25T10:00:00.000Z");
  const claims = {
    userId: "6b1f3c0e-1d2a-4c8e-9f51-0a7c2b9d4e11",
    wallet: "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy",
  };

  it("round-trips the claims and expires after 15 minutes", async () => {
    const { token, expiresAt } = await signAccessToken(secret, claims, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(ACCESS_TOKEN_TTL_SECS * 1000);
    expect(await verifyAccessToken(secret, token, now)).toEqual(claims);
    expect(await verifyAccessToken(secret, token, new Date(expiresAt.getTime() + 1000))).toBeNull();
  });

  it("rejects a token signed by another key and garbage", async () => {
    const { token } = await signAccessToken(signingKey(), claims, now);
    expect(await verifyAccessToken(secret, token, now)).toBeNull();
    expect(await verifyAccessToken(secret, "not-a-jwt", now)).toBeNull();
  });

  it("refuses a signing key that is not an Ed25519 private JWK", async () => {
    await expect(
      signAccessToken(JSON.stringify({ kty: "oct", k: "abc" }), claims, now),
    ).rejects.toThrow("Ed25519 private JWK");
  });

  it("hashes refresh tokens with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
