import { exportJWK, importJWK, type JWK, jwtVerify, SignJWT } from "jose";

export const ACCESS_TOKEN_TTL_SECS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECS = 30 * 24 * 60 * 60;

const ISSUER = "paycheck-router-core";
const AUDIENCE = "paycheck-router";
const ALG = "EdDSA";

export type AccessClaims = { userId: string; wallet: string };

type SigningKeys = { privateKey: CryptoKey; publicKey: CryptoKey; kid: string };

const cache = new Map<string, Promise<SigningKeys>>();

/**
 * `SESSION_SIGNING_KEY` is an Ed25519 private JWK (with `kid`). The public half is derived from
 * it, so rotating the secret rotates both.
 */
function loadKeys(secret: string): Promise<SigningKeys> {
  let keys = cache.get(secret);
  if (!keys) {
    keys = (async () => {
      const jwk = JSON.parse(secret) as JWK;
      if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d) {
        throw new Error("SESSION_SIGNING_KEY must be an Ed25519 private JWK");
      }
      const privateKey = (await importJWK(jwk, ALG, { extractable: true })) as CryptoKey;
      const { d: _private, ...publicJwk } = await exportJWK(privateKey);
      const publicKey = (await importJWK(publicJwk, ALG)) as CryptoKey;
      return { privateKey, publicKey, kid: jwk.kid ?? "session" };
    })();
    cache.set(secret, keys);
  }
  return keys;
}

export async function signAccessToken(
  secret: string,
  claims: AccessClaims,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const { privateKey, kid } = await loadKeys(secret);
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + ACCESS_TOKEN_TTL_SECS) * 1000);
  const token = await new SignJWT({ wal: claims.wallet })
    .setProtectedHeader({ alg: ALG, kid, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(privateKey);
  return { token, expiresAt };
}

/** Returns the claims, or null for any invalid, expired or foreign token. */
export async function verifyAccessToken(
  secret: string,
  token: string,
  now: Date,
): Promise<AccessClaims | null> {
  const { publicKey } = await loadKeys(secret);
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
      currentDate: now,
    });
    if (typeof payload.sub !== "string" || typeof payload.wal !== "string") return null;
    return { userId: payload.sub, wallet: payload.wal };
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function newRefreshToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}
