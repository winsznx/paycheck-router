use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use paycheck_router::{
    constants::{MAX_BAND_EQUITY_BPS, MAX_FEE_BPS},
    error::RouterError,
    instructions::{AssetStatusParams, ConfigUpdate},
    state::AssetStatus,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::common::*;

fn update_config_ix(admin: &Pubkey, update: ConfigUpdate, treasury: Option<Pubkey>) -> Instruction {
    Instruction {
        program_id: paycheck_router::ID,
        accounts: paycheck_router::accounts::UpdateConfig {
            admin: *admin,
            config: config_pda(),
            treasury,
        }
        .to_account_metas(None),
        data: paycheck_router::instruction::UpdateConfig { update }.data(),
    }
}

fn set_status_ix(admin: &Pubkey, mint: &Pubkey, params: AssetStatusParams) -> Instruction {
    Instruction {
        program_id: paycheck_router::ID,
        accounts: paycheck_router::accounts::SetAssetStatus {
            admin: *admin,
            config: config_pda(),
            asset: asset_pda(mint),
        }
        .to_account_metas(None),
        data: paycheck_router::instruction::SetAssetStatus { params }.data(),
    }
}

fn status(status: AssetStatus) -> AssetStatusParams {
    AssetStatusParams {
        status: status as u8,
        conversion_target: Pubkey::default(),
        conversion_ratio_num: 0,
        conversion_ratio_den: 0,
        conversion_deadline: 0,
    }
}

#[test]
fn initialize_config_stores_values() {
    let env = Env::new();
    let config = env.config();
    assert_eq!(config.admin, env.admin.pubkey());
    assert_eq!(config.treasury, env.treasury);
    assert_eq!(config.fee_bps, 20);
    assert_eq!(config.usdc_mint, env.usdc_mint);
    assert_eq!(config.usdc_feed_id, USDC_FEED);
    assert_eq!(config.jupiter_program, env.swap_program);
    assert_eq!(config.attester, env.attester.pubkey());
    assert_eq!(config.pause_authority, env.guardian.pubkey());
    assert_eq!(config.max_price_age_secs, 30);
    assert_eq!(config.max_conf_bps, 50);
    assert_eq!(config.max_leg_usdc, 5_000 * ONE_USDC);
    assert!(!config.paused);
    assert_eq!(config.version, 1);
}

#[test]
fn initialize_config_requires_upgrade_authority() {
    let mut env = Env::bare();
    let impostor = Keypair::new();
    env.fund(&impostor.pubkey());
    let mut ix = env.initialize_config_ix(env.default_config_params());
    ix.accounts[0].pubkey = impostor.pubkey();
    assert_router_error(env.send(&[ix], &[&impostor]), RouterError::Unauthorized);

    env.set_upgrade_authority(None);
    let ix = env.initialize_config_ix(env.default_config_params());
    let deployer = env.deployer.insecure_clone();
    assert_router_error(env.send(&[ix], &[&deployer]), RouterError::Unauthorized);
}

#[test]
fn initialize_config_runs_once() {
    let mut env = Env::new();
    let ix = env.initialize_config_ix(env.default_config_params());
    let deployer = env.deployer.insecure_clone();
    assert!(env.send(&[ix], &[&deployer]).is_err());
}

#[test]
fn initialize_config_enforces_hard_caps() {
    type Mutation = Box<dyn Fn(&mut paycheck_router::instructions::ConfigParams)>;
    let cases: Vec<Mutation> = vec![
        Box::new(|p| p.fee_bps = MAX_FEE_BPS + 1),
        Box::new(|p| p.max_price_age_secs = 121),
        Box::new(|p| p.max_price_age_secs = 0),
        Box::new(|p| p.max_conf_bps = 201),
        Box::new(|p| p.max_leg_usdc = 0),
        Box::new(|p| p.usdc_feed_id = [0u8; 32]),
        Box::new(|p| p.jupiter_program = paycheck_router::ID),
        Box::new(|p| p.attester = Pubkey::default()),
    ];
    for mutate in cases {
        let mut env = Env::bare();
        let mut params = env.default_config_params();
        mutate(&mut params);
        let ix = env.initialize_config_ix(params);
        let deployer = env.deployer.insecure_clone();
        assert_router_error(env.send(&[ix], &[&deployer]), RouterError::InvalidParameter);
    }
}

#[test]
fn initialize_config_rejects_non_usdc_treasury() {
    let mut env = Env::bare();
    let other_mint = env.create_mint(TOKEN_PROGRAM, 6, None);
    let admin = env.admin.pubkey();
    env.treasury = env.create_token_account(&admin, &other_mint, TOKEN_PROGRAM);
    let ix = env.initialize_config_ix(env.default_config_params());
    let deployer = env.deployer.insecure_clone();
    assert!(env.send(&[ix], &[&deployer]).is_err());
}

#[test]
fn update_config_changes_fields_inside_caps() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let new_attester = Pubkey::new_unique();
    let new_treasury =
        env.create_token_account(&admin.pubkey(), &env.usdc_mint.clone(), TOKEN_PROGRAM);
    let update = ConfigUpdate {
        fee_bps: Some(MAX_FEE_BPS),
        attester: Some(new_attester),
        max_price_age_secs: Some(120),
        max_conf_bps: Some(200),
        max_leg_usdc: Some(1_000 * ONE_USDC),
        ..ConfigUpdate::default()
    };
    let ix = update_config_ix(&admin.pubkey(), update, Some(new_treasury));
    env.send(&[ix], &[&admin]).unwrap();
    let config = env.config();
    assert_eq!(config.fee_bps, MAX_FEE_BPS);
    assert_eq!(config.attester, new_attester);
    assert_eq!(config.treasury, new_treasury);
    assert_eq!(config.max_price_age_secs, 120);
    assert_eq!(config.max_conf_bps, 200);
    assert_eq!(config.max_leg_usdc, 1_000 * ONE_USDC);
}

#[test]
fn update_config_rejects_non_admin() {
    let mut env = Env::new();
    let outsider = Keypair::new();
    env.fund(&outsider.pubkey());
    let ix = update_config_ix(
        &outsider.pubkey(),
        ConfigUpdate {
            fee_bps: Some(1),
            ..ConfigUpdate::default()
        },
        None,
    );
    assert_router_error(env.send(&[ix], &[&outsider]), RouterError::Unauthorized);
}

#[test]
fn invariant_09_fee_never_exceeds_50_bps() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    for fee_bps in [51u16, 100, u16::MAX] {
        let ix = update_config_ix(
            &admin.pubkey(),
            ConfigUpdate {
                fee_bps: Some(fee_bps),
                ..ConfigUpdate::default()
            },
            None,
        );
        assert_router_error(env.send(&[ix], &[&admin]), RouterError::InvalidParameter);
    }
    assert!(env.config().fee_bps <= MAX_FEE_BPS);
    let mut params = env.default_config_params();
    params.fee_bps = 51;
    let mut fresh = Env::bare();
    let ix = fresh.initialize_config_ix(params);
    let deployer = fresh.deployer.insecure_clone();
    assert_router_error(
        fresh.send(&[ix], &[&deployer]),
        RouterError::InvalidParameter,
    );
}

#[test]
fn global_pause_is_admin_only_and_reversible() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let guardian = env.guardian.insecure_clone();

    let ix = env.set_global_pause_ix(&guardian.pubkey(), false);
    assert_router_error(env.send(&[ix], &[&guardian]), RouterError::Unauthorized);

    let ix = env.set_global_pause_ix(&admin.pubkey(), true);
    env.send(&[ix], &[&admin]).unwrap();
    assert!(env.config().paused);
    let ix = env.set_global_pause_ix(&admin.pubkey(), false);
    env.send(&[ix], &[&admin]).unwrap();
    assert!(!env.config().paused);
}

#[test]
fn emergency_pause_can_only_pause() {
    let mut env = Env::new();
    let guardian = env.guardian.insecure_clone();
    let outsider = Keypair::new();
    env.fund(&outsider.pubkey());

    let ix = env.emergency_pause_ix(&outsider.pubkey());
    assert_router_error(env.send(&[ix], &[&outsider]), RouterError::Unauthorized);

    let ix = env.emergency_pause_ix(&guardian.pubkey());
    env.send(&[ix], &[&guardian]).unwrap();
    assert!(env.config().paused);

    let ix = env.set_global_pause_ix(&guardian.pubkey(), false);
    assert_router_error(env.send(&[ix], &[&guardian]), RouterError::Unauthorized);
    assert!(env.config().paused);
}

#[test]
fn upsert_asset_reads_mint_and_validates() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let mint = env.add_listed_asset(NVDA_FEED, NVDA_FEED_247);
    let asset = env.asset(&mint);
    assert_eq!(asset.mint, mint);
    assert_eq!(asset.token_program, TOKEN_2022_PROGRAM);
    assert_eq!(asset.decimals, 8);
    assert_eq!(asset.kind, 0);
    assert_eq!(asset.status, AssetStatus::Active as u8);
    assert_eq!(asset.feed_id, NVDA_FEED);
    assert_eq!(asset.max_band_bps, 250);

    let mut params = Env::listed_params(NVDA_FEED, NVDA_FEED_247);
    params.max_band_bps = 100;
    let ix = env.upsert_asset_ix(&admin.pubkey(), &mint, TOKEN_2022_PROGRAM, params);
    env.send(&[ix], &[&admin]).unwrap();
    assert_eq!(env.asset(&mint).max_band_bps, 100);

    let ix = env.upsert_asset_ix(
        &admin.pubkey(),
        &mint,
        TOKEN_2022_PROGRAM,
        Env::preipo_params(),
    );
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::AssetKindMismatch);
}

#[test]
fn upsert_asset_requires_matching_token_program() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let mint = env.create_mint(TOKEN_2022_PROGRAM, 8, Some(1.0));
    let ix = env.upsert_asset_ix(
        &admin.pubkey(),
        &mint,
        TOKEN_PROGRAM,
        Env::listed_params(NVDA_FEED, [0u8; 32]),
    );
    assert!(env.send(&[ix], &[&admin]).is_err());
}

#[test]
fn upsert_asset_enforces_band_caps_and_feeds() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let mint = env.create_mint(TOKEN_2022_PROGRAM, 8, Some(1.0));

    let mut params = Env::listed_params(NVDA_FEED, NVDA_FEED_247);
    params.max_band_bps = MAX_BAND_EQUITY_BPS;
    params.band_247_extra_bps = 1;
    let ix = env.upsert_asset_ix(&admin.pubkey(), &mint, TOKEN_2022_PROGRAM, params);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::BandTooWide);

    let params = Env::listed_params([0u8; 32], [0u8; 32]);
    let ix = env.upsert_asset_ix(&admin.pubkey(), &mint, TOKEN_2022_PROGRAM, params);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::PriceFeedMismatch);

    let mut params = Env::preipo_params();
    params.max_band_bps = 1_001;
    let ix = env.upsert_asset_ix(&admin.pubkey(), &mint, TOKEN_2022_PROGRAM, params);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::BandTooWide);

    let mut params = Env::preipo_params();
    params.feed_id = NVDA_FEED;
    let ix = env.upsert_asset_ix(&admin.pubkey(), &mint, TOKEN_2022_PROGRAM, params);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::PriceFeedMismatch);

    let mut params = Env::preipo_params();
    params.kind = 7;
    let ix = env.upsert_asset_ix(&admin.pubkey(), &mint, TOKEN_2022_PROGRAM, params);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::InvalidParameter);

    let outsider = Keypair::new();
    env.fund(&outsider.pubkey());
    let ix = env.upsert_asset_ix(
        &outsider.pubkey(),
        &mint,
        TOKEN_2022_PROGRAM,
        Env::listed_params(NVDA_FEED, [0u8; 32]),
    );
    assert_router_error(env.send(&[ix], &[&outsider]), RouterError::Unauthorized);
}

#[test]
fn upsert_asset_rejects_mint_with_transfer_hook_program() {
    use anchor_spl::token_2022::spl_token_2022::{
        self,
        extension::{transfer_hook, ExtensionType},
        state::Mint as MintState,
    };
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let payer = env.mint_authority.insecure_clone();
    let mint = Keypair::new();
    let space =
        ExtensionType::try_calculate_account_len::<MintState>(&[ExtensionType::TransferHook])
            .unwrap();
    let lamports = env.svm.minimum_balance_for_rent_exemption(space);
    let ixs = [
        anchor_lang::solana_program::system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            lamports,
            space as u64,
            &TOKEN_2022_PROGRAM,
        ),
        transfer_hook::instruction::initialize(
            &TOKEN_2022_PROGRAM,
            &mint.pubkey(),
            Some(payer.pubkey()),
            Some(Pubkey::new_unique()),
        )
        .unwrap(),
        spl_token_2022::instruction::initialize_mint2(
            &TOKEN_2022_PROGRAM,
            &mint.pubkey(),
            &payer.pubkey(),
            None,
            8,
        )
        .unwrap(),
    ];
    env.send(&ixs, &[&payer, &mint]).unwrap();
    let ix = env.upsert_asset_ix(
        &admin.pubkey(),
        &mint.pubkey(),
        TOKEN_2022_PROGRAM,
        Env::listed_params(NVDA_FEED, [0u8; 32]),
    );
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::InvalidParameter);
}

#[test]
fn set_asset_status_moves_between_states() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let listed = env.add_listed_asset(NVDA_FEED, [0u8; 32]);
    let pre = env.add_preipo_asset();

    let ix = set_status_ix(&admin.pubkey(), &listed, status(AssetStatus::BuysPaused));
    env.send(&[ix], &[&admin]).unwrap();
    assert_eq!(env.asset(&listed).status, AssetStatus::BuysPaused as u8);

    let converting = AssetStatusParams {
        status: AssetStatus::Converting as u8,
        conversion_target: listed,
        conversion_ratio_num: 5,
        conversion_ratio_den: 1,
        conversion_deadline: env.now() + 86_400,
    };
    let ix = set_status_ix(&admin.pubkey(), &listed, converting.clone());
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::AssetKindMismatch);

    let ix = set_status_ix(&admin.pubkey(), &pre, converting.clone());
    env.send(&[ix], &[&admin]).unwrap();
    let asset = env.asset(&pre);
    assert_eq!(asset.status, AssetStatus::Converting as u8);
    assert_eq!(asset.conversion_target, listed);
    assert_eq!(asset.conversion_ratio_num, 5);

    let past = AssetStatusParams {
        conversion_deadline: env.now() - 1,
        ..converting.clone()
    };
    let ix = set_status_ix(&admin.pubkey(), &pre, past);
    assert_router_error(
        env.send(&[ix], &[&admin]),
        RouterError::ConversionDeadlinePassed,
    );

    let zero_ratio = AssetStatusParams {
        conversion_ratio_den: 0,
        ..converting
    };
    let ix = set_status_ix(&admin.pubkey(), &pre, zero_ratio);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::InvalidParameter);

    let ix = set_status_ix(&admin.pubkey(), &pre, status(AssetStatus::Active));
    env.send(&[ix], &[&admin]).unwrap();
    let asset = env.asset(&pre);
    assert_eq!(asset.status, AssetStatus::Active as u8);
    assert_eq!(asset.conversion_target, Pubkey::default());

    let mut bad = status(AssetStatus::Active);
    bad.status = 9;
    let ix = set_status_ix(&admin.pubkey(), &pre, bad);
    assert_router_error(env.send(&[ix], &[&admin]), RouterError::InvalidParameter);
}
