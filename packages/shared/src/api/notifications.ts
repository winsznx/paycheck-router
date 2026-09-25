import { z } from "zod";
import { IsoDateTime } from "./common.ts";

export const NotificationChannel = z.enum(["email", "push", "telegram"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationEvent = z.enum([
  "paycheck.recorded",
  "paycheck.complete",
  "slice.waiting",
  "slice.expired",
  "allowance.low",
  "allowance.revoked",
  "router.changed",
  "sign_in.new",
  "conversion.reminder",
  "weekly.summary",
  "incident",
]);
export type NotificationEvent = z.infer<typeof NotificationEvent>;

/** Default channels per event and whether the user may turn them off (PRD 19.2). */
export const NOTIFICATION_DEFAULTS: Record<
  NotificationEvent,
  { channels: readonly NotificationChannel[]; canDisable: boolean }
> = {
  "paycheck.recorded": { channels: ["push", "telegram"], canDisable: true },
  "paycheck.complete": { channels: ["push", "telegram"], canDisable: true },
  "slice.waiting": { channels: ["push", "telegram"], canDisable: true },
  "slice.expired": { channels: ["push", "telegram", "email"], canDisable: true },
  "allowance.low": { channels: ["push", "email", "telegram"], canDisable: true },
  "allowance.revoked": { channels: ["email", "push"], canDisable: false },
  "router.changed": { channels: ["email", "push"], canDisable: false },
  "sign_in.new": { channels: ["email"], canDisable: false },
  "conversion.reminder": { channels: ["email", "push", "telegram"], canDisable: false },
  "weekly.summary": { channels: ["email"], canDisable: true },
  incident: { channels: ["push", "telegram"], canDisable: true },
};

export const NotificationPref = z.object({
  event: NotificationEvent,
  channel: NotificationChannel,
  enabled: z.boolean(),
  canDisable: z.boolean(),
});
export type NotificationPref = z.infer<typeof NotificationPref>;

/** `GET /notifications/prefs`. */
export const NotificationPrefsResponse = z.object({
  prefs: z.array(NotificationPref),
  channels: z.object({
    email: z.object({ configured: z.boolean(), address: z.string().nullable() }),
    push: z.object({ configured: z.boolean() }),
    telegram: z.object({ configured: z.boolean(), linked: z.boolean() }),
  }),
});
export type NotificationPrefsResponse = z.infer<typeof NotificationPrefsResponse>;

/** `PUT /notifications/prefs`. Security events ignore attempts to disable them. */
export const PutNotificationPrefsRequest = z.object({
  prefs: z
    .array(
      z.object({ event: NotificationEvent, channel: NotificationChannel, enabled: z.boolean() }),
    )
    .max(64),
});
export type PutNotificationPrefsRequest = z.infer<typeof PutNotificationPrefsRequest>;

/** `POST /telegram/link`: a one-time code and the bot deep link. */
export const TelegramLinkResponse = z.object({
  code: z.string(),
  url: z.url(),
  expiresAt: IsoDateTime,
});
export type TelegramLinkResponse = z.infer<typeof TelegramLinkResponse>;
