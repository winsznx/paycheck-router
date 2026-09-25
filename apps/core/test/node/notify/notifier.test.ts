import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { notifications } from "../../../src/db/schema.ts";
import { deliver, render } from "../../../src/notify/notifier.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

describe("notifier", () => {
  const env = testEnv();
  let app: ReturnType<typeof testApp>;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });

  it("renders the paycheck copy from base units", () => {
    expect(
      render({
        userId: "u",
        event: "paycheck.recorded",
        data: { inflow: "1850000000", investTotal: "370000000", sender: null },
      }).text,
    ).toBe("$1,850 arrived. Buying $370 of stocks.");
  });

  it("logs unconfigured channels and never reports them delivered", async () => {
    const session = await sessionFor(app, env, await generateKeyPairSigner());
    const retry = await deliver(env, db, {
      userId: session.user.id,
      event: "paycheck.recorded",
      data: { inflow: "1850000000", investTotal: "370000000", sender: null },
    });
    expect(retry).toBe(false);
    const rows = await db
      .select({ channel: notifications.channel, status: notifications.status })
      .from(notifications)
      .where(eq(notifications.userId, session.user.id));
    expect(rows.sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([
      { channel: "push", status: "not_configured" },
      { channel: "telegram", status: "not_configured" },
    ]);
  });

  it("serves defaults and keeps security events on", async () => {
    const session = await sessionFor(app, env, await generateKeyPairSigner());
    const put = await app.request(
      "/notifications/prefs",
      {
        method: "PUT",
        headers: { ...bearer(session), "content-type": "application/json" },
        body: JSON.stringify({
          prefs: [
            { event: "paycheck.recorded", channel: "push", enabled: false },
            { event: "sign_in.new", channel: "email", enabled: false },
          ],
        }),
      },
      env,
    );
    expect(put.status).toBe(200);
    const body = api.NotificationPrefsResponse.parse(await put.json());
    const find = (event: string, channel: string) =>
      body.prefs.find((pref) => pref.event === event && pref.channel === channel);
    expect(find("paycheck.recorded", "push")?.enabled).toBe(false);
    expect(find("sign_in.new", "email")).toMatchObject({ enabled: true, canDisable: false });
    expect(body.channels.telegram).toEqual({ configured: false, linked: false });
  });
});
