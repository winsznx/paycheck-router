import { generateKeyPairSigner, signBytes } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  checkSiwsMessage,
  parseSiwsMessage,
  SIWS_STATEMENT,
  verifySiwsSignature,
} from "../../../src/auth/siws.ts";
import { siwsMessageText } from "../helpers/siws.ts";

const NOW = new Date("2026-09-25T10:00:00.000Z");

describe("SIWS messages", () => {
  it("parses the wallet-standard layout", () => {
    const text = siwsMessageText({
      domain: "localhost:3000",
      address: "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy",
      uri: "http://localhost:3000",
      chainId: "localnet",
      nonce: "abc123def456",
      issuedAt: NOW.toISOString(),
      expirationTime: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    expect(parseSiwsMessage(text)).toEqual({
      domain: "localhost:3000",
      address: "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy",
      statement: SIWS_STATEMENT,
      uri: "http://localhost:3000",
      version: "1",
      chainId: "localnet",
      nonce: "abc123def456",
      issuedAt: NOW.toISOString(),
      expirationTime: new Date(NOW.getTime() + 600_000).toISOString(),
      notBefore: null,
      requestId: null,
      resources: [],
    });
  });

  it("rejects text that is not a SIWS message", () => {
    expect(parseSiwsMessage("hello")).toBeNull();
    expect(
      parseSiwsMessage("x wants you to sign in with your Solana account:\naddr\n\nBogus: 1"),
    ).toBeNull();
  });

  const base = {
    domain: "localhost:3000",
    address: "hoyjKyffP55yKjj8aEGARUQi5xKC3bZTYv4j4ih3dBy",
    uri: "http://localhost:3000",
    chainId: "localnet",
    nonce: "abc123def456",
    issuedAt: NOW.toISOString(),
  };
  const expectations = {
    domains: [base.domain, "127.0.0.1:3000"],
    address: base.address,
    chainId: "localnet",
    now: NOW,
    maxSkewMs: 300_000,
  };

  it("accepts a message for this domain, chain and address", () => {
    const message = parseSiwsMessage(siwsMessageText(base));
    expect(message && checkSiwsMessage(message, expectations)).toEqual({
      ok: true,
      nonce: base.nonce,
    });
  });

  it.each([
    ["domain", { domain: "evil.example" }, "domain mismatch"],
    ["chain", { chainId: "mainnet" }, "chain mismatch"],
    ["address", { address: "7okuGKwRkoLvcGsu1wXHC3gqJQk41FZT9mo363Qsefwu" }, "address mismatch"],
    [
      "stale issued-at",
      { issuedAt: "2026-09-25T09:00:00.000Z" },
      "issued-at outside the allowed window",
    ],
    ["expiry", { expirationTime: "2026-09-25T09:59:00.000Z" }, "message expired"],
  ])("rejects a wrong %s", (_label, override, reason) => {
    const message = parseSiwsMessage(siwsMessageText({ ...base, ...override }));
    expect(message && checkSiwsMessage(message, expectations)).toEqual({ ok: false, reason });
  });

  it("verifies the Ed25519 signature over the exact text", async () => {
    const signer = await generateKeyPairSigner();
    const text = siwsMessageText({ ...base, address: signer.address });
    const signature = await signBytes(signer.keyPair.privateKey, new TextEncoder().encode(text));
    expect(await verifySiwsSignature(signer.address, text, signature)).toBe(true);
    expect(await verifySiwsSignature(signer.address, `${text} `, signature)).toBe(false);
    expect(await verifySiwsSignature(signer.address, text, signature.slice(1))).toBe(false);
  });
});
