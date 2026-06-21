/// <reference types="@cloudflare/workers-types" />

// ── Environment bindings (Cloudflare Worker) ─────────────────────────────────

export interface Env {
  // KV namespace for replay prevention
  PAYMENT_KV: KVNamespace;

  // Secrets (set via wrangler secret put)
  HELIUS_API_KEY: string;
  ARCIUM_API_KEY: string;
  ARCIUM_MXE_ID: string;
  PAYMENT_WALLET_ADDRESS: string;
  CMC_API_KEY: string;

  // M5 (off the hot path): URL of the Node "charger" service that runs the real
  // Arcium round-trip via arcium-mxe/client. The Worker only delegates to it and
  // consumes the boolean result — it never imports anchor/@arcium-hq/client.
  // Optional; absent ⇒ real path is unavailable (mock mode still works).
  ARCIUM_CHARGER_URL?: string;

  // Vars (set in wrangler.toml)
  USDC_MINT: string;
}

// ── x402 protocol types ───────────────────────────────────────────────────────

export interface X402PaymentRequired {
  version: number;
  accepts: PaymentOption[];
  error?: string;
}

export interface PaymentOption {
  scheme: "exact";
  network: "solana-mainnet" | "solana-devnet";
  maxAmountRequired: string;      // USDC base units as string
  resource: string;               // the requested URL path
  description: string;
  mimeType: string;
  payTo: string;                  // gateway wallet address
  maxTimeoutSeconds: number;
  asset: string;                  // USDC mint address
  extra?: Record<string, string>;
}

export interface ParsedPayment {
  signature: string;
  senderWallet: string;           // never logged in plaintext
  recipientWallet: string;
  amount: bigint;                 // USDC base units
  tokenMint: string;
  slot: number;
}

// ── Arcium MXE types ──────────────────────────────────────────────────────────

export interface MXEVerifyRequest {
  encryptedSender: string;        // base64-encoded ciphertext
  encryptedAmount: string;        // base64-encoded ciphertext
  encryptedMint: string;          // base64-encoded ciphertext
  requiredAmount: number;         // plaintext (public price)
  expectedRecipient: string;      // plaintext (gateway wallet)
  expectedMint: string;           // plaintext (USDC mint)
}

export interface MXEVerifyResponse {
  valid: boolean;
  computationId: string;
  clusterSignature: string;
}

// ── Verification result ───────────────────────────────────────────────────────

export interface VerificationResult {
  valid: boolean;
  txSignature: string;
  /** Arcium computation proof — safe to include in response headers */
  arciumProof: string;
  mode: "mpc" | "mock";
}

// ── API endpoint config ───────────────────────────────────────────────────────

export interface EndpointConfig {
  priceUsdc: number;              // USDC base units (6 decimals)
  description: string;
  upstreamUrl: (env: Env, params?: Record<string, string>) => string;
}
