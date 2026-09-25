use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod guard;
pub mod instructions;
pub mod pricing;
pub mod state;
pub mod token_ops;

use instructions::*;

declare_id!("PayEFo1ZAPXKf5H4DoqrsEceYzdSvXJBAGBD7AMQY6H");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Paycheck Router",
    project_url: "https://github.com/winsznx/paycheck-router",
    contacts: "link:https://github.com/winsznx/paycheck-router/security/advisories/new",
    policy: "https://github.com/winsznx/paycheck-router/security/policy",
    preferred_languages: "en",
    source_code: "https://github.com/winsznx/paycheck-router"
}

#[program]
pub mod paycheck_router {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams) -> Result<()> {
        instructions::admin::initialize_config(ctx, params)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
        instructions::admin::update_config(ctx, update)
    }

    pub fn upsert_asset(ctx: Context<UpsertAsset>, params: AssetParams) -> Result<()> {
        instructions::admin::upsert_asset(ctx, params)
    }

    pub fn set_asset_status(ctx: Context<SetAssetStatus>, params: AssetStatusParams) -> Result<()> {
        instructions::admin::set_asset_status(ctx, params)
    }

    pub fn set_global_pause(ctx: Context<SetGlobalPause>, paused: bool) -> Result<()> {
        instructions::admin::set_global_pause(ctx, paused)
    }

    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        instructions::admin::emergency_pause(ctx)
    }

    pub fn create_router<'info>(
        ctx: Context<'info, CreateRouter<'info>>,
        params: RouterParams,
    ) -> Result<()> {
        instructions::router::create_router(ctx, params)
    }

    pub fn update_router<'info>(
        ctx: Context<'info, UpdateRouter<'info>>,
        params: RouterParams,
    ) -> Result<()> {
        instructions::router::update_router(ctx, params)
    }

    pub fn set_router_paused(ctx: Context<SetRouterPaused>, paused: bool) -> Result<()> {
        instructions::router::set_router_paused(ctx, paused)
    }

    pub fn cancel_leg(ctx: Context<CancelLeg>, leg_index: u8) -> Result<()> {
        instructions::router::cancel_leg(ctx, leg_index)
    }

    pub fn close_router(ctx: Context<CloseRouter>) -> Result<()> {
        instructions::router::close_router(ctx)
    }

    pub fn sync_watermark(ctx: Context<SyncWatermark>) -> Result<()> {
        instructions::inflow::sync_watermark(ctx)
    }

    pub fn skip_inflow(ctx: Context<SkipInflow>) -> Result<()> {
        instructions::inflow::skip_inflow(ctx)
    }

    pub fn record_paycheck(ctx: Context<RecordPaycheck>, detected_slot: u64) -> Result<()> {
        instructions::inflow::record_paycheck(ctx, detected_slot)
    }
}
