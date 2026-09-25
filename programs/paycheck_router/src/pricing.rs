//! Reference prices the guard trusts: Pyth `PriceUpdateV2` accounts owned by
//! the receiver, Ed25519-attested PreStocks marks, and the Scaled UI
//! multiplier read from the mint itself.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        scaled_ui_amount::ScaledUiAmountConfig, transfer_hook::TransferHook,
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Mint as MintState,
};
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::{
    constants::{
        ED25519_PROGRAM_ID, MAX_ATTESTATION_AGE_SECS, PYTH_RECEIVER_PROGRAM_ID, USDC_PEG_BPS,
    },
    error::RouterError,
    events::{MarkAttestation, PriceSource},
    guard,
};

#[derive(Clone, Copy, Debug)]
pub struct Reference {
    pub price_e9: u64,
    pub usdc_price_e9: u64,
    pub band_bps: u16,
    pub source: PriceSource,
    pub publish_time: i64,
    pub attestation: Option<MarkAttestation>,
}

#[derive(Clone, Copy, Debug)]
pub struct PythPrice {
    pub price_e9: u64,
    pub publish_time: i64,
}

/// Reads a fully verified price for `feed_id`. Returns `Ok(None)` when the
/// price is older than `max_age_secs`, so the caller can fall back to a 24/7
/// feed; every other problem is an error.
pub fn read_pyth_price(
    account: &AccountInfo,
    feed_id: &[u8; 32],
    max_age_secs: u16,
    max_conf_bps: u16,
    now: i64,
) -> Result<Option<PythPrice>> {
    require_keys_eq!(
        *account.owner,
        PYTH_RECEIVER_PROGRAM_ID,
        RouterError::PriceFeedMismatch
    );
    let data = account.try_borrow_data()?;
    let update = PriceUpdateV2::try_deserialize(&mut &data[..])
        .map_err(|_| error!(RouterError::PriceFeedMismatch))?;
    require!(
        update.verification_level == VerificationLevel::Full,
        RouterError::PriceFeedMismatch
    );
    let message = update.price_message;
    require!(message.feed_id == *feed_id, RouterError::PriceFeedMismatch);
    if message.publish_time.saturating_add(i64::from(max_age_secs)) < now {
        return Ok(None);
    }
    require!(message.price > 0, RouterError::PriceFeedMismatch);
    require!(
        guard::confidence_within(message.price as u64, message.conf, max_conf_bps),
        RouterError::ConfidenceTooWide
    );
    let price_e9 = guard::pyth_price_to_e9(message.price, message.exponent)
        .ok_or(RouterError::MathOverflow)?;
    Ok(Some(PythPrice {
        price_e9,
        publish_time: message.publish_time,
    }))
}

/// USDC/USD must be fresh, tight and within `USDC_PEG_BPS` of 1.00.
pub fn read_usdc_price(
    account: &AccountInfo,
    feed_id: &[u8; 32],
    max_age_secs: u16,
    max_conf_bps: u16,
    now: i64,
) -> Result<u64> {
    let price = read_pyth_price(account, feed_id, max_age_secs, max_conf_bps, now)?
        .ok_or(RouterError::PriceStale)?;
    require!(
        guard::usdc_on_peg(price.price_e9, USDC_PEG_BPS),
        RouterError::UsdcDepeg
    );
    Ok(price.price_e9)
}

/// Reads the listed-equity price: the regular feed, or the 24/7 feed with
/// its extra band when the regular one is stale and the caller passed it.
pub fn read_equity_price(
    regular: &AccountInfo,
    fallback_247: Option<&AccountInfo>,
    feed_id: &[u8; 32],
    feed_id_247: &[u8; 32],
    max_age_secs: u16,
    max_conf_bps: u16,
    now: i64,
) -> Result<(PythPrice, PriceSource)> {
    if let Some(price) = read_pyth_price(regular, feed_id, max_age_secs, max_conf_bps, now)? {
        return Ok((price, PriceSource::PythRegular));
    }
    let has_247 = *feed_id_247 != [0u8; 32];
    match fallback_247 {
        Some(account) if has_247 => {
            let price = read_pyth_price(account, feed_id_247, max_age_secs, max_conf_bps, now)?
                .ok_or(RouterError::PriceStale)?;
            Ok((price, PriceSource::Pyth247))
        }
        _ => err!(RouterError::PriceStale),
    }
}

const ED25519_OFFSETS_START: usize = 2;
const ED25519_OFFSETS_LEN: usize = 14;
const ED25519_PUBKEY_LEN: usize = 32;
const ED25519_SIGNATURE_LEN: usize = 64;
const CURRENT_INSTRUCTION: u16 = u16::MAX;

fn read_u16(data: &[u8], at: usize) -> Result<u16> {
    let bytes = data
        .get(at..at + 2)
        .ok_or(RouterError::AttestationMalformed)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice(data: &[u8], offset: u16, len: usize) -> Result<&[u8]> {
    let start = usize::from(offset);
    data.get(start..start + len)
        .ok_or_else(|| error!(RouterError::AttestationMalformed))
}

/// Verifies that the instruction immediately before this one is an Ed25519
/// sigverify of exactly one signature by `attester` over a Borsh
/// `MarkAttestation` for `mint`, with every offset inside that instruction.
pub fn read_attestation(
    instructions_sysvar: &AccountInfo,
    attester: &Pubkey,
    mint: &Pubkey,
    now: i64,
) -> Result<MarkAttestation> {
    let current = load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(RouterError::AttestationMissing))?;
    require!(current > 0, RouterError::AttestationMissing);
    let previous = load_instruction_at_checked(usize::from(current - 1), instructions_sysvar)
        .map_err(|_| error!(RouterError::AttestationMissing))?;
    require_keys_eq!(
        previous.program_id,
        ED25519_PROGRAM_ID,
        RouterError::AttestationMissing
    );

    let data = previous.data.as_slice();
    require!(
        data.len() >= ED25519_OFFSETS_START + ED25519_OFFSETS_LEN && data[0] == 1,
        RouterError::AttestationMalformed
    );
    let at = ED25519_OFFSETS_START;
    let signature_offset = read_u16(data, at)?;
    let signature_ix = read_u16(data, at + 2)?;
    let pubkey_offset = read_u16(data, at + 4)?;
    let pubkey_ix = read_u16(data, at + 6)?;
    let message_offset = read_u16(data, at + 8)?;
    let message_size = read_u16(data, at + 10)?;
    let message_ix = read_u16(data, at + 12)?;
    let own_index = current - 1;
    let in_same_instruction = |ix: u16| ix == CURRENT_INSTRUCTION || ix == own_index;
    require!(
        in_same_instruction(signature_ix)
            && in_same_instruction(pubkey_ix)
            && in_same_instruction(message_ix),
        RouterError::AttestationMalformed
    );
    slice(data, signature_offset, ED25519_SIGNATURE_LEN)?;

    let pubkey = slice(data, pubkey_offset, ED25519_PUBKEY_LEN)?;
    require!(
        pubkey == attester.as_ref(),
        RouterError::AttestationSignerMismatch
    );

    require!(
        usize::from(message_size) == MarkAttestation::LEN,
        RouterError::AttestationMalformed
    );
    let mut message = slice(data, message_offset, MarkAttestation::LEN)?;
    let attestation = MarkAttestation::deserialize(&mut message)
        .map_err(|_| error!(RouterError::AttestationMalformed))?;
    require_keys_eq!(attestation.mint, *mint, RouterError::AttestationMalformed);
    require!(
        attestation.mark_price_e9 > 0,
        RouterError::AttestationMalformed
    );
    require!(
        now.abs_diff(attestation.observed_at) <= MAX_ATTESTATION_AGE_SECS as u64,
        RouterError::AttestationStale
    );
    Ok(attestation)
}

/// The Scaled UI multiplier in effect at `now`: `new_multiplier` once its
/// timestamp has passed, else `multiplier`, else 1 for SPL Token mints and
/// Token-2022 mints without the extension.
pub fn effective_multiplier(mint: &AccountInfo, now: i64) -> Result<f64> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(1.0);
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    let Ok(config) = state.get_extension::<ScaledUiAmountConfig>() else {
        return Ok(1.0);
    };
    let effective_at: i64 = config.new_multiplier_effective_timestamp.into();
    let multiplier: f64 = if now >= effective_at {
        config.new_multiplier.into()
    } else {
        config.multiplier.into()
    };
    Ok(multiplier)
}

/// Mints whose transfer hook points at a program would need extra accounts
/// on every transfer, and run code the registry never reviewed.
pub fn has_active_transfer_hook(mint: &AccountInfo) -> Result<bool> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(false);
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    Ok(state
        .get_extension::<TransferHook>()
        .map(|hook| Option::<Pubkey>::from(hook.program_id).is_some())
        .unwrap_or(false))
}
