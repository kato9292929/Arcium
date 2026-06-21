use arcis::*;

// x402 Private Gateway — confidential prepaid-balance instructions.
//
// Ported from the real Arcium examples (arcium-hq/examples: voting, blackjack).
// API surface verified against those repos — see docs/phase2/M2-arcium-reference.md.
//
// Privacy model (M0 decision: encrypted prepaid-balance):
//   • Each agent has an Mxe-owned encrypted `Balance` (USDC base units, 6 decimals).
//   • Deposits accumulate into the encrypted balance (amount stays hidden).
//   • Each API call `charge`s the balance: if sufficient, debit and reveal ONLY a
//     boolean `paid_ok`; the balance and the per-call spend pattern stay encrypted.
//   • The agent (owner) may reveal its own balance.
#[encrypted]
mod circuits {
    use arcis::*;

    /// An agent's prepaid balance, in USDC base units (1 USDC = 1_000_000).
    /// Mxe-owned, persistent encrypted state (mirrors voting's VoteStats).
    pub struct Balance {
        amount: u64,
    }

    /// A deposit (top-up) amount, encrypted by the agent before submission.
    pub struct DepositAmount {
        amount: u64,
    }

    /// A per-call charge (the advertised API price), encrypted before submission.
    pub struct ChargeAmount {
        amount: u64,
    }

    /// Initialize a fresh agent balance at zero (Mxe-owned).
    /// Mirrors voting::init_vote_stats.
    #[instruction]
    pub fn init_balance(mxe: Mxe) -> Enc<Mxe, Balance> {
        let balance = Balance { amount: 0 };
        mxe.from_arcis(balance)
    }

    /// Top up: add an encrypted deposit to the encrypted balance.
    /// Mirrors voting::vote (accumulate into Enc<Mxe, _>).
    #[instruction]
    pub fn deposit(
        deposit_ctxt: Enc<Shared, DepositAmount>,
        balance_ctxt: Enc<Mxe, Balance>,
    ) -> Enc<Mxe, Balance> {
        let deposit = deposit_ctxt.to_arcis();
        let mut balance = balance_ctxt.to_arcis();

        balance.amount += deposit.amount;

        balance_ctxt.owner.from_arcis(balance)
    }

    /// Charge for one API call.
    ///
    /// If `balance >= price`, debit and report `paid_ok = true`; otherwise leave the
    /// balance unchanged and report `paid_ok = false`. The subtraction is computed
    /// unconditionally (no data-dependent branch) so nothing leaks but the boolean.
    /// Only `paid_ok` is revealed — the balance remains encrypted.
    ///
    /// Tuple output `(Enc<Mxe, Balance>, bool)` mirrors blackjack::player_hit.
    #[instruction]
    pub fn charge(
        charge_ctxt: Enc<Shared, ChargeAmount>,
        balance_ctxt: Enc<Mxe, Balance>,
    ) -> (Enc<Mxe, Balance>, bool) {
        let charge = charge_ctxt.to_arcis();
        let mut balance = balance_ctxt.to_arcis();

        let sufficient = balance.amount >= charge.amount;

        // Oblivious debit: subtract the price only when sufficient, otherwise keep
        // the balance. Computed as an expression (Arcis has no early return).
        let debited = balance.amount - charge.amount;
        balance.amount = if sufficient { debited } else { balance.amount };

        (balance_ctxt.owner.from_arcis(balance), sufficient.reveal())
    }

    /// Owner-only readout of the current balance (reveals the u64).
    /// Mirrors voting::reveal_result (authority-gated on the Anchor side).
    #[instruction]
    pub fn reveal_balance(balance_ctxt: Enc<Mxe, Balance>) -> u64 {
        let balance = balance_ctxt.to_arcis();
        balance.amount.reveal()
    }
}
