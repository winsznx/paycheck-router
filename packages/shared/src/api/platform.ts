import { z } from "zod";
import {
  AddressString,
  Environment,
  ExplorerLink,
  IsoDateTime,
  SignatureString,
  U64String,
} from "./common.ts";
import { Verification } from "./paychecks.ts";

export const SubmitTxKind = z.enum([
  "router.create",
  "router.update",
  "router.pause",
  "router.allowance",
  "router.revoke",
  "router.close",
  "leg.buy_now",
  "leg.cancel",
  "swap",
  "conversion",
]);
export type SubmitTxKind = z.infer<typeof SubmitTxKind>;

/** `POST /tx/submit`: a fully signed transaction the API broadcasts and tracks to finality. */
export const SubmitTxRequest = z.object({
  tx: z.base64(),
  kind: SubmitTxKind,
  /** The leg a `leg.buy_now` or `leg.cancel` transaction acts on. */
  legId: z.uuid().optional(),
});
export type SubmitTxRequest = z.infer<typeof SubmitTxRequest>;

export const SubmitTxStatus = z.enum(["submitted", "confirmed", "finalized", "failed", "expired"]);

export const SubmitTxResponse = z.object({
  signature: SignatureString,
  status: SubmitTxStatus,
  error: z.string().nullable(),
  links: z.array(ExplorerLink),
});
export type SubmitTxResponse = z.infer<typeof SubmitTxResponse>;

export const ComponentHealth = z.enum(["operational", "degraded", "down", "unknown"]);

/** `GET /status`. */
export const StatusResponse = z.object({
  environment: Environment,
  components: z.array(
    z.object({
      id: z.enum(["detection", "execution", "pricing", "routing", "chain", "notifications", "api"]),
      status: ComponentHealth,
      detail: z.string(),
      checkedAt: IsoDateTime,
    }),
  ),
  asOf: IsoDateTime,
});
export type StatusResponse = z.infer<typeof StatusResponse>;

export const ProofLeg = z.object({
  signature: SignatureString,
  mint: AddressString,
  symbol: z.string(),
  amountIn: U64String,
  outAmount: U64String,
  fee: U64String,
  issuerFee: U64String,
  uiMultiplier: z.string().nullable(),
  sharesUi: z.string().nullable(),
  refPriceE9: U64String.nullable(),
  execPriceE9: U64String.nullable(),
  premiumBps: z.number().int().nullable(),
  executedAt: IsoDateTime,
  paycheck: z.object({
    seq: U64String,
    inflow: U64String,
    investTotal: U64String,
    recordedSig: SignatureString,
    recordedAt: IsoDateTime,
  }),
  verification: Verification.nullable(),
  links: z.array(ExplorerLink),
});
export type ProofLeg = z.infer<typeof ProofLeg>;

/** `GET /proof`. Public, no personal data. */
export const ProofResponse = z.object({
  environment: Environment,
  /** True when every figure comes from a Surfpool fork of mainnet. */
  fork: z.boolean(),
  programId: AddressString,
  campaign: z.object({
    paychecks: z.number().int(),
    slicesExecuted: z.number().int(),
    slicesVerified: z.number().int(),
    waitsByReason: z.record(z.string(), z.number().int()),
    medianSecondsToShares: z.number().nullable(),
  }),
  recentLegs: z.array(ProofLeg),
  asOf: IsoDateTime,
});
export type ProofResponse = z.infer<typeof ProofResponse>;

/** `POST /metrics`: one web-vitals beacon. */
export const MetricBeacon = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().nonnegative(),
  route: z.string().max(128),
  deviceClass: z.enum(["mobile", "tablet", "desktop"]),
});
export type MetricBeacon = z.infer<typeof MetricBeacon>;
