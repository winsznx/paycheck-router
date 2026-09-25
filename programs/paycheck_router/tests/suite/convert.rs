use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use paycheck_router::{
    error::RouterError,
    guard::{self, ConvertInputs},
    instructions::AssetStatusParams,
    state::AssetStatus,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

use crate::{common::*, market::*};

const HOLDING: u64 = 2_000_000_000;
const CONVERTED: u64 = 1_000_000_000;

struct Conversion {
    m: Market,
    deadline: i64,
}

impl Conversion {
    fn convert_authority(&self) -> Pubkey {
        convert_pda(&self.m.router(), &self.m.pre)
    }

    fn convert_source(&self) -> Pubkey {
        ata(&self.convert_authority(), &self.m.pre, &TOKEN_2022_PROGRAM)
    }

    fn owner_source(&self) -> Pubkey {
        self.m.destination(&self.m.pre)
    }

    fn min_target(&self, amount: u64) -> u64 {
        guard::min_target_convert(&ConvertInputs {
            amount_in: amount,
            multiplier_pre_e12: 1_000_000_000_000,
            decimals_pre: 9,
            ratio_num: 5,
            ratio_den: 1,
            band_bps: 300,
            multiplier_target_e12: 1_000_000_000_000,
            decimals_target: 8,
        })
        .unwrap()
    }

    fn route(&self, amount: u64, out: u64) -> Route {
        let (pre, nvda) = (self.m.pre, self.m.nvda);
        Route::new()
            .transfer(
                (TOKEN_2022_PROGRAM, pre, 9),
                self.convert_source(),
                self.m.vault_account(&pre),
                self.convert_authority(),
                amount,
            )
            .transfer(
                (TOKEN_2022_PROGRAM, nvda, 8),
                self.m.vault_account(&nvda),
                self.m.destination(&nvda),
                vault(),
                out,
            )
    }

    fn ix(&self, caller: Pubkey, destination: Pubkey, amount: u64, route: &Route) -> Instruction {
        self.ix_with_source(caller, self.owner_source(), destination, amount, route)
    }

    fn ix_with_source(
        &self,
        caller: Pubkey,
        owner_source: Pubkey,
        destination: Pubkey,
        amount: u64,
        route: &Route,
    ) -> Instruction {
        let mut accounts = paycheck_router::accounts::ConvertHolding {
            caller,
            config: config_pda(),
            router: self.m.router(),
            asset: asset_pda(&self.m.pre),
            convert_authority: self.convert_authority(),
            owner_source,
            convert_source: self.convert_source(),
            destination,
            asset_mint: self.m.pre,
            target_mint: self.m.nvda,
            jupiter_program: test_swap::ID,
            asset_token_program: TOKEN_2022_PROGRAM,
            target_token_program: TOKEN_2022_PROGRAM,
            owner_intermediate: None,
            intermediate_mint: None,
        }
        .to_account_metas(None);
        accounts.extend(route.accounts.iter().cloned());
        Instruction {
            program_id: paycheck_router::ID,
            accounts,
            data: paycheck_router::instruction::ConvertHolding {
                amount,
                swap_data: route.data(),
            }
            .data(),
        }
    }

    fn as_owner(&mut self, ix: Instruction) -> TxResult {
        let key = self.m.worker.key.insecure_clone();
        self.m.env.send(&[ix], &[&key])
    }
}

fn set_status(env: &mut Env, mint: &Pubkey, params: AssetStatusParams) {
    let admin = env.admin.insecure_clone();
    let ix = Instruction {
        program_id: paycheck_router::ID,
        accounts: paycheck_router::accounts::SetAssetStatus {
            admin: admin.pubkey(),
            config: config_pda(),
            asset: asset_pda(mint),
        }
        .to_account_metas(None),
        data: paycheck_router::instruction::SetAssetStatus { params }.data(),
    };
    env.send(&[ix], &[&admin]).unwrap();
}

fn converting(m: &Market, deadline: i64) -> AssetStatusParams {
    AssetStatusParams {
        status: AssetStatus::Converting as u8,
        conversion_target: m.nvda,
        conversion_ratio_num: 5,
        conversion_ratio_den: 1,
        conversion_deadline: deadline,
    }
}

fn setup() -> Conversion {
    let mut m = market();
    let deadline = m.env.now() + 86_400;
    let params = converting(&m, deadline);
    let pre = m.pre;
    set_status(&mut m.env, &pre, params);
    let owner_pre = m.destination(&pre);
    m.env.mint_to(&pre, &owner_pre, HOLDING);
    let convert_authority = convert_pda(&m.router(), &pre);
    let key = m.worker.key.insecure_clone();
    m.env
        .approve(&key, &owner_pre, &convert_authority, u64::MAX);
    m.env
        .create_ata(&convert_authority, &pre, TOKEN_2022_PROGRAM);
    Conversion { m, deadline }
}

#[test]
fn convert_holding_swaps_into_the_target_at_the_ratio() {
    let mut c = setup();
    let min_out = c.min_target(CONVERTED);
    assert_eq!(min_out, 485_000_000);
    let owner = c.m.owner();
    let nvda_account = c.m.destination(&c.m.nvda);

    let short = c.route(CONVERTED, min_out - 1);
    let ix = c.ix(owner, nvda_account, CONVERTED, &short);
    assert_router_error(c.as_owner(ix), RouterError::OutputBelowMinimum);

    let route = c.route(CONVERTED, min_out);
    let ix = c.ix(owner, nvda_account, CONVERTED, &route);
    c.as_owner(ix).unwrap();
    assert_eq!(c.m.env.balance(&c.owner_source()), HOLDING - CONVERTED);
    assert_eq!(c.m.env.balance(&nvda_account), min_out);
    assert_eq!(c.m.env.balance(&c.convert_source()), 0);
}

#[test]
fn convert_holding_needs_owner_unless_auto_convert() {
    let mut c = setup();
    let stranger = Keypair::new();
    c.m.env.fund(&stranger.pubkey());
    let nvda_account = c.m.destination(&c.m.nvda);
    let route = c.route(CONVERTED, c.min_target(CONVERTED));
    let ix = c.ix(stranger.pubkey(), nvda_account, CONVERTED, &route);
    assert_router_error(c.m.env.send(&[ix], &[&stranger]), RouterError::Unauthorized);

    let legs = vec![Env::leg(c.m.nvda, 7_000, 50), Env::leg(c.m.spy, 3_000, 50)];
    let mut params = c.m.env.router_params(legs);
    params.auto_convert = true;
    let owner = c.m.owner();
    let ix = c.m.env.update_router_ix(&owner, params);
    c.as_owner(ix).unwrap();
    let ix = c.ix(stranger.pubkey(), nvda_account, CONVERTED, &route);
    c.m.env.send(&[ix], &[&stranger]).unwrap();
}

#[test]
fn convert_holding_requires_an_open_conversion() {
    let mut c = setup();
    let owner = c.m.owner();
    let nvda_account = c.m.destination(&c.m.nvda);
    let route = c.route(CONVERTED, c.min_target(CONVERTED));

    c.m.env.set_time(c.deadline);
    let ix = c.ix(owner, nvda_account, CONVERTED, &route);
    assert_router_error(c.as_owner(ix), RouterError::ConversionDeadlinePassed);

    c.m.env.set_time(START_TIME);
    let pre = c.m.pre;
    set_status(
        &mut c.m.env,
        &pre,
        AssetStatusParams {
            status: AssetStatus::Active as u8,
            conversion_target: Pubkey::default(),
            conversion_ratio_num: 0,
            conversion_ratio_den: 0,
            conversion_deadline: 0,
        },
    );
    let ix = c.ix(owner, nvda_account, CONVERTED, &route);
    assert_router_error(c.as_owner(ix), RouterError::ConversionNotActive);
}

#[test]
fn invariant_12_convert_authority_moves_only_its_token_into_the_target() {
    let mut c = setup();
    let owner = c.m.owner();
    let min_out = c.min_target(CONVERTED);
    let route = c.route(CONVERTED, min_out);

    let spy_account = c.m.destination(&c.m.spy);
    let ix = c.ix(owner, spy_account, CONVERTED, &route);
    assert_router_error(c.as_owner(ix), RouterError::DestinationMintMismatch);

    let thief = Keypair::new().pubkey();
    let nvda = c.m.nvda;
    let thief_account = c.m.env.create_ata(&thief, &nvda, TOKEN_2022_PROGRAM);
    let ix = c.ix(owner, thief_account, CONVERTED, &route);
    assert_router_error(c.as_owner(ix), RouterError::DestinationOwnerMismatch);

    // The owner's SPY account delegated to this Convert authority is still
    // out of reach: the authority is bound to the pre-IPO mint.
    let key = c.m.worker.key.insecure_clone();
    let convert_authority = c.convert_authority();
    let spy = c.m.spy;
    c.m.env.mint_to(&spy, &spy_account, 1_000);
    c.m.env
        .approve(&key, &spy_account, &convert_authority, u64::MAX);
    let nvda_account = c.m.destination(&nvda);
    let ix = c.ix_with_source(owner, spy_account, nvda_account, 1_000, &route);
    assert_router_error(c.as_owner(ix), RouterError::InvalidParameter);

    // A route that uses the authority's allowance to take more pre-IPO
    // tokens than the conversion amount is refused.
    let pre = c.m.pre;
    let greedy = c.route(CONVERTED, min_out).transfer(
        (TOKEN_2022_PROGRAM, pre, 9),
        c.owner_source(),
        c.m.vault_account(&pre),
        convert_authority,
        1,
    );
    let ix = c.ix(owner, nvda_account, CONVERTED, &greedy);
    assert_router_error(c.as_owner(ix), RouterError::InputOverspent);

    // Leaving any other token with the Convert authority is refused too.
    let convert_spy =
        c.m.env
            .create_ata(&convert_authority, &spy, TOKEN_2022_PROGRAM);
    let stray = c.route(CONVERTED, min_out).transfer(
        (TOKEN_2022_PROGRAM, spy, 8),
        c.m.vault_account(&spy),
        convert_spy,
        vault(),
        1,
    );
    let ix = c.ix(owner, nvda_account, CONVERTED, &stray);
    assert_router_error(c.as_owner(ix), RouterError::InputOverspent);

    assert_eq!(c.m.env.balance(&c.owner_source()), HOLDING);
    let ix = c.ix(owner, nvda_account, CONVERTED, &route);
    c.as_owner(ix).unwrap();
    assert_eq!(c.m.env.balance(&c.owner_source()), HOLDING - CONVERTED);
}

#[test]
fn convert_holding_checks_the_owner_allowance() {
    let mut c = setup();
    let owner = c.m.owner();
    let key = c.m.worker.key.insecure_clone();
    let nvda_account = c.m.destination(&c.m.nvda);
    let route = c.route(CONVERTED, c.min_target(CONVERTED));
    let owner_source = c.owner_source();

    c.m.env
        .approve(&key, &owner_source, &Pubkey::new_unique(), u64::MAX);
    let ix = c.ix(owner, nvda_account, CONVERTED, &route);
    assert_router_error(c.as_owner(ix), RouterError::DelegateMismatch);

    let convert_authority = c.convert_authority();
    c.m.env
        .approve(&key, &owner_source, &convert_authority, CONVERTED - 1);
    let ix = c.ix(owner, nvda_account, CONVERTED, &route);
    assert_router_error(c.as_owner(ix), RouterError::AllowanceInsufficient);

    c.m.env
        .approve(&key, &owner_source, &convert_authority, u64::MAX);
    let ix = c.ix(owner, nvda_account, HOLDING + 1, &route);
    assert_router_error(c.as_owner(ix), RouterError::BalanceInsufficient);
}
