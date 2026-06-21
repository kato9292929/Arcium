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
 *   The Worker stays a THIN layer. It does NOT import anchor/@arcium-hq/client
 *   (those need Node and cannot run in a Worker). Per the M0-② decision
 *   (verification off the hot path), the real encrypt→queue→finalize→decrypt
 *   round-trip lives in the independent Node module `arcium-mxe/client`
 *   (X402ArciumClient), typically fronted by a small "charger" HTTP service.
 *   When `chargerUrl` is configured, this module just delegates to it and
 *   consumes the boolean result. If no charger is configured, the real path is
 *   unavailable and throws (mock mode still works).
 *
 *   STATUS: M5 DRAFT — UNVERIFIED. The charger request/response contract below
 *   is provisional until the program is built (M3) and deployed to devnet (M4).
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
  /** M5: URL of the Node charger service (arcium-mxe/client). Real path only. */
  chargerUrl?: string;
}

/**
 * Real path (M5 DRAFT): delegate the charge decision to the Node charger service.
 *
 * Contract (provisional, finalized after M3/M4): POST { agent, price } →
 * { paid_ok: boolean, computationId: string }. The service runs
 * X402ArciumClient.charge() against Arcium and returns only the boolean.
 */
async function chargeViaService(
  opts: ArciumVerifyOptions,
): Promise<MXEVerifyResponse> {
  const res = await fetch(`${opts.chargerUrl!.replace(/\/$/, "")}/charge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      agent: opts.senderWallet,
      price: opts.requiredAmount,
    }),
  });

  if (!res.ok) {
    throw new Error(`Charger service error: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { paid_ok?: boolean; computationId?: string };
  return {
    valid: body.paid_ok === true,
    computationId: body.computationId ?? "unknown",
    clusterSignature: "charger-service",
  };
}

/**
 * Verify a payment.
 *
 * Mock mode (ARCIUM_MXE_ID === "mock" or absent) returns a deterministic result
 * driven by the amount comparison only — NO real encryption, NO real MPC.
 *
 * Any other ARCIUM_MXE_ID selects the real path, which delegates to the Node
 * charger service (ARCIUM_CHARGER_URL) — see the module header. UNVERIFIED draft.
 */
export async function verifyPaymentViaMXE(
  opts: ArciumVerifyOptions,
): Promise<MXEVerifyResponse> {
  const isMock = !opts.mxeId || opts.mxeId === "mock";

  if (!isMock) {
    // ── Real path: thin delegation to the off-hot-path charger (M5 DRAFT) ─────
    // The Worker does not run Arcium itself; it asks the charger service (which
    // wraps arcium-mxe/client) to charge the agent's encrypted prepaid balance
    // and returns only the boolean `paid_ok`. UNVERIFIED until M3/M4 land.
    if (!opts.chargerUrl) {
      throw new Error(
        "Real Arcium path requires ARCIUM_CHARGER_URL (the Node charger service " +
          "wrapping arcium-mxe/client). Set ARCIUM_MXE_ID=mock for mock mode. " +
          "See arcium-mxe/README.md and arcium-mxe/client/.",
      );
    }
    return chargeViaService(opts);
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
