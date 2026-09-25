use anchor_lang::prelude::*;

use crate::state::LegConfig;

/// Signed PreStocks mark carried by the Ed25519 instruction in front of
/// `execute_prestock_leg`. The attester signs its Borsh serialization.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct MarkAttestation {
    pub mint: Pubkey,
    pub mark_price_e9: u64,
    pub observed_at: i64,
    pub source: u8,
}

impl MarkAttestation {
    pub const LEN: usize = 32 + 8 + 8 + 1;
}

/// Where a guard's reference price came from.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PriceSource {
    PythRegular,
    Pyth247,
    MarkAttestation,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SwapSide {
    Buy,
    Sell,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub jupiter_program: Pubkey,
    pub attester: Pubkey,
    pub pause_authority: Pubkey,
    pub max_price_age_secs: u16,
    pub max_conf_bps: u16,
    pub max_leg_usdc: u64,
    pub paused: bool,
    pub slot: u64,
}

#[event]
pub struct AssetUpserted {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub kind: u8,
    pub issuer: u8,
    pub status: u8,
    pub feed_id: [u8; 32],
    pub feed_id_247: [u8; 32],
    pub max_band_bps: u16,
    pub band_247_extra_bps: u16,
    pub conversion_target: Pubkey,
    pub conversion_ratio_num: u64,
    pub conversion_ratio_den: u64,
    pub conversion_deadline: i64,
    pub slot: u64,
}

#[event]
pub struct RouterCreated {
    pub router: Pubkey,
    pub owner: Pubkey,
    pub pay_in: Pubkey,
    pub recorder: Pubkey,
    pub rent_payer: Pubkey,
    pub watermark: u64,
    pub invest_bps: u16,
    pub legs: Vec<LegConfig>,
    pub slot: u64,
}

#[event]
pub struct RouterUpdated {
    pub router: Pubkey,
    pub recorder: Pubkey,
    pub invest_bps: u16,
    pub min_inflow: u64,
    pub daily_cap: u64,
    pub max_wait_secs: u32,
    pub auto_convert: bool,
    pub legs: Vec<LegConfig>,
    pub slot: u64,
}

#[event]
pub struct RouterPaused {
    pub router: Pubkey,
    pub paused: bool,
    pub slot: u64,
}

#[event]
pub struct RouterClosed {
    pub router: Pubkey,
    pub owner: Pubkey,
    pub rent_payer: Pubkey,
    pub slot: u64,
}

#[event]
pub struct PaycheckRecorded {
    pub router: Pubkey,
    pub paycheck: Pubkey,
    pub seq: u64,
    pub inflow: u64,
    pub invest_total: u64,
    pub leg_amounts: Vec<u64>,
    pub leg_mints: Vec<Pubkey>,
    pub watermark: u64,
    pub expires_at: i64,
    pub detected_slot: u64,
    pub slot: u64,
}

#[event]
pub struct InflowSkipped {
    pub router: Pubkey,
    pub amount: u64,
    pub watermark: u64,
    pub slot: u64,
}

#[event]
pub struct WatermarkSynced {
    pub router: Pubkey,
    pub previous: u64,
    pub watermark: u64,
    pub slot: u64,
}

#[event]
pub struct LegExecuted {
    pub router: Pubkey,
    pub paycheck: Pubkey,
    pub seq: u64,
    pub leg_index: u8,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount_in: u64,
    pub fee: u64,
    /// USDC handed to the route: amount_in less the fee.
    pub swapped_in: u64,
    /// USDC the route actually spent: swapped_in less dust_returned.
    pub usdc_consumed: u64,
    pub dust_returned: u64,
    /// Intermediate-mint leftovers swept to the owner's intermediate account.
    pub intermediate_returned: u64,
    pub out_amount: u64,
    pub issuer_fee: u64,
    pub min_out: u64,
    pub ref_price_e9: u64,
    pub usdc_price_e9: u64,
    pub multiplier_e12: u64,
    pub band_bps: u16,
    pub price_source: PriceSource,
    pub price_publish_time: i64,
    pub attestation: Option<MarkAttestation>,
    pub owner_initiated: bool,
    pub slot: u64,
}

#[event]
pub struct LegExpired {
    pub router: Pubkey,
    pub paycheck: Pubkey,
    pub seq: u64,
    pub leg_index: u8,
    pub mint: Pubkey,
    pub amount_in: u64,
    pub slot: u64,
}

#[event]
pub struct LegCancelled {
    pub router: Pubkey,
    pub paycheck: Pubkey,
    pub seq: u64,
    pub leg_index: u8,
    pub mint: Pubkey,
    pub amount_in: u64,
    pub slot: u64,
}

#[event]
pub struct PaycheckClosed {
    pub router: Pubkey,
    pub paycheck: Pubkey,
    pub seq: u64,
    pub rent_payer: Pubkey,
    pub slot: u64,
}

#[event]
pub struct GuardedSwap {
    pub router: Pubkey,
    pub side: SwapSide,
    pub mint: Pubkey,
    pub amount_in: u64,
    pub fee: u64,
    pub out_amount: u64,
    pub issuer_fee: u64,
    pub min_out: u64,
    pub ref_price_e9: u64,
    pub usdc_price_e9: u64,
    pub multiplier_e12: u64,
    pub band_bps: u16,
    pub price_source: PriceSource,
    pub price_publish_time: i64,
    pub attestation: Option<MarkAttestation>,
    pub slot: u64,
}

#[event]
pub struct HoldingConverted {
    pub router: Pubkey,
    pub mint: Pubkey,
    pub target_mint: Pubkey,
    pub amount_in: u64,
    pub out_amount: u64,
    pub issuer_fee: u64,
    pub min_out: u64,
    pub ratio_num: u64,
    pub ratio_den: u64,
    pub slot: u64,
}
