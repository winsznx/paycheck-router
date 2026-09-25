/** Fields of a Sign-In-With-Solana message (PRD 12.1). */
export type SiwsFields = {
  domain: string;
  address: string;
  statement?: string | undefined;
  uri?: string | undefined;
  version?: string | undefined;
  chainId?: string | undefined;
  nonce?: string | undefined;
  issuedAt?: string | undefined;
  expirationTime?: string | undefined;
  notBefore?: string | undefined;
  requestId?: string | undefined;
  resources?: readonly string[] | undefined;
};

const FIELD_LABELS: ReadonlyArray<readonly [keyof SiwsFields, string]> = [
  ["uri", "URI"],
  ["version", "Version"],
  ["chainId", "Chain ID"],
  ["nonce", "Nonce"],
  ["issuedAt", "Issued At"],
  ["expirationTime", "Expiration Time"],
  ["notBefore", "Not Before"],
  ["requestId", "Request ID"],
];

/** The text layout Solana wallets produce for `solana:signIn`, which the core API parses. */
export function formatSiwsMessage(fields: SiwsFields): string {
  const lines = [`${fields.domain} wants you to sign in with your Solana account:`, fields.address];
  if (fields.statement) lines.push("", fields.statement);
  const entries = FIELD_LABELS.flatMap(([key, label]) => {
    const value = fields[key];
    return typeof value === "string" && value ? [`${label}: ${value}`] : [];
  });
  if (fields.resources?.length) {
    entries.push("Resources:", ...fields.resources.map((resource) => `- ${resource}`));
  }
  if (entries.length > 0) lines.push("", ...entries);
  return lines.join("\n");
}
