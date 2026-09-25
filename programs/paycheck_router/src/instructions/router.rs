use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface},
};

use crate::{
    constants::*,
    error::RouterError,
    events::{LegCancelled, RouterClosed, RouterCreated, RouterPaused, RouterUpdated},
    state::{Asset, AssetKind, Config, LegConfig, LegStatus, Paycheck, Router},
    token_ops,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RouterParams {
    pub recorder: Pubkey,
    pub invest_bps: u16,
    pub min_inflow: u64,
    pub daily_cap: u64,
    pub max_wait_secs: u32,
    pub auto_convert: bool,
    pub legs: Vec<LegConfig>,
}

/// Validates rules and the split. `assets` are the Asset accounts for each
/// leg's mint, in leg order, passed as remaining accounts.
fn validate_router_params(params: &RouterParams, assets: &[AccountInfo]) -> Result<()> {
    require!(
        params.invest_bps >= MIN_INVEST_BPS && u64::from(params.invest_bps) <= BPS_DENOMINATOR,
        RouterError::InvalidParameter
    );
    require!(
        params.min_inflow >= MIN_INFLOW_FLOOR,
        RouterError::InflowBelowMinimum
    );
    require!(params.daily_cap > 0, RouterError::InvalidParameter);
    require!(
        params.max_wait_secs > 0 && params.max_wait_secs <= MAX_WAIT_CAP_SECS,
        RouterError::InvalidParameter
    );
    require!(params.legs.len() <= MAX_LEGS, RouterError::TooManyLegs);
    require!(!params.legs.is_empty(), RouterError::InvalidWeights);
    require!(
        assets.len() == params.legs.len(),
        RouterError::AssetNotActive
    );

    let mut weight_sum: u64 = 0;
    for (index, leg) in params.legs.iter().enumerate() {
        require!(leg.weight_bps > 0, RouterError::InvalidWeights);
        require!(
            params.legs[..index]
                .iter()
                .all(|other| other.mint != leg.mint),
            RouterError::InvalidWeights
        );
        weight_sum += u64::from(leg.weight_bps);

        let asset_info = &assets[index];
        let (expected, _) =
            Pubkey::find_program_address(&[ASSET_SEED, leg.mint.as_ref()], &crate::ID);
        require_keys_eq!(asset_info.key(), expected, RouterError::AssetNotActive);
        require_keys_eq!(*asset_info.owner, crate::ID, RouterError::AssetNotActive);
        let asset = Asset::try_deserialize(&mut &asset_info.try_borrow_data()?[..])
            .map_err(|_| error!(RouterError::AssetNotActive))?;
        require!(asset.is_active(), RouterError::AssetNotActive);
        let kind_cap = match asset.kind() {
            AssetKind::ListedEquity => MAX_BAND_EQUITY_BPS,
            AssetKind::PreIpo => MAX_BAND_PREIPO_BPS,
        };
        require!(
            leg.band_bps <= asset.max_band_bps && leg.band_bps <= kind_cap,
            RouterError::BandTooWide
        );
    }
    require!(weight_sum == BPS_DENOMINATOR, RouterError::InvalidWeights);
    Ok(())
}

fn apply_params(router: &mut Router, params: &RouterParams) {
    router.recorder = params.recorder;
    router.invest_bps = params.invest_bps;
    router.min_inflow = params.min_inflow;
    router.daily_cap = params.daily_cap;
    router.max_wait_secs = params.max_wait_secs;
    router.auto_convert = params.auto_convert;
    router.legs = [LegConfig::default(); MAX_LEGS];
    router.legs[..params.legs.len()].copy_from_slice(&params.legs);
    router.leg_count = params.legs.len() as u8;
}

#[derive(Accounts)]
pub struct CreateRouter<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Router::INIT_SPACE,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump,
    )]
    pub router: Box<Account<'info, Router>>,
    /// CHECK: PDA that signs swaps and holds the owner's USDC allowance; it
    /// stores no data.
    #[account(seeds = [AUTHORITY_SEED, router.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        associated_token::mint = usdc_mint,
        associated_token::authority = owner,
        associated_token::token_program = usdc_token_program,
    )]
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
        associated_token::token_program = usdc_token_program,
    )]
    pub authority_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_router<'info>(
    ctx: Context<'info, CreateRouter<'info>>,
    params: RouterParams,
) -> Result<()> {
    validate_router_params(&params, ctx.remaining_accounts)?;
    let now = Clock::get()?;
    let router = &mut ctx.accounts.router;
    router.owner = ctx.accounts.owner.key();
    router.pay_in = ctx.accounts.pay_in.key();
    router.rent_payer = ctx.accounts.payer.key();
    apply_params(router, &params);
    router.watermark = ctx.accounts.pay_in.amount;
    router.day_start = 0;
    router.day_spent = 0;
    router.paused = false;
    router.paycheck_seq = 0;
    router.created_at = now.unix_timestamp;
    router.updated_at = now.unix_timestamp;
    router.bump = ctx.bumps.router;
    router.authority_bump = ctx.bumps.authority;
    router.pending_legs = 0;
    emit!(RouterCreated {
        router: router.key(),
        owner: router.owner,
        pay_in: router.pay_in,
        recorder: router.recorder,
        rent_payer: router.rent_payer,
        watermark: router.watermark,
        invest_bps: router.invest_bps,
        legs: params.legs,
        slot: now.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateRouter<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump = router.bump,
        has_one = owner @ RouterError::Unauthorized,
    )]
    pub router: Box<Account<'info, Router>>,
}

pub fn update_router<'info>(
    ctx: Context<'info, UpdateRouter<'info>>,
    params: RouterParams,
) -> Result<()> {
    validate_router_params(&params, ctx.remaining_accounts)?;
    let clock = Clock::get()?;
    let router = &mut ctx.accounts.router;
    apply_params(router, &params);
    router.updated_at = clock.unix_timestamp;
    emit!(RouterUpdated {
        router: router.key(),
        recorder: router.recorder,
        invest_bps: router.invest_bps,
        min_inflow: router.min_inflow,
        daily_cap: router.daily_cap,
        max_wait_secs: router.max_wait_secs,
        auto_convert: router.auto_convert,
        legs: params.legs,
        slot: clock.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetRouterPaused<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump = router.bump,
        has_one = owner @ RouterError::Unauthorized,
    )]
    pub router: Box<Account<'info, Router>>,
}

pub fn set_router_paused(ctx: Context<SetRouterPaused>, paused: bool) -> Result<()> {
    let clock = Clock::get()?;
    let router = &mut ctx.accounts.router;
    router.paused = paused;
    router.updated_at = clock.unix_timestamp;
    emit!(RouterPaused {
        router: router.key(),
        paused,
        slot: clock.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelLeg<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump = router.bump,
        has_one = owner @ RouterError::Unauthorized,
    )]
    pub router: Box<Account<'info, Router>>,
    #[account(
        mut,
        seeds = [PAYCHECK_SEED, router.key().as_ref(), &paycheck.seq.to_le_bytes()],
        bump = paycheck.bump,
        has_one = router,
    )]
    pub paycheck: Box<Account<'info, Paycheck>>,
}

pub fn cancel_leg(ctx: Context<CancelLeg>, leg_index: u8) -> Result<()> {
    let paycheck = &mut ctx.accounts.paycheck;
    let leg = paycheck
        .legs
        .get_mut(usize::from(leg_index))
        .ok_or(RouterError::InvalidParameter)?;
    require!(leg.is_pending(), RouterError::LegNotPending);
    leg.status = LegStatus::Cancelled as u8;
    let (mint, amount_in) = (leg.mint, leg.amount_in);
    let router = &mut ctx.accounts.router;
    router.pending_legs = router
        .pending_legs
        .checked_sub(1)
        .ok_or(RouterError::MathOverflow)?;
    emit!(LegCancelled {
        router: router.key(),
        paycheck: paycheck.key(),
        seq: paycheck.seq,
        leg_index,
        mint,
        amount_in,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseRouter<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = rent_payer,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump = router.bump,
        has_one = owner @ RouterError::Unauthorized,
        has_one = rent_payer @ RouterError::Unauthorized,
        has_one = pay_in @ RouterError::DestinationOwnerMismatch,
    )]
    pub router: Box<Account<'info, Router>>,
    /// CHECK: receives the rent; must equal `router.rent_payer`.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    /// CHECK: router authority PDA, owner of the account being closed.
    #[account(seeds = [AUTHORITY_SEED, router.key().as_ref()], bump = router.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = authority)]
    pub authority_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn close_router(ctx: Context<CloseRouter>) -> Result<()> {
    let router = &ctx.accounts.router;
    require!(router.pending_legs == 0, RouterError::OpenPaychecksRemain);
    let router_key = router.key();
    let seeds: &[&[u8]] = &[
        AUTHORITY_SEED,
        router_key.as_ref(),
        &[router.authority_bump],
    ];

    let token_program = ctx.accounts.usdc_token_program.to_account_info();
    let authority = ctx.accounts.authority.to_account_info();
    let authority_usdc = ctx.accounts.authority_usdc.to_account_info();
    let usdc_mint = ctx.accounts.usdc_mint.to_account_info();
    let usdc = token_ops::MintRef {
        mint: &usdc_mint,
        token_program: &token_program,
        decimals: ctx.accounts.usdc_mint.decimals,
    };
    token_ops::transfer(
        &usdc,
        &authority_usdc,
        &ctx.accounts.pay_in.to_account_info(),
        &authority,
        &[seeds],
        ctx.accounts.authority_usdc.amount,
    )?;
    let close = CloseAccount {
        account: authority_usdc,
        destination: ctx.accounts.rent_payer.to_account_info(),
        authority,
    };
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        close,
        &[seeds],
    ))?;

    emit!(RouterClosed {
        router: router_key,
        owner: router.owner,
        rent_payer: router.rent_payer,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
