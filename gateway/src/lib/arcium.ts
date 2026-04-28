/**
 * Arcium SDK wrapper — MXE invocation with mock fallback.
 *
 * When ARCIUM_MXE_ID is absent (local dev / CI), all encryption and MXE
 * calls are replaced by deterministic mocks so the gateway remains fully
 * functional for demo purposes.
 *
 * Privacy guarantee: sender wallet, transfer amount, and token mint are
 * encrypted with the Arcium cluster's public key *before* leaving this
 * module.  They never appear in logs, KV, or response bodies.
 */

import type { MXEVerifyRequest, MXEVerifyResponse } from "../types.js";

// Lazy-loaded only when a real MXE_ID is configured.
type ArciumClient = {
  encrypt(data: Uint8Array): Promise<string>;
  executeMXE(mxeId: string, inputs: Record<string, unknown>): Promise<{ output: { payment_valid: boolean }; computationId: string; clusterSignature: string }>;
};

let _client: ArciumClient | null = null;

async function getClient(apiKey: string): Promise<ArciumClient> {
  if (_client) return _client;

  // Dynamic import so the Worker doesn't hard-fail when the SDK is absent.
  try {
    const { ArciumClient: AC } = await import("@arcium-hq/arcium-js");
    _client = new AC({ apiKey }) as unknown as ArciumClient;
    return _client;
  } catch {
    throw new Error("@arcium-hq/arcium-js not installed — set ARCIUM_MXE_ID=mock to use mock mode");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pubkeyToBytes(base58: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of base58) {
    const d = ALPHABET.indexOf(ch);
    if (d < 0) throw new Error(`Invalid base58 char: ${ch}`);
    n = n * 58n + BigInt(d);
  }
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

function u64ToBytes(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

// ── Mock implementation (no real crypto) ─────────────────────────────────────

function mockEncrypt(data: Uint8Array): string {
  // XOR with a static "key" and base64-encode — not real crypto, demo only.
  const masked = data.map((b, i) => b ^ (0x42 + i));
  return btoa(String.fromCharCode(...masked));
}

function mockExecuteMXE(
  inputs: MXEVerifyRequest,
): MXEVerifyResponse {
  // Decode the mock-encrypted amount to check it.
  const encAmount = Uint8Array.from(atob(inputs.encryptedAmount), c => c.charCodeAt(0));
  const amountBytes = encAmount.map((b, i) => b ^ (0x42 + i));

  let amount = 0n;
  for (const byte of amountBytes) {
    amount = (amount << 8n) | BigInt(byte);
  }

  const valid = amount >= BigInt(inputs.requiredAmount);

  return {
    valid,
    computationId: `mock-${Date.now()}`,
    clusterSignature: "mock-signature-arcium-not-configured",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ArciumVerifyOptions {
  apiKey: string;
  mxeId: string;
  senderWallet: string;
  transferAmount: bigint;
  tokenMint: string;
  requiredAmount: number;
  expectedRecipient: string;
  expectedMint: string;
}

/**
 * Encrypt payment fields and invoke the Arcium MXE to get a single boolean.
 * In mock mode (ARCIUM_MXE_ID === "mock" or absent) this returns a
 * deterministic result driven by the amount comparison only.
 */
export async function verifyPaymentViaMXE(
  opts: ArciumVerifyOptions,
): Promise<MXEVerifyResponse> {
  const isMock = !opts.mxeId || opts.mxeId === "mock";

  const senderBytes = pubkeyToBytes(opts.senderWallet);
  const amountBytes = u64ToBytes(opts.transferAmount);
  const mintBytes = pubkeyToBytes(opts.tokenMint);

  if (isMock) {
    const req: MXEVerifyRequest = {
      encryptedSender: mockEncrypt(senderBytes),
      encryptedAmount: mockEncrypt(amountBytes),
      encryptedMint: mockEncrypt(mintBytes),
      requiredAmount: opts.requiredAmount,
      expectedRecipient: opts.expectedRecipient,
      expectedMint: opts.expectedMint,
    };
    return mockExecuteMXE(req);
  }

  // Real path — encrypt with cluster public key then invoke MXE.
  const client = await getClient(opts.apiKey);

  const [encSender, encAmount, encMint] = await Promise.all([
    client.encrypt(senderBytes),
    client.encrypt(amountBytes),
    client.encrypt(mintBytes),
  ]);

  const result = await client.executeMXE(opts.mxeId, {
    encrypted_sender: encSender,
    encrypted_amount: encAmount,
    encrypted_mint: encMint,
    required_amount: opts.requiredAmount,
    expected_recipient: opts.expectedRecipient,
    expected_mint: opts.expectedMint,
  });

  return {
    valid: result.output.payment_valid,
    computationId: result.computationId,
    clusterSignature: result.clusterSignature,
  };
}
