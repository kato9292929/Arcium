# x402 Private Gateway

> ⚠️ **Status: mock mode demo.** This project currently runs in **mock mode** —
> the "MPC" verification is a local **XOR-based simulation** (`ARCIUM_MXE_ID=mock`),
> not real multi-party computation. **Real Arcium MPC integration is not yet
> deployed or implemented.** The gateway and dashboard are fully functional as a
> demo, but no payment is actually verified on the Arcium network. The Arcis MXE
> program and the SDK "real" code path are design references, not working
> integrations — see the notes throughout this README. Tracking real integration
> as future work (Phase 2).

Privacy-preserving API payment gateway built on the [x402 protocol](https://x402.org), designed to use **Arcium's MPC network** to verify payments without revealing wallet addresses, payment amounts, or API access patterns on-chain. _(MPC verification is currently mocked — see the status note above.)_

## The problem

Standard x402 exposes everything on-chain: who paid, how much, which API, how often. For enterprise API companies (financial data, corporate databases), this is a dealbreaker — competitors can see exactly which clients are buying what data.

```
Standard x402 (public):
Agent → 402 → USDC transfer (visible on-chain) → API access
         ↑ sender, amount, endpoint all permanently indexable

x402 Private Gateway:
Agent → 402 → Arcium MXE verifies (encrypted) → API access
         ↑ only payment_valid: true exits the MPC cluster
```

## Privacy guarantee

| Data field | Standard x402 | x402 Private Gateway |
|---|---|---|
| Sender wallet address | ✗ Public on-chain | ✓ Hidden (MPC-encrypted) |
| Exact payment amount | ✗ Public on-chain | ✓ Hidden (MPC-encrypted) |
| API endpoint accessed | ✗ Logged by servers | ✓ Not logged by gateway |
| Access frequency per wallet | ✗ Indexable from chain | ✓ Hidden (no wallet in KV) |
| Payment occurred | ✓ Verifiable | ✓ Verifiable (via boolean proof) |
| Gateway approved | — | ✓ Cryptographic Arcium proof |

**What Arcium hides:** sender wallet address, exact payment amount, token mint, access patterns.

**What is publicly verifiable:** payment occurred (Solana tx exists), gateway approved the request (Arcium computation proof in response header), API responded.

## Project structure

```
/arcium-mxe           — Arcis MXE program (Rust)
  src/
    payment_verifier.rs   — MXE computation: encrypted verify → boolean
    lib.rs

/gateway              — Cloudflare Worker (TypeScript + Hono.js)
  src/
    index.ts              — route definitions
    types.ts              — shared TypeScript types
    middleware/
      x402.ts             — 402 response builder
      private-verify.ts   — orchestrates the full verification flow
      proxy.ts            — upstream API proxy
    lib/
      arcium.ts           — Arcium SDK wrapper + mock fallback
      solana.ts           — Helius RPC, tx parsing
      kv.ts               — replay prevention (24h TTL)
  wrangler.toml
  .env.example

/dashboard            — Next.js 15 demo dashboard
  app/
    page.tsx              — live demo page
  components/
    ComparisonView.tsx    — side-by-side: public vs private
    PrivacyProof.tsx      — detail view of Arcium verification
  lib/
    types.ts
```

## Tech stack

| Layer | Technology |
|---|---|
| Edge gateway | Cloudflare Workers + Hono.js |
| MPC computation | Arcium SDK + Arcis (Rust DSL) — _planned; currently mocked (XOR simulation)_ |
| Payment chain | Solana + USDC |
| RPC / indexing | Helius Enhanced Transactions API |
| Dashboard | Next.js 15 + React 19 |
| Deployment | Wrangler (gateway) + Vercel (dashboard) |

## Quick start

### 1. Arcium MXE program

> **TODO — real Arcium integration is not implemented.** `arcium-mxe/src/payment_verifier.rs`
> is a **design reference** written against an illustrative API; it does not
> compile or deploy as-is, and there is no `arcis-cli` / `arcis deploy` command
> (those do not exist). The real toolchain is **`arcup`** + the **`arcium` CLI**
> (an Anchor wrapper) using `arcium build` / `arcium test`. For the correct
> install and deploy steps, follow the official docs:
> <https://docs.arcium.com/developers/installation>.
>
> Until that work is done, run the gateway in **mock mode** (`ARCIUM_MXE_ID=mock`),
> which needs no Arcium deployment — skip to step 2.

### 2. Gateway

```bash
cd gateway
npm install

# Configure environment
cp .env.example .env
# Edit .env — at minimum set HELIUS_API_KEY and PAYMENT_WALLET_ADDRESS
# Set ARCIUM_MXE_ID=mock to run without a real Arcium deployment

# Local dev
npm run dev
# → http://localhost:8787

# Set Wrangler secrets for production
wrangler secret put HELIUS_API_KEY
wrangler secret put ARCIUM_API_KEY
wrangler secret put ARCIUM_MXE_ID
wrangler secret put PAYMENT_WALLET_ADDRESS
wrangler secret put CMC_API_KEY

# Create KV namespace
wrangler kv:namespace create PAYMENT_KV
# Paste the returned IDs into wrangler.toml

# Deploy
npm run deploy
```

### 3. Dashboard

```bash
cd dashboard
npm install

cp .env.example .env.local
# Set NEXT_PUBLIC_GATEWAY_URL to your Worker URL

npm run dev
# → http://localhost:3000

# Deploy to Vercel
vercel deploy
```

## API reference

### `GET /v1/price/:symbol`

Price: **0.001 USDC** · Returns real-time price data for the given symbol.

```bash
# Without payment — returns 402
curl https://gateway.example.com/v1/price/BTC

# With payment
curl -H "X-PAYMENT: <solana_tx_signature>" \
     https://gateway.example.com/v1/price/BTC
```

Response headers on success:
```
X-Arcium-Proof: <computation_id>   # safe to log — no sensitive data
X-Privacy-Mode: mpc                # or "mock" in dev mode
X-Payment-Accepted: true
```

### `GET /v1/listings`

Price: **0.002 USDC** · Returns top 10 cryptocurrency listings by market cap.

### `GET /health`

No payment required.

```json
{ "status": "ok", "arcium": "connected", "timestamp": "..." }
```

### `POST /api/demo/trigger`

Fires a test payment through both the public and private flows simultaneously. Used by the dashboard demo.

```json
{
  "publicObservable": {
    "signature": "...",
    "sender": "7xKX...",
    "amount": "0.001 USDC",
    "endpoint": "/v1/price/BTC"
  },
  "privateVerified": {
    "payment_valid": true,
    "sender": "[HIDDEN]",
    "amount": "[HIDDEN]",
    "endpoint": "[HIDDEN]",
    "arciumProof": "..."
  }
}
```

## How the MXE works (intended design)

> The snippet below is the **intended** Arcis program. `arcium-mxe/src/payment_verifier.rs`
> is a design reference written against an illustrative API — it does not compile
> or deploy as-is, and is **not** what runs in mock mode. See the file header and
> <https://docs.arcium.com/developers/arcis> for the real API.

The Arcis program (`arcium-mxe/src/payment_verifier.rs`) is intended to define a Multi-party eXecutable computation:

```rust
#[mxe]
pub fn verify_payment(
    private: PrivatePaymentInputs,   // encrypted: sender, amount, mint
    params: PublicPaymentParams,     // public: required price, gateway wallet
) -> PaymentVerificationResult {    // output: { payment_valid: bool }
    let amount_sufficient = private.transfer_amount.ct_ge(params.required_amount);
    let mint_correct = private.token_mint.ct_eq(&params.expected_mint);
    PaymentVerificationResult {
        payment_valid: (amount_sufficient & mint_correct).reveal(),
    }
}
```

Once deployed on Arcium, the cluster would hold shares of the decryption key so that no single node can decrypt the inputs, the computation would run in a threshold MPC environment, and only the final boolean would be recombined and returned. _(Not yet deployed — currently mocked.)_

## Security notes

- Wallet addresses and amounts are **never** written to logs, KV, or response bodies by the gateway.
- Replay prevention is keyed on transaction signature only (no wallet in KV keys).
- Recipient check (on-chain field, already public) is done before submitting to MXE — avoids paying Arcium compute for obviously invalid requests.
- Transaction freshness is checked by slot distance (~5 min window) to prevent recycling old payments.
- In mock mode (`ARCIUM_MXE_ID=mock`), the gateway is fully functional but uses local XOR obfuscation instead of real MPC. **Do not use mock mode in production.**

## License

MIT
