/**
 * x402 Payment Required middleware.
 *
 * Returns a 402 response with a machine-readable payment descriptor when a
 * request arrives without an X-PAYMENT header, following the x402 protocol
 * spec (https://x402.org).
 */

import type { Context } from "hono";
import type { Env, X402PaymentRequired, PaymentOption } from "../types.js";

export interface X402Config {
  priceBaseUnits: number;   // USDC base units (6 decimals)
  description: string;
}

export function build402Response(
  c: Context<{ Bindings: Env }>,
  config: X402Config,
): Response {
  const url = new URL(c.req.url);

  const option: PaymentOption = {
    scheme: "exact",
    network: "solana-mainnet",
    maxAmountRequired: String(config.priceBaseUnits),
    resource: url.pathname,
    description: config.description,
    mimeType: "application/json",
    payTo: c.env.PAYMENT_WALLET_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: c.env.USDC_MINT,
    extra: {
      gateway: "x402-private-gateway",
      privacyProvider: "arcium-mpc",
    },
  };

  const body: X402PaymentRequired = {
    version: 1,
    accepts: [option],
  };

  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Required-Version": "1",
      "X-Privacy-Provider": "arcium-mpc",
    },
  });
}

/**
 * Extract the payment signature from the X-PAYMENT header.
 * The header value is the base58 Solana transaction signature.
 */
export function extractPaymentHeader(c: Context): string | null {
  const header = c.req.header("X-PAYMENT");
  if (!header || header.trim() === "") return null;
  return header.trim();
}
