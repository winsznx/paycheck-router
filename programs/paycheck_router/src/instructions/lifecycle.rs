use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::RouterError,
    events::{LegExpired, PaycheckClosed},
    state::{LegStatus, Paycheck, Router},
};

#[derive(Accounts)]
pub struct ExpireLeg<'info> {
    #[account(mut, seeds = [ROUTER_SEED, router.owner.as_ref()], bump = router.bump)]
    pub router: Box<Account<'info, Router>>,
    #[account(
        mut,
        seeds = [PAYCHECK_SEED, router.key().as_ref(), &paycheck.seq.to_le_bytes()],
        bump = paycheck.bump,
        has_one = router,
    )]
    pub paycheck: Box<Account<'info, Paycheck>>,
}

pub fn expire_leg(ctx: Context<ExpireLeg>, leg_index: u8) -> Result<()> {
    let clock = Clock::get()?;
    let paycheck = &mut ctx.accounts.paycheck;
    let expires_at = paycheck.expires_at;
    let leg = paycheck
        .legs
        .get_mut(usize::from(leg_index))
        .ok_or(RouterError::InvalidParameter)?;
    require!(leg.is_pending(), RouterError::LegNotPending);
    require!(
        clock.unix_timestamp >= expires_at,
        RouterError::LegNotExpired
    );
    leg.status = LegStatus::Expired as u8;
    let (mint, amount_in) = (leg.mint, leg.amount_in);
    let router = &mut ctx.accounts.router;
    router.pending_legs = router
        .pending_legs
        .checked_sub(1)
        .ok_or(RouterError::MathOverflow)?;
    emit!(LegExpired {
        router: router.key(),
        paycheck: paycheck.key(),
        seq: paycheck.seq,
        leg_index,
        mint,
        amount_in,
        slot: clock.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePaycheck<'info> {
    #[account(
        mut,
        close = rent_payer,
        seeds = [PAYCHECK_SEED, paycheck.router.as_ref(), &paycheck.seq.to_le_bytes()],
        bump = paycheck.bump,
        has_one = rent_payer @ RouterError::Unauthorized,
    )]
    pub paycheck: Box<Account<'info, Paycheck>>,
    /// CHECK: receives the rent; must equal `paycheck.rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

pub fn close_paycheck(ctx: Context<ClosePaycheck>) -> Result<()> {
    let paycheck = &ctx.accounts.paycheck;
    require!(paycheck.all_final(), RouterError::OpenPaychecksRemain);
    emit!(PaycheckClosed {
        router: paycheck.router,
        paycheck: paycheck.key(),
        seq: paycheck.seq,
        rent_payer: paycheck.rent_payer,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
