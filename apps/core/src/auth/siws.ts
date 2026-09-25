import {
  type Address,
  getPublicKeyFromAddress,
  isSignatureBytes,
  verifySignature,
} from "@solana/kit";

export const SIWS_STATEMENT = "Sign in to Paycheck Router";

/** Fields of a Sign-In-With-Solana message, in the text layout wallets produce. */
export type SiwsMessage = {
  domain: string;
  address: string;
  statement: string | null;
  uri: string | null;
  version: string | null;
  chainId: string | null;
  nonce: string | null;
  issuedAt: string | null;
  expirationTime: string | null;
  notBefore: string | null;
  requestId: string | null;
  resources: string[];
};

const HEADER = / wants you to sign in with your Solana account:$/;

const FIELD_KEYS = {
  URI: "uri",
  Version: "version",
  "Chain ID": "chainId",
  Nonce: "nonce",
  "Issued At": "issuedAt",
  "Expiration Time": "expirationTime",
  "Not Before": "notBefore",
  "Request ID": "requestId",
} as const satisfies Record<string, keyof SiwsMessage>;

/** Parses the message text the wallet signed; returns null when it is not a SIWS message. */
export function parseSiwsMessage(text: string): SiwsMessage | null {
  const lines = text.split("\n");
  const header = lines[0];
  const address = lines[1];
  if (!header || !HEADER.test(header) || !address) return null;
  const message: SiwsMessage = {
    domain: header.replace(HEADER, ""),
    address,
    statement: null,
    uri: null,
    version: null,
    chainId: null,
    nonce: null,
    issuedAt: null,
    expirationTime: null,
    notBefore: null,
    requestId: null,
    resources: [],
  };
  let index = 2;
  if (lines[index] === "" && lines[index + 1] !== undefined && !lines[index + 1]?.includes(": ")) {
    message.statement = lines[index + 1] ?? null;
    index += 2;
  }
  let inResources = false;
  for (const line of lines.slice(index)) {
    if (line === "") continue;
    if (inResources && line.startsWith("- ")) {
      message.resources.push(line.slice(2));
      continue;
    }
    if (line === "Resources:") {
      inResources = true;
      continue;
    }
    const separator = line.indexOf(": ");
    if (separator === -1) return null;
    const key = line.slice(0, separator) as keyof typeof FIELD_KEYS;
    const field = FIELD_KEYS[key];
    if (!field) return null;
    message[field] = line.slice(separator + 2);
  }
  return message;
}

export type SiwsExpectations = {
  domain: string;
  address: string;
  chainId: string;
  now: Date;
  /** How far `Issued At` may sit from the server clock. */
  maxSkewMs: number;
};

export type SiwsCheck = { ok: true; nonce: string } | { ok: false; reason: string };

export function checkSiwsMessage(message: SiwsMessage, expect: SiwsExpectations): SiwsCheck {
  if (message.domain !== expect.domain) return { ok: false, reason: "domain mismatch" };
  if (message.address !== expect.address) return { ok: false, reason: "address mismatch" };
  if (message.statement !== SIWS_STATEMENT) return { ok: false, reason: "statement mismatch" };
  if (message.chainId !== expect.chainId) return { ok: false, reason: "chain mismatch" };
  if (message.version !== "1") return { ok: false, reason: "unsupported version" };
  if (!message.nonce) return { ok: false, reason: "missing nonce" };
  if (!message.issuedAt) return { ok: false, reason: "missing issued-at" };
  const issuedAt = Date.parse(message.issuedAt);
  if (Number.isNaN(issuedAt) || Math.abs(issuedAt - expect.now.getTime()) > expect.maxSkewMs) {
    return { ok: false, reason: "issued-at outside the allowed window" };
  }
  if (message.expirationTime) {
    const expiresAt = Date.parse(message.expirationTime);
    if (Number.isNaN(expiresAt) || expiresAt <= expect.now.getTime()) {
      return { ok: false, reason: "message expired" };
    }
  }
  if (message.notBefore) {
    const notBefore = Date.parse(message.notBefore);
    if (Number.isNaN(notBefore) || notBefore > expect.now.getTime()) {
      return { ok: false, reason: "message not yet valid" };
    }
  }
  return { ok: true, nonce: message.nonce };
}

/** Verifies the wallet's Ed25519 signature over the exact message bytes with WebCrypto. */
export async function verifySiwsSignature(
  address: Address,
  messageText: string,
  signature: Uint8Array,
): Promise<boolean> {
  if (!isSignatureBytes(signature)) return false;
  const publicKey = await getPublicKeyFromAddress(address);
  return verifySignature(publicKey, signature, new TextEncoder().encode(messageText));
}
