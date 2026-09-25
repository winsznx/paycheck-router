const CHAINALYSIS_URL = "https://public.chainalysis.com/api/v1/address";

export type SanctionsStatus = "clear" | "flagged" | "not_configured";

/**
 * Chainalysis free sanctions screening. Without an API key the wallet is reported as
 * `not_configured`, never as clear.
 */
export async function checkSanctions(
  apiKey: string | undefined,
  walletAddress: string,
): Promise<SanctionsStatus> {
  if (!apiKey) return "not_configured";
  const response = await fetch(`${CHAINALYSIS_URL}/${walletAddress}`, {
    headers: { "x-api-key": apiKey, accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Chainalysis sanctions check failed with ${response.status}`);
  }
  const body = (await response.json()) as { identifications?: unknown[] };
  return (body.identifications?.length ?? 0) > 0 ? "flagged" : "clear";
}
