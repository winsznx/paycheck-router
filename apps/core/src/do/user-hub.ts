import { DurableObject } from "cloudflare:workers";
import { api, assetByMint } from "@paycheck-router/shared";
import type { Env } from "../env.ts";
import { log } from "../log.ts";
import { latestPrices } from "../pricing/hermes.ts";
import { ulidFactory } from "../realtime/ulid.ts";

type Attachment = { userId: string; priceMints: string[]; lastTickAt: Record<string, number> };

export type PublishInput = {
  [T in api.ServerEventType]: { type: T; data: api.ServerEventPayload<T> };
}[api.ServerEventType];

const PRICE_TICK_MS = 1_000;

/**
 * One per user. Holds the user's WebSockets with the Hibernation API, keeps the last 500 events
 * in SQLite for `resume`, and streams throttled Pyth ticks for subscribed mints.
 */
export class UserHub extends DurableObject<Env> {
  private readonly nextId = ulidFactory();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "create table if not exists events (id text primary key, type text not null, ts text not null, data text not null)",
      );
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const userId = request.headers.get("x-user-id");
    if (!userId) return new Response("Missing user", { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    const attachment: Attachment = { userId, priceMints: [], lastTickAt: {} };
    server.serializeAttachment(attachment);
    const headers = new Headers();
    const offered = request.headers.get("sec-websocket-protocol") ?? "";
    if (offered.split(",").some((value) => value.trim() === api.REALTIME_PROTOCOL)) {
      headers.set("sec-websocket-protocol", api.REALTIME_PROTOCOL);
    }
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  /** Appends an event to the replay log and fans it out to every open socket. */
  publish(input: PublishInput): api.ServerEvent {
    const event = { ...input, id: this.nextId(Date.now()), ts: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      "insert into events (id, type, ts, data) values (?, ?, ?, ?)",
      event.id,
      event.type,
      event.ts,
      JSON.stringify(event.data),
    );
    this.ctx.storage.sql.exec(
      "delete from events where id not in (select id from events order by id desc limit ?)",
      api.REALTIME_REPLAY_LIMIT,
    );
    const frame = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) this.sendSafe(socket, frame);
    return event as api.ServerEvent;
  }

  /** Events after `lastEventId`, oldest first, and whether the log still covered that id. */
  replay(lastEventId: string | null): { events: api.ServerEvent[]; complete: boolean } {
    if (!lastEventId) return { events: [], complete: true };
    const known = this.ctx.storage.sql
      .exec("select count(*) as n from events where id <= ?", lastEventId)
      .one().n as number;
    const rows = this.ctx.storage.sql
      .exec<{ id: string; type: string; ts: string; data: string }>(
        "select id, type, ts, data from events where id > ? order by id asc limit ?",
        lastEventId,
        api.REALTIME_REPLAY_LIMIT,
      )
      .toArray();
    return {
      events: rows.map(
        (row) =>
          ({
            id: row.id,
            type: row.type,
            ts: row.ts,
            data: JSON.parse(row.data),
          }) as api.ServerEvent,
      ),
      complete: known > 0,
    };
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendControl(socket, { type: "error", code: "bad_json", message: "Messages are JSON" });
      return;
    }
    const message = api.ClientMessage.safeParse(parsed);
    if (!message.success) {
      this.sendControl(socket, { type: "error", code: "bad_message", message: "Unknown message" });
      return;
    }
    switch (message.data.type) {
      case "ping":
        this.sendControl(socket, { type: "pong", ts: new Date().toISOString() });
        return;
      case "resume": {
        const { events, complete } = this.replay(message.data.lastEventId);
        for (const event of events) this.sendSafe(socket, JSON.stringify(event));
        this.sendControl(socket, { type: "resumed", replayed: events.length, complete });
        return;
      }
      case "subscribe.prices": {
        const attachment = socket.deserializeAttachment() as Attachment;
        const priceMints = message.data.mints.filter((mint) => assetByMint(mint)?.feedId);
        socket.serializeAttachment({ ...attachment, priceMints });
        if (priceMints.length > 0 && (await this.ctx.storage.getAlarm()) === null) {
          await this.ctx.storage.setAlarm(Date.now() + PRICE_TICK_MS);
        }
        return;
      }
    }
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code === 1005 ? 1000 : code, "closing");
  }

  override async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    log.warn("realtime socket error", { error });
    socket.close(1011, "error");
  }

  /** Price ticks: one Hermes read per second for the union of subscribed mints. */
  override async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    const wanted = new Map<string, string>();
    for (const socket of sockets) {
      const attachment = socket.deserializeAttachment() as Attachment;
      for (const mint of attachment.priceMints) {
        const feedId = assetByMint(mint)?.feedId;
        if (feedId) wanted.set(feedId, mint);
      }
    }
    if (wanted.size === 0) return;
    try {
      const prices = await latestPrices(
        { url: this.env.HERMES_URL, apiKey: this.env.PYTH_API_KEY },
        [...wanted.keys()],
      );
      for (const price of prices) {
        const mint = wanted.get(price.feedId);
        const asset = mint ? assetByMint(mint) : undefined;
        if (!mint || !asset) continue;
        const frame = JSON.stringify({
          type: "price.tick",
          id: this.nextId(Date.now()),
          ts: new Date().toISOString(),
          data: {
            mint,
            symbol: asset.symbol,
            price: {
              feedId: price.feedId,
              price: price.price.toString(),
              conf: price.conf.toString(),
              exponent: price.exponent,
              publishTime: price.publishTime.toISOString(),
            },
          },
        } satisfies api.ServerEvent);
        for (const socket of sockets) {
          const attachment = socket.deserializeAttachment() as Attachment;
          if (attachment.priceMints.includes(mint)) this.sendSafe(socket, frame);
        }
      }
    } catch (error) {
      log.warn("price tick failed", { error });
    }
    await this.ctx.storage.setAlarm(Date.now() + PRICE_TICK_MS);
  }

  private sendControl(socket: WebSocket, message: api.ServerControl): void {
    this.sendSafe(socket, JSON.stringify(message));
  }

  private sendSafe(socket: WebSocket, frame: string): void {
    try {
      socket.send(frame);
    } catch (error) {
      log.warn("realtime send failed", { error });
    }
  }
}
