import type { IdentifierString } from "@wallet-standard/base";
import { isForkEnvironment } from "@/lib/env.ts";

/** Fork runs sign for a surfnet (SIWS chain `localnet`); everything else is mainnet (PRD 12.1). */
export const SOLANA_CHAIN: IdentifierString = isForkEnvironment
  ? "solana:localnet"
  : "solana:mainnet";
