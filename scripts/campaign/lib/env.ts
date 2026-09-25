import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { HermesOptions, JupiterClientOptions } from "@paycheck-router/sdk";

/** The campaign's own surfnet ports; other workstreams use 8899, 28899 and 38899. */
export const CAMPAIGN_RPC_PORT = 48_899;

export type CampaignEnv = {
  rpcPort: number;
  programSo: string;
  /** `solana-verify get-executable-hash` of `programSo`, computed once per campaign run. */
  programExecutableHash: string | null;
  /** Where the binary came from (PROGRAM_SOURCE), e.g. the CI release run that built it. */
  programSource: string | null;
  /** Null when PYTH_API_KEY is unset: cases stop before their first Hermes call. */
  hermes: (HermesOptions & { apiKey: string }) | null;
  jupiter: JupiterClientOptions;
};

export async function readEnv(rpcPort: number = CAMPAIGN_RPC_PORT): Promise<CampaignEnv> {
  const apiKey = process.env.PYTH_API_KEY;
  const programSo =
    process.env.PROGRAM_SO ??
    resolve(import.meta.dirname, "..", "..", "..", "target", "deploy", "paycheck_router.so");
  return {
    rpcPort,
    programSo,
    programExecutableHash: await executableHash(programSo),
    programSource: process.env.PROGRAM_SOURCE ?? null,
    hermes: apiKey
      ? { apiKey, ...(process.env.HERMES_URL ? { baseUrl: process.env.HERMES_URL } : {}) }
      : null,
    jupiter: process.env.JUPITER_API_KEY ? { apiKey: process.env.JUPITER_API_KEY } : {},
  };
}

export function requireHermes(env: CampaignEnv): HermesOptions & { apiKey: string } {
  if (!env.hermes) {
    throw new Error(
      "PYTH_API_KEY is not set: Hermes answers 401 without a key and there is no fallback price source",
    );
  }
  return env.hermes;
}

/** The hash `solana-verify` publishes for a verifiable build; null when the tool is missing. */
async function executableHash(soPath: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("solana-verify", ["get-executable-hash", soPath]);
    return stdout.trim().split("\n").at(-1) ?? null;
  } catch (error) {
    console.warn(`solana-verify get-executable-hash failed: ${String(error)}`);
    return null;
  }
}
