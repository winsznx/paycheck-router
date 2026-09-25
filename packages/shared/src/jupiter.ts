export const JUPITER_BUILD_URL = "https://api.jup.ag/swap/v2/build";

/**
 * Proprietary AMMs whose quote state is pushed every slot by an off-chain updater. The updater
 * writes to mainnet only, so a fork's copy goes stale and quotes zero. Excluded on surfnets only.
 */
export const FORK_EXCLUDED_DEXES = [
  "AlphaQ",
  "Aquifer",
  "BinaryFi",
  "BisonFi",
  "BisonFi Predict",
  "GoonFi V2",
  "HumidiFi",
  "Obric V2",
  "Quantum",
  "Scorch",
  "SolFi",
  "SolFi V2",
  "TesseraV",
  "WhaleStreet",
  "ZeroFi",
] as const;

export const JUPITER_MAX_ACCOUNTS = 40;
