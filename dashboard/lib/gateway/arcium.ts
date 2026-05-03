// Mock Arcium MXE verification — identical logic to gateway/src/lib/arcium.ts.
// Returns payment_valid: true when the mock-encrypted amount >= required.

import type { MXEVerifyRequest, MXEVerifyResponse, VerificationResult } from "./types";

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

function mockEncrypt(data: Uint8Array): string {
  const masked = data.map((b, i) => b ^ (0x42 + i));
  return btoa(String.fromCharCode(...masked));
}

function mockExecuteMXE(inputs: MXEVerifyRequest): MXEVerifyResponse {
  const encAmount = Uint8Array.from(atob(inputs.encryptedAmount), c => c.charCodeAt(0));
  const amountBytes = encAmount.map((b, i) => b ^ (0x42 + i));
  let amount = 0n;
  for (const byte of amountBytes) amount = (amount << 8n) | BigInt(byte);

  return {
    valid: amount >= BigInt(inputs.requiredAmount),
    computationId: `mock-${Date.now()}`,
    clusterSignature: "mock-signature-arcium-not-configured",
  };
}

export async function verifyPaymentMock(
  senderWallet: string,
  transferAmount: bigint,
  tokenMint: string,
  requiredAmount: number,
  expectedRecipient: string,
  expectedMint: string,
): Promise<VerificationResult> {
  const req: MXEVerifyRequest = {
    encryptedSender: mockEncrypt(pubkeyToBytes(senderWallet)),
    encryptedAmount: mockEncrypt(u64ToBytes(transferAmount)),
    encryptedMint:   mockEncrypt(pubkeyToBytes(tokenMint)),
    requiredAmount,
    expectedRecipient,
    expectedMint,
  };
  const result = mockExecuteMXE(req);
  return {
    valid: result.valid,
    txSignature: "mock",
    arciumProof: result.computationId,
    mode: "mock",
  };
}
