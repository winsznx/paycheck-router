import { api } from "@paycheck-router/shared";
import { and, eq } from "drizzle-orm";
import { fixedToDecimal } from "../chain/shares.ts";
import type { Db } from "../db/client.ts";
import { notificationPrefs, notifications, telegramLinks, users } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { type Delivery, sendEmail, sendTelegram } from "./providers.ts";

export type NotifyMessage = {
  userId: string;
  event: api.NotificationEvent;
  data: Record<string, string | null>;
};

const usdc = (raw: string | null | undefined) =>
  raw ? `$${Number(fixedToDecimal(BigInt(raw), 6)).toLocaleString("en-US")}` : "";

/** Plain-text copy per event (PRD 19.2); amounts in USDC with two decimals at most. */
export function render(message: NotifyMessage): { subject: string; text: string } {
  const d = message.data;
  switch (message.event) {
    case "paycheck.recorded":
      return {
        subject: "Paycheck received",
        text: `${usdc(d.inflow)} arrived${d.sender ? ` from ${d.sender.slice(0, 4)}…${d.sender.slice(-4)}` : ""}. Buying ${usdc(d.investTotal)} of stocks.`,
      };
    case "paycheck.complete":
      return {
        subject: "Paycheck complete",
        text: `Every slice of your ${usdc(d.investTotal)} paycheck is final.`,
      };
    case "slice.waiting":
      return {
        subject: `${d.symbol ?? "A slice"} is waiting`,
        text: `Your ${usdc(d.amountIn)} ${d.symbol ?? ""} slice is waiting: ${d.reason ?? "no reason given"}. Your USDC stays in your wallet until it buys.`,
      };
    case "slice.expired":
      return {
        subject: `${d.symbol ?? "A slice"} expired`,
        text: `Your ${usdc(d.amountIn)} USDC stayed in your wallet.`,
      };
    default:
      return { subject: "Paycheck Router", text: JSON.stringify(d) };
  }
}

/** Channels for one user and event: stored preferences over the PRD defaults. */
async function channelsFor(db: Db, message: NotifyMessage): Promise<api.NotificationChannel[]> {
  const defaults = api.NOTIFICATION_DEFAULTS[message.event];
  const stored = await db
    .select()
    .from(notificationPrefs)
    .where(
      and(eq(notificationPrefs.userId, message.userId), eq(notificationPrefs.event, message.event)),
    );
  const overrides = new Map(stored.map((pref) => [pref.channel, pref.enabled]));
  return api.NotificationChannel.options.filter((channel) => {
    const enabled = overrides.get(channel) ?? defaults.channels.includes(channel);
    return enabled || (!defaults.canDisable && defaults.channels.includes(channel));
  });
}

/**
 * Sends one notification on every channel the user wants and logs each attempt in
 * `notifications`. A channel whose provider is not configured is logged as such and never
 * reported as delivered. Returns true when a retryable failure should send it back to the queue.
 */
export async function deliver(env: Env, db: Db, message: NotifyMessage): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, message.userId)).limit(1);
  if (!user || user.deletedAt) return false;
  const { subject, text } = render(message);
  let retry = false;
  let sent = false;
  for (const channel of await channelsFor(db, message)) {
    let delivery: Delivery;
    if (channel === "email") {
      delivery = user.email
        ? await sendEmail(env, user.email, subject, text)
        : { status: "not_configured", reason: "no email address on file" };
    } else if (channel === "telegram") {
      const [link] = await db
        .select()
        .from(telegramLinks)
        .where(eq(telegramLinks.userId, user.id))
        .limit(1);
      delivery = link?.chatId
        ? await sendTelegram(env, link.chatId, text)
        : { status: "not_configured", reason: "Telegram is not linked" };
      if (delivery.status === "failed" && delivery.error.startsWith("Telegram 403")) {
        await db
          .update(telegramLinks)
          .set({ chatId: null, linkedAt: null })
          .where(eq(telegramLinks.userId, user.id));
      }
    } else {
      delivery = {
        status: "not_configured",
        reason: "Web Push delivery is not built in this Worker yet",
      };
    }
    if (delivery.status === "failed" && delivery.retryable) retry = true;
    if (delivery.status === "sent") sent = true;
    await db.insert(notifications).values({
      userId: user.id,
      event: message.event,
      channel,
      payload: { subject, text },
      status: delivery.status,
      providerId: delivery.status === "sent" ? delivery.providerId : null,
      error:
        delivery.status === "failed"
          ? delivery.error
          : delivery.status === "not_configured"
            ? delivery.reason
            : null,
      sentAt: delivery.status === "sent" ? new Date() : null,
    });
  }
  // Retrying after a partial success would send the delivered channels twice.
  return retry && !sent;
}
