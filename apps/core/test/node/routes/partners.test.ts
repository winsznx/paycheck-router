import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { api } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { adminUsers, partnerWebhookDeliveries, partnerWebhooks } from "../../../src/db/schema.ts";
import { fanOut, signatureHeader, webhookSecret } from "../../../src/partners/webhooks.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

const SIGNING_KEY = "partner-signing-key-for-tests";
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

describe("partner routes and webhooks", () => {
  const env = testEnv({ PARTNER_WEBHOOK_SIGNING_KEY: SIGNING_KEY });
  let app: ReturnType<typeof testApp>;
  let db: Db;
  const received: { headers: IncomingMessage["headers"]; body: string }[] = [];
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end("ok");
    });
  });
  let receiverUrl = "";

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  });

  afterAll(() => {
    receiver.close();
  });

  const json = (headers: Record<string, string>, body: unknown) => ({
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function partnerKey(): Promise<string> {
    const admin = await sessionFor(app, env, await generateKeyPairSigner());
    await db.insert(adminUsers).values({ userId: admin.user.id, role: "admin" });
    const res = await app.request(
      "/admin/partners",
      json(bearer(admin), { name: "Payroll Co" }),
      env,
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { key: string }).key;
  }

  it("signs deliveries as t=<unix>,v1=<hmac>", async () => {
    const header = await signatureHeader("secret", '{"a":1}', 1_790_000_000);
    const expected = createHmac("sha256", "secret").update('1790000000.{"a":1}').digest("hex");
    expect(header).toBe(`t=1790000000,v1=${expected}`);
  });

  it("runs invite, consent, members, stats and a signed webhook delivery", async () => {
    const key = await partnerKey();
    const partner = { authorization: `Bearer ${key}` };

    const invite = await app.request(
      "/partner/invites",
      json(partner, {
        preset: { investBps: 2000, legs: [{ mint: SPYX, weightBps: 10_000, bandBps: 50 }] },
      }),
      env,
    );
    expect(invite.status).toBe(201);
    const { code } = api.Invite.parse(await invite.json());
    expect(
      api.InviteView.parse(await (await app.request(`/invites/${code}`, {}, env)).json()),
    ).toMatchObject({
      partner: "Payroll Co",
    });

    const hook = await app.request(
      "/partner/webhooks",
      json(partner, { url: "https://partner.example/hooks", events: ["member.joined"] }),
      env,
    );
    expect(hook.status).toBe(201);
    const created = api.Webhook.parse(await hook.json());
    expect(created.secret).toBe(await webhookSecret(SIGNING_KEY, created.id));
    await db
      .update(partnerWebhooks)
      .set({ url: receiverUrl })
      .where(eq(partnerWebhooks.id, created.id));

    const member = await sessionFor(app, env, await generateKeyPairSigner());
    const accept = await app.request(
      `/invites/${code}/accept`,
      json(bearer(member), { shareWithPartner: true }),
      env,
    );
    expect(accept.status).toBe(200);

    expect(received).toHaveLength(1);
    const delivery = received[0];
    const [t, v1] = String(delivery?.headers["x-paycheck-signature"]).split(",");
    const unix = t?.slice(2) ?? "";
    const expected = createHmac("sha256", created.secret ?? "")
      .update(`${unix}.${delivery?.body}`)
      .digest("hex");
    expect(v1).toBe(`v1=${expected}`);
    expect(JSON.parse(delivery?.body ?? "{}")).toMatchObject({ event: "member.joined" });

    const members = api.PartnerMembersResponse.parse(
      await (await app.request("/partner/members", { headers: partner }, env)).json(),
    );
    expect(members.members.map((row) => row.memberId)).toEqual([member.user.id]);
    const stats = api.PartnerStatsResponse.parse(
      await (await app.request("/partner/stats", { headers: partner }, env)).json(),
    );
    expect(stats).toMatchObject({ members: 1, paychecks: 0, revenueShareBps: 2500 });
  });

  it("refuses unknown keys and schedules a retry when the receiver fails", async () => {
    expect(
      (
        await app.request(
          "/partner/stats",
          { headers: { authorization: "Bearer pk_live_nope" } },
          env,
        )
      ).status,
    ).toBe(401);

    const key = await partnerKey();
    const hookRes = await app.request(
      "/partner/webhooks",
      json(
        { authorization: `Bearer ${key}` },
        { url: "https://partner.example/x", events: ["leg.waiting"] },
      ),
      env,
    );
    const hook = api.Webhook.parse(await hookRes.json());
    await db
      .update(partnerWebhooks)
      .set({ url: "http://127.0.0.1:9/unreachable" })
      .where(eq(partnerWebhooks.id, hook.id));
    const invite = api.Invite.parse(
      await (
        await app.request(
          "/partner/invites",
          json(
            { authorization: `Bearer ${key}` },
            { preset: { investBps: 2000, legs: [{ mint: SPYX, weightBps: 10_000, bandBps: 50 }] } },
          ),
          env,
        )
      ).json(),
    );
    const member = await sessionFor(app, env, await generateKeyPairSigner());
    await app.request(
      `/invites/${invite.code}/accept`,
      json(bearer(member), { shareWithPartner: true }),
      env,
    );
    await fanOut(db, SIGNING_KEY, member.user.id, "leg.waiting", { symbol: "SPYx" }, new Date());
    const [row] = await db
      .select()
      .from(partnerWebhookDeliveries)
      .where(eq(partnerWebhookDeliveries.webhookId, hook.id));
    expect(row).toMatchObject({ status: "retrying", attempt: 1 });
    expect(row?.nextAttemptAt).not.toBeNull();
  });
});
