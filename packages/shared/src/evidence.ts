import { z } from "zod";
import { WaitReason } from "./waits.ts";

const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export const AddressString = z.string().regex(base58).min(32).max(44);
export const SignatureString = z.string().regex(base58).min(64).max(88);
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export const FeedIdHex = z.string().regex(/^[0-9a-f]{64}$/);
/** Integer amounts travel as decimal strings so u64 values survive JSON. */
export const IntegerString = z.string().regex(/^-?\d+$/);

export const Environment = z.enum(["fork", "staging", "production"]);

/** Closed-loop verification states for one leg. */
export const VerificationState = z.enum([
  "REQUESTED",
  "ACKNOWLEDGED",
  "EXECUTED",
  "VERIFIED",
  "UNVERIFIED",
]);
export type VerificationState = z.infer<typeof VerificationState>;

export const WaitReasonSchema = z.enum(Object.values(WaitReason) as [WaitReason, ...WaitReason[]]);

/** A raw upstream or chain response stored next to the manifest, addressed by content hash. */
export const ArtifactRef = z.object({
  path: z.string().min(1),
  sha256: Sha256Hex,
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

export const PythPriceRecord = z.object({
  feedId: FeedIdHex,
  price: IntegerString,
  conf: IntegerString,
  exponent: z.number().int(),
  publishTime: z.number().int(),
  postedAccount: AddressString.nullable(),
});
export type PythPriceRecord = z.infer<typeof PythPriceRecord>;

export const AttestationRecord = z.object({
  mint: AddressString,
  markPriceE9: IntegerString,
  observedAt: z.number().int(),
  source: z.number().int().min(0).max(255),
  attester: AddressString,
  message: z.string().regex(/^[0-9a-f]+$/),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  apiResponse: ArtifactRef,
});
export type AttestationRecord = z.infer<typeof AttestationRecord>;

export const TransactionRecord = z.object({
  label: z.string(),
  signature: SignatureString,
  slot: z.number().int().nullable(),
  err: z.unknown().nullable(),
  raw: ArtifactRef.nullable(),
});
export type TransactionRecord = z.infer<typeof TransactionRecord>;

export const SimulationRecord = z.object({
  unitsConsumed: z.number().int().nullable(),
  errorCode: z.number().int().nullable(),
  errorName: z.string().nullable(),
  logs: ArtifactRef,
});
export type SimulationRecord = z.infer<typeof SimulationRecord>;

export const LegAttempt = z.object({
  key: z.string(),
  startedAt: z.iso.datetime(),
  jupiterBuild: ArtifactRef.nullable(),
  hermesUpdate: ArtifactRef.nullable(),
  prices: z.array(PythPriceRecord),
  attestation: AttestationRecord.nullable(),
  simulation: SimulationRecord.nullable(),
  transactionBytes: z.number().int().nullable(),
  signatures: z.array(SignatureString),
  outcome: z.enum(["executed", "waiting", "failed"]),
  waitReason: WaitReasonSchema.nullable(),
  error: z.string().nullable(),
});
export type LegAttempt = z.infer<typeof LegAttempt>;

export const VerifierCheck = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
});
export type VerifierCheck = z.infer<typeof VerifierCheck>;

export const VerifierResult = z.object({
  state: z.enum(["VERIFIED", "UNVERIFIED"]),
  verifiedAt: z.iso.datetime(),
  checks: z.array(VerifierCheck),
});
export type VerifierResult = z.infer<typeof VerifierResult>;

export const ExecutedLeg = z.object({
  signature: SignatureString,
  slot: z.number().int(),
  amountIn: IntegerString,
  /** Protocol fee in USDC base units. */
  fee: IntegerString,
  swappedIn: IntegerString,
  /** Shares that reached the owner's balance. */
  outAmount: IntegerString,
  /** Token-2022 transfer fee the issuer withheld from the delivered shares. */
  issuerFee: IntegerString,
  minOut: IntegerString,
  refPriceE9: IntegerString,
  usdcPriceE9: IntegerString,
  multiplierE12: IntegerString,
  priceSource: z.enum(["PythRegular", "Pyth247", "MarkAttestation"]),
  pricePublishTime: z.number().int(),
  /** Gross fill over the reference price. */
  premiumBps: IntegerString,
  /** USDC in, protocol fee included, against the shares kept after the issuer fee. */
  allInCostBps: IntegerString,
  /** Raw getTransaction (jsonParsed) response. */
  transaction: ArtifactRef,
  /** Raw Paycheck account read back after execution. */
  readback: ArtifactRef,
  /** Hermes history for the reference feed and for USDC/USD at their publish times. */
  history: z.array(ArtifactRef),
});
export type ExecutedLeg = z.infer<typeof ExecutedLeg>;

export const LegRecord = z.object({
  index: z.number().int().min(0),
  mint: AddressString,
  symbol: z.string(),
  kind: z.enum(["listed_equity", "pre_ipo"]),
  amountIn: IntegerString,
  bandBps: z.number().int(),
  state: z.enum(["PENDING", "WAITING", "EXECUTED", "VERIFIED", "UNVERIFIED", "EXPIRED"]),
  waitReason: WaitReasonSchema.nullable(),
  attempts: z.array(LegAttempt),
  executed: ExecutedLeg.nullable(),
  verification: VerifierResult.nullable(),
});
export type LegRecord = z.infer<typeof LegRecord>;

export const RunManifest = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  environment: Environment,
  fork: z
    .object({
      startSlot: z.number().int(),
      rpcUrl: z.string(),
      datasource: z.string(),
      surfpoolVersion: z.string(),
      clockDriftSecs: z.number(),
    })
    .nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  commit: z.string(),
  programId: AddressString,
  programSha256: Sha256Hex.nullable(),
  /** `solana-verify get-executable-hash` of the deployed binary. */
  programExecutableHash: Sha256Hex.nullable(),
  crankVersion: z.string(),
  rpc: z.object({ sender: z.string(), verifier: z.string() }),
  feedIds: z.array(FeedIdHex),
  keys: z.record(z.string(), AddressString),
  router: z
    .object({
      address: AddressString,
      owner: AddressString,
      authority: AddressString,
      investBps: z.number().int(),
      legs: z.array(
        z.object({ mint: AddressString, symbol: z.string(), weightBps: z.number().int() }),
      ),
    })
    .nullable(),
  paycheck: z
    .object({
      address: AddressString,
      seq: IntegerString,
      inflow: IntegerString,
      investTotal: IntegerString,
      sender: AddressString.nullable(),
      inflowSignature: SignatureString.nullable(),
      recordSignature: SignatureString,
    })
    .nullable(),
  transactions: z.array(TransactionRecord),
  legs: z.array(LegRecord),
  artifacts: z.array(ArtifactRef),
  error: z.string().nullable(),
});
export type RunManifest = z.infer<typeof RunManifest>;

export const MANIFEST_FILE = "manifest.json";
