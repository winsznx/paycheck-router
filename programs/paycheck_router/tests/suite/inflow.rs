use anchor_lang::solana_program::instruction::Instruction;
use paycheck_router::{
    error::RouterError,
    instructions::allocate_legs,
    state::{LegConfig, LegStatus},
};
use proptest::prelude::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::common::*;

struct Setup {
    env: Env,
    worker: Worker,
    nvda: Pubkey,
    spy: Pubkey,
}

fn setup() -> Setup {
    let mut env = Env::new();
    let nvda = env.add_listed_asset(NVDA_FEED, NVDA_FEED_247);
    let spy = env.add_listed_asset(SPY_FEED, [0u8; 32]);
    let worker = Worker::new(&mut env, 0);
    worker.setup(
        &mut env,
        vec![Env::leg(nvda, 6_000, 50), Env::leg(spy, 4_000, 50)],
    );
    Setup {
        env,
        worker,
        nvda,
        spy,
    }
}

impl Setup {
    fn record(&mut self) -> TxResult {
        let worker = self.worker.pubkey();
        self.env.record(&worker)
    }

    fn send_as_worker(&mut self, ix: Instruction) -> TxResult {
        let key = self.worker.key.insecure_clone();
        self.env.send(&[ix], &[&key])
    }
}

#[test]
fn record_paycheck_splits_inflow_by_weight() {
    let mut s = setup();
    s.worker.receive_pay(&mut s.env, 1_000 * ONE_USDC);
    s.record().unwrap();

    let router_key = s.worker.router();
    let paycheck = s.env.paycheck(&router_key, 0);
    assert_eq!(paycheck.router, router_key);
    assert_eq!(paycheck.seq, 0);
    assert_eq!(paycheck.inflow, 1_000 * ONE_USDC);
    assert_eq!(paycheck.invest_total, 200 * ONE_USDC);
    assert_eq!(paycheck.detected_slot, 42);
    assert_eq!(paycheck.recorded_at, START_TIME);
    assert_eq!(paycheck.expires_at, START_TIME + 86_400);
    assert_eq!(paycheck.rent_payer, s.env.crank.pubkey());
    assert_eq!(paycheck.legs.len(), 2);
    assert_eq!(paycheck.legs[0].mint, s.nvda);
    assert_eq!(paycheck.legs[0].amount_in, 120 * ONE_USDC);
    assert_eq!(paycheck.legs[1].mint, s.spy);
    assert_eq!(paycheck.legs[1].amount_in, 80 * ONE_USDC);
    assert!(paycheck
        .legs
        .iter()
        .all(|leg| leg.status == LegStatus::Pending as u8));

    let router = s.env.router(&s.worker.pubkey());
    assert_eq!(router.watermark, 1_000 * ONE_USDC);
    assert_eq!(router.paycheck_seq, 1);
    assert_eq!(router.total_inflow, 1_000 * ONE_USDC);
    assert_eq!(router.pending_legs, 2);
    assert_eq!(router.day_spent, 200 * ONE_USDC);
    assert_eq!(s.env.balance(&s.worker.pay_in), 1_000 * ONE_USDC);
}

#[test]
fn record_paycheck_rejects_small_or_missing_inflow() {
    let mut s = setup();
    assert_router_error(s.record(), RouterError::NoNewInflow);
    s.worker.receive_pay(&mut s.env, 10 * ONE_USDC - 1);
    assert_router_error(s.record(), RouterError::InflowBelowMinimum);
    s.worker.receive_pay(&mut s.env, 1);
    s.record().unwrap();
}

#[test]
fn record_paycheck_applies_the_one_usdc_floor() {
    let mut s = setup();
    let worker = s.worker.pubkey();
    // Force a router minimum under the floor by writing the account directly.
    let router_key = s.worker.router();
    let mut account = s.env.svm.get_account(&router_key).unwrap();
    let mut router = s.env.router(&worker);
    router.min_inflow = 1;
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&router, &mut data).unwrap();
    account.data[..data.len()].copy_from_slice(&data);
    s.env.svm.set_account(router_key, account).unwrap();

    s.worker.receive_pay(&mut s.env, ONE_USDC - 1);
    assert_router_error(s.record(), RouterError::InflowBelowMinimum);
}

#[test]
fn only_the_recorder_records_unless_unset() {
    let mut s = setup();
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    let stranger = Keypair::new();
    s.env.fund(&stranger.pubkey());
    let ix = s
        .env
        .record_ix(&stranger.pubkey(), &stranger.pubkey(), &s.worker.pubkey());
    assert_router_error(
        s.env.send(&[ix], &[&stranger]),
        RouterError::UnauthorizedRecorder,
    );

    let mut params = s.env.router_params(vec![Env::leg(s.nvda, 10_000, 50)]);
    params.recorder = Pubkey::default();
    let ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    s.send_as_worker(ix).unwrap();
    let ix = s
        .env
        .record_ix(&stranger.pubkey(), &stranger.pubkey(), &s.worker.pubkey());
    s.env.send(&[ix], &[&stranger]).unwrap();
    let paycheck = s.env.paycheck(&s.worker.router(), 0);
    assert_eq!(paycheck.rent_payer, stranger.pubkey());
}

#[test]
fn invariant_06_legs_never_exceed_invest_share() {
    let mut s = setup();
    for amount in [10 * ONE_USDC, 333_333_333, 1_234_567_891, 17 * ONE_USDC + 1] {
        s.worker.receive_pay(&mut s.env, amount);
        s.record().unwrap();
        let seq = s.env.router(&s.worker.pubkey()).paycheck_seq - 1;
        let paycheck = s.env.paycheck(&s.worker.router(), seq);
        let total: u64 = paycheck.legs.iter().map(|leg| leg.amount_in).sum();
        assert_eq!(total, paycheck.invest_total);
        assert!(u128::from(total) * 10_000 <= u128::from(paycheck.inflow) * 2_000);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn invariant_06_allocation_property(
        weights in proptest::collection::vec(1u16..=10_000, 1..=8),
        invest_total in 0u64..=u64::MAX / 10_000,
        max_leg in 1u64..=u64::MAX / 10_000,
        disabled_mask in 0u8..=255,
    ) {
        let legs: Vec<LegConfig> = weights
            .iter()
            .enumerate()
            .map(|(index, weight)| LegConfig {
                mint: Pubkey::new_unique(),
                weight_bps: *weight,
                band_bps: 0,
                enabled: disabled_mask & (1 << index) == 0,
            })
            .collect();
        let weight_sum: u64 = legs.iter().filter(|l| l.enabled).map(|l| u64::from(l.weight_bps)).sum();
        prop_assume!(weight_sum <= 10_000);
        let allocation = allocate_legs(&legs, invest_total, max_leg).unwrap();
        let total: u128 = allocation.iter().map(|(_, amount)| u128::from(*amount)).sum();
        prop_assert!(total <= u128::from(invest_total));
        prop_assert!(allocation.iter().all(|(_, amount)| *amount <= max_leg));
    }
}

#[test]
fn max_leg_usdc_scales_the_whole_paycheck() {
    let mut s = setup();
    let mut params = s.env.router_params(vec![
        Env::leg(s.nvda, 6_000, 50),
        Env::leg(s.spy, 4_000, 50),
    ]);
    params.invest_bps = 10_000;
    params.daily_cap = 1_000_000 * ONE_USDC;
    let ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    s.send_as_worker(ix).unwrap();

    s.worker.receive_pay(&mut s.env, 20_000 * ONE_USDC);
    s.record().unwrap();
    let paycheck = s.env.paycheck(&s.worker.router(), 0);
    assert_eq!(paycheck.legs[0].amount_in, 5_000 * ONE_USDC);
    assert_eq!(
        paycheck.legs[1].amount_in,
        8_000 * ONE_USDC * 5_000 / 12_000
    );
    assert_eq!(
        paycheck.invest_total,
        paycheck.legs[0].amount_in + paycheck.legs[1].amount_in
    );
}

#[test]
fn daily_cap_limits_investment_per_utc_day() {
    let mut s = setup();
    let mut params = s.env.router_params(vec![Env::leg(s.nvda, 10_000, 50)]);
    params.invest_bps = 10_000;
    params.daily_cap = 150 * ONE_USDC;
    let ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    s.send_as_worker(ix).unwrap();

    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.record().unwrap();
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.record().unwrap();
    let router = s.worker.router();
    assert_eq!(s.env.paycheck(&router, 0).invest_total, 100 * ONE_USDC);
    assert_eq!(s.env.paycheck(&router, 1).invest_total, 50 * ONE_USDC);

    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.record().unwrap();
    let capped = s.env.paycheck(&router, 2);
    assert_eq!(capped.invest_total, 0);
    assert!(capped.legs.is_empty());
    assert_eq!(s.env.router(&s.worker.pubkey()).watermark, 300 * ONE_USDC);

    s.env.advance(86_400);
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.record().unwrap();
    assert_eq!(s.env.paycheck(&router, 3).invest_total, 100 * ONE_USDC);
}

#[test]
fn disabled_legs_keep_their_share_as_usdc() {
    let mut s = setup();
    let mut legs = vec![Env::leg(s.nvda, 6_000, 50), Env::leg(s.spy, 4_000, 50)];
    legs[1].enabled = false;
    let params = s.env.router_params(legs);
    let ix = s.env.update_router_ix(&s.worker.pubkey(), params);
    s.send_as_worker(ix).unwrap();
    s.worker.receive_pay(&mut s.env, 1_000 * ONE_USDC);
    s.record().unwrap();
    let paycheck = s.env.paycheck(&s.worker.router(), 0);
    assert_eq!(paycheck.legs.len(), 1);
    assert_eq!(paycheck.invest_total, 120 * ONE_USDC);
}

#[test]
fn invariant_08_paused_router_or_config_blocks_record() {
    let mut s = setup();
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);

    let ix = s.env.set_router_paused_ix(&s.worker.pubkey(), true);
    s.send_as_worker(ix).unwrap();
    assert_router_error(s.record(), RouterError::RouterPaused);
    let ix = s.env.set_router_paused_ix(&s.worker.pubkey(), false);
    s.send_as_worker(ix).unwrap();

    let guardian = s.env.guardian.insecure_clone();
    let ix = s.env.emergency_pause_ix(&guardian.pubkey());
    s.env.send(&[ix], &[&guardian]).unwrap();
    assert_router_error(s.record(), RouterError::ConfigPaused);

    let admin = s.env.admin.insecure_clone();
    let ix = s.env.set_global_pause_ix(&admin.pubkey(), false);
    s.env.send(&[ix], &[&admin]).unwrap();
    s.record().unwrap();
}

#[test]
fn skip_inflow_advances_watermark_without_paycheck() {
    let mut s = setup();
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    let stranger = Keypair::new();
    s.env.fund(&stranger.pubkey());
    let ix = s.env.skip_ix(&stranger.pubkey(), &s.worker.pubkey());
    assert_router_error(
        s.env.send(&[ix], &[&stranger]),
        RouterError::UnauthorizedRecorder,
    );

    let recorder = s.env.recorder.insecure_clone();
    let ix = s.env.skip_ix(&recorder.pubkey(), &s.worker.pubkey());
    s.env.send(&[ix], &[&recorder]).unwrap();
    let router = s.env.router(&s.worker.pubkey());
    assert_eq!(router.watermark, 100 * ONE_USDC);
    assert_eq!(router.paycheck_seq, 0);
    assert_router_error(s.record(), RouterError::NoNewInflow);

    s.worker.receive_pay(&mut s.env, 50 * ONE_USDC);
    let ix = s.env.skip_ix(&s.worker.pubkey(), &s.worker.pubkey());
    s.send_as_worker(ix).unwrap();
    assert_eq!(s.env.router(&s.worker.pubkey()).watermark, 150 * ONE_USDC);
}

#[test]
fn sync_watermark_follows_owner_spending_down_only() {
    let mut s = setup();
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.record().unwrap();
    let sink = Keypair::new().pubkey();
    let usdc_mint = s.env.usdc_mint;
    let sink_account = s.env.create_ata(&sink, &usdc_mint, TOKEN_PROGRAM);
    let key = s.worker.key.insecure_clone();
    let pay_in = s.worker.pay_in;
    s.env.spend(&key, &pay_in, &sink_account, 70 * ONE_USDC);

    let crank = s.env.crank.insecure_clone();
    let ix = s.env.sync_ix(&s.worker.pubkey());
    s.env.send(&[ix], &[&crank]).unwrap();
    assert_eq!(s.env.router(&s.worker.pubkey()).watermark, 30 * ONE_USDC);

    s.worker.receive_pay(&mut s.env, 500 * ONE_USDC);
    let ix = s.env.sync_ix(&s.worker.pubkey());
    s.env.send(&[ix], &[&crank]).unwrap();
    assert_eq!(s.env.router(&s.worker.pubkey()).watermark, 30 * ONE_USDC);
    s.record().unwrap();
    assert_eq!(s.env.paycheck(&s.worker.router(), 1).inflow, 500 * ONE_USDC);
}

#[test]
fn invariant_10_replaying_inflow_instructions_changes_nothing() {
    let mut s = setup();
    s.worker.receive_pay(&mut s.env, 100 * ONE_USDC);
    s.record().unwrap();
    let after_first = s.env.router(&s.worker.pubkey());

    let recorder = s.env.recorder.insecure_clone();
    let crank = s.env.crank.insecure_clone();
    let seq0 = paycheck_pda(&s.worker.router(), 0);
    let mut replay = s
        .env
        .record_ix(&recorder.pubkey(), &crank.pubkey(), &s.worker.pubkey());
    replay.accounts[5].pubkey = seq0;
    assert!(s.env.send(&[replay], &[&crank, &recorder]).is_err());
    assert_router_error(s.record(), RouterError::NoNewInflow);

    for _ in 0..2 {
        let ix = s.env.skip_ix(&recorder.pubkey(), &s.worker.pubkey());
        s.env.send(&[ix], &[&recorder]).unwrap();
        let ix = s.env.sync_ix(&s.worker.pubkey());
        s.env.send(&[ix], &[&crank]).unwrap();
    }
    let after_replays = s.env.router(&s.worker.pubkey());
    assert_eq!(after_replays.watermark, after_first.watermark);
    assert_eq!(after_replays.paycheck_seq, after_first.paycheck_seq);
    assert_eq!(after_replays.pending_legs, after_first.pending_legs);
    assert_eq!(after_replays.day_spent, after_first.day_spent);
}
