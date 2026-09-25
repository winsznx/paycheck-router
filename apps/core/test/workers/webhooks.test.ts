import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("webhooks and beacons", () => {
  it("refuses a Helius delivery without the shared secret", async () => {
    const res = await exports.default.fetch("http://core.test/webhooks/helius", {
      method: "POST",
      headers: { authorization: "wrong", "content-type": "application/json" },
      body: "[]",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("accepts a Helius delivery with the secret and triggers a sweep", async () => {
    const res = await exports.default.fetch("http://core.test/webhooks/helius", {
      method: "POST",
      headers: { authorization: "vitest-helius-secret", "content-type": "application/json" },
      body: JSON.stringify([{ signature: "x" }]),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1 });
  });

  it("writes a web-vitals beacon and rejects a malformed one", async () => {
    const ok = await exports.default.fetch("http://core.test/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "LCP", value: 1820, route: "/app", deviceClass: "mobile" }),
    });
    expect(ok.status).toBe(204);
    const bad = await exports.default.fetch("http://core.test/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "FPS", value: 1 }),
    });
    expect(bad.status).toBe(400);
  });
});
