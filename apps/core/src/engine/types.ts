import type { api, WaitReason } from "@paycheck-router/shared";

/** Everything core knows about one router, keyed by the Supabase id. */
export type RouterRef = {
  routerId: string;
  userId: string | null;
  routerPda: string;
  owner: string;
  payIn: string;
  authority: string;
};

/** A pay-in balance above watermark + minimum, found by the reconcile sweep. */
export type SweepHit = {
  routerPda: string;
  balance: bigint;
  watermark: bigint;
  delta: bigint;
  slot: bigint;
};

/** One USDC credit to the pay-in account, resolved from its transaction. */
export type InflowSource = {
  signature: string;
  slot: bigint;
  amount: bigint;
  sender: string | null;
};

export type InflowRules = {
  minInflow: bigint;
  appThreshold: bigint;
  taggedPayersOnly: boolean;
  taggedPayers: readonly string[];
};

export type InflowDecision =
  | { action: "record" }
  | {
      action: "skip";
      reason: "below_minimum" | "untagged_sender" | "self_transfer" | "protocol_movement";
    };

export type RecordedLeg = { idx: number; mint: string; amountIn: bigint; bandBps: number };

export type RecordedPaycheck = {
  signature: string;
  paycheckPda: string;
  seq: bigint;
  inflow: bigint;
  investTotal: bigint;
  recordedAt: Date;
  expiresAt: Date;
  legs: RecordedLeg[];
};

export type RecordOutcome =
  | { kind: "recorded"; paycheck: RecordedPaycheck }
  | { kind: "nothing_new" }
  | { kind: "failed"; error: string; programErrorCode: number | null };

/** One leg the Executor runs; attempts are counted by the RouterActor. */
export type LegJob = {
  legId: string;
  router: RouterRef;
  paycheckPda: string;
  seq: bigint;
  idx: number;
  mint: string;
  amountIn: bigint;
  bandBps: number;
  attemptNo: number;
};

export type AttemptRecord = {
  attemptNo: number;
  kind: "simulate" | "send";
  outcome: string;
  programErrorCode: number | null;
  reason: string | null;
  signature: string | null;
  cuUsed: number | null;
  priorityFeeLamports: bigint | null;
  quote: Record<string, unknown> | null;
  simLogs: readonly string[] | null;
};

export type ExecutedLeg = {
  signature: string;
  slot: bigint;
  outAmount: bigint;
  fee: bigint;
  issuerFee: bigint;
  /** Scaled UI multiplier the program applied, as a decimal string. */
  uiMultiplier: string;
  refPriceE9: bigint;
  execPriceE9: bigint | null;
  premiumBps: number | null;
  /** Opaque evidence the verifier needs (decoded event, posted Hermes update). */
  evidence: Record<string, unknown>;
};

export type LegOutcome =
  | { kind: "executed"; leg: ExecutedLeg; attempts: AttemptRecord[] }
  | {
      kind: "waiting";
      reason: WaitReason;
      programErrorCode: number | null;
      attempts: AttemptRecord[];
    }
  | { kind: "failed"; error: string; programErrorCode: number | null; attempts: AttemptRecord[] };

export type LegHooks = {
  executing(job: LegJob): Promise<void>;
  outcome(job: LegJob, outcome: LegOutcome): Promise<void>;
};

export type VerifyJob = {
  legId: string;
  router: RouterRef;
  seq: bigint;
  idx: number;
  mint: string;
  signature: string;
  evidence: Record<string, unknown>;
};

export type VerificationOutcome = {
  rpcProvider: string;
  finalizedSlot: bigint | null;
  ownerDeltaRaw: bigint | null;
  ownerUsdcDelta: bigint | null;
  recomputedMinOut: bigint | null;
  recomputedPremiumBps: number | null;
  matches: boolean;
  diff: Record<string, unknown> | null;
  hermesPublishTime: Date | null;
};

export type RouterState = {
  owner: string;
  payIn: string;
  recorder: string;
  investBps: number;
  minInflow: bigint;
  dailyCap: bigint;
  maxWaitSecs: number;
  autoConvert: boolean;
  paused: boolean;
  watermark: bigint;
  paycheckSeq: bigint;
  legs: { mint: string; weightBps: number; bandBps: number; enabled: boolean }[];
};

export type CreateRouterInput = {
  owner: string;
  investBps: number;
  legs: api.LegSpec[];
  minInflow: bigint;
  dailyCap: bigint;
  maxWaitSecs: number;
  autoConvert: boolean;
  allowance: bigint;
};

/** Owner-signed router changes; the sponsor pays the fee. */
export type RouterAction =
  | {
      kind: "update";
      owner: string;
      investBps: number;
      legs: api.LegSpec[];
      minInflow: bigint;
      dailyCap: bigint;
      maxWaitSecs: number;
      autoConvert: boolean;
    }
  | { kind: "pause"; owner: string; paused: boolean }
  | { kind: "allowance"; owner: string; amount: bigint }
  | { kind: "revoke"; owner: string }
  | { kind: "close"; owner: string };

export type BuiltTransaction = {
  /** Base64 wire transaction, fee payer (sponsor) signature attached when sponsored. */
  tx: string;
  feePayer: string;
  lastValidBlockHeight: bigint;
  summary: string[];
};

/**
 * The chain operations core orchestrates. The implementation is the `packages/sdk` pipeline;
 * tests supply their own.
 */
export interface Engine {
  sweep(routers: readonly RouterRef[], inFlight: ReadonlySet<string>): Promise<SweepHit[]>;
  resolveInflows(payIn: string, until: string | null): Promise<InflowSource[]>;
  classify(
    inflow: { amount: bigint; sender: string | null },
    router: RouterRef,
    rules: InflowRules,
  ): InflowDecision;
  recordPaycheck(router: RouterRef): Promise<RecordOutcome>;
  skipInflow(router: RouterRef): Promise<{ signature: string }>;
  /** Runs the legs of one paycheck in order, largest first, sharing one price post. */
  executeLegs(jobs: readonly LegJob[], hooks: LegHooks): Promise<void>;
  expireLeg(job: LegJob): Promise<{ signature: string }>;
  verifyLeg(job: VerifyJob): Promise<VerificationOutcome>;
  readRouter(routerPda: string): Promise<RouterState | null>;
  buildCreateRouter(input: CreateRouterInput): Promise<BuiltTransaction>;
  buildCancelLeg(input: {
    owner: string;
    paycheckPda: string;
    idx: number;
  }): Promise<BuiltTransaction>;
  buildBuyNow(input: { owner: string; job: LegJob; bandBps: number }): Promise<BuiltTransaction>;
  buildRouterAction(action: RouterAction): Promise<BuiltTransaction>;
}
