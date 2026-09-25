import { z } from "zod";
import { Bps, IsoDateTime, U64String, Uuid } from "./common.ts";
import { LegSpec } from "./market.ts";

export const PartnerWebhookEvent = z.enum([
  "member.joined",
  "paycheck.recorded",
  "leg.executed",
  "leg.waiting",
  "leg.expired",
]);
export type PartnerWebhookEvent = z.infer<typeof PartnerWebhookEvent>;

export const InvitePreset = z.object({
  investBps: z.number().int().min(100).max(10_000),
  legs: z.array(LegSpec).min(1).max(8),
});
export type InvitePreset = z.infer<typeof InvitePreset>;

/** `POST /partner/invites` (partner key). */
export const CreateInviteRequest = z.object({
  preset: InvitePreset.refine(
    (preset) => preset.legs.reduce((sum, leg) => sum + leg.weightBps, 0) === 10_000,
    { message: "leg weights must sum to 10000 bps", path: ["legs"] },
  ),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const Invite = z.object({
  id: Uuid,
  code: z.string(),
  url: z.url(),
  preset: InvitePreset,
  expiresAt: IsoDateTime.nullable(),
});
export type Invite = z.infer<typeof Invite>;

/** `GET /invites/:code` (public): what the invite pre-fills, and who sent it. */
export const InviteView = z.object({
  code: z.string(),
  partner: z.string().nullable(),
  preset: InvitePreset,
  expiresAt: IsoDateTime.nullable(),
});
export type InviteView = z.infer<typeof InviteView>;

/** `POST /invites/:code/accept` (user): join the partner and consent to share milestones. */
export const AcceptInviteRequest = z.object({ shareWithPartner: z.boolean() });
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequest>;

/** `GET /partner/members`: consenting members only, identified by join order, no wallets. */
export const PartnerMembersResponse = z.object({
  members: z.array(
    z.object({
      memberId: Uuid,
      joinedAt: IsoDateTime,
      consentedAt: IsoDateTime,
      paychecks: z.number().int(),
      investedUsdc: U64String,
    }),
  ),
});
export type PartnerMembersResponse = z.infer<typeof PartnerMembersResponse>;

/** `GET /partner/stats`: aggregates over consenting members. */
export const PartnerStatsResponse = z.object({
  members: z.number().int(),
  paychecks: z.number().int(),
  slicesExecuted: z.number().int(),
  investedUsdc: U64String,
  revenueShareBps: Bps,
});
export type PartnerStatsResponse = z.infer<typeof PartnerStatsResponse>;

/** `POST /partner/webhooks`. */
export const CreateWebhookRequest = z.object({
  url: z.url().refine((url) => url.startsWith("https://"), "webhooks must use https"),
  events: z.array(PartnerWebhookEvent).min(1),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>;

/** The signing secret is shown once, at creation. */
export const Webhook = z.object({
  id: Uuid,
  url: z.url(),
  events: z.array(PartnerWebhookEvent),
  secret: z.string().optional(),
  createdAt: IsoDateTime,
});
export type Webhook = z.infer<typeof Webhook>;

/** Header on every delivery: `t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. */
export const PARTNER_SIGNATURE_HEADER = "x-paycheck-signature";

/** `POST /admin/partners` (admin): the key is returned once. */
export const CreatePartnerRequest = z.object({
  name: z.string().min(1).max(120),
  contactEmail: z.email().optional(),
});
export type CreatePartnerRequest = z.infer<typeof CreatePartnerRequest>;
