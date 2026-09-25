import type { MarkState } from "@paycheck-router/sdk";
import { address } from "@solana/kit";
import type { MarkBookState } from "../do/mark-book.ts";

export function toMarkState(stored: MarkBookState): MarkState {
  return {
    lastAccepted: new Map(
      stored.lastAccepted.map((mark) => [
        address(mark.mint),
        { markPriceE9: mark.markPriceE9, observedAt: mark.observedAt },
      ]),
    ),
    pendingJump: new Map(
      stored.pendingJump.map((mark) => [
        address(mark.mint),
        { markPriceE9: mark.markPriceE9, observedAt: mark.observedAt },
      ]),
    ),
  };
}

export function fromMarkState(marks: MarkState): MarkBookState {
  return {
    lastAccepted: [...marks.lastAccepted].map(([mint, mark]) => ({ mint, ...mark })),
    pendingJump: [...marks.pendingJump].map(([mint, mark]) => ({ mint, ...mark })),
  };
}
