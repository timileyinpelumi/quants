// Creates Token-2022 mints with one xStock extension each and tries Kamino InitializeReward on a fresh farm.
import { Farms } from "@kamino-finance/farms-sdk";
import { createSolanaRpc, createNoopSigner, address, type Instruction } from "@solana/kit";
import { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, AccountState, createMint, getMintLen, createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction, createInitializePermanentDelegateInstruction, createInitializeDefaultAccountStateInstruction,
  createInitializeScaledUiAmountConfigInstruction, createInitializePausableConfigInstruction, createInitializeTransferHookInstruction,
  createInitializeInterestBearingMintInstruction, createInitializeGroupPointerInstruction, getOrCreateAssociatedTokenAccount, mintTo,
} from "@solana/spl-token";
import { createInitializeInstruction as createInitMetadata, pack, type TokenMetadata } from "@solana/spl-token-metadata";

const RPC = "http://127.0.0.1:8999";
const conn = new Connection(RPC, "confirmed");
const farms = new Farms(createSolanaRpc(RPC));
const toWeb3 = (ix: Instruction) => new TransactionInstruction({
  programId: new PublicKey(ix.programAddress),
  keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
  data: Buffer.from(ix.data ?? []),
});
const signer = (kp: Keypair) => createNoopSigner(address(kp.publicKey.toBase58()));
const T22 = address(TOKEN_2022_PROGRAM_ID.toBase58());

const admin = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(admin.publicKey, 100 * LAMPORTS_PER_SOL));
const a = admin.publicKey;

// ConfidentialTransferExtension(27) / InitializeMint(0): authority, auto_approve, auditor (zeroed = None)
const ctInit = (mint: PublicKey) => new TransactionInstruction({
  programId: TOKEN_2022_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
  data: Buffer.concat([Buffer.from([27, 0]), a.toBuffer(), Buffer.from([0]), Buffer.alloc(32)]),
});

type Ext = { type: ExtensionType; ix: (m: PublicKey) => TransactionInstruction };
const EXT: Record<string, Ext> = {
  metadataPointer: { type: ExtensionType.MetadataPointer, ix: (m) => createInitializeMetadataPointerInstruction(m, a, m, TOKEN_2022_PROGRAM_ID) },
  permanentDelegate: { type: ExtensionType.PermanentDelegate, ix: (m) => createInitializePermanentDelegateInstruction(m, a, TOKEN_2022_PROGRAM_ID) },
  defaultAccountState: { type: ExtensionType.DefaultAccountState, ix: (m) => createInitializeDefaultAccountStateInstruction(m, AccountState.Initialized, TOKEN_2022_PROGRAM_ID) },
  scaledUiAmount: { type: ExtensionType.ScaledUiAmountConfig, ix: (m) => createInitializeScaledUiAmountConfigInstruction(m, a, 1.0009, TOKEN_2022_PROGRAM_ID) },
  pausable: { type: ExtensionType.PausableConfig, ix: (m) => createInitializePausableConfigInstruction(m, a, TOKEN_2022_PROGRAM_ID) },
  confidentialTransferMint: { type: ExtensionType.ConfidentialTransferMint, ix: ctInit },
  interestBearing: { type: ExtensionType.InterestBearingConfig, ix: (m) => createInitializeInterestBearingMintInstruction(m, a, 10, TOKEN_2022_PROGRAM_ID) },
  groupPointer: { type: ExtensionType.GroupPointer, ix: (m) => createInitializeGroupPointerInstruction(m, a, m, TOKEN_2022_PROGRAM_ID) },
  transferHookNull: { type: ExtensionType.TransferHook, ix: (m) => createInitializeTransferHookInstruction(m, a, PublicKey.default, TOKEN_2022_PROGRAM_ID) },
};

async function makeMint(names: string[], withMetadata = false) {
  const kp = Keypair.generate();
  const m = kp.publicKey;
  const types = names.map((n) => EXT[n]!.type);
  const space = getMintLen(types);
  const md: TokenMetadata = { mint: m, name: "Test xStock", symbol: "TSTx", uri: "https://example.com/x.json", additionalMetadata: [], updateAuthority: a };
  const total = space + (withMetadata ? 4 + pack(md).length : 0);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: a, newAccountPubkey: m, space, lamports: await conn.getMinimumBalanceForRentExemption(total), programId: TOKEN_2022_PROGRAM_ID }),
    ...names.map((n) => EXT[n]!.ix(m)),
    createInitializeMintInstruction(m, 8, a, a, TOKEN_2022_PROGRAM_ID),
  );
  if (withMetadata) tx.add(createInitMetadata({ programId: TOKEN_2022_PROGRAM_ID, metadata: m, updateAuthority: a, mint: m, mintAuthority: a, name: md.name, symbol: md.symbol, uri: md.uri }));
  await sendAndConfirmTransaction(conn, tx, [admin, kp]);
  return m;
}

const stakeMint = await createMint(conn, admin, a, null, 6);
const gcKp = Keypair.generate();
await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createGlobalConfigIxs(signer(admin), signer(gcKp))).map(toWeb3)), [admin, gcKp]);
const gc = address(gcKp.publicKey.toBase58());

async function tryReward(label: string, mint: PublicKey) {
  const farm = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(...(await farms.createFarmIxs(signer(admin), signer(farm), gc, address(stakeMint.toBase58()))).map(toWeb3)), [admin, farm]);
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(toWeb3(await farms.addRewardToFarmIx(signer(admin), gc, address(farm.publicKey.toBase58()), address(mint.toBase58()), T22))), [admin]);
    console.log(`ok   ${label}`);
  } catch (e: any) {
    const log = (e.logs ?? []).find((l: string) => l.includes("Error") || l.includes("rror")) ?? e.message;
    console.log(`FAIL ${label}: ${log}`);
  }
}

await tryReward("token-2022, no extensions", await makeMint([]));
for (const n of Object.keys(EXT)) await tryReward(n, await makeMint([n]));
await tryReward("metadataPointer + tokenMetadata", await makeMint(["metadataPointer"], true));
const XSTOCK = ["metadataPointer", "permanentDelegate", "defaultAccountState", "scaledUiAmount", "pausable", "confidentialTransferMint", "transferHookNull"];
await tryReward("all xStock extensions", await makeMint(XSTOCK, true));
const reduced = await makeMint(XSTOCK.filter((n) => n !== "scaledUiAmount" && n !== "pausable"), true);
await tryReward("xStock extensions minus scaledUiAmount and pausable", reduced);

// Hand the reduced mint to reward.ts: 100 tokens in the spike admin's ATA, which reward.ts uses as HOLDER.
const SP = "/tmp/claude-1000/-home-timileyin-dev-personal/1566bdc7-c9a1-4273-9e5e-f550946fa998/scratchpad/xstock-spike";
const spikeAdmin = Keypair.fromSecretKey(Uint8Array.from(await Bun.file(`${SP}/admin.json`).json()));
const h = await createAccountFor(reduced, spikeAdmin.publicKey);
await mintTo(conn, admin, reduced, h, admin, 100_0000_0000n, [], undefined, TOKEN_2022_PROGRAM_ID);
console.log(`XMINT=${reduced.toBase58()} HOLDER=${h.toBase58()}`);

async function createAccountFor(mint: PublicKey, owner: PublicKey) {
  const { createAccount } = await import("@solana/spl-token");
  return createAccount(conn, admin, mint, owner, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
}
