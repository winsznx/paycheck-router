//! swap_guarded: an owner's manual buy or sell of a registered asset, under
//! the same reference prices, band cap, fee and authority sweep as a leg.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::RouterError,
    events::{GuardedSwap, SwapSide},
    guard::{self, BuyInputs, SellInputs},
    instructions::execute::{attested_reference, listed_reference},
    pricing::{self, Reference},
    state::{AssetKind, AssetStatus, Config, Router},
    token_ops::{self, MintRef, SweepTarget},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct GuardedSwapParams {
    pub side: SwapSide,
    /// USDC base units for a buy, raw asset units for a sell.
    pub amount_in: u64,
    pub band_bps: u16,
}

#[derive(Accounts)]
pub struct SwapGuarded<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [ROUTER_SEED, owner.key().as_ref()],
        bump = router.bump,
        has_one = owner @ RouterError::Unauthorized,
        has_one = pay_in,
    )]
    pub router: Box<Account<'info, Router>>,
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, crate::state::Asset>>,
    /// CHECK: router authority PDA; the swap's taker.
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
    /// The owner's account for the asset: destination on a buy, source on a sell.
    #[account(mut)]
    pub owner_asset: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = asset_mint,
        token::authority = authority,
        token::token_program = asset_token_program,
    )]
    pub authority_asset: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.treasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = asset.mint)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: Pyth update for a listed equity; required for that kind.
    pub price_update: Option<UncheckedAccount<'info>>,
    /// CHECK: optional Pyth 24/7 update for a listed equity.
    pub price_update_247: Option<UncheckedAccount<'info>>,
    /// CHECK: Instructions sysvar; required for a pre-IPO asset.
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

fn reference_for(accounts: &SwapGuarded, band_bps: u16, now: i64) -> Result<Reference> {
    match accounts.asset.kind() {
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
            Ok(reference)
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
            )
        }
    }
}

pub fn swap_guarded<'info>(
    ctx: Context<'info, SwapGuarded<'info>>,
    params: GuardedSwapParams,
    swap_data: Vec<u8>,
) -> Result<()> {
    let clock = Clock::get()?;
    let accounts = &mut *ctx.accounts;
    require!(!accounts.config.paused, RouterError::ConfigPaused);
    require!(!accounts.router.paused, RouterError::RouterPaused);
    require!(
        params.band_bps <= MAX_BAND_OWNER_BPS,
        RouterError::BandTooWide
    );
    require!(params.amount_in > 0, RouterError::InvalidParameter);
    let status = accounts.asset.status;
    match params.side {
        SwapSide::Buy => require!(accounts.asset.is_active(), RouterError::AssetNotActive),
        SwapSide::Sell => require!(
            status != AssetStatus::Converting as u8,
            RouterError::AssetNotActive
        ),
    }
    require_keys_eq!(
        accounts.owner_asset.owner,
        accounts.router.owner,
        RouterError::DestinationOwnerMismatch
    );
    require_keys_eq!(
        accounts.owner_asset.mint,
        accounts.asset.mint,
        RouterError::DestinationMintMismatch
    );
    require_keys_eq!(
        accounts.jupiter_program.key(),
        accounts.config.jupiter_program,
        RouterError::JupiterProgramMismatch
    );

    let reference = reference_for(accounts, params.band_bps, clock.unix_timestamp)?;
    let multiplier = pricing::effective_multiplier(
        &accounts.asset_mint.to_account_info(),
        clock.unix_timestamp,
    )?;
    let multiplier_e12 = guard::multiplier_to_e12(multiplier).ok_or(RouterError::MathOverflow)?;

    let router_key = accounts.router.key();
    let authority_key = accounts.authority.key();
    let owner_key = accounts.owner.key();
    let authority_seeds: &[&[u8]] = &[
        AUTHORITY_SEED,
        router_key.as_ref(),
        &[accounts.router.authority_bump],
    ];
    let owner_info = accounts.owner.to_account_info();
    let authority_info = accounts.authority.to_account_info();
    let pay_in_info = accounts.pay_in.to_account_info();
    let owner_asset_info = accounts.owner_asset.to_account_info();
    let authority_usdc_info = accounts.authority_usdc.to_account_info();
    let authority_asset_info = accounts.authority_asset.to_account_info();
    let usdc_mint_info = accounts.usdc_mint.to_account_info();
    let usdc_program = accounts.usdc_token_program.to_account_info();
    let asset_mint_info = accounts.asset_mint.to_account_info();
    let asset_program = accounts.asset_token_program.to_account_info();
    let usdc = MintRef {
        mint: &usdc_mint_info,
        token_program: &usdc_program,
        decimals: accounts.usdc_mint.decimals,
    };
    let asset = MintRef {
        mint: &asset_mint_info,
        token_program: &asset_program,
        decimals: accounts.asset_mint.decimals,
    };
    let mut touched = ctx.remaining_accounts.to_vec();
    touched.push(authority_usdc_info.clone());
    touched.push(authority_asset_info.clone());

    let (fee, out_amount, issuer_fee, min_out) = match params.side {
        SwapSide::Buy => {
            require!(
                accounts.pay_in.amount >= params.amount_in,
                RouterError::BalanceInsufficient
            );
            let fee = guard::bps_of(params.amount_in, accounts.config.fee_bps)
                .ok_or(RouterError::MathOverflow)?;
            let swapped_in = params.amount_in - fee;
            let min_out = guard::min_out_buy(&BuyInputs {
                usdc_in: swapped_in,
                usdc_price_e9: reference.usdc_price_e9,
                price_e9: reference.price_e9,
                band_bps: reference.band_bps,
                multiplier_e12,
                decimals: accounts.asset_mint.decimals,
            })
            .ok_or(RouterError::MathOverflow)?;
            require!(min_out > 0, RouterError::OutputBelowMinimum);

            let pay_in_before = accounts.pay_in.amount;
            let owner_asset_before = accounts.owner_asset.amount;
            let withheld_before = token_ops::withheld_amount(&owner_asset_info)?;
            let treasury_info = accounts.treasury.to_account_info();
            token_ops::transfer(&usdc, &pay_in_info, &treasury_info, &owner_info, &[], fee)?;
            token_ops::transfer(
                &usdc,
                &pay_in_info,
                &authority_usdc_info,
                &owner_info,
                &[],
                swapped_in,
            )?;
            token_ops::invoke_swap(
                &accounts.jupiter_program.to_account_info(),
                ctx.remaining_accounts,
                swap_data,
                &authority_key,
                authority_seeds,
                &owner_key,
            )?;
            accounts.pay_in.reload()?;
            let spent = pay_in_before
                .checked_sub(accounts.pay_in.amount)
                .ok_or(RouterError::InputOverspent)?;
            require!(spent == params.amount_in, RouterError::InputOverspent);

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
                        mint: asset,
                        to: &owner_asset_info,
                    },
                ],
            )?;
            accounts.owner_asset.reload()?;
            let out_amount = accounts
                .owner_asset
                .amount
                .checked_sub(owner_asset_before)
                .ok_or(RouterError::OutputBelowMinimum)?;
            let issuer_fee = token_ops::withheld_amount(&owner_asset_info)?
                .checked_sub(withheld_before)
                .ok_or(RouterError::OutputBelowMinimum)?;
            let delivered = out_amount
                .checked_add(issuer_fee)
                .ok_or(RouterError::MathOverflow)?;
            require!(delivered >= min_out, RouterError::OutputBelowMinimum);

            let net_spent = params
                .amount_in
                .checked_sub(swept[0])
                .ok_or(RouterError::MathOverflow)?;
            let router = &mut accounts.router;
            router.watermark = router.watermark.saturating_sub(net_spent);
            router.total_invested = router
                .total_invested
                .checked_add(swapped_in.saturating_sub(swept[0]))
                .ok_or(RouterError::MathOverflow)?;
            (fee, out_amount, issuer_fee, min_out)
        }
        SwapSide::Sell => {
            require!(
                accounts.owner_asset.amount >= params.amount_in,
                RouterError::BalanceInsufficient
            );
            let min_out = guard::min_usdc_sell(&SellInputs {
                amount_in: params.amount_in,
                usdc_price_e9: reference.usdc_price_e9,
                price_e9: reference.price_e9,
                band_bps: reference.band_bps,
                multiplier_e12,
                decimals: accounts.asset_mint.decimals,
            })
            .ok_or(RouterError::MathOverflow)?;
            require!(min_out > 0, RouterError::OutputBelowMinimum);

            let owner_asset_before = accounts.owner_asset.amount;
            let pay_in_before = accounts.pay_in.amount;
            token_ops::transfer(
                &asset,
                &owner_asset_info,
                &authority_asset_info,
                &owner_info,
                &[],
                params.amount_in,
            )?;
            token_ops::invoke_swap(
                &accounts.jupiter_program.to_account_info(),
                ctx.remaining_accounts,
                swap_data,
                &authority_key,
                authority_seeds,
                &owner_key,
            )?;
            accounts.owner_asset.reload()?;
            let sold = owner_asset_before
                .checked_sub(accounts.owner_asset.amount)
                .ok_or(RouterError::InputOverspent)?;
            require!(sold == params.amount_in, RouterError::InputOverspent);

            token_ops::sweep_authority_accounts(
                &touched,
                &authority_info,
                authority_seeds,
                &[
                    SweepTarget {
                        mint: usdc,
                        to: &pay_in_info,
                    },
                    SweepTarget {
                        mint: asset,
                        to: &owner_asset_info,
                    },
                ],
            )?;
            accounts.pay_in.reload()?;
            let gross = accounts
                .pay_in
                .amount
                .checked_sub(pay_in_before)
                .ok_or(RouterError::OutputBelowMinimum)?;
            require!(gross >= min_out, RouterError::OutputBelowMinimum);
            let fee =
                guard::bps_of(gross, accounts.config.fee_bps).ok_or(RouterError::MathOverflow)?;
            token_ops::transfer(
                &usdc,
                &pay_in_info,
                &accounts.treasury.to_account_info(),
                &owner_info,
                &[],
                fee,
            )?;
            // Sale proceeds are not pay: raise the watermark so they are
            // never recorded as an inflow.
            let router = &mut accounts.router;
            router.watermark = router
                .watermark
                .checked_add(gross - fee)
                .ok_or(RouterError::MathOverflow)?;
            (fee, gross - fee, 0, min_out)
        }
    };

    accounts.authority_usdc.reload()?;
    accounts.authority_asset.reload()?;
    require!(
        accounts.authority_usdc.amount == 0 && accounts.authority_asset.amount == 0,
        RouterError::InputOverspent
    );
    let router = &mut accounts.router;
    router.total_fees = router
        .total_fees
        .checked_add(fee)
        .ok_or(RouterError::MathOverflow)?;
    router.updated_at = clock.unix_timestamp;

    emit!(GuardedSwap {
        router: router_key,
        side: params.side,
        mint: accounts.asset.mint,
        amount_in: params.amount_in,
        fee,
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
        slot: clock.slot,
    });
    Ok(())
}
