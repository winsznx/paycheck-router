/** Compile-time limits the program enforces; the offchain side mirrors them to reject early. */
export const HARD_CAPS = {
  maxLegs: 8,
  maxFeeBps: 50,
  maxBandEquityBps: 300,
  maxBandPreIpoBps: 1_000,
  maxBandOwnerBps: 1_000,
  maxPriceAgeCapSecs: 120,
  maxConfCapBps: 200,
  usdcPegBps: 50,
  maxAttestationAgeSecs: 300,
  minInflowFloor: 1_000_000n,
  maxWaitCapSecs: 1_209_600,
} as const;

export const BPS_DENOMINATOR = 10_000;

/** Values `initialize_config` is called with at launch and on every fork run. */
export const LAUNCH_CONFIG = {
  feeBps: 20,
  maxPriceAgeSecs: 30,
  maxConfBps: 50,
  maxLegUsdc: 5_000_000_000n,
} as const;

export const DEFAULT_BANDS = {
  listedEquityBps: 50,
  preIpoBps: 300,
  band247ExtraBps: 50,
} as const;
