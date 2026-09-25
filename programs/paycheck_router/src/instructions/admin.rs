use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::*,
    error::RouterError,
    events::{AssetUpserted, ConfigUpdated},
    pricing,
    program::PaycheckRouter,
    state::{Asset, AssetKind, AssetStatus, Config, ISSUER_MAX},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ConfigParams {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub usdc_feed_id: [u8; 32],
    pub jupiter_program: Pubkey,
    pub attester: Pubkey,
    pub pause_authority: Pubkey,
    pub max_price_age_secs: u16,
    pub max_conf_bps: u16,
    pub max_leg_usdc: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct ConfigUpdate {
    pub admin: Option<Pubkey>,
    pub fee_bps: Option<u16>,
    pub usdc_feed_id: Option<[u8; 32]>,
    pub jupiter_program: Option<Pubkey>,
    pub attester: Option<Pubkey>,
    pub pause_authority: Option<Pubkey>,
    pub max_price_age_secs: Option<u16>,
    pub max_conf_bps: Option<u16>,
    pub max_leg_usdc: Option<u64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AssetParams {
    pub kind: u8,
    pub issuer: u8,
    pub feed_id: [u8; 32],
    pub feed_id_247: [u8; 32],
    pub max_band_bps: u16,
    pub band_247_extra_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AssetStatusParams {
    pub status: u8,
    pub conversion_target: Pubkey,
    pub conversion_ratio_num: u64,
    pub conversion_ratio_den: u64,
    pub conversion_deadline: i64,
}

fn validate_config(config: &Config) -> Result<()> {
    require!(config.fee_bps <= MAX_FEE_BPS, RouterError::InvalidParameter);
    require!(
        config.max_price_age_secs > 0 && config.max_price_age_secs <= MAX_PRICE_AGE_CAP_SECS,
        RouterError::InvalidParameter
    );
    require!(
        config.max_conf_bps > 0 && config.max_conf_bps <= MAX_CONF_CAP_BPS,
        RouterError::InvalidParameter
    );
    require!(config.max_leg_usdc > 0, RouterError::InvalidParameter);
    require!(
        config.usdc_feed_id != [0u8; 32],
        RouterError::InvalidParameter
    );
    require!(
        config.jupiter_program != Pubkey::default() && config.jupiter_program != crate::ID,
        RouterError::InvalidParameter
    );
    require!(
        config.admin != Pubkey::default()
            && config.attester != Pubkey::default()
            && config.pause_authority != Pubkey::default(),
        RouterError::InvalidParameter
    );
    Ok(())
}

fn emit_config(config: &Config) -> Result<()> {
    emit!(ConfigUpdated {
        admin: config.admin,
        treasury: config.treasury,
        fee_bps: config.fee_bps,
        jupiter_program: config.jupiter_program,
        attester: config.attester,
        pause_authority: config.pause_authority,
        max_price_age_secs: config.max_price_age_secs,
        max_conf_bps: config.max_conf_bps,
        max_leg_usdc: config.max_leg_usdc,
        paused: config.paused,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub deployer: Signer<'info>,
    #[account(
        init,
        payer = deployer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ RouterError::Unauthorized)]
    pub program: Program<'info, PaycheckRouter>,
    #[account(constraint = program_data.upgrade_authority_address == Some(deployer.key()) @ RouterError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = usdc_mint, token::token_program = usdc_token_program)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams) -> Result<()> {
    require!(
        ctx.accounts.usdc_mint.decimals == USDC_DECIMALS,
        RouterError::InvalidParameter
    );
    let config = &mut ctx.accounts.config;
    config.set_inner(Config {
        admin: params.admin,
        treasury: ctx.accounts.treasury.key(),
        fee_bps: params.fee_bps,
        usdc_mint: ctx.accounts.usdc_mint.key(),
        usdc_feed_id: params.usdc_feed_id,
        jupiter_program: params.jupiter_program,
        attester: params.attester,
        max_price_age_secs: params.max_price_age_secs,
        max_conf_bps: params.max_conf_bps,
        paused: false,
        bump: ctx.bumps.config,
        version: CONFIG_VERSION,
        reserved: [0u8; 64],
        pause_authority: params.pause_authority,
        max_leg_usdc: params.max_leg_usdc,
    });
    validate_config(config)?;
    emit_config(config)
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(token::mint = config.usdc_mint)]
    pub treasury: Option<InterfaceAccount<'info, TokenAccount>>,
}

pub fn update_config(ctx: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(treasury) = &ctx.accounts.treasury {
        config.treasury = treasury.key();
    }
    if let Some(admin) = update.admin {
        config.admin = admin;
    }
    if let Some(fee_bps) = update.fee_bps {
        config.fee_bps = fee_bps;
    }
    if let Some(feed_id) = update.usdc_feed_id {
        config.usdc_feed_id = feed_id;
    }
    if let Some(jupiter_program) = update.jupiter_program {
        config.jupiter_program = jupiter_program;
    }
    if let Some(attester) = update.attester {
        config.attester = attester;
    }
    if let Some(pause_authority) = update.pause_authority {
        config.pause_authority = pause_authority;
    }
    if let Some(age) = update.max_price_age_secs {
        config.max_price_age_secs = age;
    }
    if let Some(conf) = update.max_conf_bps {
        config.max_conf_bps = conf;
    }
    if let Some(max_leg_usdc) = update.max_leg_usdc {
        config.max_leg_usdc = max_leg_usdc;
    }
    validate_config(config)?;
    emit_config(config)
}

#[derive(Accounts)]
pub struct SetGlobalPause<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn set_global_pause(ctx: Context<SetGlobalPause>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = paused;
    emit_config(config)
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    pub pause_authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = pause_authority @ RouterError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = true;
    emit_config(config)
}

#[derive(Accounts)]
pub struct UpsertAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Asset::INIT_SPACE,
        seeds = [ASSET_SEED, mint.key().as_ref()],
        bump,
    )]
    pub asset: Account<'info, Asset>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

fn validate_asset_params(params: &AssetParams) -> Result<()> {
    require!(params.issuer <= ISSUER_MAX, RouterError::InvalidParameter);
    let zero = [0u8; 32];
    if params.kind == AssetKind::ListedEquity as u8 {
        require!(params.feed_id != zero, RouterError::PriceFeedMismatch);
        let widest = params
            .max_band_bps
            .checked_add(params.band_247_extra_bps)
            .ok_or(RouterError::MathOverflow)?;
        require!(widest <= MAX_BAND_EQUITY_BPS, RouterError::BandTooWide);
    } else if params.kind == AssetKind::PreIpo as u8 {
        require!(
            params.feed_id == zero && params.feed_id_247 == zero,
            RouterError::PriceFeedMismatch
        );
        require!(
            params.band_247_extra_bps == 0,
            RouterError::InvalidParameter
        );
        require!(
            params.max_band_bps <= MAX_BAND_PREIPO_BPS,
            RouterError::BandTooWide
        );
    } else {
        return err!(RouterError::InvalidParameter);
    }
    Ok(())
}

pub fn upsert_asset(ctx: Context<UpsertAsset>, params: AssetParams) -> Result<()> {
    validate_asset_params(&params)?;
    let mint_info = ctx.accounts.mint.to_account_info();
    require!(
        !pricing::has_active_transfer_hook(&mint_info)?,
        RouterError::InvalidParameter
    );
    let asset = &mut ctx.accounts.asset;
    let is_new = asset.mint == Pubkey::default();
    if is_new {
        asset.mint = ctx.accounts.mint.key();
        asset.status = AssetStatus::Active as u8;
        asset.bump = ctx.bumps.asset;
    } else {
        require!(asset.kind == params.kind, RouterError::AssetKindMismatch);
    }
    asset.token_program = ctx.accounts.token_program.key();
    asset.decimals = ctx.accounts.mint.decimals;
    asset.kind = params.kind;
    asset.issuer = params.issuer;
    asset.feed_id = params.feed_id;
    asset.feed_id_247 = params.feed_id_247;
    asset.max_band_bps = params.max_band_bps;
    asset.band_247_extra_bps = params.band_247_extra_bps;
    emit_asset(asset)
}

fn emit_asset(asset: &Asset) -> Result<()> {
    emit!(AssetUpserted {
        mint: asset.mint,
        token_program: asset.token_program,
        decimals: asset.decimals,
        kind: asset.kind,
        issuer: asset.issuer,
        status: asset.status,
        feed_id: asset.feed_id,
        feed_id_247: asset.feed_id_247,
        max_band_bps: asset.max_band_bps,
        band_247_extra_bps: asset.band_247_extra_bps,
        conversion_target: asset.conversion_target,
        conversion_ratio_num: asset.conversion_ratio_num,
        conversion_ratio_den: asset.conversion_ratio_den,
        conversion_deadline: asset.conversion_deadline,
        slot: Clock::get()?.slot,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetAssetStatus<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Account<'info, Asset>,
}

pub fn set_asset_status(ctx: Context<SetAssetStatus>, params: AssetStatusParams) -> Result<()> {
    let asset = &mut ctx.accounts.asset;
    match params.status {
        s if s == AssetStatus::Active as u8
            || s == AssetStatus::BuysPaused as u8
            || s == AssetStatus::Delisted as u8 =>
        {
            asset.conversion_target = Pubkey::default();
            asset.conversion_ratio_num = 0;
            asset.conversion_ratio_den = 0;
            asset.conversion_deadline = 0;
        }
        s if s == AssetStatus::Converting as u8 => {
            require!(
                asset.kind() == AssetKind::PreIpo,
                RouterError::AssetKindMismatch
            );
            require!(
                params.conversion_deadline > Clock::get()?.unix_timestamp,
                RouterError::ConversionDeadlinePassed
            );
            require!(
                params.conversion_target != Pubkey::default()
                    && params.conversion_target != asset.mint
                    && params.conversion_ratio_num > 0
                    && params.conversion_ratio_den > 0,
                RouterError::InvalidParameter
            );
            asset.conversion_target = params.conversion_target;
            asset.conversion_ratio_num = params.conversion_ratio_num;
            asset.conversion_ratio_den = params.conversion_ratio_den;
            asset.conversion_deadline = params.conversion_deadline;
        }
        _ => return err!(RouterError::InvalidParameter),
    }
    asset.status = params.status;
    emit_asset(asset)
}
