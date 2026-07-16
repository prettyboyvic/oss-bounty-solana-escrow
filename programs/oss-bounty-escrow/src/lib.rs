#![allow(deprecated, unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

pub mod rules;

use rules::{
    can_cancel, can_fund, can_refund, can_release, validate_initialization, validate_sponsor,
    EscrowError, EscrowStatus,
};

declare_id!("DhTtpYXCdVweT5oD9wnu6eiVZMScBc3nmuNixrwVs9X2");

#[program]
pub mod oss_bounty_escrow {
    use super::*;

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        external_ref_hash: [u8; 32],
        amount: u64,
        expiry: i64,
        maintainer: Pubkey,
        contributor: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_initialization(
            external_ref_hash,
            amount,
            now,
            expiry,
            maintainer,
            contributor,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.sponsor = ctx.accounts.sponsor.key();
        escrow.maintainer = maintainer;
        escrow.contributor = contributor;
        escrow.mint = ctx.accounts.mint.key();
        escrow.vault = ctx.accounts.vault.key();
        escrow.external_ref_hash = external_ref_hash;
        escrow.amount = amount;
        escrow.created_at = now;
        escrow.expiry = expiry;
        escrow.status = EscrowStatus::Initialized;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;

        emit!(EscrowInitialized {
            escrow: escrow.key(),
            sponsor: escrow.sponsor,
            maintainer,
            contributor,
            mint: escrow.mint,
            vault: escrow.vault,
            external_ref_hash,
            amount,
            expiry,
        });

        Ok(())
    }

    pub fn cancel(ctx: Context<SponsorAction>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.status = can_cancel(escrow.status)?;

        emit!(EscrowCancelled {
            escrow: escrow.key(),
            sponsor: escrow.sponsor,
        });

        Ok(())
    }

    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let now = Clock::get()?.unix_timestamp;
        let next_status = can_fund(escrow.status, now, escrow.expiry)?;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.sponsor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.sponsor.to_account_info(),
                },
            ),
            escrow.amount,
            ctx.accounts.mint.decimals,
        )?;

        escrow.status = next_status;

        emit!(EscrowFunded {
            escrow: escrow.key(),
            sponsor: escrow.sponsor,
            amount: escrow.amount,
        });

        Ok(())
    }

    pub fn release(ctx: Context<ReleaseEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let now = Clock::get()?.unix_timestamp;
        let next_status = can_release(escrow.status, now, escrow.expiry)?;
        let sponsor = escrow.sponsor;
        let external_ref_hash = escrow.external_ref_hash;
        let bump = [escrow.bump];
        let signer_seeds: &[&[u8]] = &[
            b"escrow",
            sponsor.as_ref(),
            external_ref_hash.as_ref(),
            &bump,
        ];
        let signer = &[signer_seeds];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.contributor_token.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer,
            ),
            escrow.amount,
            ctx.accounts.mint.decimals,
        )?;

        escrow.status = next_status;

        emit!(EscrowReleased {
            escrow: escrow.key(),
            maintainer: escrow.maintainer,
            contributor: escrow.contributor,
            amount: escrow.amount,
        });

        Ok(())
    }

    pub fn refund(ctx: Context<RefundEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        validate_sponsor(escrow.sponsor, ctx.accounts.sponsor.key())?;
        let now = Clock::get()?.unix_timestamp;
        let next_status = can_refund(escrow.status, now, escrow.expiry)?;
        let sponsor = escrow.sponsor;
        let external_ref_hash = escrow.external_ref_hash;
        let bump = [escrow.bump];
        let signer_seeds: &[&[u8]] = &[
            b"escrow",
            sponsor.as_ref(),
            external_ref_hash.as_ref(),
            &bump,
        ];
        let signer = &[signer_seeds];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.sponsor_token.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer,
            ),
            escrow.amount,
            ctx.accounts.mint.decimals,
        )?;

        escrow.status = next_status;

        emit!(EscrowRefunded {
            escrow: escrow.key(),
            sponsor: escrow.sponsor,
            amount: escrow.amount,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(external_ref_hash: [u8; 32])]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", sponsor.key().as_ref(), external_ref_hash.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = sponsor,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SponsorAction<'info> {
    pub sponsor: Signer<'info>,
    #[account(mut, has_one = sponsor)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor
    )]
    pub sponsor_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        has_one = sponsor,
        has_one = mint,
        has_one = vault @ EscrowError::InvalidVault
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    pub maintainer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        has_one = maintainer,
        has_one = mint,
        has_one = vault @ EscrowError::InvalidVault
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        constraint = contributor_token.owner == escrow.contributor
            @ EscrowError::InvalidContributorTokenOwner
    )]
    pub contributor_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundEscrow<'info> {
    pub sponsor: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        has_one = mint,
        has_one = vault @ EscrowError::InvalidVault
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor
    )]
    pub sponsor_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub sponsor: Pubkey,
    pub maintainer: Pubkey,
    pub contributor: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub external_ref_hash: [u8; 32],
    pub amount: u64,
    pub created_at: i64,
    pub expiry: i64,
    pub status: EscrowStatus,
    pub bump: u8,
    pub vault_bump: u8,
}

#[event]
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub sponsor: Pubkey,
    pub maintainer: Pubkey,
    pub contributor: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub external_ref_hash: [u8; 32],
    pub amount: u64,
    pub expiry: i64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub sponsor: Pubkey,
}

#[event]
pub struct EscrowFunded {
    pub escrow: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub maintainer: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
}
