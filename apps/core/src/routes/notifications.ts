import { api } from "@paycheck-router/shared";
import { and, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { newNonce } from "../auth/tokens.ts";
import { notificationPrefs, telegramLinks, users } from "../db/schema.ts";
import type { AppContext, AppEnv } from "../http/context.ts";
import { readJson } from "../http/json.ts";
import { notConfigured, notFound, parseOrThrow, unauthorized } from "../http/problem.ts";
import { rateLimit } from "../http/rate-limit.ts";
import { requireSession, sessionOf } from "../http/session.ts";
import { sendTelegram } from "../notify/providers.ts";

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.use("/notifications/*", requireSession, rateLimit("USER_LIMITER", "user"));
notificationRoutes.use("/telegram/link", requireSession, rateLimit("USER_LIMITER", "user"));

const LINK_TTL_MS = 10 * 60 * 1000;

async function prefsFor(c: AppContext): Promise<api.NotificationPrefsResponse> {
  const { db } = c.var.services;
  const { userId } = sessionOf(c);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound("User");
  const stored = await db
    .select()
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId));
  const overrides = new Map(stored.map((pref) => [`${pref.event}/${pref.channel}`, pref.enabled]));
  const [link] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .limit(1);
  const prefs: api.NotificationPref[] = [];
  for (const event of api.NotificationEvent.options) {
    const defaults = api.NOTIFICATION_DEFAULTS[event];
    for (const channel of api.NotificationChannel.options) {
      const byDefault = defaults.channels.includes(channel);
      const enabled = overrides.get(`${event}/${channel}`) ?? byDefault;
      prefs.push({
        event,
        channel,
        enabled: enabled || (!defaults.canDisable && byDefault),
        canDisable: defaults.canDisable || !byDefault,
      });
    }
  }
  const body: api.NotificationPrefsResponse = {
    prefs,
    channels: {
      email: {
        configured: Boolean(c.env.RESEND_API_KEY && c.env.RESEND_FROM),
        address: user.email,
      },
      push: { configured: false },
      telegram: {
        configured: Boolean(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_BOT_USERNAME),
        linked: Boolean(link?.chatId),
      },
    },
  };
  return body;
}

notificationRoutes.get("/notifications/prefs", async (c) => c.json(await prefsFor(c)));

notificationRoutes.put("/notifications/prefs", async (c) => {
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const body = parseOrThrow(api.PutNotificationPrefsRequest, await readJson(c));
  for (const pref of body.prefs) {
    const defaults = api.NOTIFICATION_DEFAULTS[pref.event];
    const locked = !defaults.canDisable && defaults.channels.includes(pref.channel);
    await db
      .insert(notificationPrefs)
      .values({
        userId,
        event: pref.event,
        channel: pref.channel,
        enabled: locked ? true : pref.enabled,
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: [notificationPrefs.userId, notificationPrefs.event, notificationPrefs.channel],
        set: { enabled: locked ? true : pref.enabled, updatedAt: now() },
      });
  }
  return c.json(await prefsFor(c));
});

/** A one-time code for `t.me/<bot>?start=<code>`; the bot webhook links the chat. */
notificationRoutes.post("/telegram/link", async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_BOT_USERNAME) throw notConfigured("Telegram");
  const { db, now } = c.var.services;
  const { userId } = sessionOf(c);
  const code = newNonce();
  const expiresAt = new Date(now().getTime() + LINK_TTL_MS);
  await db
    .insert(telegramLinks)
    .values({ userId, linkCode: code, linkCodeExpiresAt: expiresAt })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { linkCode: code, linkCodeExpiresAt: expiresAt },
    });
  const body: api.TelegramLinkResponse = {
    code,
    url: `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${code}`,
    expiresAt: expiresAt.toISOString(),
  };
  return c.json(body);
});

type TelegramUpdate = { message?: { chat?: { id?: number }; text?: string } };

/** Bot updates; `/start <code>` links the chat to the account that asked for the code. */
notificationRoutes.post("/webhooks/telegram", async (c) => {
  if (!c.env.TELEGRAM_WEBHOOK_SECRET || !c.env.TELEGRAM_BOT_TOKEN) throw notConfigured("Telegram");
  if (c.req.header("x-telegram-bot-api-secret-token") !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    throw unauthorized("Bad Telegram secret token");
  }
  const { db, now } = c.var.services;
  const update = (await readJson(c)) as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const code = /^\/start\s+(\S+)/.exec(update.message?.text ?? "")?.[1];
  if (!chatId || !code) return c.json({ ok: true });
  const [linked] = await db
    .update(telegramLinks)
    .set({ chatId: BigInt(chatId), linkedAt: now(), linkCode: null, linkCodeExpiresAt: null })
    .where(and(eq(telegramLinks.linkCode, code), gt(telegramLinks.linkCodeExpiresAt, now())))
    .returning({ userId: telegramLinks.userId });
  await sendTelegram(
    c.env,
    BigInt(chatId),
    linked
      ? "Linked. Paycheck Router will message you here when your paychecks buy."
      : "That link has expired. Open Settings in the app to get a new one.",
  );
  return c.json({ ok: true });
});
