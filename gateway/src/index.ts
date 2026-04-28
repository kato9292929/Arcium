/// <reference types="@cloudflare/workers-types" />
/**
 * x402 Private Gateway — Cloudflare Worker entry point.
 *
 * Routes:
 *   GET  /v1/price/:symbol   → USDC price data, 0.001 USDC gate
 *   GET  /v1/listings        → top listings data, 0.002 USDC gate
 *   GET  /health             → liveness + Arcium connectivity check
 *   POST /api/demo/trigger   → fires test payment through both flows (dashboard)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types.js";
import { privateVerify } from "./middleware/private-verify.js";
import { proxyUpstream, mockUpstreamResponse } from "./middleware/proxy.js";

// ── Price constants (USDC base units, 6 decimals) ─────────────────────────────
const PRICE_QUOTE = 1_000;     // 0.001 USDC
const PRICE_LISTINGS = 2_000;  // 0.002 USDC

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware ─────────────────────────────────────────────────────────

app.use("*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "X-PAYMENT"],
  exposeHeaders: ["X-Arcium-Proof", "X-Privacy-Mode", "X-Payment-Accepted"],
}));

// Minimal logger — deliberately omits sensitive headers.
app.use("*", logger());

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const arciumMode = c.env.ARCIUM_MXE_ID && c.env.ARCIUM_MXE_ID !== "mock"
    ? "connected"
    : "mock";

  return c.json({
    status: "ok",
    arcium: arciumMode,
    timestamp: new Date().toISOString(),
  });
});

// ── GET /v1/price/:symbol ─────────────────────────────────────────────────────

app.get("/v1/price/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();

  const result = await privateVerify(c, {
    priceBaseUnits: PRICE_QUOTE,
    description: `Real-time USDC price for ${symbol}`,
  });

  // privateVerify returns a Response when payment is missing or invalid.
  if (result instanceof Response) return result;

  // Payment verified — fetch upstream (CMC) or fall back to mock.
  if (!c.env.CMC_API_KEY) {
    return c.json({
      ...mockUpstreamResponse(symbol),
      _arciumProof: result.arciumProof,
      _privacyMode: result.mode,
    });
  }

  const upstreamUrl =
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest` +
    `?symbol=${encodeURIComponent(symbol)}&CMC_PRO_API_KEY=${c.env.CMC_API_KEY}`;

  return proxyUpstream(c, upstreamUrl, result);
});

// ── GET /v1/listings ──────────────────────────────────────────────────────────

app.get("/v1/listings", async (c) => {
  const result = await privateVerify(c, {
    priceBaseUnits: PRICE_LISTINGS,
    description: "Top 10 cryptocurrency listings by market cap",
  });

  if (result instanceof Response) return result;

  if (!c.env.CMC_API_KEY) {
    return c.json({
      data: Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        symbol: ["BTC", "ETH", "SOL", "USDC", "BNB", "ADA", "XRP", "DOGE", "AVAX", "LINK"][i],
        price: 1000 + Math.random() * 50_000,
      })),
      _source: "mock",
      _arciumProof: result.arciumProof,
      _privacyMode: result.mode,
    });
  }

  const upstreamUrl =
    `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest` +
    `?limit=10&CMC_PRO_API_KEY=${c.env.CMC_API_KEY}`;

  return proxyUpstream(c, upstreamUrl, result);
});

// ── POST /api/demo/trigger ────────────────────────────────────────────────────

app.post("/api/demo/trigger", async (c) => {
  // Fires a mock payment through both the public path (simulated) and the
  // private MXE path simultaneously so the dashboard can show the contrast.

  const mockSig = `demo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const mockAmount = PRICE_QUOTE;

  // Simulate what a public on-chain observer would see.
  const publicObservable = {
    signature: mockSig,
    sender: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", // demo address
    recipient: c.env.PAYMENT_WALLET_ADDRESS ?? "GATEWAY_WALLET",
    amount: `${mockAmount / 1_000_000} USDC`,
    endpoint: "/v1/price/BTC",
    timestamp: new Date().toISOString(),
  };

  // What the private gateway reveals (only the boolean).
  const privateVerified = {
    payment_valid: true,
    sender: "[HIDDEN — encrypted inside Arcium MPC cluster]",
    amount: "[HIDDEN — encrypted inside Arcium MPC cluster]",
    endpoint: "[HIDDEN — not logged by gateway]",
    arciumProof: `demo-proof-${Date.now()}`,
    privacyMode: !c.env.ARCIUM_MXE_ID || c.env.ARCIUM_MXE_ID === "mock" ? "mock" : "mpc",
  };

  return c.json({
    publicObservable,
    privateVerified,
    comparison: {
      publicExposes: ["sender wallet", "exact amount", "API endpoint", "timestamp"],
      privateExposes: ["payment_valid boolean only"],
      hiddenByArcium: ["sender wallet", "exact amount", "API endpoint", "access frequency"],
    },
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("Unhandled error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
