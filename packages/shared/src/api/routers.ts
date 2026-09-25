import { z } from "zod";
import { AddressString, Bps, IsoDateTime, SignatureString, U64String, Uuid } from "./common.ts";
import { LegSpec } from "./market.ts";

export const RouterLeg = LegSpec.extend({
  idx: z.number().int().min(0).max(7),
  symbol: z.string(),
  enabled: z.boolean(),
  colorSlot: z.number().int().min(0).max(7),
});
export type RouterLeg = z.infer<typeof RouterLeg>;

export const Router = z.object({
  id: Uuid,
  routerPda: AddressString,
  authorityPda: AddressString,
  owner: AddressString,
  payInAta: AddressString,
  status: z.enum(["active", "paused", "closed"]),
  investBps: Bps,
  minInflow: U64String,
  appThreshold: U64String.nullable(),
  dailyCap: U64String,
  maxWaitSecs: z.number().int(),
  autoConvert: z.boolean(),
  recorder: AddressString,
  payerRule: z.enum(["any", "tagged"]),
  legs: z.array(RouterLeg),
  /** Remaining SPL allowance from the pay-in account to the Authority PDA. */
  allowance: z.object({ delegate: AddressString.nullable(), amount: U64String }),
  usdcBalance: U64String,
  watermark: U64String,
  createdSig: SignatureString.nullable(),
  createdAt: IsoDateTime,
});
export type Router = z.infer<typeof Router>;

export const RoutersResponse = z.object({ routers: z.array(Router) });
export type RoutersResponse = z.infer<typeof RoutersResponse>;

/** `POST /routers/tx/create`. */
export const CreateRouterTxRequest = z
  .object({
    wallet: AddressString,
    investBps: z.number().int().min(100).max(10_000),
    legs: z.array(LegSpec).min(1).max(8),
    minInflow: U64String,
    dailyCap: U64String,
    maxWaitSecs: z.number().int().min(0).max(1_209_600),
    autoConvert: z.boolean(),
    allowance: U64String,
    /** Optional app-side threshold above `minInflow`, kept offchain. */
    appThreshold: U64String.optional(),
  })
  .refine((body) => body.legs.reduce((sum, leg) => sum + leg.weightBps, 0) === 10_000, {
    message: "leg weights must sum to 10000 bps",
    path: ["legs"],
  })
  .refine((body) => new Set(body.legs.map((leg) => leg.mint)).size === body.legs.length, {
    message: "each asset may appear once",
    path: ["legs"],
  });
export type CreateRouterTxRequest = z.infer<typeof CreateRouterTxRequest>;

/** `GET /routers/:id/inflows`: recent inflows grouped by sender, for tagging payers. */
export const RouterInflowsResponse = z.object({
  senders: z.array(
    z.object({
      sender: AddressString.nullable(),
      label: z.string().nullable(),
      tagged: z.boolean(),
      count: z.number().int(),
      total: U64String,
      lastAt: IsoDateTime,
    }),
  ),
});
export type RouterInflowsResponse = z.infer<typeof RouterInflowsResponse>;

/** `PUT /routers/:id/payers`: who counts as a paycheck sender. */
export const PutPayersRequest = z.object({
  payerRule: z.enum(["any", "tagged"]),
  tags: z
    .array(z.object({ payerOwner: AddressString, label: z.string().max(64).nullable() }))
    .max(50),
});
export type PutPayersRequest = z.infer<typeof PutPayersRequest>;
/** `POST /routers/:id/tx/update`: new split and rules (validated like create). */
export const UpdateRouterTxRequest = z
  .object({
    investBps: z.number().int().min(100).max(10_000),
    legs: z.array(LegSpec).min(1).max(8),
    minInflow: U64String,
    dailyCap: U64String,
    maxWaitSecs: z.number().int().min(0).max(1_209_600),
    autoConvert: z.boolean(),
  })
  .refine((body) => body.legs.reduce((sum, leg) => sum + leg.weightBps, 0) === 10_000, {
    message: "leg weights must sum to 10000 bps",
    path: ["legs"],
  })
  .refine((body) => new Set(body.legs.map((leg) => leg.mint)).size === body.legs.length, {
    message: "each asset may appear once",
    path: ["legs"],
  });
export type UpdateRouterTxRequest = z.infer<typeof UpdateRouterTxRequest>;

/** `POST /routers/:id/tx/pause`. */
export const PauseRouterTxRequest = z.object({ paused: z.boolean() });
export type PauseRouterTxRequest = z.infer<typeof PauseRouterTxRequest>;

/** `POST /routers/:id/tx/allowance`: the new total USDC allowance for the Authority PDA. */
export const AllowanceTxRequest = z.object({ amount: U64String });
export type AllowanceTxRequest = z.infer<typeof AllowanceTxRequest>;
