import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { markBookFor } from "../../src/do/stubs.ts";
import { fromMarkState, toMarkState } from "../../src/engine/marks.ts";
import type { Env } from "../../src/env.ts";

const ANTHROPIC = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";

describe("MarkBook", () => {
  it("starts empty and keeps the attester's marks between batches", async () => {
    const book = markBookFor(env as unknown as Env);
    const empty = toMarkState(await book.load());
    expect(empty.lastAccepted.size).toBe(0);

    empty.lastAccepted.set(ANTHROPIC as never, {
      markPriceE9: 1_044_640_000_000n,
      observedAt: 1_790_347_000,
    });
    empty.pendingJump.set(OPENAI as never, {
      markPriceE9: 1_334_300_000_000n,
      observedAt: 1_790_347_010,
    });
    await book.save(fromMarkState(empty));

    const restored = toMarkState(await book.load());
    expect(restored.lastAccepted.get(ANTHROPIC as never)).toEqual({
      markPriceE9: 1_044_640_000_000n,
      observedAt: 1_790_347_000,
    });
    expect(restored.pendingJump.get(OPENAI as never)?.markPriceE9).toBe(1_334_300_000_000n);
  });
});
