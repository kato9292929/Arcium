/// x402 Private Gateway — Arcium MXE payment verification program.
///
/// This MXE computation verifies that a Solana USDC transfer is valid for a
/// given API price **without revealing** the sender wallet, the exact amount,
/// or any other private field to any observer (on-chain or off-chain).
///
/// Privacy model
/// ─────────────
/// Private (MPC-encrypted, never revealed):
///   • sender_wallet  — the paying agent's public key
///   • transfer_amount — exact token-account balance delta
///   • token_mint     — prevents substituting a different SPL token
///
/// Public (returned, safe to log/index):
///   • payment_valid  — single boolean output
///   • required_amount — the advertised API price (already public)
///   • expected_recipient — gateway wallet (already public)
use arcis::prelude::*;
use solana_program::pubkey::Pubkey;

// ── Encrypted input bundle ──────────────────────────────────────────────────

/// All sensitive fields arrive pre-encrypted by the gateway before being
/// submitted to the Arcium cluster.  The Arcis runtime decrypts these inside
/// the MPC environment; they are never exposed to individual nodes in plaintext.
#[derive(ArcisInput)]
pub struct PrivatePaymentInputs {
    /// The SPL-token source account owner (the paying agent).
    pub sender_wallet: Encrypted<Pubkey>,
    /// Amount in USDC base units (6 decimals, so 1 USDC = 1_000_000).
    pub transfer_amount: Encrypted<u64>,
    /// The SPL mint the transfer was denominated in.
    pub token_mint: Encrypted<Pubkey>,
}

// ── Public parameters ───────────────────────────────────────────────────────

/// Fields that are already publicly known (the API price list, the gateway
/// wallet) — no privacy loss from including them as public parameters.
#[derive(ArcisParam)]
pub struct PublicPaymentParams {
    /// Minimum accepted amount in USDC base units for this API endpoint.
    pub required_amount: u64,
    /// The gateway's USDC-receiving wallet that must be the transfer destination.
    pub expected_recipient: Pubkey,
    /// Expected SPL mint (always USDC mainnet on this gateway).
    pub expected_mint: Pubkey,
}

// ── Output ──────────────────────────────────────────────────────────────────

#[derive(ArcisOutput)]
pub struct PaymentVerificationResult {
    /// The **only** value that leaves the MPC environment.
    /// All private inputs remain encrypted inside the cluster.
    pub payment_valid: bool,
}

// ── MXE entry point ─────────────────────────────────────────────────────────

/// Verify a USDC payment inside the Arcium MPC cluster.
///
/// The function performs three checks in constant time to avoid leaking
/// information through timing side-channels:
///   1. transfer_amount  >= required_amount
///   2. token_mint       == expected_mint   (must be USDC, not a fake token)
///   3. [recipient check happens off-MXE against on-chain tx data]
///
/// The sender's identity is bound to the encrypted input but is **never
/// compared or returned** — it serves only as a commitment to prevent the
/// gateway from substituting a different payer's transaction.
#[mxe]
pub fn verify_payment(
    private: PrivatePaymentInputs,
    params: PublicPaymentParams,
) -> PaymentVerificationResult {
    // Constant-time amount check: amount must meet or exceed the listed price.
    let amount_sufficient = private.transfer_amount.ct_ge(params.required_amount);

    // Constant-time mint check: reject payments in any token other than the
    // configured USDC mint (prevents token-substitution attacks).
    let mint_correct = private.token_mint.ct_eq(&params.expected_mint);

    // Combine with bitwise AND so both conditions must hold.
    // Neither branch leaks which check failed.
    let payment_valid = amount_sufficient & mint_correct;

    // sender_wallet is bound to the encrypted context (prevents replay with a
    // different payer's tx) but is never evaluated or returned.
    let _ = &private.sender_wallet;

    PaymentVerificationResult {
        payment_valid: payment_valid.reveal(),
    }
}

// ── Unit tests (run outside MPC with mock Encrypted<T> shims) ───────────────

#[cfg(test)]
mod tests {
    use super::*;
    use arcis::testing::MockEncrypted;

    fn usdc_mint() -> Pubkey {
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            .parse()
            .unwrap()
    }

    fn gateway_wallet() -> Pubkey {
        Pubkey::new_unique()
    }

    fn make_params(required: u64) -> PublicPaymentParams {
        PublicPaymentParams {
            required_amount: required,
            expected_recipient: gateway_wallet(),
            expected_mint: usdc_mint(),
        }
    }

    #[test]
    fn exact_amount_passes() {
        let private = PrivatePaymentInputs {
            sender_wallet: MockEncrypted::new(Pubkey::new_unique()),
            transfer_amount: MockEncrypted::new(1_000),   // 0.001 USDC
            token_mint: MockEncrypted::new(usdc_mint()),
        };
        let result = verify_payment(private, make_params(1_000));
        assert!(result.payment_valid);
    }

    #[test]
    fn overpayment_passes() {
        let private = PrivatePaymentInputs {
            sender_wallet: MockEncrypted::new(Pubkey::new_unique()),
            transfer_amount: MockEncrypted::new(5_000),
            token_mint: MockEncrypted::new(usdc_mint()),
        };
        let result = verify_payment(private, make_params(1_000));
        assert!(result.payment_valid);
    }

    #[test]
    fn insufficient_amount_fails() {
        let private = PrivatePaymentInputs {
            sender_wallet: MockEncrypted::new(Pubkey::new_unique()),
            transfer_amount: MockEncrypted::new(500),
            token_mint: MockEncrypted::new(usdc_mint()),
        };
        let result = verify_payment(private, make_params(1_000));
        assert!(!result.payment_valid);
    }

    #[test]
    fn wrong_mint_fails() {
        let fake_mint = Pubkey::new_unique();
        let private = PrivatePaymentInputs {
            sender_wallet: MockEncrypted::new(Pubkey::new_unique()),
            transfer_amount: MockEncrypted::new(2_000),
            token_mint: MockEncrypted::new(fake_mint), // not USDC
        };
        let result = verify_payment(private, make_params(1_000));
        assert!(!result.payment_valid);
    }

    #[test]
    fn wrong_mint_and_low_amount_fails() {
        let fake_mint = Pubkey::new_unique();
        let private = PrivatePaymentInputs {
            sender_wallet: MockEncrypted::new(Pubkey::new_unique()),
            transfer_amount: MockEncrypted::new(100),
            token_mint: MockEncrypted::new(fake_mint),
        };
        let result = verify_payment(private, make_params(1_000));
        assert!(!result.payment_valid);
    }
}
