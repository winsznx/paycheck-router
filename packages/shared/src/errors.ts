import { WaitReason } from "./waits.ts";

/** What the crank does when simulation or confirmation fails with a program error. */
export type CrankAction =
  | "stop_all"
  | "stop_router"
  | "reject_config"
  | "wait"
  | "reroute"
  | "drop"
  | "skip"
  | "alert"
  | "expire"
  | "resign"
  | "notify_owner";

export type ProgramErrorInfo = {
  code: number;
  name: string;
  action: CrankAction;
  reason: WaitReason | null;
};

const TABLE: readonly [number, string, CrankAction, WaitReason | null][] = [
  [6000, "ConfigPaused", "stop_all", WaitReason.PROTOCOL_PAUSED],
  [6001, "RouterPaused", "stop_router", WaitReason.ROUTER_PAUSED],
  [6002, "InvalidWeights", "reject_config", null],
  [6003, "TooManyLegs", "reject_config", null],
  [6004, "BandTooWide", "reject_config", null],
  [6005, "AssetNotActive", "wait", WaitReason.ASSET_PAUSED],
  [6006, "AssetKindMismatch", "reroute", null],
  [6007, "NoNewInflow", "drop", null],
  [6008, "InflowBelowMinimum", "skip", WaitReason.BELOW_MINIMUM],
  [6009, "UnauthorizedRecorder", "alert", null],
  [6010, "LegNotPending", "drop", null],
  [6011, "PaycheckExpired", "expire", WaitReason.EXPIRED],
  [6012, "PriceStale", "wait", WaitReason.MARKET_CLOSED],
  [6013, "PriceFeedMismatch", "alert", null],
  [6014, "ConfidenceTooWide", "wait", WaitReason.PRICE_UNCERTAIN],
  [6015, "UsdcDepeg", "wait", WaitReason.USDC_OFF_PEG],
  [6016, "AllowanceInsufficient", "wait", WaitReason.ALLOWANCE_LOW],
  [6017, "DelegateMismatch", "wait", WaitReason.ALLOWANCE_REVOKED],
  [6018, "BalanceInsufficient", "wait", WaitReason.FUNDS_MOVED],
  [6019, "DestinationOwnerMismatch", "alert", null],
  [6020, "DestinationMintMismatch", "alert", null],
  [6021, "JupiterProgramMismatch", "alert", null],
  [6022, "OutputBelowMinimum", "wait", WaitReason.PREMIUM_TOO_HIGH],
  [6023, "InputOverspent", "alert", null],
  [6024, "AttestationMissing", "resign", null],
  [6025, "AttestationSignerMismatch", "alert", null],
  [6026, "AttestationStale", "resign", null],
  [6027, "AttestationMalformed", "alert", null],
  [6028, "ConversionNotActive", "drop", null],
  [6029, "ConversionDeadlinePassed", "notify_owner", WaitReason.CONVERSION_CLOSED],
  [6030, "MathOverflow", "alert", null],
  [6031, "OpenPaychecksRemain", "notify_owner", null],
  [6032, "InvalidParameter", "reject_config", null],
  [6033, "Unauthorized", "alert", null],
  [6034, "LegNotExpired", "drop", null],
];

export const PROGRAM_ERRORS: readonly ProgramErrorInfo[] = TABLE.map(
  ([code, name, action, reason]) => ({ code, name, action, reason }),
);

const byCode = new Map(PROGRAM_ERRORS.map((info) => [info.code, info]));
const byName = new Map(PROGRAM_ERRORS.map((info) => [info.name, info]));

export function programErrorByCode(code: number): ProgramErrorInfo | undefined {
  return byCode.get(code);
}

export function programErrorByName(name: string): ProgramErrorInfo | undefined {
  return byName.get(name);
}
