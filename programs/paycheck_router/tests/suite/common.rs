#![allow(dead_code)]

use anchor_lang::{
    solana_program::{
        bpf_loader_upgradeable::{self, UpgradeableLoaderState},
        instruction::Instruction,
        program_pack::Pack,
        system_instruction,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::{
    associated_token::{
        get_associated_token_address_with_program_id,
        spl_associated_token_account::instruction::create_associated_token_account_idempotent,
    },
    token_2022::spl_token_2022::{
        self,
        extension::{
            scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensionsMut, ExtensionType,
            StateWithExtensionsMut,
        },
        state::{Account as TokenAccountState, Mint as MintState},
    },
};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use paycheck_router::{
    constants::*,
    error::RouterError,
    instructions::{AssetParams, ConfigParams, RouterParams},
    state::{Asset, Config, LegConfig, Paycheck, Router},
};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

pub use anchor_lang::prelude::Pubkey;

pub const TOKEN_PROGRAM: Pubkey = anchor_spl::token::ID;
pub const TOKEN_2022_PROGRAM: Pubkey = anchor_spl::token_2022::ID;
pub const SYSTEM_PROGRAM: Pubkey = anchor_lang::solana_program::system_program::ID;
pub const ATA_PROGRAM: Pubkey = anchor_spl::associated_token::ID;

pub const USDC_FEED: [u8; 32] = [0xea; 32];
pub const NVDA_FEED: [u8; 32] = [0xb1; 32];
pub const NVDA_FEED_247: [u8; 32] = [0xa4; 32];
pub const SPY_FEED: [u8; 32] = [0x19; 32];

pub const START_TIME: i64 = 1_790_000_000;
pub const ONE_USDC: u64 = 1_000_000;

pub type TxResult = Result<TransactionMetadata, Box<FailedTransactionMetadata>>;

fn deploy_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy")
}

fn read_program(name: &str) -> Vec<u8> {
    let path = deploy_dir().join(format!("{name}.so"));
    std::fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "{} is missing: run `anchor build` and `cargo build-sbf --tools-version v1.52 \
             --manifest-path programs/paycheck_router/test-programs/test_swap/Cargo.toml \
             --sbf-out-dir target/deploy` first",
            path.display()
        )
    })
}

pub fn error_code(error: RouterError) -> u32 {
    anchor_lang::error::ERROR_CODE_OFFSET + error as u32
}

pub fn assert_router_error(result: TxResult, expected: RouterError) {
    let failure = match result {
        Ok(meta) => panic!(
            "expected {expected:?}, transaction succeeded: {:#?}",
            meta.logs
        ),
        Err(failure) => failure,
    };
    let expected_code = error_code(expected);
    let rendered = format!("{:?}", failure.err);
    assert!(
        rendered.contains(&format!("Custom({expected_code})")),
        "expected {expected:?} ({expected_code}), got {rendered}\nlogs: {:#?}",
        failure.meta.logs
    );
}

pub fn assert_anchor_error(result: TxResult, code: u32) {
    let failure = result.expect_err("expected failure");
    let rendered = format!("{:?}", failure.err);
    assert!(
        rendered.contains(&format!("Custom({code})")),
        "expected custom error {code}, got {rendered}\nlogs: {:#?}",
        failure.meta.logs
    );
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &paycheck_router::ID).0
}

pub fn asset_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ASSET_SEED, mint.as_ref()], &paycheck_router::ID).0
}

pub fn router_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ROUTER_SEED, owner.as_ref()], &paycheck_router::ID).0
}

pub fn authority_pda(router: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[AUTHORITY_SEED, router.as_ref()], &paycheck_router::ID).0
}

pub fn convert_pda(router: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[CONVERT_SEED, router.as_ref(), mint.as_ref()],
        &paycheck_router::ID,
    )
    .0
}

pub fn paycheck_pda(router: &Pubkey, seq: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[PAYCHECK_SEED, router.as_ref(), &seq.to_le_bytes()],
        &paycheck_router::ID,
    )
    .0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, token_program)
}

pub struct Env {
    pub svm: LiteSVM,
    pub deployer: Keypair,
    pub admin: Keypair,
    pub guardian: Keypair,
    pub attester: Keypair,
    pub crank: Keypair,
    pub recorder: Keypair,
    pub mint_authority: Keypair,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub swap_program: Pubkey,
}

impl Env {
    /// Programs loaded, clock set, USDC mint and treasury created; no Config.
    pub fn bare() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(paycheck_router::ID, &read_program("paycheck_router"))
            .unwrap();
        svm.add_program(test_swap::ID, &read_program("test_swap"))
            .unwrap();

        let env_keys = [
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
        ];
        for key in &env_keys {
            svm.airdrop(&key.pubkey(), 100_000_000_000).unwrap();
        }
        let [deployer, admin, guardian, attester, crank, recorder, mint_authority] = env_keys;

        let mut env = Self {
            svm,
            deployer,
            admin,
            guardian,
            attester,
            crank,
            recorder,
            mint_authority,
            usdc_mint: Pubkey::default(),
            treasury: Pubkey::default(),
            swap_program: test_swap::ID,
        };
        env.set_upgrade_authority(Some(env.deployer.pubkey()));
        env.set_time(START_TIME);
        env.usdc_mint = env.create_mint(TOKEN_PROGRAM, 6, None);
        let treasury_owner = env.admin.pubkey();
        env.treasury = env.create_ata(&treasury_owner, &env.usdc_mint.clone(), TOKEN_PROGRAM);
        env
    }

    /// `bare` plus an initialized Config.
    pub fn new() -> Self {
        let mut env = Self::bare();
        let ix = env.initialize_config_ix(env.default_config_params());
        let deployer = env.deployer.insecure_clone();
        env.send(&[ix], &[&deployer]).unwrap();
        env
    }

    pub fn set_upgrade_authority(&mut self, authority: Option<Pubkey>) {
        let program_data = self.program_data();
        let mut account = self.svm.get_account(&program_data).unwrap();
        let metadata_len = UpgradeableLoaderState::size_of_programdata_metadata();
        let state = UpgradeableLoaderState::ProgramData {
            slot: 0,
            upgrade_authority_address: authority,
        };
        let encoded = bincode::serialize(&state).unwrap();
        account.data[..metadata_len].fill(0);
        account.data[..encoded.len()].copy_from_slice(&encoded);
        self.svm.set_account(program_data, account).unwrap();
    }

    pub fn program_data(&self) -> Pubkey {
        Pubkey::find_program_address(&[paycheck_router::ID.as_ref()], &bpf_loader_upgradeable::ID).0
    }

    pub fn now(&self) -> i64 {
        self.svm
            .get_sysvar::<anchor_lang::prelude::Clock>()
            .unix_timestamp
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp = unix_timestamp;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn advance(&mut self, seconds: i64) {
        let now = self.now();
        self.set_time(now + seconds);
    }

    pub fn send(&mut self, instructions: &[Instruction], signers: &[&Keypair]) -> TxResult {
        let payer = signers[0].pubkey();
        let tx = Transaction::new_signed_with_payer(
            instructions,
            Some(&payer),
            signers,
            self.svm.latest_blockhash(),
        );
        let result = self.svm.send_transaction(tx).map_err(Box::new);
        self.svm.expire_blockhash();
        result
    }

    pub fn fund(&mut self, key: &Pubkey) {
        self.svm.airdrop(key, 10_000_000_000).unwrap();
    }

    pub fn create_mint(
        &mut self,
        token_program: Pubkey,
        decimals: u8,
        scaled_multiplier: Option<f64>,
    ) -> Pubkey {
        let mint = Keypair::new();
        let extensions: Vec<ExtensionType> = scaled_multiplier
            .map(|_| vec![ExtensionType::ScaledUiAmount])
            .unwrap_or_default();
        let space = if extensions.is_empty() {
            MintState::LEN
        } else {
            ExtensionType::try_calculate_account_len::<MintState>(&extensions).unwrap()
        };
        let lamports = self.svm.minimum_balance_for_rent_exemption(space);
        let payer = self.mint_authority.insecure_clone();
        let mut ixs = vec![system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            lamports,
            space as u64,
            &token_program,
        )];
        if let Some(multiplier) = scaled_multiplier {
            ixs.push(
                spl_token_2022::extension::scaled_ui_amount::instruction::initialize(
                    &token_program,
                    &mint.pubkey(),
                    Some(payer.pubkey()),
                    multiplier,
                )
                .unwrap(),
            );
        }
        ixs.push(
            spl_token_2022::instruction::initialize_mint2(
                &token_program,
                &mint.pubkey(),
                &payer.pubkey(),
                None,
                decimals,
            )
            .unwrap(),
        );
        self.send(&ixs, &[&payer, &mint]).unwrap();
        mint.pubkey()
    }

    /// Rewrites the mint's Scaled UI config in place.
    pub fn set_scaled_multiplier(
        &mut self,
        mint: &Pubkey,
        multiplier: f64,
        new_multiplier: f64,
        effective_at: i64,
    ) {
        let mut account = self.svm.get_account(mint).unwrap();
        {
            let mut state = StateWithExtensionsMut::<MintState>::unpack(&mut account.data).unwrap();
            let config = state.get_extension_mut::<ScaledUiAmountConfig>().unwrap();
            config.multiplier = multiplier.into();
            config.new_multiplier = new_multiplier.into();
            config.new_multiplier_effective_timestamp = effective_at.into();
        }
        self.svm.set_account(*mint, account).unwrap();
    }

    pub fn create_ata(&mut self, owner: &Pubkey, mint: &Pubkey, token_program: Pubkey) -> Pubkey {
        let payer = self.mint_authority.insecure_clone();
        let ix = create_associated_token_account_idempotent(
            &payer.pubkey(),
            owner,
            mint,
            &token_program,
        );
        self.send(&[ix], &[&payer]).unwrap();
        ata(owner, mint, &token_program)
    }

    /// A token account at a fresh keypair address, for tests that need a
    /// second account of the same owner and mint.
    pub fn create_token_account(
        &mut self,
        owner: &Pubkey,
        mint: &Pubkey,
        token_program: Pubkey,
    ) -> Pubkey {
        let account = Keypair::new();
        let payer = self.mint_authority.insecure_clone();
        let space = TokenAccountState::LEN;
        let lamports = self.svm.minimum_balance_for_rent_exemption(space);
        let ixs = [
            system_instruction::create_account(
                &payer.pubkey(),
                &account.pubkey(),
                lamports,
                space as u64,
                &token_program,
            ),
            spl_token_2022::instruction::initialize_account3(
                &token_program,
                &account.pubkey(),
                mint,
                owner,
            )
            .unwrap(),
        ];
        self.send(&ixs, &[&payer, &account]).unwrap();
        account.pubkey()
    }

    pub fn mint_to(&mut self, mint: &Pubkey, account: &Pubkey, amount: u64) {
        let payer = self.mint_authority.insecure_clone();
        let token_program = self.svm.get_account(mint).unwrap().owner;
        let ix = spl_token_2022::instruction::mint_to(
            &token_program,
            mint,
            account,
            &payer.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        self.send(&[ix], &[&payer]).unwrap();
    }

    pub fn approve(&mut self, owner: &Keypair, account: &Pubkey, delegate: &Pubkey, amount: u64) {
        let token_program = self.svm.get_account(account).unwrap().owner;
        let ix = spl_token_2022::instruction::approve(
            &token_program,
            account,
            delegate,
            &owner.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        let payer = self.mint_authority.insecure_clone();
        self.send(&[ix], &[&payer, owner]).unwrap();
    }

    /// Moves tokens out of an owner's account, as the owner spending USDC.
    pub fn spend(&mut self, owner: &Keypair, from: &Pubkey, to: &Pubkey, amount: u64) {
        let token_program = self.svm.get_account(from).unwrap().owner;
        let mint = self.token_state(from).mint;
        let decimals = self.mint_decimals(&mint);
        let ix = spl_token_2022::instruction::transfer_checked(
            &token_program,
            from,
            &mint,
            to,
            &owner.pubkey(),
            &[],
            amount,
            decimals,
        )
        .unwrap();
        let payer = self.mint_authority.insecure_clone();
        self.send(&[ix], &[&payer, owner]).unwrap();
    }

    pub fn mint_decimals(&self, mint: &Pubkey) -> u8 {
        let account = self.svm.get_account(mint).unwrap();
        MintState::unpack_from_slice(&account.data[..MintState::LEN])
            .unwrap()
            .decimals
    }

    pub fn token_state(&self, account: &Pubkey) -> TokenAccountState {
        let account = self.svm.get_account(account).unwrap();
        TokenAccountState::unpack_from_slice(&account.data[..TokenAccountState::LEN]).unwrap()
    }

    pub fn balance(&self, account: &Pubkey) -> u64 {
        self.token_state(account).amount
    }

    pub fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn account_exists(&self, key: &Pubkey) -> bool {
        self.svm
            .get_account(key)
            .map(|a| a.lamports > 0)
            .unwrap_or(false)
    }

    pub fn fetch<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let account = self.svm.get_account(key).unwrap();
        T::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    pub fn config(&self) -> Config {
        self.fetch(&config_pda())
    }

    pub fn router(&self, owner: &Pubkey) -> Router {
        self.fetch(&router_pda(owner))
    }

    pub fn paycheck(&self, router: &Pubkey, seq: u64) -> Paycheck {
        self.fetch(&paycheck_pda(router, seq))
    }

    pub fn asset(&self, mint: &Pubkey) -> Asset {
        self.fetch(&asset_pda(mint))
    }

    // Instruction builders.

    pub fn default_config_params(&self) -> ConfigParams {
        ConfigParams {
            admin: self.admin.pubkey(),
            fee_bps: 20,
            usdc_feed_id: USDC_FEED,
            jupiter_program: self.swap_program,
            attester: self.attester.pubkey(),
            pause_authority: self.guardian.pubkey(),
            max_price_age_secs: 30,
            max_conf_bps: 50,
            max_leg_usdc: 5_000 * ONE_USDC,
        }
    }

    pub fn initialize_config_ix(&self, params: ConfigParams) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::InitializeConfig {
                deployer: self.deployer.pubkey(),
                config: config_pda(),
                program: paycheck_router::ID,
                program_data: self.program_data(),
                usdc_mint: self.usdc_mint,
                treasury: self.treasury,
                usdc_token_program: TOKEN_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::InitializeConfig { params }.data(),
        }
    }

    pub fn upsert_asset_ix(
        &self,
        admin: &Pubkey,
        mint: &Pubkey,
        token_program: Pubkey,
        params: AssetParams,
    ) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::UpsertAsset {
                admin: *admin,
                config: config_pda(),
                asset: asset_pda(mint),
                mint: *mint,
                token_program,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::UpsertAsset { params }.data(),
        }
    }

    pub fn listed_params(feed_id: [u8; 32], feed_id_247: [u8; 32]) -> AssetParams {
        AssetParams {
            kind: 0,
            issuer: 0,
            feed_id,
            feed_id_247,
            max_band_bps: 250,
            band_247_extra_bps: 50,
        }
    }

    pub fn preipo_params() -> AssetParams {
        AssetParams {
            kind: 1,
            issuer: 1,
            feed_id: [0u8; 32],
            feed_id_247: [0u8; 32],
            max_band_bps: 1_000,
            band_247_extra_bps: 0,
        }
    }

    /// Creates a Token-2022 mint with a Scaled UI multiplier and registers
    /// it as a listed equity.
    pub fn add_listed_asset(&mut self, feed_id: [u8; 32], feed_id_247: [u8; 32]) -> Pubkey {
        let mint = self.create_mint(TOKEN_2022_PROGRAM, 8, Some(1.0));
        let admin = self.admin.insecure_clone();
        let ix = self.upsert_asset_ix(
            &admin.pubkey(),
            &mint,
            TOKEN_2022_PROGRAM,
            Self::listed_params(feed_id, feed_id_247),
        );
        self.send(&[ix], &[&admin]).unwrap();
        mint
    }

    pub fn add_preipo_asset(&mut self) -> Pubkey {
        let mint = self.create_mint(TOKEN_2022_PROGRAM, 9, Some(1.0));
        let admin = self.admin.insecure_clone();
        let ix = self.upsert_asset_ix(
            &admin.pubkey(),
            &mint,
            TOKEN_2022_PROGRAM,
            Self::preipo_params(),
        );
        self.send(&[ix], &[&admin]).unwrap();
        mint
    }

    pub fn router_params(&self, legs: Vec<LegConfig>) -> RouterParams {
        RouterParams {
            recorder: self.recorder.pubkey(),
            invest_bps: 2_000,
            min_inflow: 10 * ONE_USDC,
            daily_cap: 10_000 * ONE_USDC,
            max_wait_secs: 86_400,
            auto_convert: false,
            legs,
        }
    }

    pub fn leg(mint: Pubkey, weight_bps: u16, band_bps: u16) -> LegConfig {
        LegConfig {
            mint,
            weight_bps,
            band_bps,
            enabled: true,
        }
    }

    pub fn create_router_ix(
        &self,
        owner: &Pubkey,
        payer: &Pubkey,
        params: RouterParams,
    ) -> Instruction {
        let router = router_pda(owner);
        let authority = authority_pda(&router);
        let mut accounts = paycheck_router::accounts::CreateRouter {
            owner: *owner,
            payer: *payer,
            config: config_pda(),
            router,
            authority,
            usdc_mint: self.usdc_mint,
            pay_in: ata(owner, &self.usdc_mint, &TOKEN_PROGRAM),
            authority_usdc: ata(&authority, &self.usdc_mint, &TOKEN_PROGRAM),
            usdc_token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None);
        accounts.extend(asset_metas(&params.legs));
        Instruction {
            program_id: paycheck_router::ID,
            accounts,
            data: paycheck_router::instruction::CreateRouter { params }.data(),
        }
    }

    pub fn update_router_ix(&self, owner: &Pubkey, params: RouterParams) -> Instruction {
        let mut accounts = paycheck_router::accounts::UpdateRouter {
            owner: *owner,
            router: router_pda(owner),
        }
        .to_account_metas(None);
        accounts.extend(asset_metas(&params.legs));
        Instruction {
            program_id: paycheck_router::ID,
            accounts,
            data: paycheck_router::instruction::UpdateRouter { params }.data(),
        }
    }

    pub fn record_ix(&self, recorder: &Pubkey, payer: &Pubkey, owner: &Pubkey) -> Instruction {
        let router_key = router_pda(owner);
        let seq = self
            .svm
            .get_account(&router_key)
            .map(|account| {
                Router::try_deserialize(&mut account.data.as_slice())
                    .unwrap()
                    .paycheck_seq
            })
            .unwrap_or(0);
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::RecordPaycheck {
                recorder: *recorder,
                payer: *payer,
                config: config_pda(),
                router: router_key,
                pay_in: ata(owner, &self.usdc_mint, &TOKEN_PROGRAM),
                paycheck: paycheck_pda(&router_key, seq),
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::RecordPaycheck { detected_slot: 42 }.data(),
        }
    }

    pub fn record(&mut self, owner: &Pubkey) -> TxResult {
        let recorder = self.recorder.insecure_clone();
        let crank = self.crank.insecure_clone();
        let ix = self.record_ix(&recorder.pubkey(), &crank.pubkey(), owner);
        self.send(&[ix], &[&crank, &recorder])
    }

    pub fn skip_ix(&self, signer: &Pubkey, owner: &Pubkey) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::SkipInflow {
                signer: *signer,
                router: router_pda(owner),
                pay_in: ata(owner, &self.usdc_mint, &TOKEN_PROGRAM),
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::SkipInflow {}.data(),
        }
    }

    pub fn sync_ix(&self, owner: &Pubkey) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::SyncWatermark {
                router: router_pda(owner),
                pay_in: ata(owner, &self.usdc_mint, &TOKEN_PROGRAM),
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::SyncWatermark {}.data(),
        }
    }

    pub fn set_router_paused_ix(&self, owner: &Pubkey, paused: bool) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::SetRouterPaused {
                owner: *owner,
                router: router_pda(owner),
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::SetRouterPaused { paused }.data(),
        }
    }

    pub fn set_global_pause_ix(&self, admin: &Pubkey, paused: bool) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::SetGlobalPause {
                admin: *admin,
                config: config_pda(),
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::SetGlobalPause { paused }.data(),
        }
    }

    pub fn emergency_pause_ix(&self, signer: &Pubkey) -> Instruction {
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::EmergencyPause {
                pause_authority: *signer,
                config: config_pda(),
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::EmergencyPause {}.data(),
        }
    }

    pub fn cancel_leg_ix(&self, owner: &Pubkey, seq: u64, leg_index: u8) -> Instruction {
        let router = router_pda(owner);
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::CancelLeg {
                owner: *owner,
                router,
                paycheck: paycheck_pda(&router, seq),
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::CancelLeg { leg_index }.data(),
        }
    }

    pub fn close_router_ix(&self, owner: &Pubkey, rent_payer: &Pubkey) -> Instruction {
        let router = router_pda(owner);
        let authority = authority_pda(&router);
        Instruction {
            program_id: paycheck_router::ID,
            accounts: paycheck_router::accounts::CloseRouter {
                owner: *owner,
                router,
                rent_payer: *rent_payer,
                authority,
                authority_usdc: ata(&authority, &self.usdc_mint, &TOKEN_PROGRAM),
                pay_in: ata(owner, &self.usdc_mint, &TOKEN_PROGRAM),
                usdc_mint: self.usdc_mint,
                usdc_token_program: TOKEN_PROGRAM,
            }
            .to_account_metas(None),
            data: paycheck_router::instruction::CloseRouter {}.data(),
        }
    }
}

pub fn asset_metas(
    legs: &[LegConfig],
) -> Vec<anchor_lang::solana_program::instruction::AccountMeta> {
    legs.iter()
        .map(|leg| {
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                asset_pda(&leg.mint),
                false,
            )
        })
        .collect()
}

/// A worker with a funded USDC account, ready to create a router.
pub struct Worker {
    pub key: Keypair,
    pub pay_in: Pubkey,
}

impl Worker {
    pub fn new(env: &mut Env, starting_usdc: u64) -> Self {
        let key = Keypair::new();
        env.fund(&key.pubkey());
        let usdc_mint = env.usdc_mint;
        let pay_in = env.create_ata(&key.pubkey(), &usdc_mint, TOKEN_PROGRAM);
        if starting_usdc > 0 {
            env.mint_to(&usdc_mint, &pay_in, starting_usdc);
        }
        Self { key, pay_in }
    }

    pub fn pubkey(&self) -> Pubkey {
        self.key.pubkey()
    }

    pub fn router(&self) -> Pubkey {
        router_pda(&self.key.pubkey())
    }

    pub fn authority(&self) -> Pubkey {
        authority_pda(&self.router())
    }

    /// Creates the router with `legs` and approves the authority for a large
    /// USDC allowance, as the setup transaction does.
    pub fn setup(&self, env: &mut Env, legs: Vec<LegConfig>) {
        let params = env.router_params(legs);
        self.setup_with(env, params);
    }

    pub fn setup_with(&self, env: &mut Env, params: RouterParams) {
        let ix = env.create_router_ix(&self.pubkey(), &self.pubkey(), params);
        env.send(&[ix], &[&self.key]).unwrap();
        let authority = self.authority();
        env.approve(&self.key, &self.pay_in, &authority, u64::MAX);
    }

    /// An employer paying this worker `amount` USDC.
    pub fn receive_pay(&self, env: &mut Env, amount: u64) {
        let usdc_mint = env.usdc_mint;
        env.mint_to(&usdc_mint, &self.pay_in, amount);
    }
}
