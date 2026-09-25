//! Stand-in for the Jupiter program inside LiteSVM tests. It runs a list of
//! token transfers chosen by the test, so a test can model an honest route,
//! a route that pays the wrong account, or one that pulls extra USDC.

use anchor_lang::prelude::*;

declare_id!("7bMVoGnCgMTM3vcoFscGNk4VpPyzVdcxPBtNHR4jAWfc");

pub const VAULT_SEED: &[u8] = b"vault";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct TransferOp {
    /// Sign with the vault PDA instead of relying on a signer passed in.
    pub from_vault: bool,
    pub token_program: u8,
    pub from: u8,
    pub mint: u8,
    pub to: u8,
    pub authority: u8,
    pub amount: u64,
    pub decimals: u8,
}

#[program]
pub mod test_swap {
    use super::*;

    pub fn run<'info>(ctx: Context<'info, Run>, ops: Vec<TransferOp>) -> Result<()> {
        let accounts = ctx.remaining_accounts;
        let vault_bump = Pubkey::find_program_address(&[VAULT_SEED], &crate::ID).1;
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
        for op in ops {
            let program = &accounts[op.token_program as usize];
            let cpi_accounts = anchor_spl::token_interface::TransferChecked {
                from: accounts[op.from as usize].clone(),
                mint: accounts[op.mint as usize].clone(),
                to: accounts[op.to as usize].clone(),
                authority: accounts[op.authority as usize].clone(),
            };
            if op.from_vault {
                let signer_seeds = &[vault_seeds];
                let cpi = CpiContext::new_with_signer(program.key(), cpi_accounts, signer_seeds);
                anchor_spl::token_interface::transfer_checked(cpi, op.amount, op.decimals)?;
            } else {
                let cpi = CpiContext::new(program.key(), cpi_accounts);
                anchor_spl::token_interface::transfer_checked(cpi, op.amount, op.decimals)?;
            }
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Run {}
