//! Price accounts and attestation instructions built the way the Pyth
//! receiver and the Ed25519 precompile lay them out on mainnet.

use anchor_lang::{solana_program::instruction::Instruction, AccountSerialize, AnchorSerialize};
use paycheck_router::{constants::PYTH_RECEIVER_PROGRAM_ID, events::MarkAttestation};
use pyth_solana_receiver_sdk::price_update::{PriceFeedMessage, PriceUpdateV2, VerificationLevel};
use solana_keypair::Keypair;
use solana_signer::Signer;

use solana_account::Account;

use crate::common::{Env, Pubkey};

#[derive(Clone, Copy, Debug)]
pub struct PriceSpec {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub full: bool,
}

impl PriceSpec {
    pub fn equity(feed_id: [u8; 32], usd: f64, publish_time: i64) -> Self {
        Self {
            feed_id,
            price: (usd * 100_000.0).round() as i64,
            conf: 1_000,
            exponent: -5,
            publish_time,
            full: true,
        }
    }

    pub fn usdc(feed_id: [u8; 32], usd: f64, publish_time: i64) -> Self {
        Self {
            feed_id,
            price: (usd * 100_000_000.0).round() as i64,
            conf: 20_000,
            exponent: -8,
            publish_time,
            full: true,
        }
    }
}

pub fn price_update_data(spec: &PriceSpec) -> Vec<u8> {
    let update = PriceUpdateV2 {
        write_authority: Pubkey::new_unique(),
        verification_level: if spec.full {
            VerificationLevel::Full
        } else {
            VerificationLevel::Partial { num_signatures: 5 }
        },
        price_message: PriceFeedMessage {
            feed_id: spec.feed_id,
            price: spec.price,
            conf: spec.conf,
            exponent: spec.exponent,
            publish_time: spec.publish_time,
            prev_publish_time: spec.publish_time - 1,
            ema_price: spec.price,
            ema_conf: spec.conf,
        },
        posted_slot: 1,
    };
    let mut data = Vec::with_capacity(PriceUpdateV2::LEN);
    update.try_serialize(&mut data).unwrap();
    data
}

/// Writes a price account at a fresh address owned by `owner`.
pub fn post_price_as(env: &mut Env, spec: &PriceSpec, owner: Pubkey) -> Pubkey {
    let address = Pubkey::new_unique();
    let data = price_update_data(spec);
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    env.svm
        .set_account(
            address,
            Account {
                lamports,
                data,
                owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    address
}

pub fn post_price(env: &mut Env, spec: &PriceSpec) -> Pubkey {
    post_price_as(env, spec, PYTH_RECEIVER_PROGRAM_ID)
}

pub const ED25519_PROGRAM_ID: Pubkey = paycheck_router::constants::ED25519_PROGRAM_ID;

pub fn attestation_message(attestation: &MarkAttestation) -> Vec<u8> {
    let mut message = Vec::with_capacity(MarkAttestation::LEN);
    attestation.serialize(&mut message).unwrap();
    message
}

/// The single-signature layout `new_ed25519_instruction` produces: offsets,
/// then public key, signature and message, all inside this instruction.
pub fn ed25519_instruction(signer: &Keypair, message: &[u8]) -> Instruction {
    let pubkey = signer.pubkey().to_bytes();
    let signature: [u8; 64] = signer.sign_message(message).into();
    ed25519_raw(&pubkey, &signature, message, u16::MAX)
}

pub fn ed25519_raw(
    pubkey: &[u8; 32],
    signature: &[u8; 64],
    message: &[u8],
    instruction_index: u16,
) -> Instruction {
    let header_len = 2 + 14;
    let pubkey_offset = header_len as u16;
    let signature_offset = pubkey_offset + 32;
    let message_offset = signature_offset + 64;
    let mut data = vec![1u8, 0u8];
    for value in [
        signature_offset,
        instruction_index,
        pubkey_offset,
        instruction_index,
        message_offset,
        message.len() as u16,
        instruction_index,
    ] {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data.extend_from_slice(pubkey);
    data.extend_from_slice(signature);
    data.extend_from_slice(message);
    Instruction {
        program_id: ED25519_PROGRAM_ID,
        accounts: vec![],
        data,
    }
}
