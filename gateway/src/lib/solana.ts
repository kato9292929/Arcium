/**
 * Solana / Helius helpers — fetch and parse USDC transfer details.
 *
 * RPC strategy (in order):
 *   1. Helius RPC (mainnet.helius-rpc.com) — preferred; high rate limits.
 *   2. Public Solana mainnet RPC (api.mainnet-beta.solana.com) — automatic
 *      fallback when Helius returns 403 (domain allowlist not configured).
 *      No API key required; lower rate limits but fine for local dev.
 *   3. Mock stub when HELIUS_API_KEY === "mock".
 *
 * Token amounts are derived from pre/post token balance snapshots in the
 * transaction metadata — no full instruction decoding required.
 */

import type { ParsedPayment } from "../types.js";

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

// ── RPC helpers ───────────────────────────────────────────────────────────────

function heliusRpcUrl(apiKey: string): string {
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

async function rpcPost(url: string, method: string, params: unknown[]): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

/**
 * Call a Solana JSON-RPC method.  Tries Helius first; falls back to the
 * public RPC endpoint if Helius returns 403 (allowlist not configured for
 * the current host, which is common in local dev).
 */
async function rpcCall<T>(
  apiKey: string,
  method: string,
  params: unknown[],
): Promise<T> {
  let res = await rpcPost(heliusRpcUrl(apiKey), method, params);

  if (res.status === 403) {
    // Helius allowlist is blocking this host — transparently fall back to
    // the public Solana RPC.  Rate limits are lower but sufficient for dev.
    res = await rpcPost(PUBLIC_RPC, method, params);
  }

  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);

  const json = (await res.json()) as { result: T; error?: { message: string } };
  if (json.error) throw new Error(`Solana RPC error: ${json.error.message}`);
  return json.result;
}

// ── Raw RPC response types ────────────────────────────────────────────────────

interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  owner: string;
  uiTokenAmount: {
    amount: string;    // base-unit string, e.g. "1000"
    decimals: number;
  };
}

interface RpcTransaction {
  slot: number;
  meta: {
    err: unknown;
    preTokenBalances: RpcTokenBalance[];
    postTokenBalances: RpcTokenBalance[];
  } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string } | string>;
    };
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a confirmed transaction and extract the SPL token transfer details
 * needed for MXE encryption.
 */
export async function fetchParsedPayment(
  signature: string,
  heliusApiKey: string,
): Promise<ParsedPayment> {
  if (heliusApiKey === "mock") {
    return {
      signature,
      senderWallet: "MockSender1111111111111111111111111111111111",
      recipientWallet: "MockRecipient111111111111111111111111111111",
      amount: 1_000n,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      slot: 0,
    };
  }

  const tx = await rpcCall<RpcTransaction | null>(
    heliusApiKey,
    "getTransaction",
    [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
  );

  if (!tx) throw new Error(`Transaction not found or not yet confirmed: ${signature}`);
  if (tx.meta?.err) throw new Error(`Transaction failed on-chain`);

  const pre  = tx.meta?.preTokenBalances  ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const preMap  = new Map<number, bigint>();
  const postMap = new Map<number, bigint>();
  for (const b of pre)  preMap.set(b.accountIndex,  BigInt(b.uiTokenAmount.amount));
  for (const b of post) postMap.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));

  // Recipient = account with the largest positive balance delta.
  let recipientIndex = -1;
  let transferAmount = 0n;
  let tokenMint = "";

  for (const b of post) {
    const delta = (postMap.get(b.accountIndex) ?? 0n) - (preMap.get(b.accountIndex) ?? 0n);
    if (delta > 0n && delta > transferAmount) {
      transferAmount = delta;
      recipientIndex = b.accountIndex;
      tokenMint = b.mint;
    }
  }

  if (recipientIndex === -1) {
    throw new Error(`No positive token balance delta found — not a token transfer`);
  }

  // Sender = account with a negative delta for the same mint.
  let senderIndex = -1;
  for (const b of pre) {
    if (b.mint !== tokenMint) continue;
    const delta = (postMap.get(b.accountIndex) ?? 0n) - (preMap.get(b.accountIndex) ?? 0n);
    if (delta < 0n) { senderIndex = b.accountIndex; break; }
  }

  // The `owner` field in token balances is the wallet (not the token account).
  const recipientBalance = post.find(b => b.accountIndex === recipientIndex);
  const senderBalance    = pre.find(b  => b.accountIndex === senderIndex);

  const keyAt = (i: number): string => {
    const k = tx.transaction.message.accountKeys[i];
    return typeof k === "string" ? k : (k?.pubkey ?? "");
  };

  return {
    signature,
    senderWallet:    senderBalance?.owner    ?? keyAt(senderIndex),
    recipientWallet: recipientBalance?.owner ?? keyAt(recipientIndex),
    amount: transferAmount,
    tokenMint,
    slot: tx.slot,
  };
}

/** Recipient check — both values are already public, no privacy loss. */
export function recipientMatches(
  payment: ParsedPayment,
  expectedRecipient: string,
): boolean {
  return payment.recipientWallet === expectedRecipient;
}

/** Current slot for freshness checking. Falls back to public RPC on 403. */
export async function fetchCurrentSlot(heliusApiKey: string): Promise<number> {
  if (heliusApiKey === "mock") return 0;
  return rpcCall<number>(heliusApiKey, "getSlot", []);
}

/** ~5 minutes at 400 ms/slot on mainnet. */
const MAX_SLOT_AGE = 750;

export function isTxTooOld(txSlot: number, currentSlot: number): boolean {
  if (txSlot === 0) return false; // mock sentinel
  return currentSlot - txSlot > MAX_SLOT_AGE;
}
