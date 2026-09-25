//! execute_leg, execute_prestock_leg and execute_leg_owner (PRD 6.5). The
//! three differ only in where the reference price comes from and who may
//! call; `settle_leg` does the money movement for all of them.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::RouterError,
    events::{LegExecuted, PriceSource},
    guard::{self, BuyInputs},
    pricing::{self, Reference},
    state::{Asset, AssetKind, Config, LegState, LegStatus, Paycheck, Router},
    token_ops::{self, MintRef, SweepTarget},
};

pub struct LegAccounts<'a, 'info> {
    pub config: &'a Account<'info, Config>,
    pub router: &'a mut Account<'info, Router>,
    pub paycheck: &'a mut Account<'info, Paycheck>,
    pub asset: &'a Account<'info, Asset>,
    pub authority: &'a UncheckedAccount<'info>,
    pub pay_in: &'a mut InterfaceAccount<'info, TokenAccount>,
    pub authority_usdc: &'a mut InterfaceAccount<'info, TokenAccount>,
    pub treasury: &'a InterfaceAccount<'info, TokenAccount>,
    pub usdc_mint: &'a InterfaceAccount<'info, Mint>,
    pub destination: &'a mut InterfaceAccount<'info, TokenAccount>,
    pub asset_mint: &'a InterfaceAccount<'info, Mint>,
    pub jupiter_program: &'a UncheckedAccount<'info>,
    pub usdc_token_program: &'a Interface<'info, TokenInterface>,
    pub asset_token_program: &'a Interface<'info, TokenInterface>,
}

macro_rules! leg_accounts {
    ($accounts:expr) => {
        LegAccounts {
            config: &$accounts.config,
            router: &mut $accounts.router,
            paycheck: &mut $accounts.paycheck,
            asset: &$accounts.asset,
            authority: &$accounts.authority,
            pay_in: &mut $accounts.pay_in,
            authority_usdc: &mut $accounts.authority_usdc,
            treasury: &$accounts.treasury,
            usdc_mint: &$accounts.usdc_mint,
            destination: &mut $accounts.destination,
            asset_mint: &$accounts.asset_mint,
            jupiter_program: &$accounts.jupiter_program,
            usdc_token_program: &$accounts.usdc_token_program,
            asset_token_program: &$accounts.asset_token_program,
        }
    };
}

/// Step 1 of PRD 6.5: pause, leg, expiry and asset checks, in that order.
pub fn precheck(
    config: &Config,
    router: &Router,
    paycheck: &Paycheck,
    asset: &Asset,
    leg_index: u8,
    now: i64,
    kind: Option<AssetKind>,
) -> Result<LegState> {
    require!(!config.paused, RouterError::ConfigPaused);
    require!(!router.paused, RouterError::RouterPaused);
    let leg = *paycheck
        .legs
        .get(usize::from(leg_index))
        .ok_or(RouterError::InvalidParameter)?;
    require!(leg.is_pending(), RouterError::LegNotPending);
    require!(now < paycheck.expires_at, RouterError::PaycheckExpired);
    require_keys_eq!(asset.mint, leg.mint, RouterError::InvalidParameter);
    require!(asset.is_active(), RouterError::AssetNotActive);
    if let Some(kind) = kind {
        require!(asset.kind() == kind, RouterError::AssetKindMismatch);
    }
    Ok(leg)
}

/// The band the owner chose for this asset, clamped to the asset's current
/// ceiling. A leg whose asset has since left the split keeps the ceiling.
pub fn leg_band(router: &Router, asset: &Asset) -> u16 {
    router
        .active_legs()
        .iter()
        .find(|leg| leg.mint == asset.mint)
        .map(|leg| leg.band_bps)
        .unwrap_or(asset.max_band_bps)
        .min(asset.max_band_bps)
}

pub fn settle_leg<'info>(
    accounts: LegAccounts<'_, 'info>,
    route_accounts: &'info [AccountInfo<'info>],
    leg_index: u8,
    swap_data: Vec<u8>,
    reference: Reference,
    owner_initiated: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let LegAccounts {
        config,
        router,
        paycheck,
        asset,
        authority,
        pay_in,
        authority_usdc,
        treasury,
        usdc_mint,
        destination,
        asset_mint,
        jupiter_program,
        usdc_token_program,
        asset_token_program,
    } = accounts;
    let leg_slot = usize::from(leg_index);
    let amount_in = paycheck.legs[leg_slot].amount_in;
    let authority_key = authority.key();

    require!(
        pay_in.delegate.contains(&authority_key),
        RouterError::DelegateMismatch
    );
    require!(
        pay_in.delegated_amount >= amount_in,
        RouterError::AllowanceInsufficient
    );
    require!(pay_in.amount >= amount_in, RouterError::BalanceInsufficient);

    let fee = guard::bps_of(amount_in, config.fee_bps).ok_or(RouterError::MathOverflow)?;
    let swapped_in = amount_in - fee;

    require_keys_eq!(
        destination.owner,
        router.owner,
        RouterError::DestinationOwnerMismatch
    );
    require_keys_eq!(
        destination.mint,
        asset.mint,
        RouterError::DestinationMintMismatch
    );
    let multiplier =
        pricing::effective_multiplier(&asset_mint.to_account_info(), clock.unix_timestamp)?;
    let multiplier_e12 = guard::multiplier_to_e12(multiplier).ok_or(RouterError::MathOverflow)?;
    let min_out = guard::min_out_buy(&BuyInputs {
        usdc_in: swapped_in,
        usdc_price_e9: reference.usdc_price_e9,
        price_e9: reference.price_e9,
        band_bps: reference.band_bps,
        multiplier_e12,
        decimals: asset_mint.decimals,
    })
    .ok_or(RouterError::MathOverflow)?;
    require!(min_out > 0, RouterError::OutputBelowMinimum);
    require_keys_eq!(
        jupiter_program.key(),
        config.jupiter_program,
        RouterError::JupiterProgramMismatch
    );

    let router_key = router.key();
    let authority_seeds: &[&[u8]] = &[
        AUTHORITY_SEED,
        router_key.as_ref(),
        &[router.authority_bump],
    ];
    let pay_in_before = pay_in.amount;
    let destination_before = destination.amount;
    let withheld_before = token_ops::withheld_amount(&destination.to_account_info())?;
    let usdc_program = usdc_token_program.to_account_info();
    let usdc_mint_info = usdc_mint.to_account_info();
    let authority_info = authority.to_account_info();
    let pay_in_info = pay_in.to_account_info();
    let authority_usdc_info = authority_usdc.to_account_info();

    let usdc = MintRef {
        mint: &usdc_mint_info,
        token_program: &usdc_program,
        decimals: usdc_mint.decimals,
    };
    token_ops::transfer(
        &usdc,
        &pay_in_info,
        &treasury.to_account_info(),
        &authority_info,
        &[authority_seeds],
        fee,
    )?;
    token_ops::transfer(
        &usdc,
        &pay_in_info,
        &authority_usdc_info,
        &authority_info,
        &[authority_seeds],
        swapped_in,
    )?;

    token_ops::invoke_swap(
        &jupiter_program.to_account_info(),
        route_accounts,
        swap_data,
        &authority_key,
        authority_seeds,
        &router.owner,
    )?;

    pay_in.reload()?;
    let spent = pay_in_before
        .checked_sub(pay_in.amount)
        .ok_or(RouterError::InputOverspent)?;
    require!(spent == amount_in, RouterError::InputOverspent);

    let asset_mint_info = asset_mint.to_account_info();
    let asset_program = asset_token_program.to_account_info();
    let destination_info = destination.to_account_info();
    let mut touched = route_accounts.to_vec();
    touched.push(authority_usdc_info);
    let swept = token_ops::sweep_authority_accounts(
        &touched,
        &authority_info,
        authority_seeds,
        &[
            SweepTarget {
                mint: usdc,
                to: &pay_in_info,
            },
            SweepTarget {
                mint: MintRef {
                    mint: &asset_mint_info,
                    token_program: &asset_program,
                    decimals: asset_mint.decimals,
                },
                to: &destination_info,
            },
        ],
    )?;
    let dust_returned = swept[0];

    destination.reload()?;
    let out_amount = destination
        .amount
        .checked_sub(destination_before)
        .ok_or(RouterError::OutputBelowMinimum)?;
    // The guard prices gross delivery: an issuer transfer fee withheld in the
    // destination is the issuer's charge, reported apart from the premium.
    let issuer_fee = token_ops::withheld_amount(&destination_info)?
        .checked_sub(withheld_before)
        .ok_or(RouterError::OutputBelowMinimum)?;
    let delivered = out_amount
        .checked_add(issuer_fee)
        .ok_or(RouterError::MathOverflow)?;
    require!(delivered >= min_out, RouterError::OutputBelowMinimum);
    authority_usdc.reload()?;
    require!(authority_usdc.amount == 0, RouterError::InputOverspent);

    let leg = &mut paycheck.legs[leg_slot];
    leg.status = LegStatus::Executed as u8;
    leg.out_amount = out_amount;
    leg.fee = fee;
    leg.ref_price_e9 = reference.price_e9;
    leg.executed_at = clock.unix_timestamp;
    leg.issuer_fee = issuer_fee;
    let mint = leg.mint;

    let net_spent = amount_in
        .checked_sub(dust_returned)
        .ok_or(RouterError::MathOverflow)?;
    // The owner may have spent USDC since the watermark was set; saturating
    // keeps a later inflow detectable instead of failing the leg.
    router.watermark = router.watermark.saturating_sub(net_spent);
    router.pending_legs = router
        .pending_legs
        .checked_sub(1)
        .ok_or(RouterError::MathOverflow)?;
    router.total_invested = router
        .total_invested
        .checked_add(swapped_in - dust_returned.min(swapped_in))
        .ok_or(RouterError::MathOverflow)?;
    router.total_fees = router
        .total_fees
        .checked_add(fee)
        .ok_or(RouterError::MathOverflow)?;
    router.updated_at = clock.unix_timestamp;

    emit!(LegExecuted {
        router: router_key,
        paycheck: paycheck.key(),
        seq: paycheck.seq,
        leg_index,
        mint,
        destination: destination.key(),
        amount_in,
        fee,
        swapped_in,
        dust_returned,
        out_amount,
        issuer_fee,
        min_out,
        ref_price_e9: reference.price_e9,
        usdc_price_e9: reference.usdc_price_e9,
        multiplier_e12: u64::try_from(multiplier_e12).map_err(|_| RouterError::MathOverflow)?,
        band_bps: reference.band_bps,
        price_source: reference.source,
        price_publish_time: reference.publish_time,
        attestation: reference.attestation,
        owner_initiated,
        slot: clock.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteLeg<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ROUTER_SEED, router.owner.as_ref()], bump = router.bump, has_one = pay_in)]
    pub router: Box<Account<'info, Router>>,
    #[account(
        mut,
        seeds = [PAYCHECK_SEED, router.key().as_ref(), &paycheck.seq.to_le_bytes()],
        bump = paycheck.bump,
        has_one = router,
    )]
    pub paycheck: Box<Account<'info, Paycheck>>,
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: router authority PDA; signs the transfers and the swap.
    #[account(seeds = [AUTHORITY_SEED, router.key().as_ref()], bump = router.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = authority,
        token::token_program = usdc_token_program,
    )]
    pub authority_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.treasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = asset.mint)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: Pyth `PriceUpdateV2` for `asset.feed_id`; owner, discriminator,
    /// verification level, feed and age are checked in the handler.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: optional Pyth update for `asset.feed_id_247`, same checks.
    pub price_update_247: Option<UncheckedAccount<'info>>,
    /// CHECK: Pyth USDC/USD update for `config.usdc_feed_id`, same checks.
    pub usdc_price_update: UncheckedAccount<'info>,
    /// CHECK: must equal `config.jupiter_program`; checked in the handler.
    pub jupiter_program: UncheckedAccount<'info>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    #[account(address = asset.token_program)]
    pub asset_token_program: Interface<'info, TokenInterface>,
}

pub fn execute_leg<'info>(
    ctx: Context<'info, ExecuteLeg<'info>>,
    leg_index: u8,
    swap_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut *ctx.accounts;
    precheck(
        &accounts.config,
        &accounts.router,
        &accounts.paycheck,
        &accounts.asset,
        leg_index,
        now,
        Some(AssetKind::ListedEquity),
    )?;
    let reference = listed_reference(
        &accounts.config,
        &accounts.asset,
        leg_band(&accounts.router, &accounts.asset),
        &accounts.price_update,
        accounts.price_update_247.as_ref(),
        &accounts.usdc_price_update,
        now,
    )?;
    settle_leg(
        leg_accounts!(accounts),
        ctx.remaining_accounts,
        leg_index,
        swap_data,
        reference,
        false,
    )
}

pub(crate) fn listed_reference(
    config: &Config,
    asset: &Asset,
    band_bps: u16,
    price_update: &UncheckedAccount,
    price_update_247: Option<&UncheckedAccount>,
    usdc_price_update: &UncheckedAccount,
    now: i64,
) -> Result<Reference> {
    let (price, source) = pricing::read_equity_price(
        price_update,
        price_update_247.map(|account| account.as_ref()),
        &asset.feed_id,
        &asset.feed_id_247,
        config.max_price_age_secs,
        config.max_conf_bps,
        now,
    )?;
    let usdc_price_e9 = pricing::read_usdc_price(
        usdc_price_update,
        &config.usdc_feed_id,
        config.max_price_age_secs,
        config.max_conf_bps,
        now,
    )?;
    let band_bps = if source == PriceSource::Pyth247 {
        band_bps
            .checked_add(asset.band_247_extra_bps)
            .ok_or(RouterError::MathOverflow)?
    } else {
        band_bps
    };
    Ok(Reference {
        price_e9: price.price_e9,
        usdc_price_e9,
        band_bps,
        source,
        publish_time: price.publish_time,
        attestation: None,
    })
}

pub(crate) fn attested_reference(
    config: &Config,
    asset: &Asset,
    band_bps: u16,
    instructions_sysvar: &UncheckedAccount,
    usdc_price_update: &UncheckedAccount,
    now: i64,
) -> Result<Reference> {
    let attestation =
        pricing::read_attestation(instructions_sysvar, &config.attester, &asset.mint, now)?;
    let usdc_price_e9 = pricing::read_usdc_price(
        usdc_price_update,
        &config.usdc_feed_id,
        config.max_price_age_secs,
        config.max_conf_bps,
        now,
    )?;
    Ok(Reference {
        price_e9: attestation.mark_price_e9,
        usdc_price_e9,
        band_bps,
        source: PriceSource::MarkAttestation,
        publish_time: attestation.observed_at,
        attestation: Some(attestation),
    })
}

#[derive(Accounts)]
pub struct ExecutePrestockLeg<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ROUTER_SEED, router.owner.as_ref()], bump = router.bump, has_one = pay_in)]
    pub router: Box<Account<'info, Router>>,
    #[account(
        mut,
        seeds = [PAYCHECK_SEED, router.key().as_ref(), &paycheck.seq.to_le_bytes()],
        bump = paycheck.bump,
        has_one = router,
    )]
    pub paycheck: Box<Account<'info, Paycheck>>,
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: router authority PDA; signs the transfers and the swap.
    #[account(seeds = [AUTHORITY_SEED, router.key().as_ref()], bump = router.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = authority,
        token::token_program = usdc_token_program,
    )]
    pub authority_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.treasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = asset.mint)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: the Instructions sysvar, read for the Ed25519 attestation.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    /// CHECK: Pyth USDC/USD update for `config.usdc_feed_id`; checked in the handler.
    pub usdc_price_update: UncheckedAccount<'info>,
    /// CHECK: must equal `config.jupiter_program`; checked in the handler.
    pub jupiter_program: UncheckedAccount<'info>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    #[account(address = asset.token_program)]
    pub asset_token_program: Interface<'info, TokenInterface>,
}

pub fn execute_prestock_leg<'info>(
    ctx: Context<'info, ExecutePrestockLeg<'info>>,
    leg_index: u8,
    swap_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut *ctx.accounts;
    precheck(
        &accounts.config,
        &accounts.router,
        &accounts.paycheck,
        &accounts.asset,
        leg_index,
        now,
        Some(AssetKind::PreIpo),
    )?;
    let reference = attested_reference(
        &accounts.config,
        &accounts.asset,
        leg_band(&accounts.router, &accounts.asset),
        &accounts.instructions_sysvar,
        &accounts.usdc_price_update,
        now,
    )?;
    settle_leg(
        leg_accounts!(accounts),
        ctx.remaining_accounts,
        leg_index,
        swap_data,
        reference,
        false,
    )
}

#[derive(Accounts)]
pub struct ExecuteLegOwner<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump = router.bump,
        has_one = pay_in,
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
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: router authority PDA; signs the transfers and the swap.
    #[account(seeds = [AUTHORITY_SEED, router.key().as_ref()], bump = router.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub pay_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = authority,
        token::token_program = usdc_token_program,
    )]
    pub authority_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.treasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = asset.mint)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: Pyth update for a listed equity; required for that kind.
    pub price_update: Option<UncheckedAccount<'info>>,
    /// CHECK: optional Pyth 24/7 update for a listed equity.
    pub price_update_247: Option<UncheckedAccount<'info>>,
    /// CHECK: Instructions sysvar; required for a pre-IPO leg.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions_sysvar: Option<UncheckedAccount<'info>>,
    /// CHECK: Pyth USDC/USD update; checked in the handler.
    pub usdc_price_update: UncheckedAccount<'info>,
    /// CHECK: must equal `config.jupiter_program`; checked in the handler.
    pub jupiter_program: UncheckedAccount<'info>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    #[account(address = asset.token_program)]
    pub asset_token_program: Interface<'info, TokenInterface>,
}

pub fn execute_leg_owner<'info>(
    ctx: Context<'info, ExecuteLegOwner<'info>>,
    leg_index: u8,
    band_bps: u16,
    swap_data: Vec<u8>,
) -> Result<()> {
    require!(band_bps <= MAX_BAND_OWNER_BPS, RouterError::BandTooWide);
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut *ctx.accounts;
    precheck(
        &accounts.config,
        &accounts.router,
        &accounts.paycheck,
        &accounts.asset,
        leg_index,
        now,
        None,
    )?;
    let reference = match accounts.asset.kind() {
        AssetKind::ListedEquity => {
            let price_update = accounts
                .price_update
                .as_ref()
                .ok_or(RouterError::PriceFeedMismatch)?;
            let mut reference = listed_reference(
                &accounts.config,
                &accounts.asset,
                band_bps,
                price_update,
                accounts.price_update_247.as_ref(),
                &accounts.usdc_price_update,
                now,
            )?;
            reference.band_bps = band_bps;
            reference
        }
        AssetKind::PreIpo => {
            let sysvar = accounts
                .instructions_sysvar
                .as_ref()
                .ok_or(RouterError::AttestationMissing)?;
            attested_reference(
                &accounts.config,
                &accounts.asset,
                band_bps,
                sysvar,
                &accounts.usdc_price_update,
                now,
            )?
        }
    };
    settle_leg(
        leg_accounts!(accounts),
        ctx.remaining_accounts,
        leg_index,
        swap_data,
        reference,
        true,
    )
}
