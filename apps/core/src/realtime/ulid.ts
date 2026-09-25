const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let value = ms;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function randomChars(count: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(count));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % 32];
  return out;
}

function increment(chars: string): string {
  const digits = [...chars];
  for (let i = digits.length - 1; i >= 0; i--) {
    const index = ALPHABET.indexOf(digits[i] ?? "0");
    if (index < 31) {
      digits[i] = ALPHABET[index + 1] ?? "0";
      return digits.join("");
    }
    digits[i] = "0";
  }
  throw new Error("ULID random component overflowed within one millisecond");
}

/**
 * Monotonic ULIDs: lexical order equals creation order within one generator, so a replay can
 * page with `id > lastEventId`.
 */
export function ulidFactory(): (now: number) => string {
  let lastTime = -1;
  let lastRandom = "";
  return (now: number) => {
    if (now <= lastTime) {
      lastRandom = increment(lastRandom);
      return encodeTime(lastTime) + lastRandom;
    }
    lastTime = now;
    lastRandom = randomChars(16);
    return encodeTime(now) + lastRandom;
  };
}
