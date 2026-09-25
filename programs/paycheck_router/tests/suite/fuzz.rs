//! Property-based fuzzing of the instruction handlers under LiteSVM, standing
//! in for Trident (see the PR notes for why Trident 0.12 cannot host an
//! anchor-lang 1.0.2 program). Every case builds a fresh bank, drives real
//! instructions with random inputs and checks the section 6.9 invariants.

use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use paycheck_router::{
    guard::{self, BuyInputs, SellInputs},
    instructions::ConfigUpdate,
    state::LegStatus,
};
use proptest::prelude::*;
use solana_signer::Signer;

use crate::{
    common::*,
    fixtures::{self, PriceSpec},
    market::*,
};

const MULTIPLIERS: [f64; 4] = [1.0, 0.95, 1.000_918_075_849_099_6, 1.486_134_7];

fn set_fee(env: &mut Env, fee_bps: u16) {
    let admin = env.admin.insecure_clone();
    let ix = Instruction {
        program_id: paycheck_router::ID,
        accounts: paycheck_router::accounts::UpdateConfig {
            admin: admin.pubkey(),
            config: config_pda(),
            treasury: None,
        }
        .to_account_metas(None),
        data: paycheck_router::instruction::UpdateConfig {
            update: ConfigUpdate {
                fee_bps: Some(fee_bps),
                ..ConfigUpdate::default()
            },
        }
        .data(),
    };
    env.send(&[ix], &[&admin]).unwrap();
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// Random prices, multipliers, fees and route behaviour. A leg executes
    /// exactly when the route delivers at least min_out and pulls nothing
    /// extra; either way the authority ends empty and the owner loses at
    /// most the leg.
    #[test]
    fn fuzz_execute_leg(
        fee_bps in 0u16..=50,
        price_cents in 1_000u64..=500_000,
        multiplier_index in 0usize..MULTIPLIERS.len(),
        out_offset in -2_000i64..=2_000,
        dust in 0u64..=50,
        extra_pull in prop_oneof![Just(0u64), 1u64..=1_000],
    ) {
        let mut m = market();
        set_fee(&mut m.env, fee_bps);
        let multiplier = MULTIPLIERS[multiplier_index];
        let nvda = m.nvda;
        m.env.set_scaled_multiplier(&nvda, multiplier, multiplier, i64::MAX);
        let usd = price_cents as f64 / 100.0;
        let now = m.env.now();
        m.nvda_price = m.post(PriceSpec::equity(NVDA_FEED, usd, now));

        let leg = m.leg(0);
        let price_e9 = price_cents * 10_000_000;
        let min_out = m.min_out(&leg, price_e9, 50, multiplier);
        let out = (min_out as i64 + out_offset).max(0) as u64;
        let swapped = leg.amount_in - m.fee(leg.amount_in);
        let mut route = Route::new()
            .transfer((TOKEN_PROGRAM, m.env.usdc_mint, 6), m.authority_usdc(), m.sink, m.authority(), swapped - dust)
            .transfer((TOKEN_2022_PROGRAM, nvda, 8), m.vault_account(&nvda), m.destination(&nvda), vault(), out);
        if extra_pull > 0 {
            route = route.transfer((TOKEN_PROGRAM, m.env.usdc_mint, 6), m.worker.pay_in, m.sink, m.authority(), extra_pull);
        }

        let pay_in = m.env.balance(&m.worker.pay_in);
        let treasury = m.env.balance(&m.env.treasury);
        let result = m.execute(&leg, &route);
        let should_pass = out >= min_out && min_out > 0 && extra_pull == 0;
        prop_assert_eq!(result.is_ok(), should_pass, "min_out {} out {} extra {}", min_out, out, extra_pull);
        prop_assert_eq!(m.env.balance(&m.authority_usdc()), 0);

        let state = m.env.paycheck(&m.router(), 0).legs[0];
        if should_pass {
            prop_assert_eq!(pay_in - m.env.balance(&m.worker.pay_in), leg.amount_in - dust);
            prop_assert_eq!(m.env.balance(&m.destination(&nvda)), out);
            let fee = m.env.balance(&m.env.treasury) - treasury;
            prop_assert!(u128::from(fee) * 10_000 <= u128::from(leg.amount_in) * 50);
            prop_assert_eq!(state.status, LegStatus::Executed as u8);
        } else {
            prop_assert_eq!(m.env.balance(&m.worker.pay_in), pay_in);
            prop_assert_eq!(m.env.balance(&m.env.treasury), treasury);
            prop_assert_eq!(state.status, LegStatus::Pending as u8);
        }
    }

    /// Random sequences of pay, spending, record, skip and sync. Every
    /// paycheck stays inside the invest share, and the watermark never lets
    /// the same USDC become two paychecks.
    #[test]
    fn fuzz_inflow_sequences(ops in proptest::collection::vec((0u8..5, 1u64..=5_000_000_000), 1..24)) {
        let mut env = Env::new();
        let nvda = env.add_listed_asset(NVDA_FEED, [0u8; 32]);
        let worker = Worker::new(&mut env, 0);
        worker.setup(&mut env, vec![Env::leg(nvda, 10_000, 50)]);
        let owner = worker.pubkey();
        let sink_owner = Pubkey::new_unique();
        let usdc_mint = env.usdc_mint;
        let sink = env.create_ata(&sink_owner, &usdc_mint, TOKEN_PROGRAM);
        let recorder = env.recorder.insecure_clone();
        let mut recorded_total: u128 = 0;
        let mut received_total: u128 = 0;
        for (op, amount) in ops {
            match op {
                0 => {
                    worker.receive_pay(&mut env, amount);
                    received_total += u128::from(amount);
                }
                1 => {
                    let balance = env.balance(&worker.pay_in);
                    if balance > 0 {
                        env.spend(&worker.key, &worker.pay_in, &sink, amount % balance + 1);
                    }
                }
                2 => {
                    let before = env.router(&owner);
                    let balance = env.balance(&worker.pay_in);
                    let result = env.record(&owner);
                    let expected_inflow = balance.saturating_sub(before.watermark);
                    let should_pass = expected_inflow >= before.min_inflow;
                    prop_assert_eq!(result.is_ok(), should_pass);
                    if should_pass {
                        let paycheck = env.paycheck(&worker.router(), before.paycheck_seq);
                        prop_assert_eq!(paycheck.inflow, expected_inflow);
                        let legs: u128 = paycheck.legs.iter().map(|leg| u128::from(leg.amount_in)).sum();
                        prop_assert!(legs * 10_000 <= u128::from(paycheck.inflow) * u128::from(before.invest_bps));
                        recorded_total += u128::from(paycheck.inflow);
                    }
                }
                3 => {
                    let ix = env.skip_ix(&recorder.pubkey(), &owner);
                    env.send(&[ix], &[&recorder]).unwrap();
                }
                _ => {
                    let crank = env.crank.insecure_clone();
                    let ix = env.sync_ix(&owner);
                    env.send(&[ix], &[&crank]).unwrap();
                }
            }
            prop_assert!(recorded_total <= received_total);
        }
    }

    /// Flipping any byte of the Ed25519 sigverify instruction either fails
    /// the transaction or leaves the attestation unchanged (the padding byte).
    #[test]
    fn fuzz_attestation_instruction_bytes(index in 0usize..160, xor in 1u8..=255) {
        let mut m = market();
        let leg = m.leg(2);
        let attester = m.env.attester.insecure_clone();
        let attestation = m.attestation(m.pre, PRE_USD);
        let mut verify = fixtures::ed25519_instruction(&attester, &fixtures::attestation_message(&attestation));
        let index = index % verify.data.len();
        verify.data[index] ^= xor;
        let min_out = m.min_out(&leg, (PRE_USD * 1e9) as u64, 300, 1.0);
        let route = m.honest_route(&leg, min_out);
        let ix = m.execute_prestock_ix(&leg, &Call::default(), &route);
        let crank = m.env.crank.insecure_clone();
        let result = m.env.send(&[verify, ix], &[&crank]);
        prop_assert!(result.is_err() || index == 1, "mutation at {} passed", index);
    }

    /// No input makes the guard panic, a wider band never raises a minimum,
    /// and buying then selling at the same reference never creates value.
    #[test]
    fn fuzz_guard_math(
        usdc_in in 0u64..=10_000_000_000_000,
        usdc_price_e9 in 990_000_000u64..=1_010_000_000,
        price_e9 in 1u64..=10_000_000_000_000,
        band in 0u16..=1_000,
        multiplier_index in 0usize..MULTIPLIERS.len(),
        decimals in 0u8..=12,
    ) {
        let multiplier_e12 = guard::multiplier_to_e12(MULTIPLIERS[multiplier_index]).unwrap();
        let buy = |band_bps| guard::min_out_buy(&BuyInputs { usdc_in, usdc_price_e9, price_e9, band_bps, multiplier_e12, decimals });
        if let (Some(tight), Some(wide)) = (buy(0), buy(band)) {
            prop_assert!(wide <= tight);
            let sold = guard::min_usdc_sell(&SellInputs { amount_in: tight, usdc_price_e9, price_e9, band_bps: 0, multiplier_e12, decimals });
            if let Some(sold) = sold {
                prop_assert!(sold <= usdc_in);
            }
        }
        let sell = |band_bps| guard::min_usdc_sell(&SellInputs { amount_in: usdc_in, usdc_price_e9, price_e9, band_bps, multiplier_e12, decimals });
        if let (Some(tight), Some(wide)) = (sell(0), sell(band)) {
            prop_assert!(wide <= tight);
        }
    }
}
