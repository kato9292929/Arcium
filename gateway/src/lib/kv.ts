/// <reference types="@cloudflare/workers-types" />
/**
 * KV-backed replay prevention.
 *
 * Each accepted tx signature is stored with a 24-hour TTL.  The key is the
 * raw signature — no wallet address or amount is stored alongside it.
 */

const TTL_SECONDS = 86_400; // 24 hours

export async function isReplay(
  kv: KVNamespace,
  txSignature: string,
): Promise<boolean> {
  const existing = await kv.get(`tx:${txSignature}`);
  return existing !== null;
}

export async function markUsed(
  kv: KVNamespace,
  txSignature: string,
): Promise<void> {
  await kv.put(`tx:${txSignature}`, "1", { expirationTtl: TTL_SECONDS });
}

/** Idempotent check-and-mark in one logical step. Returns true if replayed. */
export async function checkAndMarkUsed(
  kv: KVNamespace,
  txSignature: string,
): Promise<boolean> {
  if (await isReplay(kv, txSignature)) return true;
  await markUsed(kv, txSignature);
  return false;
}
