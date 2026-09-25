import { z } from "zod";
import { AddressString, SignatureString, WaitReasonSchema } from "../evidence.ts";

export { AddressString, SignatureString, WaitReasonSchema };

/** Unsigned integer amounts in base units travel as decimal strings so u64 values survive JSON. */
export const U64String = z.string().regex(/^\d{1,20}$/);
/** Signed integer amounts (deltas, P&L) as decimal strings. */
export const SignedIntegerString = z.string().regex(/^-?\d{1,20}$/);
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Uuid = z.uuid();
export const Bps = z.number().int().min(0).max(10_000);
export const CountryCode = z.string().regex(/^[A-Z]{2}$/);

/** RFC 9457 problem details with the API's machine-readable `code`. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

export const ProblemCode = z.enum([
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "idempotency_conflict",
  "rate_limited",
  "ineligible",
  "chain_error",
  "upstream_unavailable",
  "not_configured",
  "internal",
]);
export type ProblemCode = z.infer<typeof ProblemCode>;

/** Every transaction builder answers with an unsigned (or fee-payer-signed) v0 transaction. */
export const TxBuildResponse = z.object({
  /** Base64 wire transaction. The sponsor has already signed as fee payer when fees are sponsored. */
  tx: z.base64(),
  summary: z.array(z.string()),
  expiresAt: IsoDateTime,
  feePayer: AddressString,
  /** Last block height at which the blockhash in `tx` is valid. */
  lastValidBlockHeight: U64String,
});
export type TxBuildResponse = z.infer<typeof TxBuildResponse>;

export const LegStatus = z.enum([
  "pending",
  "waiting",
  "executing",
  "executed",
  "verified",
  "unverified",
  "expired",
  "cancelled",
]);
export type LegStatus = z.infer<typeof LegStatus>;

export const AssetKind = z.enum(["listed_equity", "pre_ipo"]);
export type AssetKind = z.infer<typeof AssetKind>;

export const Environment = z.enum(["local", "ci", "demo", "staging", "production"]);
export type Environment = z.infer<typeof Environment>;

/** Explorer link that works for mainnet or, on a surfnet, reads the fork through a custom RPC. */
export const ExplorerLink = z.object({ label: z.string(), url: z.url() });
export type ExplorerLink = z.infer<typeof ExplorerLink>;
