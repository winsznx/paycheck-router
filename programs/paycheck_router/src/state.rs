use anchor_lang::prelude::*;

use crate::constants::MAX_LEGS;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub usdc_mint: Pubkey,
    pub usdc_feed_id: [u8; 32],
    pub jupiter_program: Pubkey,
    pub attester: Pubkey,
    pub max_price_age_secs: u16,
    pub max_conf_bps: u16,
    pub paused: bool,
    pub bump: u8,
    pub version: u8,
    pub reserved: [u8; 64],
    pub pause_authority: Pubkey,
    pub max_leg_usdc: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum AssetKind {
    ListedEquity = 0,
    PreIpo = 1,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum AssetStatus {
    Active = 0,
    BuysPaused = 1,
    Converting = 2,
    Delisted = 3,
}

pub const ISSUER_MAX: u8 = 2;

#[account]
#[derive(InitSpace)]
pub struct Asset {
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
    pub bump: u8,
    pub reserved: [u8; 64],
}

impl Asset {
    pub fn kind(&self) -> AssetKind {
        if self.kind == AssetKind::PreIpo as u8 {
            AssetKind::PreIpo
        } else {
            AssetKind::ListedEquity
        }
    }

    pub fn is_active(&self) -> bool {
        self.status == AssetStatus::Active as u8
    }

    pub fn has_247_feed(&self) -> bool {
        self.feed_id_247 != [0u8; 32]
    }
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, Debug, InitSpace,
)]
pub struct LegConfig {
    pub mint: Pubkey,
    pub weight_bps: u16,
    pub band_bps: u16,
    pub enabled: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Router {
    pub owner: Pubkey,
    pub pay_in: Pubkey,
    pub recorder: Pubkey,
    pub rent_payer: Pubkey,
    pub invest_bps: u16,
    pub min_inflow: u64,
    pub daily_cap: u64,
    pub day_start: i64,
    pub day_spent: u64,
    pub max_wait_secs: u32,
    pub auto_convert: bool,
    pub paused: bool,
    pub watermark: u64,
    pub paycheck_seq: u64,
    pub legs: [LegConfig; MAX_LEGS],
    pub leg_count: u8,
    pub total_inflow: u64,
    pub total_invested: u64,
    pub total_fees: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
    pub authority_bump: u8,
    /// Legs across all paychecks still in Pending; close_router needs zero.
    pub pending_legs: u32,
    pub reserved: [u8; 64],
}

impl Router {
    pub fn active_legs(&self) -> &[LegConfig] {
        &self.legs[..self.leg_count as usize]
    }

    pub fn enabled_leg_count(&self) -> usize {
        self.active_legs().iter().filter(|leg| leg.enabled).count()
    }

    pub fn recorder_allows(&self, signer: &Pubkey) -> bool {
        self.recorder == Pubkey::default() || self.recorder == *signer
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum LegStatus {
    Pending = 0,
    Executed = 1,
    Expired = 2,
    Cancelled = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct LegState {
    pub mint: Pubkey,
    pub amount_in: u64,
    pub status: u8,
    pub out_amount: u64,
    pub fee: u64,
    pub ref_price_e9: u64,
    pub executed_at: i64,
}

impl LegState {
    pub fn is_pending(&self) -> bool {
        self.status == LegStatus::Pending as u8
    }
}

#[account]
pub struct Paycheck {
    pub router: Pubkey,
    pub seq: u64,
    pub inflow: u64,
    pub invest_total: u64,
    pub detected_slot: u64,
    pub recorded_at: i64,
    pub expires_at: i64,
    pub rent_payer: Pubkey,
    pub bump: u8,
    pub legs: Vec<LegState>,
}

impl Paycheck {
    pub const FIXED_LEN: usize = 32 + 8 + 8 + 8 + 8 + 8 + 8 + 32 + 1 + 4;

    pub fn space(leg_count: usize) -> usize {
        8 + Self::FIXED_LEN + LegState::INIT_SPACE * leg_count
    }

    pub fn all_final(&self) -> bool {
        self.legs.iter().all(|leg| !leg.is_pending())
    }
}
