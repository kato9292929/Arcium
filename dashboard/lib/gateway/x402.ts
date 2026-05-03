// Build a 402 Payment Required response per the x402 spec.

import type { X402PaymentRequired, PaymentOption } from "./types";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAYMENT_WALLET = process.env.PAYMENT_WALLET_ADDRESS ?? "GATEWAY_WALLET_NOT_SET";

export function build402(pathname: string, priceBaseUnits: number, description: string): Response {
  const option: PaymentOption = {
    scheme: "exact",
    network: "solana-mainnet",
    maxAmountRequired: String(priceBaseUnits),
    resource: pathname,
    description,
    mimeType: "application/json",
    payTo: PAYMENT_WALLET,
    maxTimeoutSeconds: 300,
    asset: USDC_MINT,
    extra: { gateway: "x402-private-gateway", privacyProvider: "arcium-mpc" },
  };

  const body: X402PaymentRequired = { version: 1, accepts: [option] };

  return Response.json(body, {
    status: 402,
    headers: {
      "X-Payment-Required-Version": "1",
      "X-Privacy-Provider": "arcium-mpc",
    },
  });
}

export function extractPaymentHeader(req: Request): string | null {
  const h = req.headers.get("X-PAYMENT");
  return h?.trim() || null;
}
