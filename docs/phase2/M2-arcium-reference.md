# Phase 2 / M2 — Arcium reference memo (写経 base)

Purpose: capture the **real, verified** Arcium API surface and the file paths we will
port from, so that M3+ is written from references — never from memory. Every API name
below was read from an actual reference repo (paths cited), not recalled.

> Phase 1 lesson: the old `arcium-mxe/` used a made-up API (`#[mxe]`, `ArcisInput`,
> `Encrypted<T>`, `.ct_ge`). None of that exists. The names in this memo replace it.

## Reference sources (read locally from tarballs; not committed)

| Ref | Repo | Why |
|---|---|---|
| Voting | `arcium-hq/examples` → `voting/` | Canonical encrypted-state + accumulate + reveal; closest to a prepaid balance |
| Election | `quiknode-labs/arcium-election` | Second independent confirmation of the same API |

Key files in `arcium-hq/examples/voting/`:
- `encrypted-ixs/src/lib.rs` — the Arcis confidential instructions
- `programs/voting/src/lib.rs` — Anchor side: queue / callback / init_comp_def + account structs
- `tests/voting.ts` — `@arcium-hq/client` encrypt → submit → finalize → event flow
- `Arcium.toml`, `Anchor.toml`, `rust-toolchain.toml`, `Cargo.toml`s — workspace + versions

Election analogues: `encrypted-ixs/src/lib.rs`, `programs/election/src/handlers/{create_poll,vote,reveal_result}.rs`,
`programs/election/src/lib.rs`, `tests/election.ts`, `tests/arcium-solana-kit/{helpers,rescue-cipher,event-listener}.ts`.

## Verified API surface (corrections vs. the Phase 2 brief)

The brief's "確認済みの実構造" was close but had at least one wrong detail — confirming why
we read the real files:

- **`use arcis::*;`** is what both examples use — **not** `use arcis_imports::*;` (brief was wrong).
- Confidential module: `#[encrypted] mod circuits { use arcis::*; ... }`.
- Each confidential fn is `#[instruction] pub fn ...`.
- Encrypted types: `Enc<Shared, T>` (caller-encrypted input) and `Enc<Mxe, T>` (MXE-owned
  persistent state). Conversions: `ctxt.to_arcis()` → plaintext inside MPC;
  `owner.from_arcis(value)` / `mxe.from_arcis(value)` → re-encrypt. Reveal a public output
  with `value.reveal()`.
- An `#[instruction]` may take `mxe: Mxe` directly (election `create_poll`) or call
  `Mxe::get()` (voting `init_vote_stats`) to mint fresh MXE-owned state.

### Anchor side (`programs/<prog>/src/lib.rs`)
- `use anchor_lang::prelude::*;` + `use arcium_anchor::prelude::*;` +
  `use arcium_client::idl::arcium::types::CallbackAccount;`
- `const COMP_DEF_OFFSET_X: u32 = comp_def_offset("x");`
- `#[arcium_program] pub mod <prog> { ... }`
- Init a computation definition: `init_comp_def(ctx.accounts, None, None)?;`
- Build args: `ArgBuilder::new().x25519_pubkey(pk).plaintext_u128(nonce).encrypted_bool(ct)`
  `.account(pubkey, offset, len).build()` — `.account(...)` feeds persistent `Enc<Mxe, _>`
  ciphertext bytes from a stored account (offset/len into that account's data).
- Queue: `queue_computation(ctx.accounts, computation_offset, args, vec![XCallback::callback_ix(computation_offset, &ctx.accounts.mxe_account, &[CallbackAccount{ pubkey, is_writable }])?], 1, 0)?;`
- Callback: `#[arcium_callback(encrypted_ix = "x")] pub fn x_callback(ctx, output: SignedComputationOutputs<XOutput>) -> Result<()>`
  then `output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)`
  returns `XOutput { field_0 }`; persisted state lives in `field_0.ciphertexts` + `field_0.nonce`.
  Public reveals come back as the typed output and are surfaced with `emit!(SomeEvent { ... })`.
- Account context macros: `#[queue_computation_accounts("x", payer)]`, `#[callback_accounts("x")]`,
  `#[init_computation_definition_accounts("x", payer)]`. PDA derive macros: `derive_mxe_pda!()`,
  `derive_mempool_pda!()`, `derive_execpool_pda!()`, `derive_comp_pda!()`, `derive_comp_def_pda!()`,
  `derive_cluster_pda!()`, `derive_sign_pda!()`, `derive_mxe_lut_pda!()`. Fixed addresses:
  `ARCIUM_FEE_POOL_ACCOUNT_ADDRESS`, `ARCIUM_CLOCK_ACCOUNT_ADDRESS`, `LUT_PROGRAM_ID`.

### Client side (`tests/*.ts`, `@arcium-hq/client`)
- Imports incl. `getMXEPublicKey`, `x25519`, `RescueCipher`, `awaitComputationFinalization`,
  `getCompDefAccOffset`, `getMXEAccAddress`, `getComputationAccAddress`, `getClusterAccAddress`,
  `getMempoolAccAddress`, `getExecutingPoolAccAddress`, `getCompDefAccAddress`, `uploadCircuit`,
  `deserializeLE`, `getArciumEnv`.
- Flow: `mxePublicKey = await getMXEPublicKey(provider, programId)` (with retry) →
  `sharedSecret = x25519.getSharedSecret(privKey, mxePublicKey)` →
  `cipher = new RescueCipher(sharedSecret)` → `ciphertext = cipher.encrypt([value], nonce)`
  (nonce = `randomBytes(16)`) → call the Anchor method with `Array.from(ciphertext[0])`,
  `Array.from(publicKey)`, `new anchor.BN(deserializeLE(nonce).toString())` plus the queue
  accounts → `await awaitComputationFinalization(provider, computationOffset, programId, "confirmed")`
  → read the result from the emitted event (`program.addEventListener(...)`).
- Comp-def init also **uploads the compiled circuit**: `uploadCircuit(provider, "x", programId, fs.readFileSync("build/x.arcis"), true)`.

### Toolchain / versions (from voting workspace — pin from references, not memory)
- `arcis = "0.9.6"`; `arcium-client = "=0.9.6"`, `arcium-macros = "0.9.6"`, `arcium-anchor = "0.9.6"`
- `anchor-lang = "0.32.1"` (feature `init-if-needed`); Rust `channel = "1.89.0"`
- Workspace: `members = ["programs/*", "encrypted-ixs"]`; `Arcium.toml` defines localnet
  (2 Cerberus nodes) and `[clusters.devnet]/.mainnet` offsets for non-local testing.
- `arcup` version: **do not hardcode** — confirm on docs.arcium.com/developers/installation.

## x402 → Arcium correspondence (recommended prepaid-balance model)

Mapping the recommended M0 option (encrypted per-agent prepaid balance) onto the voting pattern:

| x402 operation | Arcium analog (voting) | Confidential `#[instruction]` sketch* |
|---|---|---|
| Open an agent's encrypted balance | `init_vote_stats` / `create_poll` (mint `Enc<Mxe, _>` zero state via callback) | `fn init_balance(mxe: Mxe) -> Enc<Mxe, Balance>` |
| Top up balance (deposit) | `vote` (accumulate into `Enc<Mxe, _>`) | `fn deposit(amt: Enc<Shared, Amount>, bal: Enc<Mxe, Balance>) -> Enc<Mxe, Balance>` |
| Pay-per-call debit + sufficiency check (the 402 gate) | `vote` + `reveal_result` combined: subtract, keep balance encrypted, reveal only a boolean | `fn charge(price: Enc<Shared, Amount>, bal: Enc<Mxe, Balance>) -> (Enc<Mxe, Balance>, bool)` where only the bool (`paid_ok`) is `.reveal()`-ed |
| Owner-only balance readout (optional) | `reveal_result` (authority-gated) | `fn reveal_balance(bal: Enc<Mxe, Balance>) -> u64` |

\* Signatures are **sketches to be finalized in M3 against the live API after M0**, not final code.

What stays encrypted: the agent's balance and per-endpoint spend pattern. What is revealed:
only `paid_ok` (and the agent can reveal its own balance). The single public Solana deposit
tx is unavoidably public — privacy is in the *accumulated balance + spend pattern*, which is
exactly why the balance model (not single-tx compare) is the valuable design.

## Environment limitation (must run M1/M3/M4/M5 elsewhere)

The CI/agent container used for this work **cannot run the Arcium toolchain**:
no Docker daemon; `arcup`/`arcium`/`solana`/`anchor` absent; and `bin.arcium.com`,
`crates.io`, `docs.arcium.com` are network-blocked (only `raw/codeload.githubusercontent.com`
reachable). So `arcium build`/`arcium test`/`arcium deploy` and devnet e2e must be done in a
real dev environment (local with Docker, or GitHub Codespaces per the brief). M2 (this memo)
needs no toolchain and is complete; M3 code can be drafted here but its completion condition
(`arcium build`/`arcium test` green) can only be verified in that environment.
