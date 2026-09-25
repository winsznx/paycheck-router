import { importSPKI, jwtVerify } from "jose";
import { z } from "zod";

const PRIVY_API = "https://auth.privy.io/api/v1";
const ISSUER = "privy.io";

export type PrivyConfig = { appId: string; appSecret: string; verificationKey: string };

export type PrivyIdentity = {
  did: string;
  email: string | null;
  /** The user's Solana wallets, embedded ones first. */
  solanaWallets: { address: string; embedded: boolean }[];
};

const LinkedAccount = z.looseObject({
  type: z.string(),
  address: z.string().optional(),
  chain_type: z.string().optional(),
  wallet_client_type: z.string().optional(),
});

const PrivyUser = z.looseObject({
  id: z.string(),
  linked_accounts: z.array(LinkedAccount),
});

const keys = new Map<string, Promise<CryptoKey>>();

function verificationKey(pem: string): Promise<CryptoKey> {
  let key = keys.get(pem);
  if (!key) {
    key = importSPKI(pem.replaceAll("\\n", "\n"), "ES256") as Promise<CryptoKey>;
    keys.set(pem, key);
  }
  return key;
}

/**
 * Verifies a Privy access token with the app's ES256 verification key (issuer `privy.io`,
 * audience the app id) and returns the Privy DID, or null for any invalid or expired token.
 */
export async function verifyPrivyToken(
  config: PrivyConfig,
  token: string,
  now: Date,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, await verificationKey(config.verificationKey), {
      issuer: ISSUER,
      audience: config.appId,
      algorithms: ["ES256"],
      currentDate: now,
    });
    return typeof payload.sub === "string" && payload.sub.startsWith("did:privy:")
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

/** Reads the user's linked accounts from Privy's server API with the app secret. */
export async function fetchPrivyIdentity(config: PrivyConfig, did: string): Promise<PrivyIdentity> {
  const response = await fetch(`${PRIVY_API}/users/${encodeURIComponent(did)}`, {
    headers: {
      authorization: `Basic ${btoa(`${config.appId}:${config.appSecret}`)}`,
      "privy-app-id": config.appId,
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Privy user lookup failed with ${response.status}`);
  const user = PrivyUser.parse(await response.json());
  const email = user.linked_accounts.find((account) => account.type === "email")?.address ?? null;
  const solanaWallets = user.linked_accounts
    .filter(
      (account) => account.type === "wallet" && account.chain_type === "solana" && account.address,
    )
    .map((account) => ({
      address: account.address ?? "",
      embedded: account.wallet_client_type === "privy",
    }))
    .sort((a, b) => Number(b.embedded) - Number(a.embedded));
  return { did: user.id, email, solanaWallets };
}
