import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";

/** One PreStocks mark as the attester last accepted or is holding for confirmation. */
export type StoredMark = { mint: string; markPriceE9: bigint; observedAt: number };

export type MarkBookState = { lastAccepted: StoredMark[]; pendingJump: StoredMark[] };

const KEY = "marks";

/**
 * One instance (`idFromName("prestocks")`). Remembers the attester's accepted PreStocks marks and
 * any jump over 20% awaiting a confirming read 60 s later (section 7.5), so the rule holds across
 * Executor invocations instead of resetting with every batch.
 */
export class MarkBook extends DurableObject<Env> {
  async load(): Promise<MarkBookState> {
    return (
      (await this.ctx.storage.get<MarkBookState>(KEY)) ?? { lastAccepted: [], pendingJump: [] }
    );
  }

  async save(state: MarkBookState): Promise<void> {
    await this.ctx.storage.put(KEY, state);
  }
}
