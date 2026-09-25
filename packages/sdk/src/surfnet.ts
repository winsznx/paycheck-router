import type { Address } from "@solana/kit";
import { type FetchLike, jsonRpc } from "./json-rpc.ts";

/** Surfpool cheatcodes. Only ever sent to a surfnet RPC; they do not exist on a real cluster. */
export class SurfnetCheatcodes {
  constructor(
    readonly rpcUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    return (await jsonRpc<T>(this.rpcUrl, method, params, this.fetchImpl)).result;
  }

  async setAccount(
    pubkey: Address,
    update: { lamports?: bigint; data?: Uint8Array; owner?: Address; executable?: boolean },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (update.lamports !== undefined) body.lamports = Number(update.lamports);
    if (update.data !== undefined) body.data = toHex(update.data);
    if (update.owner !== undefined) body.owner = update.owner;
    if (update.executable !== undefined) body.executable = update.executable;
    await this.call("surfnet_setAccount", [pubkey, body]);
  }

  async setTokenAccount(
    owner: Address,
    mint: Address,
    update: {
      amount?: bigint;
      delegate?: Address | null;
      delegatedAmount?: bigint;
      state?: "initialized" | "frozen";
    },
    tokenProgram?: Address,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (update.amount !== undefined) body.amount = Number(update.amount);
    if (update.delegate !== undefined) body.delegate = update.delegate;
    if (update.delegatedAmount !== undefined)
      body.delegated_amount = Number(update.delegatedAmount);
    if (update.state !== undefined) body.state = update.state;
    const params: unknown[] = [owner, mint, body];
    if (tokenProgram) params.push(tokenProgram);
    await this.call("surfnet_setTokenAccount", params);
  }

  /** Moves the surfnet clock to an absolute unix time in milliseconds. */
  async timeTravelTo(absoluteTimestampMs: number): Promise<{ absoluteSlot: number }> {
    return this.call("surfnet_timeTravel", [{ absoluteTimestamp: absoluteTimestampMs }]);
  }

  /** Drops the local copy so the next read fetches the account from mainnet again. */
  async resetAccount(pubkey: Address): Promise<void> {
    await this.call("surfnet_resetAccount", [pubkey]);
  }

  async setProgramAuthority(program: Address, authority: Address | null): Promise<void> {
    await this.call("surfnet_setProgramAuthority", [program, authority]);
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
