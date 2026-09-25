use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use paycheck_router::{
    error::RouterError,
    events::SwapSide,
    guard::{self, SellInputs},
    instructions::GuardedSwapParams,
};
use solana_signer::Signer;

use crate::{common::*, market::*};

fn nvda_e9() -> u64 {
    (NVDA_USD * 1e9) as u64
}

fn swap_ix(m: &Market, params: GuardedSwapParams, call: &Call, route: &Route) -> Instruction {
    let mint = m.nvda;
    let mut accounts = paycheck_router::accounts::SwapGuarded {
        owner: m.owner(),
        config: config_pda(),
        router: m.router(),
        asset: asset_pda(&mint),
        authority: m.authority(),
        pay_in: m.worker.pay_in,
        authority_usdc: m.authority_usdc(),
        owner_asset: call.destination.unwrap_or(m.destination(&mint)),
        authority_asset: ata(&m.authority(), &mint, &TOKEN_2022_PROGRAM),
        treasury: m.env.treasury,
        usdc_mint: m.env.usdc_mint,
        asset_mint: mint,
        price_update: call.price.or(Some(m.nvda_price)),
        price_update_247: call.price_247,
        instructions_sysvar: None,
        usdc_price_update: call.usdc_price.unwrap_or(m.usdc_price),
        jupiter_program: call.swap_program.unwrap_or(test_swap::ID),
        usdc_token_program: TOKEN_PROGRAM,
        asset_token_program: TOKEN_2022_PROGRAM,
        owner_intermediate: call.intermediate.map(|(account, _)| account),
        intermediate_mint: call.intermediate.map(|(_, mint)| mint),
    }
    .to_account_metas(None);
    accounts.extend(route.accounts.iter().cloned());
    Instruction {
        program_id: paycheck_router::ID,
        accounts,
        data: paycheck_router::instruction::SwapGuarded {
            params,
            swap_data: route.data(),
        }
        .data(),
    }
}

fn setup() -> Market {
    let mut m = market();
    let authority = m.authority();
    let nvda = m.nvda;
    m.env.create_ata(&authority, &nvda, TOKEN_2022_PROGRAM);
    let usdc_mint = m.env.usdc_mint;
    let vault_usdc = m.env.create_ata(&vault(), &usdc_mint, TOKEN_PROGRAM);
    m.env.mint_to(&usdc_mint, &vault_usdc, 1_000_000 * ONE_USDC);
    m
}

fn buy(amount_in: u64, band_bps: u16) -> GuardedSwapParams {
    GuardedSwapParams {
        side: SwapSide::Buy,
        amount_in,
        band_bps,
    }
}

fn sell(amount_in: u64, band_bps: u16) -> GuardedSwapParams {
    GuardedSwapParams {
        side: SwapSide::Sell,
        amount_in,
        band_bps,
    }
}

fn buy_route(m: &Market, amount_in: u64, out: u64) -> Route {
    let swapped = amount_in - m.fee(amount_in);
    let nvda = m.nvda;
    Route::new()
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
            m.destination(&nvda),
            vault(),
            out,
        )
}

fn sell_route(m: &Market, shares: u64, usdc_out: u64) -> Route {
    let nvda = m.nvda;
    Route::new()
        .transfer(
            (TOKEN_2022_PROGRAM, nvda, 8),
            ata(&m.authority(), &nvda, &TOKEN_2022_PROGRAM),
            m.vault_account(&nvda),
            m.authority(),
            shares,
        )
        .transfer(
            (TOKEN_PROGRAM, m.env.usdc_mint, 6),
            ata(&vault(), &m.env.usdc_mint, &TOKEN_PROGRAM),
            m.worker.pay_in,
            vault(),
            usdc_out,
        )
}

fn buy_min(m: &Market, amount_in: u64, band_bps: u16) -> u64 {
    let leg = Leg {
        index: 0,
        mint: m.nvda,
        amount_in,
        decimals: 8,
    };
    m.min_out(&leg, nvda_e9(), band_bps, 1.0)
}

#[test]
fn swap_guarded_buy_charges_fee_and_delivers_to_owner() {
    let mut m = setup();
    let key = m.worker.key.insecure_clone();
    let amount_in = 100 * ONE_USDC;
    let min_out = buy_min(&m, amount_in, 100);
    let pay_in = m.env.balance(&m.worker.pay_in);
    let treasury = m.env.balance(&m.env.treasury);
    let watermark = m.env.router(&m.owner()).watermark;

    let short = buy_route(&m, amount_in, min_out - 1);
    let ix = swap_ix(&m, buy(amount_in, 100), &Call::default(), &short);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::OutputBelowMinimum);

    let route = buy_route(&m, amount_in, min_out);
    let ix = swap_ix(&m, buy(amount_in, 100), &Call::default(), &route);
    m.env.send(&[ix], &[&key]).unwrap();
    assert_eq!(m.env.balance(&m.worker.pay_in), pay_in - amount_in);
    assert_eq!(m.env.balance(&m.env.treasury), treasury + m.fee(amount_in));
    assert_eq!(m.env.balance(&m.destination(&m.nvda)), min_out);
    assert_eq!(m.env.router(&m.owner()).watermark, watermark - amount_in);
    assert_eq!(m.env.balance(&m.authority_usdc()), 0);
}

#[test]
fn swap_guarded_sell_guards_usdc_and_raises_the_watermark() {
    let mut m = setup();
    let key = m.worker.key.insecure_clone();
    let nvda = m.nvda;
    let owner_nvda = m.destination(&nvda);
    m.env.mint_to(&nvda, &owner_nvda, 100_000_000);
    let shares = 100_000_000;
    let min_usdc = guard::min_usdc_sell(&SellInputs {
        amount_in: shares,
        usdc_price_e9: 1_000_000_000,
        price_e9: nvda_e9(),
        band_bps: 100,
        multiplier_e12: 1_000_000_000_000,
        decimals: 8,
    })
    .unwrap();
    assert_eq!(min_usdc, 178_200_000);

    let short = sell_route(&m, shares, min_usdc - 1);
    let ix = swap_ix(&m, sell(shares, 100), &Call::default(), &short);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::OutputBelowMinimum);

    let pay_in = m.env.balance(&m.worker.pay_in);
    let treasury = m.env.balance(&m.env.treasury);
    let watermark = m.env.router(&m.owner()).watermark;
    let gross = min_usdc + 500_000;
    let fee = gross * 20 / 10_000;
    let route = sell_route(&m, shares, gross);
    let ix = swap_ix(&m, sell(shares, 100), &Call::default(), &route);
    m.env.send(&[ix], &[&key]).unwrap();
    assert_eq!(m.env.balance(&owner_nvda), 0);
    assert_eq!(m.env.balance(&m.worker.pay_in), pay_in + gross - fee);
    assert_eq!(m.env.balance(&m.env.treasury), treasury + fee);
    assert_eq!(m.env.router(&m.owner()).watermark, watermark + gross - fee);
    assert_eq!(
        m.env
            .balance(&ata(&m.authority(), &nvda, &TOKEN_2022_PROGRAM)),
        0
    );

    let owner = m.owner();
    assert_router_error(m.env.record(&owner), RouterError::NoNewInflow);
}

#[test]
fn swap_guarded_rejects_wide_band_other_signers_and_pauses() {
    let mut m = setup();
    let key = m.worker.key.insecure_clone();
    let crank = m.env.crank.insecure_clone();
    let amount_in = 10 * ONE_USDC;
    let route = buy_route(&m, amount_in, buy_min(&m, amount_in, 1_000));

    let ix = swap_ix(&m, buy(amount_in, 1_001), &Call::default(), &route);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::BandTooWide);

    let mut ix = swap_ix(&m, buy(amount_in, 1_000), &Call::default(), &route);
    ix.accounts[0].pubkey = crank.pubkey();
    assert!(m.env.send(&[ix], &[&crank]).is_err());

    let owner = m.owner();
    let ix = m.env.set_router_paused_ix(&owner, true);
    m.env.send(&[ix], &[&key]).unwrap();
    let ix = swap_ix(&m, buy(amount_in, 1_000), &Call::default(), &route);
    assert_router_error(m.env.send(&[ix], &[&key]), RouterError::RouterPaused);
    let ix = m.env.set_router_paused_ix(&owner, false);
    m.env.send(&[ix], &[&key]).unwrap();

    let call = Call {
        swap_program: Some(Pubkey::new_unique()),
        ..Call::default()
    };
    let ix = swap_ix(&m, buy(amount_in, 1_000), &call, &route);
    assert_router_error(
        m.env.send(&[ix], &[&key]),
        RouterError::JupiterProgramMismatch,
    );

    let ix = swap_ix(&m, buy(amount_in, 1_000), &Call::default(), &route);
    m.env.send(&[ix], &[&key]).unwrap();
}

#[test]
fn owner_signature_is_never_lent_to_the_route() {
    let mut m = setup();
    let key = m.worker.key.insecure_clone();
    let spy = m.spy;
    let owner_spy = m.destination(&spy);
    m.env.mint_to(&spy, &owner_spy, 1_000);
    let thief = solana_keypair::Keypair::new().pubkey();
    let thief_spy = m.env.create_ata(&thief, &spy, TOKEN_2022_PROGRAM);
    let amount_in = 10 * ONE_USDC;
    let min_out = buy_min(&m, amount_in, 100);
    let draining = buy_route(&m, amount_in, min_out).transfer(
        (TOKEN_2022_PROGRAM, spy, 8),
        owner_spy,
        thief_spy,
        m.owner(),
        1_000,
    );
    let ix = swap_ix(&m, buy(amount_in, 100), &Call::default(), &draining);
    assert!(m.env.send(&[ix], &[&key]).is_err());
    assert_eq!(m.env.balance(&owner_spy), 1_000);
    assert_eq!(m.env.balance(&thief_spy), 0);

    let honest = buy_route(&m, amount_in, min_out);
    let ix = swap_ix(&m, buy(amount_in, 100), &Call::default(), &honest);
    m.env.send(&[ix], &[&key]).unwrap();
}
