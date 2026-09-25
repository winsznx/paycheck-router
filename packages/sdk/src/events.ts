import { PROGRAM_ID } from "@paycheck-router/shared";
import { type Decoder, getBase64Codec } from "@solana/kit";

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT = /^Program (\w+) (success|failed.*)$/;
const DATA = "Program data: ";

/** Every `Program data:` payload our program emitted, in order, as raw bytes. */
export function programDataFromLogs(
  logs: readonly string[],
  programId: string = PROGRAM_ID,
): Uint8Array[] {
  const stack: string[] = [];
  const out: Uint8Array[] = [];
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1] ?? "");
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith(DATA) && stack.at(-1) === programId) {
      out.push(Uint8Array.from(getBase64Codec().encode(line.slice(DATA.length))));
    }
  }
  return out;
}

/** Anchor's 8-byte event discriminator: sha256("event:<Name>")[0..8]. */
export async function eventDiscriminator(name: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`event:${name}`));
  return new Uint8Array(digest).slice(0, 8);
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, i) => bytes[i] === byte);
}

/** Decodes every event named `name` our program emitted in `logs`. */
export async function decodeEvents<T>(
  logs: readonly string[],
  name: string,
  decoder: Decoder<T>,
  programId: string = PROGRAM_ID,
): Promise<T[]> {
  const discriminator = await eventDiscriminator(name);
  return programDataFromLogs(logs, programId)
    .filter((data) => startsWith(data, discriminator))
    .map((data) => decoder.decode(data.slice(discriminator.length)));
}
