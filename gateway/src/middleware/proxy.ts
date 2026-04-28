/**
 * Upstream API proxy — forwards verified requests to the data provider and
 * streams the response back to the client.
 *
 * Adds X-Arcium-Proof and X-Privacy-Mode headers so clients can confirm that
 * private verification was used without exposing any payment details.
 */

import type { Context } from "hono";
import type { Env, VerificationResult } from "../types.js";

export async function proxyUpstream(
  c: Context<{ Bindings: Env }>,
  upstreamUrl: string,
  verification: VerificationResult,
): Promise<Response> {
  const upstream = await fetch(upstreamUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "x402-private-gateway/1.0",
    },
    cf: { cacheTtl: 30, cacheEverything: false },
  });

  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "X-Arcium-Proof": verification.arciumProof,
      "X-Privacy-Mode": verification.mode,
      "X-Payment-Accepted": "true",
      // Never include wallet address, amount, or endpoint in response headers.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Return a mock data response for endpoints where CMC_API_KEY is absent
 * (local dev / CI).
 */
export function mockUpstreamResponse(symbol: string): object {
  return {
    data: {
      [symbol.toUpperCase()]: {
        quote: {
          USD: {
            price: 50_000 + Math.random() * 5_000,
            volume_24h: 1_000_000_000,
            percent_change_24h: (Math.random() - 0.5) * 10,
            last_updated: new Date().toISOString(),
          },
        },
      },
    },
    _source: "mock",
  };
}
