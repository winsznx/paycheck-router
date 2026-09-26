import { getBase58Decoder } from "@solana/kit";

export type ForkCall = { url: string; method: string; params: unknown[]; key: string | null };
type Handler = (params: unknown[]) => unknown;

/** Throwing from a handler answers with a JSON-RPC error carrying the message. */

/**
 * JSON-RPC test double for a surfnet, installed as the global `fetch`. It answers the methods a
 * test registers, records every call with the `X-Surfnet-Key` header it carried, and can be
 * switched to answer 502 like a fork that is down.
 */
export class FakeFork {
  readonly calls: ForkCall[] = [];
  down = false;
  private readonly handlers = new Map<string, Handler>();

  constructor(readonly url: string) {}

  on(method: string, handler: Handler): this {
    this.handlers.set(method, handler);
    return this;
  }

  called(method: string): ForkCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (!request.url.startsWith(this.url)) throw new Error(`unexpected fetch to ${request.url}`);
    const body = (await request.json()) as { id: number; method: string; params?: unknown[] };
    const params = body.params ?? [];
    this.calls.push({
      url: request.url,
      method: body.method,
      params,
      key: request.headers.get("x-surfnet-key"),
    });
    if (this.down) return new Response("bad gateway", { status: 502 });
    const handler = this.handlers.get(body.method);
    let payload: Record<string, unknown>;
    try {
      if (!handler) throw new Error(`${body.method} not faked`);
      payload = { jsonrpc: "2.0", id: body.id, result: await handler(params) };
    } catch (error) {
      payload = { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: String(error) } };
    }
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    });
  };
}

/** The first signature of a base64 wire transaction, as `sendTransaction` answers it. */
export function wireSignature(wire: string): string {
  const bytes = Buffer.from(wire, "base64");
  return getBase58Decoder().decode(bytes.subarray(1, 65));
}
