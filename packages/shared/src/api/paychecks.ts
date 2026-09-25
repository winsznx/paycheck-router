import { z } from "zod";
import {
  AddressString,
  Bps,
  ExplorerLink,
  IsoDateTime,
  LegStatus,
  SignatureString,
  U64String,
  Uuid,
  WaitReasonSchema,
} from "./common.ts";

export const Attempt = z.object({
  attemptNo: z.number().int(),
  kind: z.enum(["simulate", "send", "owner_buy"]),
  outcome: z.string(),
  programErrorCode: z.number().int().nullable(),
  reason: z.string().nullable(),
  signature: SignatureString.nullable(),
  priorityFeeLamports: U64String.nullable(),
  cuUsed: z.number().int().nullable(),
  createdAt: IsoDateTime,
});
export type Attempt = z.infer<typeof Attempt>;

export const Verification = z.object({
  rpcProvider: z.string(),
  finalizedSlot: U64String.nullable(),
  ownerDeltaRaw: U64String.nullable(),
  ownerUsdcDelta: U64String.nullable(),
  recomputedMinOut: U64String.nullable(),
  recomputedPremiumBps: z.number().int().nullable(),
  matches: z.boolean(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDateTime,
});
export type Verification = z.infer<typeof Verification>;

export const Leg = z.object({
  id: Uuid,
  idx: z.number().int(),
  mint: AddressString,
  symbol: z.string(),
  amountIn: U64String,
  status: LegStatus,
  waitReason: WaitReasonSchema.nullable(),
  nextAttemptAt: IsoDateTime.nullable(),
  outAmount: U64String.nullable(),
  /** Protocol fee in USDC base units. */
  fee: U64String.nullable(),
  /** Token-2022 transfer fee the issuer withheld from the delivered shares, in share base units. */
  issuerFee: U64String.nullable(),
  refPriceE9: U64String.nullable(),
  execPriceE9: U64String.nullable(),
  premiumBps: z.number().int().nullable(),
  executedSig: SignatureString.nullable(),
  executedAt: IsoDateTime.nullable(),
  verifiedAt: IsoDateTime.nullable(),
});
export type Leg = z.infer<typeof Leg>;

export const PaycheckStatus = z.enum(["open", "complete", "closed"]);

export const PaycheckSummary = z.object({
  id: Uuid,
  routerId: Uuid,
  seq: U64String,
  paycheckPda: AddressString,
  inflow: U64String,
  investTotal: U64String,
  sender: AddressString.nullable(),
  inflowSig: SignatureString.nullable(),
  recordedSig: SignatureString,
  recordedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  status: PaycheckStatus,
  legs: z.array(Leg),
});
export type PaycheckSummary = z.infer<typeof PaycheckSummary>;

export const PaychecksResponse = z.object({
  paychecks: z.array(PaycheckSummary),
  nextCursor: z.string().nullable(),
});
export type PaychecksResponse = z.infer<typeof PaychecksResponse>;

export const PaycheckDetail = PaycheckSummary.extend({
  legs: z.array(
    Leg.extend({
      attempts: z.array(Attempt),
      verification: Verification.nullable(),
      links: z.array(ExplorerLink),
    }),
  ),
  links: z.array(ExplorerLink),
});
export type PaycheckDetail = z.infer<typeof PaycheckDetail>;

/** `POST /legs/:id/tx/buy-now`. */
export const BuyNowTxRequest = z.object({ bandBps: Bps.max(1_000) });
export type BuyNowTxRequest = z.infer<typeof BuyNowTxRequest>;

export const Holding = z.object({
  mint: AddressString,
  symbol: z.string(),
  amountRaw: U64String,
  decimals: z.number().int(),
  /** Current value in USD × 1e6 (USDC units), from the reference price. Null when unpriced. */
  valueUsdc: U64String.nullable(),
  /** USDC spent on this asset through executed legs, in USDC base units. */
  costBasisUsdc: U64String,
  pnlUsdc: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  targetWeightBps: Bps,
  actualWeightBps: Bps.nullable(),
});
export type Holding = z.infer<typeof Holding>;

/** `GET /portfolio`. */
export const PortfolioResponse = z.object({
  holdings: z.array(Holding),
  totals: z.object({
    valueUsdc: U64String.nullable(),
    costBasisUsdc: U64String,
    pnlUsdc: z
      .string()
      .regex(/^-?\d+$/)
      .nullable(),
    investedUsdc: U64String,
    feesUsdc: U64String,
  }),
  asOf: IsoDateTime,
});
export type PortfolioResponse = z.infer<typeof PortfolioResponse>;
