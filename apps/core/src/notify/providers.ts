import type { Env } from "../env.ts";

export type Delivery =
  | { status: "sent"; providerId: string | null }
  | { status: "not_configured"; reason: string }
  | { status: "failed"; error: string; retryable: boolean };

const RESEND_URL = "https://api.resend.com/emails";
const TELEGRAM_API = "https://api.telegram.org";

/** Resend REST API. Without `RESEND_API_KEY` and `RESEND_FROM` nothing is sent. */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  text: string,
): Promise<Delivery> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    return { status: "not_configured", reason: "RESEND_API_KEY or RESEND_FROM is not set" };
  }
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, text }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) {
    return {
      status: "failed",
      error: `Resend ${response.status}: ${body.message ?? "no message"}`,
      retryable: response.status === 429 || response.status >= 500,
    };
  }
  return { status: "sent", providerId: body.id ?? null };
}

/** Telegram Bot API `sendMessage`. A 403 means the user blocked the bot. */
export async function sendTelegram(env: Env, chatId: bigint, text: string): Promise<Delivery> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { status: "not_configured", reason: "TELEGRAM_BOT_TOKEN is not set" };
  }
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId.toString(), text, disable_web_page_preview: true }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  if (!response.ok || !body.ok) {
    return {
      status: "failed",
      error: `Telegram ${response.status}: ${body.description ?? "no description"}`,
      retryable: response.status === 429 || response.status >= 500,
    };
  }
  return { status: "sent", providerId: String(body.result?.message_id ?? "") || null };
}
