use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

// x402 Private Gateway — Anchor program wrapping the confidential prepaid-balance
// instructions. Structure ported from arcium-hq/examples (voting + blackjack).
// See docs/phase2/M2-arcium-reference.md. STATUS: M3 draft, build-unverified
// (requires `arcium build` / `arcium test` on a real toolchain — see arcium-mxe/README.md).

const COMP_DEF_OFFSET_INIT_BALANCE: u32 = comp_def_offset("init_balance");
const COMP_DEF_OFFSET_DEPOSIT: u32 = comp_def_offset("deposit");
const COMP_DEF_OFFSET_CHARGE: u32 = comp_def_offset("charge");
const COMP_DEF_OFFSET_REVEAL_BALANCE: u32 = comp_def_offset("reveal_balance");

// Placeholder program id — replace with the address printed by `arcium init` /
// `anchor keys list` after scaffolding (mirrors voting's declare_id!).
declare_id!("11111111111111111111111111111111");

// AgentBalance.balance_state holds one 32-byte ciphertext for the single u64 amount.
// Offset = 8 (account discriminator) + 1 (bump), matching voting's poll_acc layout.
const AGENT_BALANCE_STATE_OFFSET: u32 = 8 + 1;
const AGENT_BALANCE_STATE_SIZE: u32 = 32 * 1;

#[arcium_program]
pub mod x402_gateway {
    use super::*;

    // ── init_balance ──────────────────────────────────────────────────────────

    pub fn init_balance_comp_def(ctx: Context<InitBalanceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Open a fresh encrypted prepaid balance (zero) for `authority` (the agent).
    pub fn open_balance(ctx: Context<OpenBalance>, computation_offset: u64) -> Result<()> {
        ctx.accounts.agent_balance.bump = ctx.bumps.agent_balance;
        ctx.accounts.agent_balance.authority = ctx.accounts.authority.key();
        ctx.accounts.agent_balance.balance_state = [[0; 32]; 1];

        let args = ArgBuilder::new().build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![InitBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.agent_balance.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_balance")]
    pub fn init_balance_callback(
        ctx: Context<InitBalanceCallback>,
        output: SignedComputationOutputs<InitBalanceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitBalanceOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.agent_balance.balance_state = o.ciphertexts;
        ctx.accounts.agent_balance.nonce = o.nonce;
        Ok(())
    }

    // ── deposit ───────────────────────────────────────────────────────────────

    pub fn deposit_comp_def(ctx: Context<DepositCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Top up the agent's encrypted balance by an encrypted deposit amount.
    pub fn deposit(
        ctx: Context<Deposit>,
        computation_offset: u64,
        deposit_amount: [u8; 32],
        deposit_encryption_pubkey: [u8; 32],
        deposit_nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(deposit_encryption_pubkey)
            .plaintext_u128(deposit_nonce)
            .encrypted_u64(deposit_amount)
            .plaintext_u128(ctx.accounts.agent_balance.nonce)
            .account(
                ctx.accounts.agent_balance.key(),
                AGENT_BALANCE_STATE_OFFSET,
                AGENT_BALANCE_STATE_SIZE,
            )
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![DepositCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.agent_balance.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "deposit")]
    pub fn deposit_callback(
        ctx: Context<DepositCallback>,
        output: SignedComputationOutputs<DepositOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(DepositOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.agent_balance.balance_state = o.ciphertexts;
        ctx.accounts.agent_balance.nonce = o.nonce;

        emit!(DepositEvent {
            agent_balance: ctx.accounts.agent_balance.key(),
        });
        Ok(())
    }

    // ── charge (the 402 gate) ──────────────────────────────────────────────────

    pub fn charge_comp_def(ctx: Context<ChargeCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Charge the agent's encrypted balance by an encrypted price. Debits only if
    /// sufficient; reveals only the boolean `paid_ok` via ChargeEvent.
    pub fn charge(
        ctx: Context<Charge>,
        computation_offset: u64,
        charge_amount: [u8; 32],
        charge_encryption_pubkey: [u8; 32],
        charge_nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(charge_encryption_pubkey)
            .plaintext_u128(charge_nonce)
            .encrypted_u64(charge_amount)
            .plaintext_u128(ctx.accounts.agent_balance.nonce)
            .account(
                ctx.accounts.agent_balance.key(),
                AGENT_BALANCE_STATE_OFFSET,
                AGENT_BALANCE_STATE_SIZE,
            )
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![ChargeCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.agent_balance.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "charge")]
    pub fn charge_callback(
        ctx: Context<ChargeCallback>,
        output: SignedComputationOutputs<ChargeOutput>,
    ) -> Result<()> {
        // Tuple output (Enc<Mxe, Balance>, bool): field_0.field_0 = encrypted balance,
        // field_0.field_1 = revealed paid_ok. Pattern from blackjack::player_hit_callback.
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(ChargeOutput {
                field_0:
                    ChargeOutputStruct0 {
                        field_0: new_balance,
                        field_1: paid_ok,
                    },
            }) => (new_balance, paid_ok),
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.agent_balance.balance_state = o.0.ciphertexts;
        ctx.accounts.agent_balance.nonce = o.0.nonce;

        emit!(ChargeEvent {
            agent_balance: ctx.accounts.agent_balance.key(),
            paid_ok: o.1,
        });
        Ok(())
    }

    // ── reveal_balance (owner-only) ────────────────────────────────────────────

    pub fn reveal_balance_comp_def(ctx: Context<RevealBalanceCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    /// Owner-only: reveal the agent's own current balance via RevealBalanceEvent.
    pub fn reveal_balance(ctx: Context<RevealBalance>, computation_offset: u64) -> Result<()> {
        require!(
            ctx.accounts.payer.key() == ctx.accounts.agent_balance.authority,
            ErrorCode::InvalidAuthority
        );

        let args = ArgBuilder::new()
            .plaintext_u128(ctx.accounts.agent_balance.nonce)
            .account(
                ctx.accounts.agent_balance.key(),
                AGENT_BALANCE_STATE_OFFSET,
                AGENT_BALANCE_STATE_SIZE,
            )
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RevealBalanceCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "reveal_balance")]
    pub fn reveal_balance_callback(
        ctx: Context<RevealBalanceCallback>,
        output: SignedComputationOutputs<RevealBalanceOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RevealBalanceOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(RevealBalanceEvent { amount: o });
        Ok(())
    }
}

// ── Account contexts ──────────────────────────────────────────────────────────
// These mirror voting's queue/callback/comp-def account structs (same PDA derive
// macros and fixed Arcium addresses).

#[init_computation_definition_accounts("init_balance", payer)]
#[derive(Accounts)]
pub struct InitBalanceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by the arcium program (not yet initialized).
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by the arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("init_balance", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct OpenBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the agent that owns the balance being opened.
    pub authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        init,
        payer = payer,
        space = 8 + AgentBalance::INIT_SPACE,
        seeds = [b"balance", authority.key().as_ref()],
        bump,
    )]
    pub agent_balance: Account<'info, AgentBalance>,
}

#[callback_accounts("init_balance")]
#[derive(Accounts)]
pub struct InitBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via callback constraints.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub agent_balance: Account<'info, AgentBalance>,
}

#[init_computation_definition_accounts("deposit", payer)]
#[derive(Accounts)]
pub struct DepositCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by the arcium program (not yet initialized).
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by the arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("deposit", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the agent that owns the balance.
    pub authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DEPOSIT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"balance", authority.key().as_ref()],
        bump = agent_balance.bump,
        has_one = authority,
    )]
    pub agent_balance: Box<Account<'info, AgentBalance>>,
}

#[callback_accounts("deposit")]
#[derive(Accounts)]
pub struct DepositCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_DEPOSIT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via callback constraints.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub agent_balance: Account<'info, AgentBalance>,
}

#[init_computation_definition_accounts("charge", payer)]
#[derive(Accounts)]
pub struct ChargeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by the arcium program (not yet initialized).
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by the arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("charge", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Charge<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the agent that owns the balance being charged.
    pub authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHARGE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        mut,
        seeds = [b"balance", authority.key().as_ref()],
        bump = agent_balance.bump,
        has_one = authority,
    )]
    pub agent_balance: Box<Account<'info, AgentBalance>>,
}

#[callback_accounts("charge")]
#[derive(Accounts)]
pub struct ChargeCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHARGE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via callback constraints.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub agent_balance: Account<'info, AgentBalance>,
}

#[init_computation_definition_accounts("reveal_balance", payer)]
#[derive(Accounts)]
pub struct RevealBalanceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by the arcium program (not yet initialized).
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by the arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("reveal_balance", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RevealBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        seeds = [b"balance", payer.key().as_ref()],
        bump = agent_balance.bump,
    )]
    pub agent_balance: Account<'info, AgentBalance>,
}

#[callback_accounts("reveal_balance")]
#[derive(Accounts)]
pub struct RevealBalanceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_BALANCE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via callback constraints.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
}

// ── State / events / errors ────────────────────────────────────────────────────

/// An agent's confidential prepaid balance.
#[account]
#[derive(InitSpace)]
pub struct AgentBalance {
    /// PDA bump seed.
    pub bump: u8,
    /// Encrypted balance: one 32-byte ciphertext for the single u64 amount.
    pub balance_state: [[u8; 32]; 1],
    /// The agent that owns this balance.
    pub authority: Pubkey,
    /// Cryptographic nonce for the encrypted balance.
    pub nonce: u128,
}

#[event]
pub struct DepositEvent {
    pub agent_balance: Pubkey,
}

#[event]
pub struct ChargeEvent {
    pub agent_balance: Pubkey,
    /// The only value revealed by the charge computation.
    pub paid_ok: bool,
}

#[event]
pub struct RevealBalanceEvent {
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
