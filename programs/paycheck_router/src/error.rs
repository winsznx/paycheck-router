use anchor_lang::prelude::*;

/// Codes 6000-6031 follow PRD 6.7 exactly; the crank maps each one to an
/// action. Codes from 6032 on are additions the PRD table does not cover.
#[error_code]
pub enum RouterError {
    #[msg("Protocol is paused")]
    ConfigPaused,
    #[msg("Router is paused")]
    RouterPaused,
    #[msg("Leg weights must be positive, unique and sum to 10,000 bps")]
    InvalidWeights,
    #[msg("Too many legs")]
    TooManyLegs,
    #[msg("Band exceeds the allowed cap")]
    BandTooWide,
    #[msg("Asset is not active")]
    AssetNotActive,
    #[msg("Asset kind does not match this instruction")]
    AssetKindMismatch,
    #[msg("No new inflow above the watermark")]
    NoNewInflow,
    #[msg("Inflow is below the router minimum")]
    InflowBelowMinimum,
    #[msg("Signer is not the router's recorder")]
    UnauthorizedRecorder,
    #[msg("Leg is not pending")]
    LegNotPending,
    #[msg("Paycheck has expired")]
    PaycheckExpired,
    #[msg("Price is stale")]
    PriceStale,
    #[msg("Price account does not match the expected feed")]
    PriceFeedMismatch,
    #[msg("Price confidence interval is too wide")]
    ConfidenceTooWide,
    #[msg("USDC is off its peg")]
    UsdcDepeg,
    #[msg("Delegated allowance does not cover the leg")]
    AllowanceInsufficient,
    #[msg("Router authority is not the token account delegate")]
    DelegateMismatch,
    #[msg("Balance does not cover the leg")]
    BalanceInsufficient,
    #[msg("Destination is not owned by the router owner")]
    DestinationOwnerMismatch,
    #[msg("Destination mint does not match the asset")]
    DestinationMintMismatch,
    #[msg("Swap program is not the allowlisted Jupiter program")]
    JupiterProgramMismatch,
    #[msg("Swap delivered less than the guarded minimum")]
    OutputBelowMinimum,
    #[msg("Swap moved a different input amount than the leg")]
    InputOverspent,
    #[msg("Ed25519 attestation instruction is missing")]
    AttestationMissing,
    #[msg("Attestation is not signed by the configured attester")]
    AttestationSignerMismatch,
    #[msg("Attestation is too old")]
    AttestationStale,
    #[msg("Attestation instruction or message is malformed")]
    AttestationMalformed,
    #[msg("Asset is not converting")]
    ConversionNotActive,
    #[msg("Conversion deadline has passed")]
    ConversionDeadlinePassed,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Router still has open paycheck legs")]
    OpenPaychecksRemain,
    #[msg("Parameter outside its allowed range")]
    InvalidParameter,
    #[msg("Signer is not allowed to perform this action")]
    Unauthorized,
    #[msg("Leg has not reached its expiry")]
    LegNotExpired,
}
