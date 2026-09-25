import { z } from "zod";
import { AddressString, IsoDateTime, Uuid } from "./common.ts";

export const SiwsChain = z.enum(["mainnet", "localnet"]);
export type SiwsChain = z.infer<typeof SiwsChain>;

/**
 * `GET /auth/nonce`. The client builds the Sign-In-With-Solana message from these fields (plus
 * its address, `issuedAt` and `expirationTime`) and has the wallet sign it.
 */
export const NonceResponse = z.object({
  nonce: z.string().min(8),
  expiresAt: IsoDateTime,
  domain: z.string(),
  uri: z.url(),
  statement: z.string(),
  version: z.literal("1"),
  chainId: SiwsChain,
});
export type NonceResponse = z.infer<typeof NonceResponse>;

/** `POST /auth/siws`. `message` is the exact UTF-8 text the wallet signed. */
export const SiwsRequest = z.object({
  address: AddressString,
  message: z.string().min(1).max(4096),
  /** Base64 Ed25519 signature over `message`. */
  signature: z.base64(),
});
export type SiwsRequest = z.infer<typeof SiwsRequest>;

export const EligibilityStatus = z.enum([
  "pending",
  "eligible",
  "blocked_us",
  "blocked_country",
  "blocked_sanctions",
]);
export type EligibilityStatus = z.infer<typeof EligibilityStatus>;

export const SessionUser = z.object({
  id: Uuid,
  eligibilityStatus: EligibilityStatus,
  locale: z.string(),
  refCurrency: z.string(),
});
export type SessionUser = z.infer<typeof SessionUser>;

/**
 * Issued by `POST /auth/siws` and `POST /auth/refresh`. Web also receives the same tokens as
 * HttpOnly cookies; API clients use `Authorization: Bearer <accessToken>`.
 */
export const SessionResponse = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: z.string(),
  refreshTokenExpiresAt: IsoDateTime,
  user: SessionUser,
  wallet: AddressString,
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** `POST /auth/refresh`. Web may omit the body and rely on the refresh cookie. */
export const RefreshRequest = z.object({ refreshToken: z.string().min(1) }).partial();
export type RefreshRequest = z.infer<typeof RefreshRequest>;
