use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::*,
    error::RouterError,
    events::{InflowSkipped, PaycheckRecorded, WatermarkSynced},
    guard,
    state::{Config, LegState, LegStatus, Paycheck, Router},
};

#[derive(Accounts)]
pub struct SyncWatermark<'info> {
    #[account(
        mut,
        seeds = [ROUTER_SEED, router.owner.as_ref()],
        bump = router.bump,
        has_one = pay_in,
    )]
    pub router: Box<Account<'info, Router>>,
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn sync_watermark(ctx: Context<SyncWatermark>) -> Result<()> {
    let router = &mut ctx.accounts.router;
    let previous = router.watermark;
    router.watermark = previous.min(ctx.accounts.pay_in.amount);
    emit!(WatermarkSynced {
        router: router.key(),
        previous,
        watermark: router.watermark,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SkipInflow<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, router.owner.as_ref()],
        bump = router.bump,
        has_one = pay_in,
    )]
    pub router: Box<Account<'info, Router>>,
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn skip_inflow(ctx: Context<SkipInflow>) -> Result<()> {
    let router = &mut ctx.accounts.router;
    let signer = ctx.accounts.signer.key();
    require!(
        signer == router.owner || router.recorder_allows(&signer),
        RouterError::UnauthorizedRecorder
    );
    let balance = ctx.accounts.pay_in.amount;
    let skipped = balance.saturating_sub(router.watermark);
    router.watermark = balance;
    emit!(InflowSkipped {
        router: router.key(),
        amount: skipped,
        watermark: balance,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordPaycheck<'info> {
    pub recorder: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, router.owner.as_ref()],
        bump = router.bump,
        has_one = pay_in,
    )]
    pub router: Box<Account<'info, Router>>,
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        space = Paycheck::space(router.enabled_leg_count()),
        seeds = [PAYCHECK_SEED, router.key().as_ref(), &router.paycheck_seq.to_le_bytes()],
        bump,
    )]
    pub paycheck: Box<Account<'info, Paycheck>>,
    pub system_program: Program<'info, System>,
}

/// Splits `invest_total` across the enabled legs by weight, then scales every
/// leg down by the same factor if the largest one exceeds `max_leg`.
/// Flooring leaves any remainder as USDC in the owner's wallet.
pub fn allocate_legs(
    legs: &[crate::state::LegConfig],
    invest_total: u64,
    max_leg: u64,
) -> Option<Vec<(Pubkey, u64)>> {
    let mut amounts = Vec::with_capacity(legs.len());
    for leg in legs.iter().filter(|leg| leg.enabled) {
        amounts.push((leg.mint, guard::bps_of(invest_total, leg.weight_bps)?));
    }
    let largest = amounts.iter().map(|(_, amount)| *amount).max().unwrap_or(0);
    if largest > max_leg {
        for (_, amount) in amounts.iter_mut() {
            let scaled = u128::from(*amount) * u128::from(max_leg) / u128::from(largest);
            *amount = u64::try_from(scaled).ok()?;
        }
    }
    Some(amounts)
}

pub fn record_paycheck(ctx: Context<RecordPaycheck>, detected_slot: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    let router = &mut ctx.accounts.router;
    require!(!config.paused, RouterError::ConfigPaused);
    require!(!router.paused, RouterError::RouterPaused);
    require!(
        router.recorder_allows(&ctx.accounts.recorder.key()),
        RouterError::UnauthorizedRecorder
    );

    let balance = ctx.accounts.pay_in.amount;
    require!(balance > router.watermark, RouterError::NoNewInflow);
    let inflow = balance - router.watermark;
    require!(
        inflow >= router.min_inflow.max(MIN_INFLOW_FLOOR),
        RouterError::InflowBelowMinimum
    );

    let clock = Clock::get()?;
    let today = clock.unix_timestamp - clock.unix_timestamp.rem_euclid(SECONDS_PER_DAY);
    if router.day_start != today {
        router.day_start = today;
        router.day_spent = 0;
    }
    let remaining_today = router.daily_cap.saturating_sub(router.day_spent);
    let wanted = guard::bps_of(inflow, router.invest_bps).ok_or(RouterError::MathOverflow)?;
    let allowed = wanted.min(remaining_today);

    let allocation = allocate_legs(router.active_legs(), allowed, config.max_leg_usdc)
        .ok_or(RouterError::MathOverflow)?;
    let legs: Vec<LegState> = allocation
        .iter()
        .filter(|(_, amount)| *amount > 0)
        .map(|(mint, amount)| LegState {
            mint: *mint,
            amount_in: *amount,
            status: LegStatus::Pending as u8,
            out_amount: 0,
            fee: 0,
            ref_price_e9: 0,
            executed_at: 0,
            issuer_fee: 0,
        })
        .collect();
    let invest_total = legs
        .iter()
        .try_fold(0u64, |sum, leg| sum.checked_add(leg.amount_in))
        .ok_or(RouterError::MathOverflow)?;

    let expires_at = clock
        .unix_timestamp
        .checked_add(i64::from(router.max_wait_secs))
        .ok_or(RouterError::MathOverflow)?;
    let seq = router.paycheck_seq;
    let paycheck = &mut ctx.accounts.paycheck;
    paycheck.set_inner(Paycheck {
        router: router.key(),
        seq,
        inflow,
        invest_total,
        detected_slot,
        recorded_at: clock.unix_timestamp,
        expires_at,
        rent_payer: ctx.accounts.payer.key(),
        bump: ctx.bumps.paycheck,
        legs,
    });

    router.watermark = balance;
    router.paycheck_seq = seq.checked_add(1).ok_or(RouterError::MathOverflow)?;
    router.day_spent = router
        .day_spent
        .checked_add(invest_total)
        .ok_or(RouterError::MathOverflow)?;
    router.total_inflow = router
        .total_inflow
        .checked_add(inflow)
        .ok_or(RouterError::MathOverflow)?;
    router.pending_legs = router
        .pending_legs
        .checked_add(paycheck.legs.len() as u32)
        .ok_or(RouterError::MathOverflow)?;
    router.updated_at = clock.unix_timestamp;

    emit!(PaycheckRecorded {
        router: router.key(),
        paycheck: paycheck.key(),
        seq,
        inflow,
        invest_total,
        leg_amounts: paycheck.legs.iter().map(|leg| leg.amount_in).collect(),
        leg_mints: paycheck.legs.iter().map(|leg| leg.mint).collect(),
        watermark: router.watermark,
        expires_at,
        detected_slot,
        slot: clock.slot,
    });
    Ok(())
}
