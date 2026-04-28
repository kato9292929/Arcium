/**
 * Solana / Helius helpers — fetch raw transaction data and parse the USDC
 * transfer details needed for MXE encryption.
 *
 * We deliberately avoid full transaction decoding in logs to prevent wallet
 * addresses and amounts from appearing in plaintext outside the MXE path.
 */

import type { ParsedPayment } from "../types.js";

interface HeliusEnhancedTx {
  signature: string;
  slot: number;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
  accountData?: Array<{ account: string }>;
}

export async function fetchParsedPayment(
  signature: string,
  heliusApiKey: string,
): Promise<ParsedPayment> {
  const url = `https://api.helius.xyz/v0/transactions?api-key=${heliusApiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: [signature] }),
  });

  if (!res.ok) {
    throw new Error(`Helius API error: ${res.status}`);
  }

  const txs = (await res.json()) as HeliusEnhancedTx[];
  const tx = txs[0];

  if (!tx) {
    throw new Error(`Transaction not found: ${signature}`);
  }

  const transfer = tx.tokenTransfers?.[0];
  if (!transfer) {
    throw new Error(`No token transfer found in transaction: ${signature}`);
  }

  // Convert float amount to base units — Helius returns human-readable float.
  // 1 USDC = 1_000_000 base units (6 decimals).
  const amountBaseUnits = BigInt(Math.round(transfer.tokenAmount * 1_000_000));

  return {
    signature,
    senderWallet: transfer.fromUserAccount,
    recipientWallet: transfer.toUserAccount,
    amount: amountBaseUnits,
    tokenMint: transfer.mint,
    slot: tx.slot,
  };
}

/**
 * Verify that the on-chain recipient matches the gateway wallet.
 * This check is done in plaintext because both values are already public.
 */
export function recipientMatches(
  payment: ParsedPayment,
  expectedRecipient: string,
): boolean {
  return payment.recipientWallet === expectedRecipient;
}

/**
 * Check that a transaction is recent enough to be valid (prevents use of old
 * transactions as payment tokens).  Helius does not return a timestamp in all
 * endpoints, so we use slot distance as a proxy — ~400ms per slot on mainnet.
 */
export async function fetchCurrentSlot(heliusApiKey: string): Promise<number> {
  const url = `https://api.helius.xyz/v0/rpc?api-key=${heliusApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
  });
  if (!res.ok) throw new Error(`Helius RPC error: ${res.status}`);
  const json = (await res.json()) as { result: number };
  return json.result;
}

/** Maximum slot age (~5 minutes at ~400ms/slot) */
const MAX_SLOT_AGE = 750;

export function isTxTooOld(txSlot: number, currentSlot: number): boolean {
  return currentSlot - txSlot > MAX_SLOT_AGE;
}
