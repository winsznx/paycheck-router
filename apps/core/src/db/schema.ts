/**
 * Typed mirror of `supabase/migrations`, which stays the source of truth.
 * `test/node/db/schema.test.ts` fails when a table, column, nullability, type, default, unique key,
 * index or foreign key here drifts from the SQL. Check constraints live only in SQL, and the `text`
 * enums below narrow the TypeScript types to the values those checks allow.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type JsonObject = Record<string, unknown>;

/** A split preset carried by an invite link: percentages only, never amounts. */
export interface InvitePreset {
  investBps: number;
  legs: { mint: string; weightBps: number; bandBps: number }[];
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const int64 = (name: string) => bigint(name, { mode: "bigint" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamptz("created_at").notNull().defaultNow();
const updatedAt = () => timestamptz("updated_at").notNull().defaultNow();

export const eligibilityStatus = pgEnum("eligibility_status", [
  "pending",
  "eligible",
  "blocked_us",
  "blocked_country",
  "blocked_sanctions",
]);

export const legStatus = pgEnum("leg_status", [
  "pending",
  "waiting",
  "executing",
  "executed",
  "verified",
  "unverified",
  "expired",
  "cancelled",
]);

const notificationChannels = ["email", "push", "telegram"] as const;

export const users = pgTable("users", {
  id: id(),
  privyDid: text("privy_did").unique(),
  email: text("email"),
  locale: text("locale").notNull().default("en"),
  refCurrency: text("ref_currency").notNull().default("USD"),
  countryDeclared: text("country_declared"),
  countryIpLast: text("country_ip_last"),
  usPerson: boolean("us_person"),
  eligibilityStatus: eligibilityStatus("eligibility_status").notNull().default("pending"),
  tosVersion: text("tos_version"),
  riskAckVersion: text("risk_ack_version"),
  ackedAt: timestamptz("acked_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamptz("deleted_at"),
});

export const wallets = pgTable(
  "wallets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull().unique(),
    kind: text("kind", { enum: ["embedded", "external"] }).notNull(),
    provider: text("provider"),
    verifiedAt: timestamptz("verified_at"),
    sanctionsStatus: text("sanctions_status", {
      enum: ["unchecked", "clear", "flagged", "not_configured"],
    })
      .notNull()
      .default("unchecked"),
    sanctionsCheckedAt: timestamptz("sanctions_checked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("wallets_user_id_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    familyId: uuid("family_id").notNull(),
    refreshHash: text("refresh_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    replacedBy: uuid("replaced_by").references((): AnyPgColumn => sessions.id, {
      onDelete: "set null",
    }),
    userAgent: text("user_agent"),
    ipCountry: text("ip_country"),
  },
  (t) => [
    index("sessions_family_id_idx").on(t.familyId),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  createdAt: createdAt(),
  expiresAt: timestamptz("expires_at").notNull(),
  consumedAt: timestamptz("consumed_at"),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

export const adminUsers = pgTable("admin_users", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "support", "viewer"] }).notNull(),
  createdAt: createdAt(),
});

export const assets = pgTable("assets", {
  mint: text("mint").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["listed_equity", "pre_ipo"] }).notNull(),
  issuer: text("issuer", { enum: ["xstocks", "prestocks", "other"] }).notNull(),
  tokenProgram: text("token_program").notNull(),
  decimals: smallint("decimals").notNull(),
  feedId: text("feed_id"),
  feedId247: text("feed_id_247"),
  schedule: text("schedule"),
  status: text("status", { enum: ["active", "buys_paused", "converting", "delisted"] })
    .notNull()
    .default("active"),
  defaultBandBps: integer("default_band_bps").notNull(),
  maxBandBps: integer("max_band_bps").notNull(),
  band247ExtraBps: integer("band_247_extra_bps").notNull().default(0),
  conversionTarget: text("conversion_target"),
  conversionRatioNum: int64("conversion_ratio_num"),
  conversionRatioDen: int64("conversion_ratio_den"),
  conversionDeadline: timestamptz("conversion_deadline"),
  blockedCountries: text("blocked_countries").array().notNull().default(sql`'{}'`),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: updatedAt(),
});

export const assetMultiplierHistory = pgTable(
  "asset_multiplier_history",
  {
    mint: text("mint")
      .notNull()
      .references(() => assets.mint),
    effectiveAt: timestamptz("effective_at").notNull(),
    multiplier: doublePrecision("multiplier").notNull(),
    sourceSig: text("source_sig"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.mint, t.effectiveAt] })],
);

export const attestations = pgTable(
  "attestations",
  {
    id: id(),
    mint: text("mint")
      .notNull()
      .references(() => assets.mint),
    markPriceE9: int64("mark_price_e9").notNull(),
    observedAt: timestamptz("observed_at").notNull(),
    source: text("source").notNull(),
    ed25519Sig: text("ed25519_sig").notNull(),
    payloadHash: text("payload_hash").notNull(),
    usedInSig: text("used_in_sig"),
    createdAt: createdAt(),
  },
  (t) => [index("attestations_mint_observed_at_idx").on(t.mint, t.observedAt)],
);

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: id(),
    feedId: text("feed_id").notNull(),
    price: int64("price").notNull(),
    conf: int64("conf").notNull(),
    expo: integer("expo").notNull(),
    publishTime: timestamptz("publish_time").notNull(),
    capturedAt: timestamptz("captured_at").notNull().defaultNow(),
  },
  (t) => [index("price_snapshots_feed_id_publish_time_idx").on(t.feedId, t.publishTime)],
);

export const routers = pgTable(
  "routers",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    walletId: uuid("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
    owner: text("owner").notNull(),
    routerPda: text("router_pda").notNull().unique(),
    authorityPda: text("authority_pda").notNull(),
    payInAta: text("pay_in_ata").notNull(),
    status: text("status", { enum: ["active", "paused", "closed"] })
      .notNull()
      .default("active"),
    investBps: integer("invest_bps").notNull(),
    minInflow: int64("min_inflow").notNull(),
    appThreshold: int64("app_threshold"),
    dailyCap: int64("daily_cap").notNull(),
    maxWaitSecs: integer("max_wait_secs").notNull(),
    autoConvert: boolean("auto_convert").notNull(),
    recorder: text("recorder").notNull(),
    payerRule: text("payer_rule", { enum: ["any", "tagged"] })
      .notNull()
      .default("any"),
    watermark: int64("watermark"),
    paycheckSeq: int64("paycheck_seq"),
    onchainSnapshot: jsonb("onchain_snapshot").$type<JsonObject>(),
    createdSig: text("created_sig"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamptz("closed_at"),
  },
  (t) => [index("routers_user_id_idx").on(t.userId)],
);

export const routerLegs = pgTable(
  "router_legs",
  {
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id, { onDelete: "cascade" }),
    idx: smallint("idx").notNull(),
    assetMint: text("asset_mint")
      .notNull()
      .references(() => assets.mint),
    weightBps: integer("weight_bps").notNull(),
    bandBps: integer("band_bps").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    colorSlot: smallint("color_slot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.routerId, t.idx] })],
);

export const payerTags = pgTable(
  "payer_tags",
  {
    id: id(),
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id, { onDelete: "cascade" }),
    payerOwner: text("payer_owner").notNull(),
    label: text("label"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.routerId, t.payerOwner)],
);

export const inflows = pgTable(
  "inflows",
  {
    id: id(),
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id),
    signature: text("signature").notNull(),
    slot: int64("slot").notNull(),
    amount: int64("amount").notNull(),
    senderOwner: text("sender_owner"),
    source: text("source", { enum: ["webhook", "reconcile"] }).notNull(),
    classification: text("classification", {
      enum: [
        "pending",
        "recorded",
        "skipped_below_minimum",
        "skipped_untagged",
        "skipped_self_transfer",
        "skipped_protocol",
      ],
    })
      .notNull()
      .default("pending"),
    decidedAt: timestamptz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.routerId, t.signature)],
);

export const paychecks = pgTable(
  "paychecks",
  {
    id: id(),
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id),
    seq: int64("seq").notNull(),
    paycheckPda: text("paycheck_pda").notNull().unique(),
    inflowId: uuid("inflow_id").references(() => inflows.id),
    inflowSig: text("inflow_sig"),
    senderOwner: text("sender_owner"),
    inflow: int64("inflow").notNull(),
    investTotal: int64("invest_total").notNull(),
    recordedSig: text("recorded_sig").notNull().unique(),
    recordedAt: timestamptz("recorded_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    status: text("status").notNull().default("open"),
    closedSig: text("closed_sig"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.routerId, t.seq)],
);

export const legs = pgTable(
  "legs",
  {
    id: id(),
    paycheckId: uuid("paycheck_id")
      .notNull()
      .references(() => paychecks.id, { onDelete: "cascade" }),
    idx: smallint("idx").notNull(),
    assetMint: text("asset_mint")
      .notNull()
      .references(() => assets.mint),
    amountIn: int64("amount_in").notNull(),
    status: legStatus("status").notNull().default("pending"),
    waitReason: text("wait_reason"),
    outAmount: int64("out_amount"),
    fee: int64("fee"),
    issuerFee: int64("issuer_fee"),
    uiMultiplier: text("ui_multiplier"),
    refPriceE9: int64("ref_price_e9"),
    execPriceE9: int64("exec_price_e9"),
    premiumBps: integer("premium_bps"),
    executedSig: text("executed_sig").unique(),
    executedAt: timestamptz("executed_at"),
    verifiedAt: timestamptz("verified_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at"),
    executingSince: timestamptz("executing_since"),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.paycheckId, t.idx),
    index("legs_status_idx")
      .on(t.status)
      .where(sql`${t.status} in ('pending', 'waiting', 'executing')`),
  ],
);

export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    legId: uuid("leg_id")
      .notNull()
      .references(() => legs.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    kind: text("kind", { enum: ["simulate", "send", "owner_buy"] }).notNull(),
    outcome: text("outcome").notNull(),
    programErrorCode: integer("program_error_code"),
    reason: text("reason"),
    quote: jsonb("quote").$type<JsonObject>(),
    reference: jsonb("reference").$type<JsonObject>(),
    simLogsKey: text("sim_logs_key"),
    signature: text("signature"),
    priorityFeeLamports: int64("priority_fee_lamports"),
    cuUsed: integer("cu_used"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.legId, t.attemptNo, t.kind)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    legId: uuid("leg_id")
      .notNull()
      .references(() => legs.id, { onDelete: "cascade" }),
    rpcProvider: text("rpc_provider").notNull(),
    finalizedSlot: int64("finalized_slot"),
    ownerDeltaRaw: int64("owner_delta_raw"),
    ownerUsdcDelta: int64("owner_usdc_delta"),
    recomputedMinOut: int64("recomputed_min_out"),
    recomputedPremiumBps: integer("recomputed_premium_bps"),
    matches: boolean("matches").notNull(),
    diff: jsonb("diff").$type<JsonObject>(),
    hermesPublishTime: timestamptz("hermes_publish_time"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.legId, t.rpcProvider)],
);

export const swaps = pgTable(
  "swaps",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["buy", "sell"] }).notNull(),
    assetMint: text("asset_mint")
      .notNull()
      .references(() => assets.mint),
    amountIn: int64("amount_in").notNull(),
    outAmount: int64("out_amount"),
    bandBps: integer("band_bps").notNull(),
    sig: text("sig").unique(),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("swaps_user_id_idx").on(t.userId)],
);

export const conversions = pgTable(
  "conversions",
  {
    id: id(),
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id),
    assetMint: text("asset_mint")
      .notNull()
      .references(() => assets.mint),
    amount: int64("amount").notNull(),
    targetMint: text("target_mint").notNull(),
    outAmount: int64("out_amount"),
    sig: text("sig").unique(),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversions_router_id_idx").on(t.routerId)],
);

export const feeLedger = pgTable("fee_ledger", {
  id: id(),
  legId: uuid("leg_id")
    .unique()
    .references(() => legs.id),
  swapId: uuid("swap_id")
    .unique()
    .references(() => swaps.id),
  amountUsdc: int64("amount_usdc").notNull(),
  sig: text("sig").notNull(),
  createdAt: createdAt(),
});

export const crankTxs = pgTable("crank_txs", {
  signature: text("signature").primaryKey(),
  kind: text("kind").notNull(),
  routerId: uuid("router_id").references(() => routers.id),
  feeLamports: int64("fee_lamports"),
  priorityLamports: int64("priority_lamports"),
  cuUsed: integer("cu_used"),
  landedVia: text("landed_via"),
  status: text("status").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const submittedTxs = pgTable(
  "submitted_txs",
  {
    signature: text("signature").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    context: jsonb("context").$type<JsonObject>().notNull().default({}),
    status: text("status", {
      enum: ["submitted", "confirmed", "finalized", "failed", "expired"],
    })
      .notNull()
      .default("submitted"),
    error: text("error"),
    slot: int64("slot"),
    submittedAt: timestamptz("submitted_at").notNull().defaultNow(),
    confirmedAt: timestamptz("confirmed_at"),
    finalizedAt: timestamptz("finalized_at"),
  },
  (t) => [index("submitted_txs_user_id_idx").on(t.userId)],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    channel: text("channel", { enum: notificationChannels }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event, t.channel] })],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)],
);

export const telegramLinks = pgTable("telegram_links", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  chatId: int64("chat_id"),
  linkCode: text("link_code").unique(),
  linkCodeExpiresAt: timestamptz("link_code_expires_at"),
  linkedAt: timestamptz("linked_at"),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    channel: text("channel", { enum: notificationChannels }).notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull().default({}),
    status: text("status").notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    sentAt: timestamptz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

export const partners = pgTable("partners", {
  id: id(),
  name: text("name").notNull(),
  contactEmail: text("contact_email"),
  payoutAddress: text("payout_address"),
  revenueShareBps: integer("revenue_share_bps").notNull().default(2500),
  disabledAt: timestamptz("disabled_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const partnerKeys = pgTable(
  "partner_keys",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [index("partner_keys_partner_id_idx").on(t.partnerId)],
);

export const partnerWebhooks = pgTable(
  "partner_webhooks",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: text("events").array().notNull().default(sql`'{}'`),
    disabledAt: timestamptz("disabled_at"),
    createdAt: createdAt(),
  },
  (t) => [index("partner_webhooks_partner_id_idx").on(t.partnerId)],
);

export const partnerWebhookDeliveries = pgTable(
  "partner_webhook_deliveries",
  {
    id: id(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => partnerWebhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    attempt: integer("attempt").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at"),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    createdAt: createdAt(),
    deliveredAt: timestamptz("delivered_at"),
  },
  (t) => [
    index("partner_webhook_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.deliveredAt} is null`),
  ],
);

export const partnerInvites = pgTable(
  "partner_invites",
  {
    id: id(),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "cascade" }),
    inviterUserId: uuid("inviter_user_id").references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    preset: jsonb("preset").$type<InvitePreset>().notNull(),
    expiresAt: timestamptz("expires_at"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("partner_invites_partner_id_idx").on(t.partnerId)],
);

export const partnerMembers = pgTable(
  "partner_members",
  {
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id").references(() => partnerInvites.id, { onDelete: "set null" }),
    consentedAt: timestamptz("consented_at"),
    consentRevokedAt: timestamptz("consent_revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.partnerId, t.userId] }),
    index("partner_members_user_id_idx").on(t.userId),
  ],
);

export const proofRuns = pgTable("proof_runs", {
  id: id(),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["canonical", "control", "ablation", "campaign"] }).notNull(),
  environment: text("environment", { enum: ["fork", "mainnet"] }).notNull(),
  legId: uuid("leg_id").references(() => legs.id),
  manifestKey: text("manifest_key"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const statusSnapshots = pgTable(
  "status_snapshots",
  {
    id: id(),
    component: text("component").notNull(),
    status: text("status").notNull(),
    metrics: jsonb("metrics").$type<JsonObject>().notNull().default({}),
    capturedAt: timestamptz("captured_at").notNull().defaultNow(),
  },
  (t) => [index("status_snapshots_component_captured_at_idx").on(t.component, t.capturedAt)],
);

/** Append-only: a trigger rejects UPDATE, DELETE and TRUNCATE. */
export const auditLog = pgTable("audit_log", {
  id: int64("id").primaryKey().generatedAlwaysAsIdentity(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<JsonObject>().notNull().default({}),
  ip: text("ip"),
  createdAt: createdAt(),
});

export const waitlist = pgTable(
  "waitlist",
  {
    id: id(),
    email: text("email").notNull(),
    country: text("country"),
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("waitlist_email_lower_key").on(sql`lower(${t.email})`)],
);
