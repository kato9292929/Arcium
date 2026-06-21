# `arcium-mxe/client` — Arcium client module (M5 DRAFT, UNVERIFIED)

The independent, Worker-agnostic module that performs the real Arcium round-trips
for the x402 prepaid-balance model. Ported verbatim from
[`../tests/x402_gateway.ts`](../tests/x402_gateway.ts) (which is itself written
from `arcium-hq/examples`). **Not yet run** — depends on the compiled program id +
generated IDL (`target/types/x402_gateway`) that exist only after `arcium build`
(M3) and devnet deploy (M4).

## Why a separate module (not in `gateway/src/lib/arcium.ts`)

`@coral-xyz/anchor` and `@arcium-hq/client` require Node (event listeners, fs) and
do **not** run inside a Cloudflare Worker. Per the M0-② decision (verification
**off the hot path**), all encrypt→queue→finalize→decrypt happens here in Node;
the Worker stays a thin layer that delegates and consumes only the boolean.

## API

`X402ArciumClient(provider, program, ownerKeypair)` then `await init()`:

| method | does | returns |
|---|---|---|
| `openBalance(authority)` | queue `init_balance`, await finalize | sig |
| `deposit(authority, amount)` | encrypt amount, queue `deposit`, await finalize | sig |
| `charge(authority, price)` | encrypt price, queue `charge`, await finalize, read `ChargeEvent` | `{ paidOk, finalizeSig }` |
| `revealBalance(authority)` | queue `reveal_balance`, read `RevealBalanceEvent` | `bigint` |

## Worker ↔ module bridge (the "charger" service)

The Worker (`gateway/src/lib/arcium.ts`, real path) delegates over HTTP when
`ARCIUM_CHARGER_URL` is set. Provisional contract (finalize after M3/M4):

```
POST {ARCIUM_CHARGER_URL}/charge
  body: { "agent": "<base58 pubkey>", "price": <u64 base units> }
  200:  { "paid_ok": boolean, "computationId": string }
```

A minimal Node service wrapping this module — [`charger-server.example.ts`](./charger-server.example.ts) —
implements that endpoint. It is an example skeleton, not wired to deploy.

## Before this can be called "working"

1. M3: `arcium build` → real program id + `target/types/x402_gateway.ts`.
2. M4: deploy to devnet, init comp defs.
3. Point the charger service at devnet; run one `charge` end-to-end.
4. Only then flip the gateway/root README status from mock to "devnet: real MPC".
