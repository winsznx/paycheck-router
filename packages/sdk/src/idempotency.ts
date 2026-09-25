import type { Address } from "@solana/kit";

/** Every leg attempt carries `router:seq:leg:attempt`; retries bump only `attempt`. */
export function legAttemptKey(router: Address, seq: bigint, legIndex: number, attempt: number) {
  return `${router}:${seq}:${legIndex}:${attempt}`;
}

export function parseLegAttemptKey(key: string): {
  router: string;
  seq: bigint;
  legIndex: number;
  attempt: number;
} {
  const parts = key.split(":");
  if (parts.length !== 4) throw new Error(`malformed leg attempt key ${key}`);
  const [router = "", seq = "", legIndex = "", attempt = ""] = parts;
  if (!/^\d+$/.test(seq) || !/^\d+$/.test(legIndex) || !/^\d+$/.test(attempt)) {
    throw new Error(`malformed leg attempt key ${key}`);
  }
  return { router, seq: BigInt(seq), legIndex: Number(legIndex), attempt: Number(attempt) };
}

/** Key for one recorded inflow: the router and its paycheck sequence. */
export function paycheckKey(router: Address, seq: bigint): string {
  return `${router}:${seq}`;
}
