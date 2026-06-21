import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { X402Gateway } from "../target/types/x402_gateway";
import { randomBytes, createHash } from "crypto";
import nacl from "tweetnacl";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
  getClusterAccAddress,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

const ENCRYPTION_KEY_MESSAGE = "x402-gateway-encryption-key-v1";

// Derives a deterministic X25519 encryption keypair from a Solana wallet,
// mirroring the voting example's deriveEncryptionKey.
function deriveEncryptionKey(
  wallet: anchor.web3.Keypair,
  message: string
): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, wallet.secretKey);
  const privateKey = new Uint8Array(
    createHash("sha256").update(signature).digest()
  );
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

describe("x402 Gateway", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.X402Gateway as Program<X402Gateway>;
  const provider = anchor.getProvider();

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    timeoutMs = 120000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(eventName, (ev) => {
        clearTimeout(timeoutId);
        res(ev);
      });
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${eventName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("opens a balance, deposits, charges, and reveals", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    // Initialize all four computation definitions.
    await initCompDef(program, owner, "init_balance");
    await initCompDef(program, owner, "deposit");
    await initCompDef(program, owner, "charge");
    await initCompDef(program, owner, "reveal_balance");

    const { privateKey, publicKey } = deriveEncryptionKey(
      owner,
      ENCRYPTION_KEY_MESSAGE
    );
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const [balancePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("balance"), owner.publicKey.toBuffer()],
      program.programId
    );

    // 1) Open balance (init_balance).
    {
      const offset = new anchor.BN(randomBytes(8), "hex");
      await program.methods
        .openBalance(offset)
        .accountsPartial({
          authority: owner.publicKey,
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            offset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_balance")).readUInt32LE()
          ),
          agentBalance: balancePDA,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        offset,
        program.programId,
        "confirmed"
      );
    }

    // 2) Deposit 5_000 base units (0.005 USDC).
    await submitAmount(
      "deposit",
      5_000n,
      cipher,
      publicKey,
      owner,
      balancePDA,
      program
    );

    // 3) Charge 1_000 base units (0.001 USDC) — expect paid_ok = true.
    {
      const chargeEventPromise = awaitEvent("chargeEvent");
      await submitAmount(
        "charge",
        1_000n,
        cipher,
        publicKey,
        owner,
        balancePDA,
        program
      );
      const ev = await chargeEventPromise;
      expect(ev.paidOk).to.equal(true);
    }

    // 4) Charge 999_999 base units — exceeds remaining 4_000 — expect paid_ok = false.
    {
      const chargeEventPromise = awaitEvent("chargeEvent");
      await submitAmount(
        "charge",
        999_999n,
        cipher,
        publicKey,
        owner,
        balancePDA,
        program
      );
      const ev = await chargeEventPromise;
      expect(ev.paidOk).to.equal(false);
    }

    // 5) Reveal balance — expect 4_000 (5_000 deposited - 1_000 charged).
    {
      const revealEventPromise = awaitEvent("revealBalanceEvent");
      const offset = new anchor.BN(randomBytes(8), "hex");
      await program.methods
        .revealBalance(offset)
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            offset
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("reveal_balance")).readUInt32LE()
          ),
          agentBalance: balancePDA,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      await awaitComputationFinalization(
        provider as anchor.AnchorProvider,
        offset,
        program.programId,
        "confirmed"
      );
      const ev = await revealEventPromise;
      expect(ev.amount.toString()).to.equal("4000");
    }
  });

  // Queues a deposit/charge with an encrypted u64 amount, mirroring voting's vote().
  async function submitAmount(
    method: "deposit" | "charge",
    amount: bigint,
    cipher: RescueCipher,
    publicKey: Uint8Array,
    owner: anchor.web3.Keypair,
    balancePDA: PublicKey,
    program: Program<X402Gateway>
  ): Promise<void> {
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt([amount], nonce);
    const offset = new anchor.BN(randomBytes(8), "hex");

    const compDefName = method === "deposit" ? "deposit" : "charge";
    const builder =
      method === "deposit"
        ? program.methods.deposit(
            offset,
            Array.from(ciphertext[0]),
            Array.from(publicKey),
            new anchor.BN(deserializeLE(nonce).toString())
          )
        : program.methods.charge(
            offset,
            Array.from(ciphertext[0]),
            Array.from(publicKey),
            new anchor.BN(deserializeLE(nonce).toString())
          );

    await builder
      .accountsPartial({
        authority: owner.publicKey,
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          offset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset(compDefName)).readUInt32LE()
        ),
        agentBalance: balancePDA,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      offset,
      program.programId,
      "confirmed"
    );
  }

  // Initializes a computation definition and uploads its compiled circuit,
  // mirroring voting's initVoteStatsCompDef.
  async function initCompDef(
    program: Program<X402Gateway>,
    owner: anchor.web3.Keypair,
    name: "init_balance" | "deposit" | "charge" | "reveal_balance"
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset(name);
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);
    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    // Anchor camelCases the comp-def init instruction names.
    const methodName = {
      init_balance: "initBalanceCompDef",
      deposit: "depositCompDef",
      charge: "chargeCompDef",
      reveal_balance: "revealBalanceCompDef",
    }[name] as
      | "initBalanceCompDef"
      | "depositCompDef"
      | "chargeCompDef"
      | "revealBalanceCompDef";

    const sig = await (program.methods[methodName]() as any)
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ preflightCommitment: "confirmed", commitment: "confirmed" });

    const rawCircuit = fs.readFileSync(`build/${name}.arcis`);
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      name,
      program.programId,
      rawCircuit,
      true
    );

    return sig;
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries = 20,
  retryDelayMs = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) return mxePublicKey;
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
