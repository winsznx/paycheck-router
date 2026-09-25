export type FetchLike = typeof fetch;

export class JsonRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly rpcMessage: string,
    readonly data: unknown,
  ) {
    super(`${method} failed: ${code} ${rpcMessage}`);
    this.name = "JsonRpcError";
  }
}

let nextId = 0;

/**
 * One JSON-RPC call returning the untouched `result`, for evidence that must be stored exactly as
 * the node sent it and for surfnet cheatcodes that `@solana/kit` does not model.
 */
export async function jsonRpc<T>(
  url: string,
  method: string,
  params: unknown[] = [],
  fetchImpl: FetchLike = fetch,
): Promise<{ result: T; raw: string }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
  });
  const raw = await res.text();
  if (!res.ok) throw new JsonRpcError(method, res.status, raw.slice(0, 500), null);
  const body = JSON.parse(raw) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
  if (body.error) {
    throw new JsonRpcError(method, body.error.code, body.error.message, body.error.data ?? null);
  }
  return { result: body.result as T, raw };
}
