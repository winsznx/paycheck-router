import { z } from "zod";
import { IsoDateTime, SignatureString, U64String } from "./common.ts";

/**
 * Hosted fork demo, fork environments only. `GET /demo/status` (public): `resetting` while the
 * fork is unreachable around its scheduled reset, `down` when unreachable otherwise.
 */
export const DemoStatus = z.object({
  state: z.enum(["up", "resetting", "down"]),
  resetsAt: IsoDateTime.nullable(),
  lastResetAt: IsoDateTime.nullable(),
});
export type DemoStatus = z.infer<typeof DemoStatus>;

/**
 * `POST /demo/fund` (session, Idempotency-Key): fork SOL and USDC for the signed-in wallet, once
 * per fork. Balances are set by surfnet cheatcodes, which are not transactions, so `signatures`
 * lists only real transactions sent for the grant (none today).
 */
export const DemoFundResponse = z.object({
  wallet: z.string(),
  lamports: U64String,
  usdc: U64String,
  signatures: z.array(SignatureString),
});
export type DemoFundResponse = z.infer<typeof DemoFundResponse>;

export const DEMO_PAYCHECK_MIN = 20_000_000n;
export const DEMO_PAYCHECK_MAX = 5_000_000_000n;

/** `POST /demo/paycheck` (session, Idempotency-Key): employer-1 pays the wallet by transferChecked. */
export const DemoPaycheckRequest = z.object({
  amountUsdc: U64String.refine(
    (value) => BigInt(value) >= DEMO_PAYCHECK_MIN && BigInt(value) <= DEMO_PAYCHECK_MAX,
    "amountUsdc must be between 20 and 5,000 USDC (20000000 to 5000000000)",
  ),
});
export type DemoPaycheckRequest = z.infer<typeof DemoPaycheckRequest>;

export const DemoPaycheckResponse = z.object({
  signature: SignatureString,
  amountUsdc: U64String,
  slot: U64String,
});
export type DemoPaycheckResponse = z.infer<typeof DemoPaycheckResponse>;

/** `POST /demo/simulate` (session): simulate a transaction on the fork, which the web cannot reach. */
export const DemoSimulateRequest = z.object({ transaction: z.base64() });
export type DemoSimulateRequest = z.infer<typeof DemoSimulateRequest>;

export const DemoSimulateResponse = z.object({
  ok: z.boolean(),
  unitsConsumed: z.number().int().nullable(),
  logs: z.array(z.string()),
  error: z.string().nullable(),
});
export type DemoSimulateResponse = z.infer<typeof DemoSimulateResponse>;
