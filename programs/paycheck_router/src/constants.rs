use anchor_lang::prelude::*;

pub const MAX_LEGS: usize = 8;
pub const MAX_FEE_BPS: u16 = 50;
pub const MAX_BAND_EQUITY_BPS: u16 = 300;
pub const MAX_BAND_PREIPO_BPS: u16 = 1_000;
pub const MAX_BAND_OWNER_BPS: u16 = 1_000;
pub const MAX_PRICE_AGE_CAP_SECS: u16 = 120;
pub const MAX_CONF_CAP_BPS: u16 = 200;
pub const USDC_PEG_BPS: u16 = 50;
pub const MAX_ATTESTATION_AGE_SECS: i64 = 300;
pub const MIN_INFLOW_FLOOR: u64 = 1_000_000;
pub const MAX_WAIT_CAP_SECS: u32 = 1_209_600;

/// Guard on IPO conversions: target received must be at least the ratio
/// amount less this band (PRD 7.6).
pub const CONVERSION_BAND_BPS: u16 = 300;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MIN_INVEST_BPS: u16 = 100;
pub const USDC_DECIMALS: u8 = 6;
pub const SECONDS_PER_DAY: i64 = 86_400;

pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const ROUTER_SEED: &[u8] = b"router";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const CONVERT_SEED: &[u8] = b"convert";
pub const PAYCHECK_SEED: &[u8] = b"paycheck";

pub const CONFIG_VERSION: u8 = 1;

pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
