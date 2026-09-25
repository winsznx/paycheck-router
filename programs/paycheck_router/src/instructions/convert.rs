//! convert_holding: swaps a pre-IPO token into its conversion target at IPO.
//! The Convert authority for (router, mint) is the delegate on the owner's
//! pre-IPO account and can only move that token into that target.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::RouterError,
    events::HoldingConverted,
    guard::{self, ConvertInputs},
    pricing,
    state::{Asset, AssetKind, AssetStatus, Config, Router},
    token_ops::{self, MintRef, SweepTarget},
};

#[derive(Accounts)]
pub struct ConvertHolding<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [ROUTER_SEED, router.owner.as_ref()], bump = router.bump)]
    pub router: Box<Account<'info, Router>>,
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    /// CHECK: Convert authority PDA for this router and pre-IPO mint.
    #[account(seeds = [CONVERT_SEED, router.key().as_ref(), asset.mint.as_ref()], bump)]
    pub convert_authority: UncheckedAccount<'info>,
    /// The owner's pre-IPO token account; the Convert authority is its delegate.
    #[account(mut)]
    pub owner_source: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = asset_mint,
        token::authority = convert_authority,
        token::token_program = asset_token_program,
    )]
    pub convert_source: Box<InterfaceAccount<'info, TokenAccount>>,
    /// The owner's account for the conversion target.
    #[account(mut)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = asset.mint)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mint::token_program = target_token_program)]
    pub target_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: must equal `config.jupiter_program`; checked in the handler.
    pub jupiter_program: UncheckedAccount<'info>,
    #[account(address = asset.token_program)]
    pub asset_token_program: Interface<'info, TokenInterface>,
    pub target_token_program: Interface<'info, TokenInterface>,
}

pub fn convert_holding<'info>(
    ctx: Context<'info, ConvertHolding<'info>>,
    amount: u64,
    swap_data: Vec<u8>,
) -> Result<()> {
    let clock = Clock::get()?;
    let accounts = &mut *ctx.accounts;
    let router = &accounts.router;
    let asset = &accounts.asset;
    require!(!accounts.config.paused, RouterError::ConfigPaused);
    require!(!router.paused, RouterError::RouterPaused);
    require!(
        router.auto_convert || accounts.caller.key() == router.owner,
        RouterError::Unauthorized
    );
    require!(
        asset.kind() == AssetKind::PreIpo,
        RouterError::AssetKindMismatch
    );
    require!(
        asset.status == AssetStatus::Converting as u8,
        RouterError::ConversionNotActive
    );
    require!(
        clock.unix_timestamp < asset.conversion_deadline,
        RouterError::ConversionDeadlinePassed
    );
    require!(amount > 0, RouterError::InvalidParameter);

    let convert_key = accounts.convert_authority.key();
    let source = &accounts.owner_source;
    require_keys_eq!(source.owner, router.owner, RouterError::Unauthorized);
    require_keys_eq!(source.mint, asset.mint, RouterError::InvalidParameter);
    require!(
        source.delegate.contains(&convert_key),
        RouterError::DelegateMismatch
    );
    require!(
        source.delegated_amount >= amount,
        RouterError::AllowanceInsufficient
    );
    require!(source.amount >= amount, RouterError::BalanceInsufficient);
    require_keys_eq!(
        accounts.destination.owner,
        router.owner,
        RouterError::DestinationOwnerMismatch
    );
    require_keys_eq!(
        accounts.destination.mint,
        asset.conversion_target,
        RouterError::DestinationMintMismatch
    );
    require_keys_eq!(
        accounts.target_mint.key(),
        asset.conversion_target,
        RouterError::DestinationMintMismatch
    );
    require_keys_eq!(
        accounts.jupiter_program.key(),
        accounts.config.jupiter_program,
        RouterError::JupiterProgramMismatch
    );

    let multiplier_pre = pricing::effective_multiplier(
        &accounts.asset_mint.to_account_info(),
        clock.unix_timestamp,
    )?;
    let multiplier_target = pricing::effective_multiplier(
        &accounts.target_mint.to_account_info(),
        clock.unix_timestamp,
    )?;
    let min_out = guard::min_target_convert(&ConvertInputs {
        amount_in: amount,
        multiplier_pre_e12: guard::multiplier_to_e12(multiplier_pre)
            .ok_or(RouterError::MathOverflow)?,
        decimals_pre: accounts.asset_mint.decimals,
        ratio_num: asset.conversion_ratio_num,
        ratio_den: asset.conversion_ratio_den,
        band_bps: CONVERSION_BAND_BPS,
        multiplier_target_e12: guard::multiplier_to_e12(multiplier_target)
            .ok_or(RouterError::MathOverflow)?,
        decimals_target: accounts.target_mint.decimals,
    })
    .ok_or(RouterError::MathOverflow)?;
    require!(min_out > 0, RouterError::OutputBelowMinimum);

    let router_key = router.key();
    let owner = router.owner;
    let asset_mint_key = asset.mint;
    let bump = ctx.bumps.convert_authority;
    let convert_seeds: &[&[u8]] = &[
        CONVERT_SEED,
        router_key.as_ref(),
        asset_mint_key.as_ref(),
        &[bump],
    ];

    let convert_info = accounts.convert_authority.to_account_info();
    let source_info = accounts.owner_source.to_account_info();
    let convert_source_info = accounts.convert_source.to_account_info();
    let destination_info = accounts.destination.to_account_info();
    let asset_mint_info = accounts.asset_mint.to_account_info();
    let asset_program = accounts.asset_token_program.to_account_info();
    let target_mint_info = accounts.target_mint.to_account_info();
    let target_program = accounts.target_token_program.to_account_info();
    let pre_ipo = MintRef {
        mint: &asset_mint_info,
        token_program: &asset_program,
        decimals: accounts.asset_mint.decimals,
    };
    let target = MintRef {
        mint: &target_mint_info,
        token_program: &target_program,
        decimals: accounts.target_mint.decimals,
    };

    let source_before = accounts.owner_source.amount;
    let destination_before = accounts.destination.amount;
    let withheld_before = token_ops::withheld_amount(&destination_info)?;
    token_ops::transfer(
        &pre_ipo,
        &source_info,
        &convert_source_info,
        &convert_info,
        &[convert_seeds],
        amount,
    )?;
    token_ops::invoke_swap(
        &accounts.jupiter_program.to_account_info(),
        ctx.remaining_accounts,
        swap_data,
        &convert_key,
        convert_seeds,
        &owner,
    )?;
    accounts.owner_source.reload()?;
    let moved = source_before
        .checked_sub(accounts.owner_source.amount)
        .ok_or(RouterError::InputOverspent)?;
    require!(moved == amount, RouterError::InputOverspent);

    let mut touched = ctx.remaining_accounts.to_vec();
    touched.push(convert_source_info);
    token_ops::sweep_authority_accounts(
        &touched,
        &convert_info,
        convert_seeds,
        &[
            SweepTarget {
                mint: pre_ipo,
                to: &source_info,
            },
            SweepTarget {
                mint: target,
                to: &destination_info,
            },
        ],
    )?;

    accounts.destination.reload()?;
    let out_amount = accounts
        .destination
        .amount
        .checked_sub(destination_before)
        .ok_or(RouterError::OutputBelowMinimum)?;
    let issuer_fee = token_ops::withheld_amount(&destination_info)?
        .checked_sub(withheld_before)
        .ok_or(RouterError::OutputBelowMinimum)?;
    let delivered = out_amount
        .checked_add(issuer_fee)
        .ok_or(RouterError::MathOverflow)?;
    require!(delivered >= min_out, RouterError::OutputBelowMinimum);
    accounts.convert_source.reload()?;
    require!(
        accounts.convert_source.amount == 0,
        RouterError::InputOverspent
    );

    emit!(HoldingConverted {
        router: router_key,
        mint: asset_mint_key,
        target_mint: accounts.target_mint.key(),
        amount_in: amount,
        out_amount,
        issuer_fee,
        min_out,
        ratio_num: accounts.asset.conversion_ratio_num,
        ratio_den: accounts.asset.conversion_ratio_den,
        slot: clock.slot,
    });
    Ok(())
}
