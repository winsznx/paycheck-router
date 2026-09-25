use anchor_lang::InstructionData;
use paycheck_router::{
    constants::{MAX_FEE_BPS, PYTH_RECEIVER_PROGRAM_ID},
    error::RouterError,
    guard,
    instructions::ConfigUpdate,
    state::LegStatus,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::{
    common::*,
    fixtures::{self, PriceSpec},
    market::*,
};

fn nvda_e9() -> u64 {
    (NVDA_USD * 1e9) as u64
}

#[test]
fn execute_leg_swaps_and_records_the_fill() {
    let mut m = market();
    let leg = m.leg(0);
    assert_eq!(leg.amount_in, 120 * ONE_USDC);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let out = min_out + 1_000;
    let fee = m.fee(leg.amount_in);
    let route = m.honest_route(&leg, out);

    let pay_in_before = m.env.balance(&m.worker.pay_in);
    let treasury_before = m.env.balance(&m.env.treasury);
    let meta = m.execute(&leg, &route).unwrap();
    println!("execute_leg compute units: {}", meta.compute_units_consumed);

    assert_eq!(
        m.env.balance(&m.worker.pay_in),
        pay_in_before - leg.amount_in
    );
    assert_eq!(m.env.balance(&m.env.treasury), treasury_before + fee);
    assert_eq!(m.env.balance(&m.destination(&m.nvda)), out);
    assert_eq!(m.env.balance(&m.authority_usdc()), 0);

    let paycheck = m.env.paycheck(&m.router(), 0);
    let state = paycheck.legs[0];
    assert_eq!(state.status, LegStatus::Executed as u8);
    assert_eq!(state.out_amount, out);
    assert_eq!(state.fee, fee);
    assert_eq!(state.issuer_fee, 0);
    assert_eq!(state.ref_price_e9, nvda_e9());
    assert_eq!(state.executed_at, m.env.now());

    let router = m.env.router(&m.owner());
    assert_eq!(router.watermark, PAY - leg.amount_in);
    assert_eq!(router.pending_legs, 2);
    assert_eq!(router.total_fees, fee);
    assert_eq!(router.total_invested, leg.amount_in - fee);
}

#[test]
fn invariant_01_output_only_reaches_the_owners_asset_account() {
    let mut m = market();
    let leg = m.leg(0);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);

    let thief = Keypair::new().pubkey();
    let nvda = m.nvda;
    let thief_account = m.env.create_ata(&thief, &nvda, TOKEN_2022_PROGRAM);
    let swapped = leg.amount_in - m.fee(leg.amount_in);
    let stealing = Route::new()
        .transfer(
            (TOKEN_PROGRAM, m.env.usdc_mint, 6),
            m.authority_usdc(),
            m.sink,
            m.authority(),
            swapped,
        )
        .transfer(
            (TOKEN_2022_PROGRAM, nvda, 8),
            m.vault_account(&nvda),
            thief_account,
            vault(),
            min_out * 2,
        )
        .touch(m.destination(&nvda), true);
    assert_router_error(m.execute(&leg, &stealing), RouterError::OutputBelowMinimum);

    let call = Call {
        destination: Some(thief_account),
        ..m.listed_call(&leg)
    };
    let route = m.honest_route(&leg, min_out);
    let ix = m.execute_ix(&leg, &call, &route);
    let crank = m.env.crank.insecure_clone();
    assert_router_error(
        m.env.send(&[ix], &[&crank]),
        RouterError::DestinationOwnerMismatch,
    );

    let spy = m.spy;
    let call = Call {
        destination: Some(m.destination(&spy)),
        ..m.listed_call(&leg)
    };
    let ix = m.execute_ix(&leg, &call, &route);
    assert_router_error(
        m.env.send(&[ix], &[&crank]),
        RouterError::DestinationMintMismatch,
    );

    assert_eq!(m.env.balance(&thief_account), 0);
    m.execute(&leg, &route).unwrap();
    assert_eq!(m.env.token_state(&m.destination(&nvda)).owner, m.owner());
}

#[test]
fn invariant_02_owner_usdc_falls_by_exactly_amount_in() {
    let mut m = market();
    let leg = m.leg(0);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let greedy = m.honest_route(&leg, min_out).transfer(
        (TOKEN_PROGRAM, m.env.usdc_mint, 6),
        m.worker.pay_in,
        m.sink,
        m.authority(),
        1,
    );
    assert_router_error(m.execute(&leg, &greedy), RouterError::InputOverspent);

    let before = m.env.balance(&m.worker.pay_in);
    let route = m.honest_route(&leg, min_out);
    m.execute(&leg, &route).unwrap();
    assert_eq!(before - m.env.balance(&m.worker.pay_in), leg.amount_in);
}

#[test]
fn invariant_03_authority_accounts_end_at_zero() {
    let mut m = market();
    let leg = m.leg(0);
    let nvda = m.nvda;
    let authority = m.authority();
    let authority_nvda = m.env.create_ata(&authority, &nvda, TOKEN_2022_PROGRAM);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let swapped = leg.amount_in - m.fee(leg.amount_in);
    let dust = 7;
    // Takes less than the full input and parks part of the output with the
    // authority; the program returns both to the owner.
    let messy = Route::new()
        .transfer(
            (TOKEN_PROGRAM, m.env.usdc_mint, 6),
            m.authority_usdc(),
            m.sink,
            authority,
            swapped - dust,
        )
        .transfer(
            (TOKEN_2022_PROGRAM, nvda, 8),
            m.vault_account(&nvda),
            m.destination(&nvda),
            vault(),
            min_out / 2,
        )
        .transfer(
            (TOKEN_2022_PROGRAM, nvda, 8),
            m.vault_account(&nvda),
            authority_nvda,
            vault(),
            min_out - min_out / 2,
        );
    let pay_in_before = m.env.balance(&m.worker.pay_in);
    m.execute(&leg, &messy).unwrap();
    assert_eq!(m.env.balance(&m.authority_usdc()), 0);
    assert_eq!(m.env.balance(&authority_nvda), 0);
    assert_eq!(m.env.balance(&m.destination(&nvda)), min_out);
    assert_eq!(
        pay_in_before - m.env.balance(&m.worker.pay_in),
        leg.amount_in - dust
    );
    let router = m.env.router(&m.owner());
    assert_eq!(router.watermark, PAY - (leg.amount_in - dust));

    // A route that leaves a third token with the authority is refused.
    let mut m = market();
    let leg = m.leg(0);
    let spy = m.spy;
    let authority = m.authority();
    let authority_spy = m.env.create_ata(&authority, &spy, TOKEN_2022_PROGRAM);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let stray = m.honest_route(&leg, min_out).transfer(
        (TOKEN_2022_PROGRAM, spy, 8),
        m.vault_account(&spy),
        authority_spy,
        vault(),
        5,
    );
    assert_router_error(m.execute(&leg, &stray), RouterError::InputOverspent);
}

#[test]
fn invariant_04_no_execution_on_bad_prices() {
    let mut m = market();
    let leg = m.leg(0);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));
    let now = m.env.now();
    let crank = m.env.crank.insecure_clone();

    let stale = m.post(PriceSpec::equity(NVDA_FEED, NVDA_USD, now - 31));
    let wide = m.post(PriceSpec {
        conf: 18_000_000 * 51 / 10_000 + 1,
        ..PriceSpec::equity(NVDA_FEED, NVDA_USD, now)
    });
    let partial = m.post(PriceSpec {
        full: false,
        ..PriceSpec::equity(NVDA_FEED, NVDA_USD, now)
    });
    let wrong_feed = m.post(PriceSpec::equity(SPY_FEED, NVDA_USD, now));
    let spoofed = fixtures::post_price_as(
        &mut m.env,
        &PriceSpec::equity(NVDA_FEED, NVDA_USD, now),
        Pubkey::new_unique(),
    );
    let usdc_low = m.post(PriceSpec::usdc(USDC_FEED, 0.9949, now));
    let usdc_high = m.post(PriceSpec::usdc(USDC_FEED, 1.0051, now));
    let usdc_stale = m.post(PriceSpec::usdc(USDC_FEED, 1.0, now - 31));
    let usdc_wrong_feed = m.post(PriceSpec::usdc(NVDA_FEED, 1.0, now));

    let cases = [
        (
            Call {
                price: Some(stale),
                ..Call::default()
            },
            RouterError::PriceStale,
        ),
        (
            Call {
                price: Some(wide),
                ..Call::default()
            },
            RouterError::ConfidenceTooWide,
        ),
        (
            Call {
                price: Some(partial),
                ..Call::default()
            },
            RouterError::PriceFeedMismatch,
        ),
        (
            Call {
                price: Some(wrong_feed),
                ..Call::default()
            },
            RouterError::PriceFeedMismatch,
        ),
        (
            Call {
                price: Some(spoofed),
                ..Call::default()
            },
            RouterError::PriceFeedMismatch,
        ),
        (
            Call {
                usdc_price: Some(usdc_low),
                ..m.listed_call(&leg)
            },
            RouterError::UsdcDepeg,
        ),
        (
            Call {
                usdc_price: Some(usdc_high),
                ..m.listed_call(&leg)
            },
            RouterError::UsdcDepeg,
        ),
        (
            Call {
                usdc_price: Some(usdc_stale),
                ..m.listed_call(&leg)
            },
            RouterError::PriceStale,
        ),
        (
            Call {
                usdc_price: Some(usdc_wrong_feed),
                ..m.listed_call(&leg)
            },
            RouterError::PriceFeedMismatch,
        ),
    ];
    for (call, expected) in cases {
        let ix = m.execute_ix(&leg, &call, &route);
        assert_router_error(m.env.send(&[ix], &[&crank]), expected);
    }
    assert_eq!(
        m.env.paycheck(&m.router(), 0).legs[0].status,
        LegStatus::Pending as u8
    );

    let on_edge = m.post(PriceSpec {
        conf: 18_000_000 * 50 / 10_000,
        ..PriceSpec::equity(NVDA_FEED, NVDA_USD, now - 30)
    });
    let usdc_edge = m.post(PriceSpec::usdc(USDC_FEED, 0.995, now));
    let call = Call {
        price: Some(on_edge),
        usdc_price: Some(usdc_edge),
        ..Call::default()
    };
    let leg_min = guard::min_out_buy(&guard::BuyInputs {
        usdc_in: leg.amount_in - m.fee(leg.amount_in),
        usdc_price_e9: 995_000_000,
        price_e9: nvda_e9(),
        band_bps: 50,
        multiplier_e12: 1_000_000_000_000,
        decimals: 8,
    })
    .unwrap();
    let route = m.honest_route(&leg, leg_min);
    let ix = m.execute_ix(&leg, &call, &route);
    m.env.send(&[ix], &[&crank]).unwrap();
}

#[test]
fn stale_regular_feed_falls_back_to_247_with_extra_band() {
    let mut m = market();
    let leg = m.leg(0);
    let now = m.env.now();
    let stale = m.post(PriceSpec::equity(NVDA_FEED, NVDA_USD, now - 600));
    let fresh_247 = m.post(PriceSpec::equity(NVDA_FEED_247, NVDA_USD, now));
    let crank = m.env.crank.insecure_clone();

    let with_extra = m.min_out(&leg, nvda_e9(), 100, 1.0);
    let call = Call {
        price: Some(stale),
        price_247: Some(fresh_247),
        ..Call::default()
    };
    let route = m.honest_route(&leg, with_extra - 1);
    let ix = m.execute_ix(&leg, &call, &route);
    assert_router_error(
        m.env.send(&[ix], &[&crank]),
        RouterError::OutputBelowMinimum,
    );

    let call_no_247 = Call {
        price: Some(stale),
        ..Call::default()
    };
    let route = m.honest_route(&leg, with_extra);
    let ix = m.execute_ix(&leg, &call_no_247, &route);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::PriceStale);

    let ix = m.execute_ix(&leg, &call, &route);
    m.env.send(&[ix], &[&crank]).unwrap();

    // SPY has no 24/7 feed, so a passed 24/7 account is ignored.
    let spy_leg = m.leg(1);
    let spy_stale = m.post(PriceSpec::equity(SPY_FEED, SPY_USD, now - 600));
    let call = Call {
        price: Some(spy_stale),
        price_247: Some(fresh_247),
        ..Call::default()
    };
    let route = m.honest_route(
        &spy_leg,
        m.min_out(&spy_leg, (SPY_USD * 1e9) as u64, 50, 1.0),
    );
    let ix = m.execute_ix(&spy_leg, &call, &route);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::PriceStale);
}

#[test]
fn invariant_05_every_fill_meets_min_out() {
    let mut m = market();
    let leg = m.leg(0);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let short = m.honest_route(&leg, min_out - 1);
    assert_router_error(m.execute(&leg, &short), RouterError::OutputBelowMinimum);
    let exact = m.honest_route(&leg, min_out);
    m.execute(&leg, &exact).unwrap();
    let state = m.env.paycheck(&m.router(), 0).legs[0];
    assert!(state.out_amount >= min_out);
}

#[test]
fn scaled_ui_multiplier_switches_at_its_timestamp() {
    let mut m = market();
    let leg = m.leg(0);
    let nvda = m.nvda;
    let switch_at = m.env.now() + 100;
    m.env.set_scaled_multiplier(&nvda, 1.0, 1.25, switch_at);

    let before_switch = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let after_switch = m.min_out(&leg, nvda_e9(), 50, 1.25);
    assert!(after_switch < before_switch);

    let route = m.honest_route(&leg, after_switch);
    assert_router_error(m.execute(&leg, &route), RouterError::OutputBelowMinimum);

    m.env.set_time(switch_at);
    let now = m.env.now();
    m.nvda_price = m.post(PriceSpec::equity(NVDA_FEED, NVDA_USD, now));
    m.usdc_price = m.post(PriceSpec::usdc(USDC_FEED, 1.0, now));
    m.execute(&leg, &route).unwrap();
}

#[test]
fn invariant_08_paused_router_or_config_blocks_execute() {
    let mut m = market();
    let leg = m.leg(0);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));
    let key = m.worker.key.insecure_clone();
    let owner = m.owner();

    let ix = m.env.set_router_paused_ix(&owner, true);
    m.env.send(&[ix], &[&key]).unwrap();
    assert_router_error(m.execute(&leg, &route), RouterError::RouterPaused);
    let ix = m.env.set_router_paused_ix(&owner, false);
    m.env.send(&[ix], &[&key]).unwrap();

    let guardian = m.env.guardian.insecure_clone();
    let ix = m.env.emergency_pause_ix(&guardian.pubkey());
    m.env.send(&[ix], &[&guardian]).unwrap();
    assert_router_error(m.execute(&leg, &route), RouterError::ConfigPaused);
    let call = m.listed_call(&leg);
    let ix = m.execute_owner_ix(&leg, &call, 50, &route);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::ConfigPaused);
}

#[test]
fn invariant_09_fee_is_at_most_50_bps_of_the_leg() {
    let mut m = market();
    let admin = m.env.admin.insecure_clone();
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: paycheck_router::ID,
        accounts: anchor_lang::ToAccountMetas::to_account_metas(
            &paycheck_router::accounts::UpdateConfig {
                admin: admin.pubkey(),
                config: config_pda(),
                treasury: None,
            },
            None,
        ),
        data: anchor_lang::InstructionData::data(&paycheck_router::instruction::UpdateConfig {
            update: ConfigUpdate {
                fee_bps: Some(MAX_FEE_BPS),
                ..ConfigUpdate::default()
            },
        }),
    };
    m.env.send(&[ix], &[&admin]).unwrap();
    let leg = m.leg(0);
    let treasury_before = m.env.balance(&m.env.treasury);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));
    m.execute(&leg, &route).unwrap();
    let fee = m.env.balance(&m.env.treasury) - treasury_before;
    assert_eq!(fee, leg.amount_in * 50 / 10_000);
    assert!(u128::from(fee) * 10_000 <= u128::from(leg.amount_in) * 50);
}

#[test]
fn invariant_10_replaying_execute_changes_nothing() {
    let mut m = market();
    let leg = m.leg(0);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));
    m.execute(&leg, &route).unwrap();
    let router = m.env.router(&m.owner());
    let pay_in = m.env.balance(&m.worker.pay_in);
    let destination = m.env.balance(&m.destination(&m.nvda));
    assert_router_error(m.execute(&leg, &route), RouterError::LegNotPending);
    let after = m.env.router(&m.owner());
    assert_eq!(after.watermark, router.watermark);
    assert_eq!(after.pending_legs, router.pending_legs);
    assert_eq!(m.env.balance(&m.worker.pay_in), pay_in);
    assert_eq!(m.env.balance(&m.destination(&m.nvda)), destination);
}

#[test]
fn execute_leg_checks_allowance_delegate_and_balance() {
    let mut m = market();
    let leg = m.leg(0);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));
    let key = m.worker.key.insecure_clone();
    let pay_in = m.worker.pay_in;
    let authority = m.authority();

    m.env.approve(&key, &pay_in, &authority, leg.amount_in - 1);
    assert_router_error(m.execute(&leg, &route), RouterError::AllowanceInsufficient);

    let other = Pubkey::new_unique();
    m.env.approve(&key, &pay_in, &other, u64::MAX);
    assert_router_error(m.execute(&leg, &route), RouterError::DelegateMismatch);

    m.env.approve(&key, &pay_in, &authority, u64::MAX);
    let sink = m.sink;
    let balance = m.env.balance(&pay_in);
    m.env
        .spend(&key, &pay_in, &sink, balance - leg.amount_in + 1);
    assert_router_error(m.execute(&leg, &route), RouterError::BalanceInsufficient);
}

#[test]
fn execute_leg_rejects_wrong_program_kind_and_state() {
    let mut m = market();
    let crank = m.env.crank.insecure_clone();
    let leg = m.leg(0);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));

    let call = Call {
        swap_program: Some(Pubkey::new_unique()),
        ..m.listed_call(&leg)
    };
    let ix = m.execute_ix(&leg, &call, &route);
    assert_router_error(
        m.env.send(&[ix], &[&crank]),
        RouterError::JupiterProgramMismatch,
    );

    let pre_leg = m.leg(2);
    let call = Call {
        price: Some(m.nvda_price),
        ..Call::default()
    };
    let ix = m.execute_ix(&pre_leg, &call, &route);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::AssetKindMismatch);

    let bad_index = Leg {
        index: 9,
        ..m.leg(0)
    };
    let ix = m.execute_ix(&bad_index, &m.listed_call(&leg), &route);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::InvalidParameter);

    let mismatched = Leg {
        index: 1,
        ..m.leg(0)
    };
    let ix = m.execute_ix(&mismatched, &m.listed_call(&leg), &route);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::InvalidParameter);

    let admin = m.env.admin.insecure_clone();
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: paycheck_router::ID,
        accounts: anchor_lang::ToAccountMetas::to_account_metas(
            &paycheck_router::accounts::SetAssetStatus {
                admin: admin.pubkey(),
                config: config_pda(),
                asset: asset_pda(&m.nvda),
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
    m.env.send(&[ix], &[&admin]).unwrap();
    assert_router_error(m.execute(&leg, &route), RouterError::AssetNotActive);
}

#[test]
fn execute_after_expiry_fails_and_expire_leg_finalises() {
    let mut m = market();
    let leg = m.leg(0);
    let route = m.honest_route(&leg, m.min_out(&leg, nvda_e9(), 50, 1.0));
    let crank = m.env.crank.insecure_clone();
    let expire = |m: &Market, index: u8| anchor_lang::solana_program::instruction::Instruction {
        program_id: paycheck_router::ID,
        accounts: anchor_lang::ToAccountMetas::to_account_metas(
            &paycheck_router::accounts::ExpireLeg {
                router: m.router(),
                paycheck: paycheck_pda(&m.router(), 0),
            },
            None,
        ),
        data: anchor_lang::InstructionData::data(&paycheck_router::instruction::ExpireLeg {
            leg_index: index,
        }),
    };

    let ix = expire(&m, 0);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::LegNotExpired);

    m.env.advance(86_400);
    let now = m.env.now();
    m.nvda_price = m.post(PriceSpec::equity(NVDA_FEED, NVDA_USD, now));
    m.usdc_price = m.post(PriceSpec::usdc(USDC_FEED, 1.0, now));
    assert_router_error(m.execute(&leg, &route), RouterError::PaycheckExpired);

    let pay_in = m.env.balance(&m.worker.pay_in);
    let ix = expire(&m, 0);
    m.env.send(&[ix], &[&crank]).unwrap();
    assert_eq!(
        m.env.paycheck(&m.router(), 0).legs[0].status,
        LegStatus::Expired as u8
    );
    assert_eq!(m.env.router(&m.owner()).pending_legs, 2);
    assert_eq!(m.env.balance(&m.worker.pay_in), pay_in);

    let ix = expire(&m, 0);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::LegNotPending);
    let ix = expire(&m, 5);
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::InvalidParameter);
}

#[test]
fn invariant_11_close_paycheck_refunds_the_crank() {
    let mut m = market();
    let crank = m.env.crank.insecure_clone();
    let paycheck = paycheck_pda(&m.router(), 0);
    let close = |rent_payer: Pubkey| anchor_lang::solana_program::instruction::Instruction {
        program_id: paycheck_router::ID,
        accounts: anchor_lang::ToAccountMetas::to_account_metas(
            &paycheck_router::accounts::ClosePaycheck {
                paycheck,
                rent_payer,
            },
            None,
        ),
        data: anchor_lang::InstructionData::data(&paycheck_router::instruction::ClosePaycheck {}),
    };

    let ix = close(crank.pubkey());
    assert_router_error(
        m.env.send(&[ix], &[&crank]),
        RouterError::OpenPaychecksRemain,
    );

    let key = m.worker.key.insecure_clone();
    let owner = m.owner();
    for index in 0..3 {
        let ix = m.env.cancel_leg_ix(&owner, 0, index);
        m.env.send(&[ix], &[&key]).unwrap();
    }
    let stranger = Keypair::new();
    m.env.fund(&stranger.pubkey());
    let ix = close(stranger.pubkey());
    assert_router_error(m.env.send(&[ix], &[&stranger]), RouterError::Unauthorized);

    let rent = m.env.lamports(&paycheck);
    let crank_before = m.env.lamports(&crank.pubkey());
    let ix = close(crank.pubkey());
    m.env.send(&[ix], &[&stranger]).unwrap();
    assert_eq!(m.env.lamports(&crank.pubkey()), crank_before + rent);
    assert!(!m.env.account_exists(&paycheck));

    let ix = close(crank.pubkey());
    assert!(m.env.send(&[ix], &[&stranger]).is_err());
}

#[test]
fn execute_leg_owner_buys_now_with_a_wider_band() {
    let mut m = market();
    let leg = m.leg(0);
    let key = m.worker.key.insecure_clone();
    let crank = m.env.crank.insecure_clone();
    let wide_min = m.min_out(&leg, nvda_e9(), 1_000, 1.0);
    let route = m.honest_route(&leg, wide_min);
    assert_router_error(m.execute(&leg, &route), RouterError::OutputBelowMinimum);

    let call = m.listed_call(&leg);
    let ix = m.execute_owner_ix(&leg, &call, 1_001, &route);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::BandTooWide);

    let mut ix = m.execute_owner_ix(&leg, &call, 1_000, &route);
    ix.accounts[0].pubkey = crank.pubkey();
    assert!(m.env.send(&[ix], &[&crank]).is_err());

    let ix = m.execute_owner_ix(&leg, &Call::default(), 1_000, &route);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::PriceFeedMismatch);

    let ix = m.execute_owner_ix(&leg, &call, 1_000, &route);
    m.env.send(&[ix], &[&key]).unwrap();
    assert_eq!(m.env.balance(&m.destination(&m.nvda)), wide_min);
    assert_eq!(
        m.env.paycheck(&m.router(), 0).legs[0].status,
        LegStatus::Executed as u8
    );
}

#[test]
fn execute_leg_owner_prices_pre_ipo_from_an_attestation() {
    let mut m = market();
    let leg = m.leg(2);
    let key = m.worker.key.insecure_clone();
    let mark = (PRE_USD * 1e9) as u64;
    let min_out = m.min_out(&leg, mark, 1_000, 1.0);
    let route = m.honest_route(&leg, min_out);
    let attestation = m.attestation(m.pre, PRE_USD);
    let verify = fixtures::ed25519_instruction(
        &m.env.attester.insecure_clone(),
        &fixtures::attestation_message(&attestation),
    );

    let ix = m.execute_owner_ix(&leg, &Call::default(), 1_000, &route);
    assert_router_error(
        m.env.send(&[verify.clone(), ix], &[&key]),
        RouterError::AttestationMissing,
    );
    let call = Call {
        sysvar: true,
        ..Call::default()
    };
    let ix = m.execute_owner_ix(&leg, &call, 1_000, &route);
    m.env.send(&[verify, ix], &[&key]).unwrap();
    assert_eq!(m.env.balance(&m.destination(&m.pre)), min_out);
}

#[test]
fn execute_prestock_leg_uses_the_attested_mark() {
    let mut m = market();
    let leg = m.leg(2);
    assert_eq!(leg.amount_in, 20 * ONE_USDC);
    let mark = (PRE_USD * 1e9) as u64;
    let min_out = m.min_out(&leg, mark, 300, 1.0);
    let attestation = m.attestation(m.pre, PRE_USD);

    let short = m.honest_route(&leg, min_out - 1);
    assert_router_error(
        m.execute_prestock(&leg, &attestation, &short),
        RouterError::OutputBelowMinimum,
    );
    let route = m.honest_route(&leg, min_out);
    m.execute_prestock(&leg, &attestation, &route).unwrap();
    let state = m.env.paycheck(&m.router(), 0).legs[2];
    assert_eq!(state.status, LegStatus::Executed as u8);
    assert_eq!(state.ref_price_e9, mark);
    assert_eq!(state.out_amount, min_out);
    assert_eq!(m.env.balance(&m.authority_usdc()), 0);
}

#[test]
fn execute_prestock_leg_rejects_bad_attestations() {
    let mut m = market();
    let leg = m.leg(2);
    let route = m.honest_route(&leg, m.min_out(&leg, (PRE_USD * 1e9) as u64, 300, 1.0));
    let crank = m.env.crank.insecure_clone();
    let attester = m.env.attester.insecure_clone();
    let good = m.attestation(m.pre, PRE_USD);
    let message = fixtures::attestation_message(&good);
    let ix = m.execute_prestock_ix(&leg, &Call::default(), &route);

    assert_router_error(
        m.env.send(std::slice::from_ref(&ix), &[&crank]),
        RouterError::AttestationMissing,
    );

    let memo_like = anchor_lang::solana_program::instruction::Instruction {
        program_id: test_swap::ID,
        accounts: vec![],
        data: test_swap::instruction::Run { ops: vec![] }.data(),
    };
    assert_router_error(
        m.env.send(&[memo_like, ix.clone()], &[&crank]),
        RouterError::AttestationMissing,
    );

    let impostor = Keypair::new();
    let forged = fixtures::ed25519_instruction(&impostor, &message);
    assert_router_error(
        m.env.send(&[forged, ix.clone()], &[&crank]),
        RouterError::AttestationSignerMismatch,
    );

    let old = paycheck_router::events::MarkAttestation {
        observed_at: m.env.now() - 301,
        ..good
    };
    let stale = fixtures::ed25519_instruction(&attester, &fixtures::attestation_message(&old));
    assert_router_error(
        m.env.send(&[stale, ix.clone()], &[&crank]),
        RouterError::AttestationStale,
    );

    let other_mint = paycheck_router::events::MarkAttestation {
        mint: m.nvda,
        ..good
    };
    let wrong =
        fixtures::ed25519_instruction(&attester, &fixtures::attestation_message(&other_mint));
    assert_router_error(
        m.env.send(&[wrong, ix.clone()], &[&crank]),
        RouterError::AttestationMalformed,
    );

    let mut longer = message.clone();
    longer.push(0);
    let padded = fixtures::ed25519_instruction(&attester, &longer);
    assert_router_error(
        m.env.send(&[padded, ix.clone()], &[&crank]),
        RouterError::AttestationMalformed,
    );

    let signature: [u8; 64] = attester.sign_message(&message).into();
    let elsewhere = fixtures::ed25519_raw(&attester.pubkey().to_bytes(), &signature, &message, 1);
    assert!(m.env.send(&[elsewhere, ix.clone()], &[&crank]).is_err());

    let zero = paycheck_router::events::MarkAttestation {
        mark_price_e9: 0,
        ..good
    };
    let zero_mark = fixtures::ed25519_instruction(&attester, &fixtures::attestation_message(&zero));
    assert_router_error(
        m.env.send(&[zero_mark, ix.clone()], &[&crank]),
        RouterError::AttestationMalformed,
    );

    let listed_leg = m.leg(0);
    let listed_route = m.honest_route(&listed_leg, 1);
    let listed_ix = m.execute_prestock_ix(&listed_leg, &Call::default(), &listed_route);
    let verify = fixtures::ed25519_instruction(&attester, &message);
    assert_router_error(
        m.env.send(&[verify, listed_ix], &[&crank]),
        RouterError::AssetKindMismatch,
    );

    assert_eq!(
        m.env.paycheck(&m.router(), 0).legs[2].status,
        LegStatus::Pending as u8
    );
}

#[test]
fn transfer_fee_mint_is_guarded_on_gross_delivery() {
    let fee_bps = 100;
    let mut m = market_with(Some(fee_bps));
    let leg = m.leg(2);
    let mark = (PRE_USD * 1e9) as u64;
    let min_out = m.min_out(&leg, mark, 300, 1.0);
    let attestation = m.attestation(m.pre, PRE_USD);

    let route = m.honest_route(&leg, min_out);
    m.execute_prestock(&leg, &attestation, &route).unwrap();
    let withheld = min_out * u64::from(fee_bps) / 10_000;
    let expected_fee = if min_out * u64::from(fee_bps) % 10_000 == 0 {
        withheld
    } else {
        withheld + 1
    };
    let state = m.env.paycheck(&m.router(), 0).legs[2];
    assert_eq!(state.issuer_fee, expected_fee);
    assert_eq!(state.out_amount, min_out - expected_fee);
    assert_eq!(
        m.env.balance(&m.destination(&m.pre)),
        min_out - expected_fee
    );

    let mut m = market_with(Some(fee_bps));
    let leg = m.leg(2);
    let attestation = m.attestation(m.pre, PRE_USD);
    let short = m.honest_route(&leg, min_out - 1);
    assert_router_error(
        m.execute_prestock(&leg, &attestation, &short),
        RouterError::OutputBelowMinimum,
    );
}

#[test]
fn look_alike_receiver_owner_is_rejected() {
    let mut m = market();
    let leg = m.leg(0);
    let now = m.env.now();
    let fake_receiver = Pubkey::new_unique();
    assert_ne!(fake_receiver, PYTH_RECEIVER_PROGRAM_ID);
    let look_alike = fixtures::post_price_as(
        &mut m.env,
        &PriceSpec::equity(NVDA_FEED, NVDA_USD / 2.0, now),
        fake_receiver,
    );
    let call = Call {
        price: Some(look_alike),
        ..Call::default()
    };
    let route = m.honest_route(&leg, 1);
    let ix = m.execute_ix(&leg, &call, &route);
    let crank = m.env.crank.insecure_clone();
    assert_router_error(m.env.send(&[ix], &[&crank]), RouterError::PriceFeedMismatch);
}

#[test]
fn execute_leg_owner_never_lends_the_owner_signature() {
    let mut m = market();
    let leg = m.leg(0);
    let key = m.worker.key.insecure_clone();
    let spy = m.spy;
    let owner_spy = m.destination(&spy);
    m.env.mint_to(&spy, &owner_spy, 1_000);
    let thief = Keypair::new().pubkey();
    let thief_spy = m.env.create_ata(&thief, &spy, TOKEN_2022_PROGRAM);
    let min_out = m.min_out(&leg, nvda_e9(), 50, 1.0);
    let call = m.listed_call(&leg);

    // The owner signs this transaction; a route that tries to spend the
    // owner's other tokens with that signature must fail.
    let stealing = m.honest_route(&leg, min_out).transfer(
        (TOKEN_2022_PROGRAM, spy, 8),
        owner_spy,
        thief_spy,
        m.owner(),
        1_000,
    );
    let ix = m.execute_owner_ix(&leg, &call, 50, &stealing);
    assert!(m.env.send(&[ix], &[&key]).is_err());
    assert_eq!(m.env.balance(&owner_spy), 1_000);
    assert_eq!(m.env.balance(&thief_spy), 0);

    let honest = m.honest_route(&leg, min_out);
    let ix = m.execute_owner_ix(&leg, &call, 50, &honest);
    m.env.send(&[ix], &[&key]).unwrap();
}
