//! Mainnet mint snapshots (read from a Surfpool fork on Sep 25, 2026): NVDAx
//! and OpenAI PreStocks, with every extension the issuers set.

use anchor_lang::prelude::AccountInfo;
use base64::{engine::general_purpose::STANDARD, Engine};
use paycheck_router::pricing;
use serde_json::Value;
use solana_account::Account;
use solana_signer::Signer;

use crate::{
    common::*,
    market::{market_with, PRE_USD},
};

const NVDAX: &str = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const OPENAI: &str = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";

fn snapshot(address: &str) -> (Pubkey, Account) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(format!("{address}.json"));
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let account = &doc["account"];
    let data = STANDARD
        .decode(account["data"][0].as_str().unwrap())
        .unwrap();
    let owner: Pubkey = account["owner"].as_str().unwrap().parse().unwrap();
    (
        address.parse().unwrap(),
        Account {
            lamports: account["lamports"].as_u64().unwrap(),
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn multiplier_at(address: &str, now: i64) -> f64 {
    let (key, account) = snapshot(address);
    let mut lamports = account.lamports;
    let mut data = account.data.clone();
    let info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut data,
        &account.owner,
        false,
    );
    pricing::effective_multiplier(&info, now).unwrap()
}

#[test]
fn real_mints_register_as_assets() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    for (address, params, decimals) in [
        (NVDAX, Env::listed_params(NVDA_FEED, NVDA_FEED_247), 8),
        (OPENAI, Env::preipo_params(), 9),
    ] {
        let (key, account) = snapshot(address);
        assert_eq!(account.owner, TOKEN_2022_PROGRAM);
        env.svm.set_account(key, account).unwrap();
        let ix = env.upsert_asset_ix(&admin.pubkey(), &key, TOKEN_2022_PROGRAM, params);
        env.send(&[ix], &[&admin]).unwrap();
        let asset = env.asset(&key);
        assert_eq!(asset.decimals, decimals);
        assert_eq!(asset.token_program, TOKEN_2022_PROGRAM);
    }
}

#[test]
fn real_scaled_ui_multipliers_switch_at_their_timestamps() {
    let nvda_switch = 1_789_000_200;
    assert_eq!(
        multiplier_at(NVDAX, nvda_switch - 1),
        1.000_918_075_849_099_6
    );
    assert_eq!(multiplier_at(NVDAX, nvda_switch), 1.001_701_196_801_074);

    let openai_switch = 1_784_305_800;
    assert_eq!(multiplier_at(OPENAI, openai_switch - 1), 1.0);
    assert_eq!(multiplier_at(OPENAI, openai_switch), 1.486_134_7);
}

/// execute_prestock_leg against the real OpenAI PreStocks mint: Scaled UI
/// multiplier 1.4861347, a transfer fee withheld in the destination,
/// Pausable, PermanentDelegate and confidential-transfer extensions. Only the
/// mint authority is replaced so the test can fund the swap vault.
#[test]
fn prestock_leg_executes_on_the_real_openai_mint() {
    let mut m = market_with(|env| {
        let (key, mut account) = snapshot(OPENAI);
        account.data[..4].copy_from_slice(&1u32.to_le_bytes());
        account.data[4..36].copy_from_slice(env.mint_authority.pubkey().as_ref());
        env.svm.set_account(key, account).unwrap();
        let admin = env.admin.insecure_clone();
        let ix = env.upsert_asset_ix(
            &admin.pubkey(),
            &key,
            TOKEN_2022_PROGRAM,
            Env::preipo_params(),
        );
        env.send(&[ix], &[&admin]).unwrap();
        key
    });
    let leg = m.leg(2);
    assert_eq!(leg.decimals, 9);
    let mark = (PRE_USD * 1e9) as u64;
    let multiplier = multiplier_at(OPENAI, m.env.now());
    assert_eq!(multiplier, 1.486_134_7);
    let min_out = m.min_out(&leg, mark, 300, multiplier);
    let attestation = m.attestation(m.pre, PRE_USD);

    let route = m.honest_route(&leg, min_out);
    m.execute_prestock(&leg, &attestation, &route).unwrap();
    let state = m.env.paycheck(&m.router(), 0).legs[2];
    assert!(state.issuer_fee > 0);
    assert_eq!(state.out_amount + state.issuer_fee, min_out);
    assert_eq!(m.env.balance(&m.destination(&m.pre)), state.out_amount);
}
