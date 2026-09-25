use paycheck_router::{error::RouterError, state::LegStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::common::*;

struct Setup {
    env: Env,
    worker: Worker,
    nvda: Pubkey,
    spy: Pubkey,
}

fn setup(starting_usdc: u64) -> Setup {
    let mut env = Env::new();
    let nvda = env.add_listed_asset(NVDA_FEED, NVDA_FEED_247);
    let spy = env.add_listed_asset(SPY_FEED, [0u8; 32]);
    let worker = Worker::new(&mut env, starting_usdc);
    Setup {
        env,
        worker,
        nvda,
        spy,
    }
}

fn two_legs(s: &Setup) -> Vec<paycheck_router::state::LegConfig> {
    vec![Env::leg(s.nvda, 6_000, 50), Env::leg(s.spy, 4_000, 50)]
}

#[test]
fn create_router_sets_rules_and_authority_account() {
    let mut s = setup(250 * ONE_USDC);
    let sponsor = Keypair::new();
    s.env.fund(&sponsor.pubkey());
    let params = s.env.router_params(two_legs(&s));
    let ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &sponsor.pubkey(), params);
    s.env.send(&[ix], &[&sponsor, &s.worker.key]).unwrap();

    let router = s.env.router(&s.worker.pubkey());
    assert_eq!(router.owner, s.worker.pubkey());
    assert_eq!(router.pay_in, s.worker.pay_in);
    assert_eq!(router.recorder, s.env.recorder.pubkey());
    assert_eq!(router.rent_payer, sponsor.pubkey());
    assert_eq!(router.invest_bps, 2_000);
    assert_eq!(router.leg_count, 2);
    assert_eq!(router.legs[0].mint, s.nvda);
    assert_eq!(router.legs[1].weight_bps, 4_000);
    assert_eq!(router.paycheck_seq, 0);
    assert_eq!(router.watermark, 250 * ONE_USDC);
    assert_eq!(router.created_at, START_TIME);

    let authority_usdc = ata(&s.worker.authority(), &s.env.usdc_mint, &TOKEN_PROGRAM);
    let state = s.env.token_state(&authority_usdc);
    assert_eq!(state.owner, s.worker.authority());
    assert_eq!(state.amount, 0);
}

#[test]
fn invariant_07_balance_at_creation_is_never_inflow() {
    let mut s = setup(4_321 * ONE_USDC);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    assert_eq!(s.env.router(&s.worker.pubkey()).watermark, 4_321 * ONE_USDC);
    let worker = s.worker.pubkey();
    assert_router_error(s.env.record(&worker), RouterError::NoNewInflow);

    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.env.record(&worker).unwrap();
    let router = s.worker.router();
    let paycheck = s.env.paycheck(&router, 0);
    assert_eq!(paycheck.inflow, 100 * ONE_USDC);
}

#[test]
fn create_router_validates_split() {
    let s = setup(0);
    let nvda = s.nvda;
    let spy = s.spy;
    let cases: Vec<(Vec<paycheck_router::state::LegConfig>, RouterError)> = vec![
        (
            vec![Env::leg(nvda, 6_000, 50), Env::leg(spy, 3_999, 50)],
            RouterError::InvalidWeights,
        ),
        (
            vec![Env::leg(nvda, 10_000, 50), Env::leg(spy, 0, 50)],
            RouterError::InvalidWeights,
        ),
        (
            vec![Env::leg(nvda, 5_000, 50), Env::leg(nvda, 5_000, 50)],
            RouterError::InvalidWeights,
        ),
        (vec![], RouterError::InvalidWeights),
        (vec![Env::leg(nvda, 10_000, 251)], RouterError::BandTooWide),
    ];
    for (legs, expected) in cases {
        let mut s = setup(0);
        let params = s.env.router_params(
            legs.iter()
                .map(|leg| {
                    let mint = if leg.mint == nvda { s.nvda } else { s.spy };
                    paycheck_router::state::LegConfig { mint, ..*leg }
                })
                .collect(),
        );
        let ix = s
            .env
            .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
        assert_router_error(s.env.send(&[ix], &[&s.worker.key]), expected);
    }
}

#[test]
fn create_router_rejects_too_many_legs() {
    let mut s = setup(0);
    let mut legs = Vec::new();
    for _ in 0..9 {
        let mint = s.env.add_listed_asset(NVDA_FEED, [0u8; 32]);
        legs.push(Env::leg(mint, 1_000, 50));
    }
    legs[0].weight_bps = 2_000;
    let params = s.env.router_params(legs);
    let ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::TooManyLegs,
    );
}

#[test]
fn create_router_requires_active_registered_assets() {
    let mut s = setup(0);
    let unregistered = s.env.create_mint(TOKEN_2022_PROGRAM, 8, Some(1.0));
    let params = s
        .env
        .router_params(vec![Env::leg(unregistered, 10_000, 50)]);
    let ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::AssetNotActive,
    );

    let admin = s.env.admin.insecure_clone();
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: paycheck_router::ID,
        accounts: anchor_lang::ToAccountMetas::to_account_metas(
            &paycheck_router::accounts::SetAssetStatus {
                admin: admin.pubkey(),
                config: config_pda(),
                asset: asset_pda(&s.spy),
            },
            None,
        ),
        data: anchor_lang::InstructionData::data(&paycheck_router::instruction::SetAssetStatus {
            params: paycheck_router::instructions::AssetStatusParams {
                status: 1,
                conversion_target: Pubkey::default(),
                conversion_ratio_num: 0,
                conversion_ratio_den: 0,
                conversion_deadline: 0,
            },
        }),
    };
    s.env.send(&[ix], &[&admin]).unwrap();
    let params = s.env.router_params(vec![Env::leg(s.spy, 10_000, 50)]);
    let ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::AssetNotActive,
    );

    let params = s.env.router_params(vec![Env::leg(s.nvda, 10_000, 50)]);
    let mut ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
    ix.accounts.pop();
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::AssetNotActive,
    );
}

#[test]
fn create_router_validates_rules() {
    type Mutation = Box<dyn Fn(&mut paycheck_router::instructions::RouterParams)>;
    let cases: Vec<(Mutation, RouterError)> = vec![
        (
            Box::new(|p| p.invest_bps = 99),
            RouterError::InvalidParameter,
        ),
        (
            Box::new(|p| p.invest_bps = 10_001),
            RouterError::InvalidParameter,
        ),
        (
            Box::new(|p| p.min_inflow = ONE_USDC - 1),
            RouterError::InflowBelowMinimum,
        ),
        (
            Box::new(|p| p.max_wait_secs = 1_209_601),
            RouterError::InvalidParameter,
        ),
        (
            Box::new(|p| p.max_wait_secs = 0),
            RouterError::InvalidParameter,
        ),
        (Box::new(|p| p.daily_cap = 0), RouterError::InvalidParameter),
    ];
    for (mutate, expected) in cases {
        let mut s = setup(0);
        let mut params = s.env.router_params(two_legs(&s));
        mutate(&mut params);
        let ix = s
            .env
            .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
        assert_router_error(s.env.send(&[ix], &[&s.worker.key]), expected);
    }
}

#[test]
fn create_router_requires_owner_usdc_ata() {
    let mut s = setup(0);
    let params = s.env.router_params(two_legs(&s));
    let mut ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &s.worker.pubkey(), params);
    let usdc_mint = s.env.usdc_mint;
    let other = s
        .env
        .create_token_account(&s.worker.pubkey(), &usdc_mint, TOKEN_PROGRAM);
    ix.accounts[6].pubkey = other;
    assert!(s.env.send(&[ix], &[&s.worker.key]).is_err());
}

#[test]
fn update_router_revalidates_and_applies() {
    let mut s = setup(0);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    let mut params = s.env.router_params(vec![Env::leg(s.spy, 10_000, 100)]);
    params.invest_bps = 5_000;
    params.auto_convert = true;
    params.recorder = Pubkey::default();
    let ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    let router = s.env.router(&s.worker.pubkey());
    assert_eq!(router.leg_count, 1);
    assert_eq!(router.legs[0].mint, s.spy);
    assert_eq!(router.legs[1].mint, Pubkey::default());
    assert_eq!(router.invest_bps, 5_000);
    assert!(router.auto_convert);
    assert_eq!(router.recorder, Pubkey::default());

    let params = s.env.router_params(vec![Env::leg(s.spy, 9_000, 100)]);
    let ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::InvalidWeights,
    );
}

#[test]
fn only_owner_updates_or_pauses_router() {
    let mut s = setup(0);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    let intruder = Keypair::new();
    s.env.fund(&intruder.pubkey());

    let params = s.env.router_params(two_legs(&s));
    let mut ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    ix.accounts[0].pubkey = intruder.pubkey();
    assert!(s.env.send(&[ix], &[&intruder]).is_err());

    let mut ix = s.env.set_router_paused_ix(&s.worker.pubkey(), true);
    ix.accounts[0].pubkey = intruder.pubkey();
    assert!(s.env.send(&[ix], &[&intruder]).is_err());
    assert!(!s.env.router(&s.worker.pubkey()).paused);
}

#[test]
fn owner_pauses_and_resumes_router() {
    let mut s = setup(0);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    let ix = s.env.set_router_paused_ix(&s.worker.pubkey(), true);
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    assert!(s.env.router(&s.worker.pubkey()).paused);
    let ix = s.env.set_router_paused_ix(&s.worker.pubkey(), false);
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    assert!(!s.env.router(&s.worker.pubkey()).paused);
}

#[test]
fn cancel_leg_marks_pending_leg_cancelled_once() {
    let mut s = setup(0);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    s.worker.receive_pay(&mut s.env, 1_000 * ONE_USDC);
    let worker = s.worker.pubkey();
    s.env.record(&worker).unwrap();
    let balance_before = s.env.balance(&s.worker.pay_in);

    let ix = s.env.cancel_leg_ix(&worker, 0, 1);
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    let paycheck = s.env.paycheck(&s.worker.router(), 0);
    assert_eq!(paycheck.legs[1].status, LegStatus::Cancelled as u8);
    assert_eq!(paycheck.legs[0].status, LegStatus::Pending as u8);
    assert_eq!(s.env.router(&worker).pending_legs, 1);
    assert_eq!(s.env.balance(&s.worker.pay_in), balance_before);

    let ix = s.env.cancel_leg_ix(&worker, 0, 1);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::LegNotPending,
    );
    let ix = s.env.cancel_leg_ix(&worker, 0, 7);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::InvalidParameter,
    );
}

#[test]
fn close_router_waits_for_open_legs() {
    let mut s = setup(0);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    s.worker.receive_pay(&mut s.env, 1_000 * ONE_USDC);
    let worker = s.worker.pubkey();
    s.env.record(&worker).unwrap();

    let ix = s.env.close_router_ix(&worker, &worker);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::OpenPaychecksRemain,
    );

    for leg in 0..2 {
        let ix = s.env.cancel_leg_ix(&worker, 0, leg);
        s.env.send(&[ix], &[&s.worker.key]).unwrap();
    }
    let ix = s.env.close_router_ix(&worker, &worker);
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    assert!(!s.env.account_exists(&s.worker.router()));
}

#[test]
fn invariant_11_close_router_refunds_rent_payer() {
    let mut s = setup(0);
    let sponsor = Keypair::new();
    s.env.fund(&sponsor.pubkey());
    let params = s.env.router_params(two_legs(&s));
    let ix = s
        .env
        .create_router_ix(&s.worker.pubkey(), &sponsor.pubkey(), params);
    s.env.send(&[ix], &[&sponsor, &s.worker.key]).unwrap();

    let router = s.worker.router();
    let authority_usdc = ata(&s.worker.authority(), &s.env.usdc_mint, &TOKEN_PROGRAM);
    let rent = s.env.lamports(&router) + s.env.lamports(&authority_usdc);
    let sponsor_before = s.env.lamports(&sponsor.pubkey());

    let worker = s.worker.pubkey();
    let ix = s.env.close_router_ix(&worker, &worker);
    assert_router_error(
        s.env.send(&[ix], &[&s.worker.key]),
        RouterError::Unauthorized,
    );

    let ix = s.env.close_router_ix(&worker, &sponsor.pubkey());
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    assert_eq!(s.env.lamports(&sponsor.pubkey()), sponsor_before + rent);
    assert!(!s.env.account_exists(&router));
    assert!(!s.env.account_exists(&authority_usdc));
}

#[test]
fn close_router_returns_stray_authority_usdc_to_owner() {
    let mut s = setup(0);
    let legs = two_legs(&s);
    s.worker.setup(&mut s.env, legs);
    let authority_usdc = ata(&s.worker.authority(), &s.env.usdc_mint, &TOKEN_PROGRAM);
    let usdc_mint = s.env.usdc_mint;
    s.env.mint_to(&usdc_mint, &authority_usdc, 7);
    let worker = s.worker.pubkey();
    let ix = s.env.close_router_ix(&worker, &worker);
    s.env.send(&[ix], &[&s.worker.key]).unwrap();
    assert_eq!(s.env.balance(&s.worker.pay_in), 7);
}
