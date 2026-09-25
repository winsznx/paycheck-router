import { SIWS_STATEMENT } from "../../../src/auth/siws.ts";

export type SiwsFields = {
  domain: string;
  address: string;
  uri: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
};

/** Builds the message text in the layout Wallet Standard `signIn` produces. */
export function siwsMessageText(fields: SiwsFields): string {
  const lines = [
    `${fields.domain} wants you to sign in with your Solana account:`,
    fields.address,
    "",
    SIWS_STATEMENT,
    "",
    `URI: ${fields.uri}`,
    "Version: 1",
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
  ];
  if (fields.expirationTime) lines.push(`Expiration Time: ${fields.expirationTime}`);
  return lines.join("\n");
}
