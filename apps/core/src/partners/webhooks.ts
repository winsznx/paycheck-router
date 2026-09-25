import { and, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { partnerMembers, partnerWebhookDeliveries, partnerWebhooks } from "../db/schema.ts";
import { log } from "../log.ts";

/** Section 11.5 retry schedule; after the last one the webhook is disabled. */
export const RETRY_DELAYS_SECS = [60, 300, 1_800, 7_200, 43_200] as const;

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Each webhook's secret is derived from `PARTNER_WEBHOOK_SIGNING_KEY` and its id. */
export function webhookSecret(signingKey: string, webhookId: string): Promise<string> {
  return hmacHex(signingKey, `webhook:${webhookId}`);
}

/** `t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. */
export async function signatureHeader(secret: string, body: string, unix: number): Promise<string> {
  return `t=${unix},v1=${await hmacHex(secret, `${unix}.${body}`)}`;
}

/**
 * Queues an event for every enabled webhook of every partner the user shares with (consent given
 * and not withdrawn), then attempts delivery at once.
 */
export async function fanOut(
  db: Db,
  signingKey: string | undefined,
  userId: string,
  event: string,
  data: Record<string, unknown>,
  now: Date,
): Promise<void> {
  if (!signingKey) return;
  const memberships = await db
    .select({ partnerId: partnerMembers.partnerId, consentedAt: partnerMembers.consentedAt })
    .from(partnerMembers)
    .where(and(eq(partnerMembers.userId, userId), isNull(partnerMembers.consentRevokedAt)));
  for (const membership of memberships) {
    if (!membership.consentedAt) continue;
    const hooks = await db
      .select()
      .from(partnerWebhooks)
      .where(
        and(
          eq(partnerWebhooks.partnerId, membership.partnerId),
          isNull(partnerWebhooks.disabledAt),
        ),
      );
    for (const hook of hooks) {
      if (!hook.events.includes(event)) continue;
      const [delivery] = await db
        .insert(partnerWebhookDeliveries)
        .values({
          webhookId: hook.id,
          event,
          payload: { event, data, memberId: userId },
          status: "pending",
          nextAttemptAt: now,
        })
        .returning({ id: partnerWebhookDeliveries.id });
      if (delivery) await attempt(db, signingKey, delivery.id, now);
    }
  }
}

/** One delivery attempt: 2xx marks it delivered, anything else schedules the next retry. */
export async function attempt(
  db: Db,
  signingKey: string,
  deliveryId: string,
  now: Date,
): Promise<void> {
  const [row] = await db
    .select({ delivery: partnerWebhookDeliveries, hook: partnerWebhooks })
    .from(partnerWebhookDeliveries)
    .innerJoin(partnerWebhooks, eq(partnerWebhooks.id, partnerWebhookDeliveries.webhookId))
    .where(eq(partnerWebhookDeliveries.id, deliveryId))
    .limit(1);
  if (!row || row.delivery.deliveredAt || row.hook.disabledAt) return;
  const body = JSON.stringify({ id: row.delivery.id, ...row.delivery.payload });
  const unix = Math.floor(now.getTime() / 1000);
  let status: number | null = null;
  try {
    const response = await fetch(row.hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-paycheck-signature": await signatureHeader(
          await webhookSecret(signingKey, row.hook.id),
          body,
          unix,
        ),
      },
      body,
    });
    status = response.status;
  } catch (error) {
    log.warn("partner webhook failed", { deliveryId, error });
  }
  const attemptNo = row.delivery.attempt + 1;
  if (status !== null && status >= 200 && status < 300) {
    await db
      .update(partnerWebhookDeliveries)
      .set({
        status: "delivered",
        attempt: attemptNo,
        responseStatus: status,
        deliveredAt: now,
        nextAttemptAt: null,
      })
      .where(eq(partnerWebhookDeliveries.id, deliveryId));
    return;
  }
  const delay = RETRY_DELAYS_SECS[attemptNo - 1];
  if (delay === undefined) {
    await db
      .update(partnerWebhookDeliveries)
      .set({ status: "failed", attempt: attemptNo, responseStatus: status, nextAttemptAt: null })
      .where(eq(partnerWebhookDeliveries.id, deliveryId));
    await db
      .update(partnerWebhooks)
      .set({ disabledAt: now })
      .where(eq(partnerWebhooks.id, row.hook.id));
    log.warn("partner webhook disabled after retries", { webhookId: row.hook.id });
    return;
  }
  await db
    .update(partnerWebhookDeliveries)
    .set({
      status: "retrying",
      attempt: attemptNo,
      responseStatus: status,
      nextAttemptAt: new Date(now.getTime() + delay * 1000),
    })
    .where(eq(partnerWebhookDeliveries.id, deliveryId));
}

/** Minute cron: retries every delivery whose next attempt is due. */
export async function retryDue(db: Db, signingKey: string | undefined, now: Date): Promise<void> {
  if (!signingKey) return;
  const due = await db
    .select({ id: partnerWebhookDeliveries.id })
    .from(partnerWebhookDeliveries)
    .where(
      and(
        isNull(partnerWebhookDeliveries.deliveredAt),
        lte(partnerWebhookDeliveries.nextAttemptAt, now),
      ),
    )
    .limit(50);
  for (const row of due) await attempt(db, signingKey, row.id, now);
}
