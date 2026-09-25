//! A recorded paycheck with priced assets and a test swap vault, so execute
//! tests only describe what the route does.

use anchor_lang::{
    solana_program::instruction::{AccountMeta, Instruction},
    InstructionData, ToAccountMetas,
};
use paycheck_router::{
    events::MarkAttestation,
    guard::{self, BuyInputs},
};
use solana_keypair::Keypair;
use solana_signer::Signer;
use test_swap::TransferOp;

use crate::{
    common::*,
    fixtures::{self, PriceSpec},
};

pub const NVDA_USD: f64 = 180.0;
pub const SPY_USD: f64 = 600.0;
pub const PRE_USD: f64 = 1_000.0;
pub const PAY: u64 = 1_000 * ONE_USDC;

pub fn vault() -> Pubkey {
    Pubkey::find_program_address(&[test_swap::VAULT_SEED], &test_swap::ID).0
}

pub struct Market {
    pub env: Env,
    pub worker: Worker,
    pub nvda: Pubkey,
    pub spy: Pubkey,
    pub pre: Pubkey,
    pub sink: Pubkey,
    pub nvda_price: Pubkey,
    pub spy_price: Pubkey,
    pub usdc_price: Pubkey,
}

/// Paycheck 0 holds NVDA (leg 0, 60%), SPY (leg 1, 30%) and a pre-IPO
/// token (leg 2, 10%): 120, 60 and 20 USDC of a 1,000 USDC paycheck.
pub fn market() -> Market {
    market_with(|env| env.add_preipo_asset())
}

/// `add_pre` creates and registers the pre-IPO mint for leg 2.
pub fn market_with(add_pre: impl FnOnce(&mut Env) -> Pubkey) -> Market {
    let mut env = Env::new();
    let nvda = env.add_listed_asset(NVDA_FEED, NVDA_FEED_247);
    let spy = env.add_listed_asset(SPY_FEED, [0u8; 32]);
    let pre = add_pre(&mut env);
    let worker = Worker::new(&mut env, 0);
    worker.setup(
        &mut env,
        vec![
            Env::leg(nvda, 6_000, 50),
            Env::leg(spy, 3_000, 50),
            Env::leg(pre, 1_000, 300),
        ],
    );
    worker.receive_pay(&mut env, PAY);
    let owner = worker.pubkey();
    env.record(&owner).unwrap();

    for mint in [nvda, spy, pre] {
        let vault_account = env.create_ata(&vault(), &mint, TOKEN_2022_PROGRAM);
        env.mint_to(&mint, &vault_account, 1_000_000_000_000_000);
        env.create_ata(&owner, &mint, TOKEN_2022_PROGRAM);
    }
    let sink_owner = Pubkey::new_unique();
    let usdc_mint = env.usdc_mint;
    let sink = env.create_ata(&sink_owner, &usdc_mint, TOKEN_PROGRAM);

    let now = env.now();
    let nvda_price = fixtures::post_price(&mut env, &PriceSpec::equity(NVDA_FEED, NVDA_USD, now));
    let spy_price = fixtures::post_price(&mut env, &PriceSpec::equity(SPY_FEED, SPY_USD, now));
    let usdc_price = fixtures::post_price(&mut env, &PriceSpec::usdc(USDC_FEED, 1.0, now));
    Market {
        env,
        worker,
        nvda,
        spy,
        pre,
        sink,
        nvda_price,
        spy_price,
        usdc_price,
    }
}

/// A pre-IPO mint shaped like PreStocks: Token-2022, 9 decimals, a Scaled UI
/// multiplier and a transfer fee withheld in the recipient.
pub fn add_fee_preipo_asset(env: &mut Env, fee_bps: u16) -> Pubkey {
    use anchor_spl::token_2022::spl_token_2022::{
        self,
        extension::{scaled_ui_amount, transfer_fee, ExtensionType},
        state::Mint as MintState,
    };
    let payer = env.mint_authority.insecure_clone();
    let mint = Keypair::new();
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[
        ExtensionType::TransferFeeConfig,
        ExtensionType::ScaledUiAmount,
    ])
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
        transfer_fee::instruction::initialize_transfer_fee_config(
            &TOKEN_2022_PROGRAM,
            &mint.pubkey(),
            Some(&payer.pubkey()),
            Some(&payer.pubkey()),
            fee_bps,
            u64::MAX,
        )
        .unwrap(),
        scaled_ui_amount::instruction::initialize(
            &TOKEN_2022_PROGRAM,
            &mint.pubkey(),
            Some(payer.pubkey()),
            1.0,
        )
        .unwrap(),
        spl_token_2022::instruction::initialize_mint2(
            &TOKEN_2022_PROGRAM,
            &mint.pubkey(),
            &payer.pubkey(),
            None,
            9,
        )
        .unwrap(),
    ];
    env.send(&ixs, &[&payer, &mint]).unwrap();
    let admin = env.admin.insecure_clone();
    let ix = env.upsert_asset_ix(
        &admin.pubkey(),
        &mint.pubkey(),
        TOKEN_2022_PROGRAM,
        Env::preipo_params(),
    );
    env.send(&[ix], &[&admin]).unwrap();
    mint.pubkey()
}

/// Accounts and transfers the test swap program runs as the route.
#[derive(Clone)]
pub struct Route {
    pub accounts: Vec<AccountMeta>,
    pub ops: Vec<TransferOp>,
}

impl Route {
    pub fn new() -> Self {
        Self {
            accounts: Vec::new(),
            ops: Vec::new(),
        }
    }

    fn index(&mut self, key: Pubkey, writable: bool) -> u8 {
        if let Some(position) = self.accounts.iter().position(|meta| meta.pubkey == key) {
            if writable {
                self.accounts[position].is_writable = true;
            }
            return position as u8;
        }
        self.accounts.push(if writable {
            AccountMeta::new(key, false)
        } else {
            AccountMeta::new_readonly(key, false)
        });
        (self.accounts.len() - 1) as u8
    }

    /// A transfer signed by `authority`, which the program passes on as a
    /// signer (the router authority) or the test swap vault signs for.
    /// `token` is (token program, mint, decimals).
    pub fn transfer(
        mut self,
        token: (Pubkey, Pubkey, u8),
        from: Pubkey,
        to: Pubkey,
        authority: Pubkey,
        amount: u64,
    ) -> Self {
        let (token_program, mint, decimals) = token;
        let from_vault = authority == vault();
        let op = TransferOp {
            from_vault,
            token_program: self.index(token_program, false),
            from: self.index(from, true),
            mint: self.index(mint, false),
            to: self.index(to, true),
            authority: self.index(authority, false),
            amount,
            decimals,
        };
        self.ops.push(op);
        self
    }

    pub fn touch(mut self, key: Pubkey, writable: bool) -> Self {
        self.index(key, writable);
        self
    }

    pub fn data(&self) -> Vec<u8> {
        test_swap::instruction::Run {
            ops: self.ops.clone(),
        }
        .data()
    }
}

impl Default for Route {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Leg {
    pub index: u8,
    pub mint: Pubkey,
    pub amount_in: u64,
    pub decimals: u8,
}

impl Market {
    pub fn owner(&self) -> Pubkey {
        self.worker.pubkey()
    }

    pub fn router(&self) -> Pubkey {
        self.worker.router()
    }

    pub fn authority(&self) -> Pubkey {
        self.worker.authority()
    }

    pub fn authority_usdc(&self) -> Pubkey {
        ata(&self.authority(), &self.env.usdc_mint, &TOKEN_PROGRAM)
    }

    pub fn destination(&self, mint: &Pubkey) -> Pubkey {
        ata(&self.owner(), mint, &TOKEN_2022_PROGRAM)
    }

    pub fn vault_account(&self, mint: &Pubkey) -> Pubkey {
        ata(&vault(), mint, &TOKEN_2022_PROGRAM)
    }

    pub fn leg(&self, index: u8) -> Leg {
        let paycheck = self.env.paycheck(&self.router(), 0);
        let state = paycheck.legs[usize::from(index)];
        Leg {
            index,
            mint: state.mint,
            amount_in: state.amount_in,
            decimals: self.env.mint_decimals(&state.mint),
        }
    }

    pub fn fee(&self, amount_in: u64) -> u64 {
        amount_in * u64::from(self.env.config().fee_bps) / 10_000
    }

    /// Guard minimum for `leg` at `usd`, with USDC at 1.00.
    pub fn min_out(&self, leg: &Leg, usd_e9: u64, band_bps: u16, multiplier: f64) -> u64 {
        let swapped = leg.amount_in - self.fee(leg.amount_in);
        guard::min_out_buy(&BuyInputs {
            usdc_in: swapped,
            usdc_price_e9: 1_000_000_000,
            price_e9: usd_e9,
            band_bps,
            multiplier_e12: guard::multiplier_to_e12(multiplier).unwrap(),
            decimals: leg.decimals,
        })
        .unwrap()
    }

    /// The route an honest aggregator builds: take the swapped USDC from the
    /// authority's account, deliver `out` shares to the owner.
    pub fn honest_route(&self, leg: &Leg, out: u64) -> Route {
        let swapped = leg.amount_in - self.fee(leg.amount_in);
        Route::new()
            .transfer(
                (TOKEN_PROGRAM, self.env.usdc_mint, 6),
                self.authority_usdc(),
                self.sink,
                self.authority(),
                swapped,
            )
            .transfer(
                (TOKEN_2022_PROGRAM, leg.mint, leg.decimals),
                self.vault_account(&leg.mint),
                self.destination(&leg.mint),
                vault(),
                out,
            )
    }

    fn base_metas(&self, leg: &Leg, destination: Pubkey) -> ExecuteBase {
        ExecuteBase {
            config: config_pda(),
            router: self.router(),
            paycheck: paycheck_pda(&self.router(), 0),
            asset: asset_pda(&leg.mint),
            authority: self.authority(),
            pay_in: self.worker.pay_in,
            authority_usdc: self.authority_usdc(),
            treasury: self.env.treasury,
            usdc_mint: self.env.usdc_mint,
            destination,
            asset_mint: leg.mint,
        }
    }

    pub fn execute_ix(&self, leg: &Leg, call: &Call, route: &Route) -> Instruction {
        let base = self.base_metas(leg, call.destination.unwrap_or(self.destination(&leg.mint)));
        let mut accounts = paycheck_router::accounts::ExecuteLeg {
            config: base.config,
            router: base.router,
            paycheck: base.paycheck,
            asset: base.asset,
            authority: base.authority,
            pay_in: base.pay_in,
            authority_usdc: base.authority_usdc,
            treasury: base.treasury,
            usdc_mint: base.usdc_mint,
            destination: base.destination,
            asset_mint: base.asset_mint,
            price_update: call.price.expect("price account"),
            price_update_247: call.price_247,
            usdc_price_update: call.usdc_price.unwrap_or(self.usdc_price),
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
            data: paycheck_router::instruction::ExecuteLeg {
                leg_index: leg.index,
                swap_data: route.data(),
            }
            .data(),
        }
    }

    pub fn execute_prestock_ix(&self, leg: &Leg, call: &Call, route: &Route) -> Instruction {
        let base = self.base_metas(leg, call.destination.unwrap_or(self.destination(&leg.mint)));
        let mut accounts = paycheck_router::accounts::ExecutePrestockLeg {
            config: base.config,
            router: base.router,
            paycheck: base.paycheck,
            asset: base.asset,
            authority: base.authority,
            pay_in: base.pay_in,
            authority_usdc: base.authority_usdc,
            treasury: base.treasury,
            usdc_mint: base.usdc_mint,
            destination: base.destination,
            asset_mint: base.asset_mint,
            instructions_sysvar: solana_instructions_sysvar::ID,
            usdc_price_update: call.usdc_price.unwrap_or(self.usdc_price),
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
            data: paycheck_router::instruction::ExecutePrestockLeg {
                leg_index: leg.index,
                swap_data: route.data(),
            }
            .data(),
        }
    }

    pub fn execute_owner_ix(
        &self,
        leg: &Leg,
        call: &Call,
        band_bps: u16,
        route: &Route,
    ) -> Instruction {
        let base = self.base_metas(leg, call.destination.unwrap_or(self.destination(&leg.mint)));
        let mut accounts = paycheck_router::accounts::ExecuteLegOwner {
            owner: self.owner(),
            config: base.config,
            router: base.router,
            paycheck: base.paycheck,
            asset: base.asset,
            authority: base.authority,
            pay_in: base.pay_in,
            authority_usdc: base.authority_usdc,
            treasury: base.treasury,
            usdc_mint: base.usdc_mint,
            destination: base.destination,
            asset_mint: base.asset_mint,
            price_update: call.price,
            price_update_247: call.price_247,
            instructions_sysvar: call.sysvar.then_some(solana_instructions_sysvar::ID),
            usdc_price_update: call.usdc_price.unwrap_or(self.usdc_price),
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
            data: paycheck_router::instruction::ExecuteLegOwner {
                leg_index: leg.index,
                band_bps,
                swap_data: route.data(),
            }
            .data(),
        }
    }

    /// Runs execute_leg for a listed leg with fresh prices and `route`.
    pub fn execute(&mut self, leg: &Leg, route: &Route) -> TxResult {
        let call = self.listed_call(leg);
        let ix = self.execute_ix(leg, &call, route);
        let crank = self.env.crank.insecure_clone();
        self.env.send(&[ix], &[&crank])
    }

    pub fn listed_call(&self, leg: &Leg) -> Call {
        let price = if leg.mint == self.nvda {
            self.nvda_price
        } else {
            self.spy_price
        };
        Call {
            price: Some(price),
            ..Call::default()
        }
    }

    pub fn attestation(&self, mint: Pubkey, usd: f64) -> MarkAttestation {
        MarkAttestation {
            mint,
            mark_price_e9: (usd * 1e9) as u64,
            observed_at: self.env.now(),
            source: 0,
        }
    }

    pub fn execute_prestock(
        &mut self,
        leg: &Leg,
        attestation: &MarkAttestation,
        route: &Route,
    ) -> TxResult {
        let signer = self.env.attester.insecure_clone();
        let verify =
            fixtures::ed25519_instruction(&signer, &fixtures::attestation_message(attestation));
        let ix = self.execute_prestock_ix(leg, &Call::default(), route);
        let crank = self.env.crank.insecure_clone();
        self.env.send(&[verify, ix], &[&crank])
    }

    pub fn post(&mut self, spec: PriceSpec) -> Pubkey {
        fixtures::post_price(&mut self.env, &spec)
    }
}

struct ExecuteBase {
    config: Pubkey,
    router: Pubkey,
    paycheck: Pubkey,
    asset: Pubkey,
    authority: Pubkey,
    pay_in: Pubkey,
    authority_usdc: Pubkey,
    treasury: Pubkey,
    usdc_mint: Pubkey,
    destination: Pubkey,
    asset_mint: Pubkey,
}

/// Per-call account choices; `None` takes the market default.
#[derive(Clone, Default)]
pub struct Call {
    pub price: Option<Pubkey>,
    pub price_247: Option<Pubkey>,
    pub usdc_price: Option<Pubkey>,
    pub destination: Option<Pubkey>,
    pub swap_program: Option<Pubkey>,
    pub sysvar: bool,
    /// (owner token account, mint) for a route's intermediate mint.
    pub intermediate: Option<(Pubkey, Pubkey)>,
}
