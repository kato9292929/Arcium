# x402 Gateway — Arcium MXE (`arcium-mxe/`)

Confidential prepaid-balance MXE for the x402 Private Gateway, ported from the real
Arcium examples (`arcium-hq/examples`: voting + blackjack). See
[`../docs/phase2/M2-arcium-reference.md`](../docs/phase2/M2-arcium-reference.md)
for the verified API surface and the x402 → Arcium mapping.

## ⚠️ Status: M3 draft — BUILD-UNVERIFIED

This replaces the Phase-1 fake crate (`#[mxe]`, `ArcisInput`, `Encrypted<T>`, `.ct_ge`)
with code written against the **real** Arcis / Anchor / `@arcium-hq/client` API
(`arcis 0.9.6`, `arcium-anchor 0.9.6`, `anchor 0.32.1`).

**It has NOT been compiled or tested** — the environment it was authored in has no
Docker daemon and no Arcium toolchain, and `arcium.com`/`crates.io` were network-blocked.
So **M3's completion condition (`arcium build` + `arcium test` green) is not yet met.**
Expect to iterate on macro-generated detail (output-struct names, account constraints,
arg ordering) when you first build it on a real toolchain. Do not treat this as
"working on Arcium" until the checklist below is green.

## Design (M0 decisions)

- **M0-①**: encrypted per-agent prepaid balance. `Balance { amount: u64 }` is Mxe-owned
  encrypted state; deposits accumulate; each call `charge`s it.
- **M0-②**: verification off the hot path. Deposits/charges are async queued computations;
  the gateway's 402 decision is meant to read a cheap reference, not block on finalization
  (wired in M5).

### Confidential instructions (`encrypted-ixs/src/lib.rs`)
| ix | input | output | purpose |
|---|---|---|---|
| `init_balance` | `Mxe` | `Enc<Mxe, Balance>` | open a zero balance |
| `deposit` | `Enc<Shared, DepositAmount>`, `Enc<Mxe, Balance>` | `Enc<Mxe, Balance>` | top up |
| `charge` | `Enc<Shared, ChargeAmount>`, `Enc<Mxe, Balance>` | `(Enc<Mxe, Balance>, bool)` | debit if sufficient; reveal only `paid_ok` |
| `reveal_balance` | `Enc<Mxe, Balance>` | `u64` | owner-only readout |

Only `paid_ok` (and the owner's own balance) is ever revealed; balance + per-call spend
pattern stay encrypted.

## Verification checklist (run on a real toolchain — Codespaces or local w/ Docker)

### M1 — toolchain
- [ ] Install `arcup` per <https://docs.arcium.com/developers/installation> (don't hardcode versions).
- [ ] Confirm Docker, Solana CLI, Anchor, Node present; scaffold + `arcium build` + `arcium test` the Hello-World `add_together`.

### M3 — this workspace
- [ ] `anchor keys list` → put the real program id into `declare_id!` and `Anchor.toml`.
- [ ] `arcium build` passes.
- [ ] `arcium test` (localnet) passes — `tests/x402_gateway.ts` opens a balance, deposits 5000,
      charges 1000 (`paid_ok=true`), charges 999999 (`paid_ok=false`), reveals `4000`.
- [ ] Fix any macro-detail drift (e.g. `ChargeOutputStruct0` field names) flagged by the compiler.

### M4 — devnet
- [ ] `arcium deploy` to devnet (`-ud`, cluster offset + keypair-path from docs).
- [ ] Init the four comp defs; confirm one `charge` finalizes via callback on devnet.

### M5 — gateway
- [ ] Replace the `NotImplemented` real path in `../gateway/src/lib/arcium.ts` with the
      `@arcium-hq/client` flow (getMXEPublicKey → ECDH → RescueCipher → queue → await → event).
- [ ] Wire the off-hot-path model; keep `ARCIUM_MXE_ID=mock` working.

Only after M3+M4 are green should the README status banners (root + here) move to
"devnet: real MPC" (M6).
