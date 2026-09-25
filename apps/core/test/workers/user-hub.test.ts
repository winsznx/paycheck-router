import { env, exports } from "cloudflare:workers";
import { api } from "@paycheck-router/shared";
import { describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/auth/tokens.ts";
import { userHubFor } from "../../src/do/stubs.ts";
import type { Env } from "../../src/env.ts";

const testEnv = env as unknown as Env;
const USER = "6b1f3c0e-1d2a-4c8e-9f51-0a7c2b9d4e11";
const WALLET = "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy";

const detected = (amount: string) =>
  ({
    type: "paycheck.detected",
    data: {
      routerId: USER,
      routerPda: WALLET,
      amount,
      sender: null,
      signature: null,
      detectedAt: new Date().toISOString(),
    },
  }) as const;

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), {
      once: true,
    });
  });
}

describe("UserHub", () => {
  it("keeps a replay log with monotonic ULIDs and resumes after an id", async () => {
    const hub = userHubFor(testEnv, `${USER}-log`);
    const first = await hub.publish(detected("1"));
    const second = await hub.publish(detected("2"));
    const third = await hub.publish(detected("3"));
    expect(api.ServerEvent.parse(first).id < second.id).toBe(true);
    expect(second.id < third.id).toBe(true);
    const replay = await hub.replay(first.id);
    expect(replay.complete).toBe(true);
    expect(replay.events.map((event) => event.id)).toEqual([second.id, third.id]);
    expect((await hub.replay(null)).events).toEqual([]);
  });

  it("marks a resume incomplete when the id predates the log", async () => {
    const hub = userHubFor(testEnv, `${USER}-gap`);
    await hub.publish(detected("1"));
    const replay = await hub.replay("00000000000000000000000000");
    expect(replay.complete).toBe(false);
    expect(replay.events).toHaveLength(1);
  });

  it("authenticates /realtime with the bearer subprotocol and streams events", async () => {
    const { token } = await signAccessToken(
      testEnv.SESSION_SIGNING_KEY,
      { userId: USER, wallet: WALLET },
      new Date(),
    );
    const response = await exports.default.fetch("http://core.test/realtime", {
      headers: {
        upgrade: "websocket",
        "sec-websocket-protocol": `${api.REALTIME_PROTOCOL}, ${api.REALTIME_BEARER_PREFIX}${token}`,
      },
    });
    expect(response.status).toBe(101);
    expect(response.headers.get("sec-websocket-protocol")).toBe(api.REALTIME_PROTOCOL);
    const socket = response.webSocket;
    if (!socket) throw new Error("no socket");
    socket.accept();

    const pong = nextMessage(socket);
    socket.send(JSON.stringify({ type: "ping" }));
    expect(await pong).toMatchObject({ type: "pong" });

    const pushed = nextMessage(socket);
    const event = await userHubFor(testEnv, USER).publish(detected("1850000000"));
    expect(await pushed).toEqual(event);

    const resumed = nextMessage(socket);
    socket.send(JSON.stringify({ type: "resume", lastEventId: event.id }));
    expect(await resumed).toEqual({ type: "resumed", replayed: 0, complete: true });

    const rejected = nextMessage(socket);
    socket.send(JSON.stringify({ type: "subscribe" }));
    expect(await rejected).toMatchObject({ type: "error", code: "bad_message" });
    socket.close(1000, "done");
  });

  it("refuses an upgrade without a valid session", async () => {
    const response = await exports.default.fetch("http://core.test/realtime", {
      headers: { upgrade: "websocket", "sec-websocket-protocol": "bearer.nope" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
});
