const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Server-side Turnstile check; a token is valid once and for 300 s. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);
  form.set("idempotency_key", crypto.randomUUID());
  const response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Turnstile siteverify failed with ${response.status}`);
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}
