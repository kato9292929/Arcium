// Shared types for the embedded gateway API routes.

export interface X402PaymentRequired {
  version: number;
  accepts: PaymentOption[];
}

export interface PaymentOption {
  scheme: "exact";
  network: "solana-mainnet";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: Record<string, string>;
}

export interface MXEVerifyRequest {
  encryptedSender: string;
  encryptedAmount: string;
  encryptedMint: string;
  requiredAmount: number;
  expectedRecipient: string;
  expectedMint: string;
}

export interface MXEVerifyResponse {
  valid: boolean;
  computationId: string;
  clusterSignature: string;
}

export interface VerificationResult {
  valid: boolean;
  txSignature: string;
  arciumProof: string;
  mode: "mpc" | "mock";
}
