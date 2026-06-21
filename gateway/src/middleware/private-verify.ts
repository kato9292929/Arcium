/**
 * Private payment verification middleware.
 *
 * Orchestrates the full x402 Private Gateway flow:
 *   1. Extract X-PAYMENT header (tx signature)
 *   2. Fetch raw tx from Helius — don't decode in logs
 *   3. Check on-chain recipient (public data, no privacy loss)
 *   4. Replay check (by signature only — no wallet/amount in KV)
 *   5. Encrypt private fields → send to Arcium MXE
 *   6. Return VerificationResult — only boolean escapes the MXE
 */

import type { Context } from "hono";
import type { Env, VerificationResult } from "../types.js";
import { extractPaymentHeader, build402Response } from "./x402.js";
import type { X402Config } from "./x402.js";
import { fetchParsedPayment, recipientMatches, fetchCurrentSlot, isTxTooOld } from "../lib/solana.js";
import { checkAndMarkUsed } from "../lib/kv.js";
import { verifyPaymentViaMXE } from "../lib/arcium.js";

export async function privateVerify(
  c: Context<{ Bindings: Env }>,
  config: X402Config,
): Promise<VerificationResult | Response> {
  const signature = extractPaymentHeader(c);

  if (!signature) {
    return build402Response(c, config);
  }

  // ── Step 1: Fetch transaction from Helius ──────────────────────────────────
  let payment;
  try {
    payment = await fetchParsedPayment(signature, c.env.HELIUS_API_KEY);
  } catch (err) {
    return c.json(
      { error: "Failed to fetch transaction", detail: String(err) },
      400,
    );
  }

  // ── Step 2: Check on-chain recipient (public, no privacy loss) ─────────────
  if (!recipientMatches(payment, c.env.PAYMENT_WALLET_ADDRESS)) {
    return c.json({ error: "Payment recipient mismatch" }, 400);
  }

  // ── Step 3: Freshness check ────────────────────────────────────────────────
  try {
    const currentSlot = await fetchCurrentSlot(c.env.HELIUS_API_KEY);
    if (isTxTooOld(payment.slot, currentSlot)) {
      return c.json({ error: "Transaction too old" }, 400);
    }
  } catch {
    // Non-fatal — Helius slot endpoint failure should not block payment.
  }

  // ── Step 4: Replay prevention ──────────────────────────────────────────────
  const replayed = await checkAndMarkUsed(c.env.PAYMENT_KV, signature);
  if (replayed) {
    return c.json({ error: "Transaction already used" }, 400);
  }

  // ── Step 5: Arcium MXE — encrypted verification ───────────────────────────
  const isMock = !c.env.ARCIUM_MXE_ID || c.env.ARCIUM_MXE_ID === "mock";

  let mxeResult;
  try {
    mxeResult = await verifyPaymentViaMXE({
      apiKey: c.env.ARCIUM_API_KEY,
      mxeId: c.env.ARCIUM_MXE_ID ?? "mock",
      senderWallet: payment.senderWallet,
      transferAmount: payment.amount,
      tokenMint: payment.tokenMint,
      requiredAmount: config.priceBaseUnits,
      expectedRecipient: c.env.PAYMENT_WALLET_ADDRESS,
      expectedMint: c.env.USDC_MINT,
      // M5 (off the hot path): real path delegates to this Node charger service.
      chargerUrl: c.env.ARCIUM_CHARGER_URL,
    });
  } catch (err) {
    // If MXE call fails, reverse the replay mark so the client can retry.
    // Best-effort — ignore secondary failure.
    try {
      await c.env.PAYMENT_KV.delete(`tx:${signature}`);
    } catch { /* ignore */ }
    return c.json(
      { error: "MXE verification failed", detail: String(err) },
      503,
    );
  }

  if (!mxeResult.valid) {
    // Invalid payment — remove the replay lock so they can't poison a valid tx.
    await c.env.PAYMENT_KV.delete(`tx:${signature}`);
    return c.json({ error: "Payment verification failed" }, 402);
  }

  return {
    valid: true,
    txSignature: signature,
    arciumProof: mxeResult.computationId,
    mode: isMock ? "mock" : "mpc",
  };
}
