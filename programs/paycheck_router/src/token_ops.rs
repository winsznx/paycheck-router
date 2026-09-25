use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_pack::Pack,
};
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{
            transfer_fee::TransferFeeAmount, BaseStateWithExtensions, StateWithExtensions,
        },
        state::Account as TokenAccountState,
    },
    token_interface::{self, TransferChecked},
};

use crate::error::RouterError;

/// A mint with the program that owns it, as every checked transfer needs.
#[derive(Clone, Copy)]
pub struct MintRef<'a, 'info> {
    pub mint: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub decimals: u8,
}

pub fn transfer<'info>(
    mint: &MintRef<'_, 'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let accounts = TransferChecked {
        from: from.clone(),
        mint: mint.mint.clone(),
        to: to.clone(),
        authority: authority.clone(),
    };
    let ctx = CpiContext::new_with_signer(mint.token_program.key(), accounts, signer_seeds);
    token_interface::transfer_checked(ctx, amount, mint.decimals)
}

/// Reads the base token account state if `account` is a token account under
/// either token program; `None` for anything else.
pub fn token_state(account: &AccountInfo) -> Option<TokenAccountState> {
    let owned_by_token_program =
        *account.owner == anchor_spl::token::ID || *account.owner == anchor_spl::token_2022::ID;
    if !owned_by_token_program || account.data_len() < TokenAccountState::LEN {
        return None;
    }
    let data = account.try_borrow_data().ok()?;
    TokenAccountState::unpack_from_slice(&data[..TokenAccountState::LEN]).ok()
}

/// Transfer fees withheld in a Token-2022 account; zero for SPL Token
/// accounts and accounts without the extension.
pub fn withheld_amount(account: &AccountInfo) -> Result<u64> {
    if *account.owner != anchor_spl::token_2022::ID {
        return Ok(0);
    }
    let data = account.try_borrow_data()?;
    let state = StateWithExtensions::<TokenAccountState>::unpack(&data)?;
    Ok(state
        .get_extension::<TransferFeeAmount>()
        .map(|fees| u64::from(fees.withheld_amount))
        .unwrap_or(0))
}

pub fn token_amount(account: &AccountInfo) -> Result<u64> {
    token_state(account)
        .map(|state| state.amount)
        .ok_or_else(|| error!(RouterError::InvalidParameter))
}

/// Calls the allowlisted swap program with the crank's accounts, signing as
/// `signer`. The outer transaction lists the PDA as a non-signer; the program
/// upgrades it to a signer here, which only `invoke_signed` can satisfy. The
/// router owner's signature is never lent to the route, so an owner-signed
/// instruction cannot give the swap program power over the owner's wallet.
pub fn invoke_swap<'info>(
    swap_program: &AccountInfo<'info>,
    route_accounts: &[AccountInfo<'info>],
    data: Vec<u8>,
    signer: &Pubkey,
    signer_seeds: &[&[u8]],
    owner: &Pubkey,
) -> Result<()> {
    let metas = route_accounts
        .iter()
        .map(|account| AccountMeta {
            pubkey: *account.key,
            is_signer: account.key == signer || (account.is_signer && account.key != owner),
            is_writable: account.is_writable,
        })
        .collect();
    let instruction = Instruction {
        program_id: *swap_program.key,
        accounts: metas,
        data,
    };
    invoke_signed(&instruction, route_accounts, &[signer_seeds])?;
    Ok(())
}

pub struct SweepTarget<'a, 'info> {
    pub mint: MintRef<'a, 'info>,
    pub to: &'a AccountInfo<'info>,
}

/// Empties every token account owned by `authority` among `accounts`: tokens
/// of a target mint go to that target, and any other non-zero balance fails
/// the instruction so the authority never keeps funds between instructions.
/// Returns the amount swept per target, in target order.
pub fn sweep_authority_accounts<'info>(
    accounts: &[AccountInfo<'info>],
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    targets: &[SweepTarget<'_, 'info>],
) -> Result<Vec<u64>> {
    let mut swept = vec![0u64; targets.len()];
    for account in accounts {
        let Some(state) = token_state(account) else {
            continue;
        };
        if state.owner != *authority.key || state.amount == 0 {
            continue;
        }
        let (index, target) = targets
            .iter()
            .enumerate()
            .find(|(_, target)| *target.mint.mint.key == state.mint)
            .ok_or(RouterError::InputOverspent)?;
        transfer(
            &target.mint,
            account,
            target.to,
            authority,
            &[signer_seeds],
            state.amount,
        )?;
        swept[index] = swept[index]
            .checked_add(state.amount)
            .ok_or(RouterError::MathOverflow)?;
    }
    Ok(swept)
}
