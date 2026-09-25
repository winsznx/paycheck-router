use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

declare_id!("54dbPLMwUVWP4fGock1iznSChCecnzmpQ3uNmcskztyi");

#[program]
pub mod cpi_probe {
    use super::*;

    pub fn swap_as_pda<'info>(
        ctx: Context<'info, SwapAsPda<'info>>,
        router: Pubkey,
        data: Vec<u8>,
    ) -> Result<()> {
        let (authority, bump) = Pubkey::find_program_address(&[b"authority", router.as_ref()], &crate::ID);
        let metas: Vec<AccountMeta> = ctx
            .remaining_accounts
            .iter()
            .map(|a| AccountMeta {
                pubkey: *a.key,
                is_signer: a.is_signer || *a.key == authority,
                is_writable: a.is_writable,
            })
            .collect();
        let ix = Instruction {
            program_id: *ctx.accounts.jupiter_program.key,
            accounts: metas,
            data,
        };
        let seeds: &[&[u8]] = &[b"authority", router.as_ref(), &[bump]];
        invoke_signed(&ix, ctx.remaining_accounts, &[seeds])?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct SwapAsPda<'info> {
    /// CHECK: probe only; the Jupiter program invoked by CPI
    pub jupiter_program: UncheckedAccount<'info>,
}
