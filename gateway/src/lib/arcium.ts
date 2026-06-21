/**
 * Arcium MXE wrapper.
 *
 * ┌─ STATUS ──────────────────────────────────────────────────────────────────┐
 * │ Only the MOCK path below is implemented and exercised. The "real" path is  │
 * │ NOT wired up to the Arcium network — calling it throws NotImplemented.      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Mock path (ARCIUM_MXE_ID absent or === "mock"):
 *   Encryption and MXE execution are replaced by deterministic XOR-based mocks
 *   so the gateway is fully functional for demos. This is NOT real cryptography
 *   and provides NO privacy — it only simulates the shape of the real flow.
 *
 * Real path (a non-"mock" ARCIUM_MXE_ID is configured):
 *   Intended to encrypt sender wallet, transfer amount, and token mint with the
 *   Arcium cluster key and run the verification inside MPC. This is unimplemented.
 *   The real Arcium TypeScript SDK is `@arcium-hq/client` (+ `@arcium-hq/reader`),
 *   and real computations are asynchronous: the gateway queues a computation
 *   on-chain and receives the result via callback/polling — there is no
 *   synchronous request→response `executeMXE` call as sketched in the old stub.
 *   See https://ts.arcium.com/ and https://docs.arcium.com/developers for the
 *   actual client API and computation lifecycle.
 */

import type { MXEVerifyRequest, MXEVerifyResponse } from "../types.js";

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
 * Verify a payment.
 *
 * Mock mode (ARCIUM_MXE_ID === "mock" or absent) returns a deterministic result
 * driven by the amount comparison only — NO real encryption, NO real MPC.
 *
 * Any other ARCIUM_MXE_ID selects the real path, which is NOT implemented and
 * throws. See the module header for what real Arcium integration requires.
 */
export async function verifyPaymentViaMXE(
  opts: ArciumVerifyOptions,
): Promise<MXEVerifyResponse> {
  const isMock = !opts.mxeId || opts.mxeId === "mock";

  if (!isMock) {
    // ── Real path: NOT IMPLEMENTED ───────────────────────────────────────────
    // Deliberately fail loudly instead of pretending to talk to Arcium.
    // Implementing this requires `@arcium-hq/client`, an on-chain queued
    // computation, and a callback/polling result flow (see module header).
    throw new Error(
      "Real Arcium MXE verification is not implemented. " +
        "Set ARCIUM_MXE_ID=mock to run the gateway in mock mode. " +
        "See https://docs.arcium.com/developers to implement the real path.",
    );
  }

  const senderBytes = pubkeyToBytes(opts.senderWallet);
  const amountBytes = u64ToBytes(opts.transferAmount);
  const mintBytes = pubkeyToBytes(opts.tokenMint);

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
