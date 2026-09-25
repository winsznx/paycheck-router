//! Routes that spend less than they were handed: an order-book hop can leave
//! USDC, or the middle token of a two-hop route, with the authority. The
//! leftovers go back to the owner and the authority ends empty.

use paycheck_router::{error::RouterError, state::LegStatus};
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::{common::*, fixtures, market::*};

/// Stands in for wrapped SOL between USDC and a PreStocks order book.
struct TwoHop {
    m: Market,
    mid: Pubkey,
    authority_mid: Pubkey,
    owner_mid: Pubkey,
}

fn two_hop() -> TwoHop {
    let mut m = market();
    let mid = m.env.create_mint(TOKEN_PROGRAM, 9, None);
    let vault_mid = m.env.create_ata(&vault(), &mid, TOKEN_PROGRAM);
    m.env.mint_to(&mid, &vault_mid, 1_000_000_000_000);
    let authority = m.authority();
    let authority_mid = m.env.create_ata(&authority, &mid, TOKEN_PROGRAM);
    let owner = m.owner();
    let owner_mid = m.env.create_ata(&owner, &mid, TOKEN_PROGRAM);
    TwoHop {
        m,
        mid,
        authority_mid,
        owner_mid,
    }
}

impl TwoHop {
    /// USDC to `mid` to the pre-IPO token, where the second hop spends
    /// `mid_bought - mid_left` and leaves `mid_left` with the authority.
    fn route(&self, leg: &Leg, mid_bought: u64, mid_left: u64, out: u64) -> Route {
        let m = &self.m;
        let swapped = leg.amount_in - m.fee(leg.amount_in);
        let vault_mid = ata(&vault(), &self.mid, &TOKEN_PROGRAM);
        Route::new()
            .transfer(
                (TOKEN_PROGRAM, m.env.usdc_mint, 6),
                m.authority_usdc(),
                m.sink,
                m.authority(),
                swapped,
            )
            .transfer(
                (TOKEN_PROGRAM, self.mid, 9),
                vault_mid,
                self.authority_mid,
                vault(),
                mid_bought,
            )
            .transfer(
                (TOKEN_PROGRAM, self.mid, 9),
                self.authority_mid,
                vault_mid,
                m.authority(),
                mid_bought - mid_left,
            )
            .transfer(
                (TOKEN_2022_PROGRAM, leg.mint, leg.decimals),
                m.vault_account(&leg.mint),
                m.destination(&leg.mint),
                vault(),
                out,
            )
    }

    fn execute(
        &mut self,
        leg: &Leg,
        route: &Route,
        intermediate: Option<(Pubkey, Pubkey)>,
    ) -> TxResult {
        let attester = self.m.env.attester.insecure_clone();
        let attestation = self.m.attestation(self.m.pre, PRE_USD);
        let verify =
            fixtures::ed25519_instruction(&attester, &fixtures::attestation_message(&attestation));
        let call = Call {
            intermediate,
            ..Call::default()
        };
        let ix = self.m.execute_prestock_ix(leg, &call, route);
        let crank = self.m.env.crank.insecure_clone();
        self.m.env.send(&[verify, ix], &[&crank])
    }
}

#[test]
fn route_spending_less_usdc_returns_the_dust_to_the_owner() {
    let mut m = market();
    let leg = m.leg(2);
    let min_out = m.min_out(&leg, (PRE_USD * 1e9) as u64, 300, 1.0);
    let swapped = leg.amount_in - m.fee(leg.amount_in);
    let dust = 1_234;
    let pre = m.pre;
    let route = Route::new()
        .transfer(
            (TOKEN_PROGRAM, m.env.usdc_mint, 6),
            m.authority_usdc(),
            m.sink,
            m.authority(),
            swapped - dust,
        )
        .transfer(
            (TOKEN_2022_PROGRAM, pre, 9),
            m.vault_account(&pre),
            m.destination(&pre),
            vault(),
            min_out,
        );
    let pay_in = m.env.balance(&m.worker.pay_in);
    let watermark = m.env.router(&m.owner()).watermark;
    let attestation = m.attestation(pre, PRE_USD);
    m.execute_prestock(&leg, &attestation, &route).unwrap();

    assert_eq!(
        pay_in - m.env.balance(&m.worker.pay_in),
        leg.amount_in - dust
    );
    assert_eq!(m.env.balance(&m.authority_usdc()), 0);
    assert_eq!(
        m.env.router(&m.owner()).watermark,
        watermark - (leg.amount_in - dust)
    );
    let state = m.env.paycheck(&m.router(), 0).legs[2];
    assert_eq!(state.status, LegStatus::Executed as u8);
    assert_eq!(state.dust_returned, dust);
    assert_eq!(state.out_amount, min_out);
}

#[test]
fn intermediate_leftovers_go_to_the_owners_account() {
    let mut t = two_hop();
    let leg = t.m.leg(2);
    let min_out = t.m.min_out(&leg, (PRE_USD * 1e9) as u64, 300, 1.0);
    let left = 4_321;
    let route = t.route(&leg, 764_100_642, left, min_out);

    // Without somewhere owned by the owner to put them, leftovers of the
    // middle token fail the leg rather than stay with the authority.
    assert_router_error(t.execute(&leg, &route, None), RouterError::InputOverspent);

    let stranger = Keypair::new().pubkey();
    let stranger_mid = t.m.env.create_ata(&stranger, &t.mid.clone(), TOKEN_PROGRAM);
    assert_router_error(
        t.execute(&leg, &route, Some((stranger_mid, t.mid))),
        RouterError::DestinationOwnerMismatch,
    );
    let usdc_mint = t.m.env.usdc_mint;
    assert_router_error(
        t.execute(&leg, &route, Some((t.owner_mid, usdc_mint))),
        RouterError::DestinationMintMismatch,
    );

    let pay_in = t.m.env.balance(&t.m.worker.pay_in);
    t.execute(&leg, &route, Some((t.owner_mid, t.mid))).unwrap();
    assert_eq!(t.m.env.balance(&t.owner_mid), left);
    assert_eq!(t.m.env.balance(&t.authority_mid), 0);
    assert_eq!(t.m.env.balance(&t.m.authority_usdc()), 0);
    assert_eq!(pay_in - t.m.env.balance(&t.m.worker.pay_in), leg.amount_in);
    assert_eq!(t.m.env.balance(&t.m.destination(&t.m.pre)), min_out);
}

#[test]
fn a_fully_spent_two_hop_route_needs_no_intermediate_account() {
    let mut t = two_hop();
    let leg = t.m.leg(2);
    let min_out = t.m.min_out(&leg, (PRE_USD * 1e9) as u64, 300, 1.0);
    let route = t.route(&leg, 764_100_642, 0, min_out);
    t.execute(&leg, &route, None).unwrap();
    assert_eq!(t.m.env.balance(&t.authority_mid), 0);
}

#[test]
fn invariant_02_nothing_beyond_amount_in_leaves_the_owner_with_dust() {
    let mut m = market();
    let leg = m.leg(0);
    let min_out = m.min_out(&leg, (NVDA_USD * 1e9) as u64, 50, 1.0);
    let swapped = leg.amount_in - m.fee(leg.amount_in);
    let nvda = m.nvda;
    // Spends less than it was handed, but also pulls one base unit straight
    // from the owner through the delegate: still overspending.
    let route = Route::new()
        .transfer(
            (TOKEN_PROGRAM, m.env.usdc_mint, 6),
            m.authority_usdc(),
            m.sink,
            m.authority(),
            swapped - 10,
        )
        .transfer(
            (TOKEN_PROGRAM, m.env.usdc_mint, 6),
            m.worker.pay_in,
            m.sink,
            m.authority(),
            1,
        )
        .transfer(
            (TOKEN_2022_PROGRAM, nvda, 8),
            m.vault_account(&nvda),
            m.destination(&nvda),
            vault(),
            min_out,
        );
    let pay_in = m.env.balance(&m.worker.pay_in);
    assert_router_error(m.execute(&leg, &route), RouterError::InputOverspent);
    assert_eq!(m.env.balance(&m.worker.pay_in), pay_in);
}
