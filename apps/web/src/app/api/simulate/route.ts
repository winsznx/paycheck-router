import { z } from "zod";
import { rpcUrl } from "@/lib/env.ts";

export const dynamic = "force-dynamic";

const Body = z.object({ tx: z.base64().max(4096) });

const RpcResult = z.object({
  result: z
    .object({
      value: z.object({
        err: z.unknown().nullable(),
        logs: z.array(z.string()).nullable().optional(),
      }),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
});

export type SimulationResult = { ok: boolean; logs: string[] };

/**
 * Simulates an unsigned (or fee-payer-signed) transaction before the owner signs it
 * (PRD 13.2 Review). Runs server-side so a surfnet RPC without CORS headers still works;
 * it only ever calls `simulateTransaction`.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, logs: ["Invalid transaction"] }, { status: 400 });
  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [
          parsed.data.tx,
          {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: "confirmed",
          },
        ],
      }),
    });
    const body = RpcResult.parse(await upstream.json());
    if (body.error || !body.result) {
      const result: SimulationResult = {
        ok: false,
        logs: [body.error?.message ?? "Simulation failed"],
      };
      return Response.json(result);
    }
    const result: SimulationResult = {
      ok: body.result.value.err === null,
      logs: (body.result.value.logs ?? []).slice(-12),
    };
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    const result: SimulationResult = { ok: false, logs: ["The RPC could not be reached"] };
    return Response.json(result, { status: 502 });
  }
}
