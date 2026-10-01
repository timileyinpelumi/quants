import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createBurnInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createNoopSigner, address, type Instruction, type TransactionSigner } from "@solana/kit";
import bs58 from "bs58";
import type { ChainPort, SignedTx, SigState } from "./port";
import { NATIVE_MINT } from "../domain/types";
import { mintPaused, readMint, TOKEN_2022_PROGRAM } from "./mints";

export const loadKeypair = (json: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
export const kitSigner = (kp: Keypair): TransactionSigner => createNoopSigner(address(kp.publicKey.toBase58()));

export function fromKitInstruction(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
    data: Buffer.from(ix.data ?? []),
  });
}

export class SolanaChain implements ChainPort {
  // A mint's token program and decimals never change, so they are read once per process.
  private mints = new Map<string, { program: PublicKey; decimals: number }>();
  constructor(readonly conn: Connection, readonly keeper: Keypair, readonly spill: Keypair) {}

  async mintInfo(mint: string): Promise<{ program: PublicKey; decimals: number } | null> {
    const hit = this.mints.get(mint);
    if (hit) return hit;
    const key = new PublicKey(mint);
    const info = await this.conn.getAccountInfo(key, "confirmed");
    if (!info) return null;
    const { program, decimals } = readMint(key, info);
    this.mints.set(mint, { program, decimals });
    return { program, decimals };
  }

  private async requireMint(mint: string) {
    const m = await this.mintInfo(mint);
    if (!m) throw new Error(`mint ${mint} not found`);
    return m;
  }

  async signLegacy(tx: Transaction, signers: Keypair[]): Promise<SignedTx> {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.keeper.publicKey;
    tx.sign(this.keeper, ...signers.filter((s) => !s.publicKey.equals(this.keeper.publicKey)));
    const raw = tx.serialize();
    return {
      signature: bs58.encode(tx.signature!),
      lastValidBlockHeight: BigInt(lastValidBlockHeight),
      send: async () => { await this.conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }); },
    };
  }

  async signVersioned(tx: VersionedTransaction, signers: Keypair[], lastValidBlockHeight: bigint): Promise<SignedTx> {
    tx.sign([this.keeper, ...signers]);
    const raw = tx.serialize();
    return {
      signature: bs58.encode(tx.signatures[0]!),
      lastValidBlockHeight,
      send: async () => { await this.conn.sendRawTransaction(raw, { maxRetries: 3 }); },
    };
  }

  async status(sig: string): Promise<SigState> {
    const { value } = await this.conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const s = value[0];
    if (!s) return "unknown";
    if (s.err) return "failed";
    return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "unknown";
  }

  async blockHeight() { return BigInt(await this.conn.getBlockHeight("confirmed")); }

  async waitForConfirmation(sig: string, lastValidBlockHeight: bigint): Promise<SigState> {
    while (true) {
      // Height first: a status read after the observed expiry is final.
      const height = await this.blockHeight();
      const s = await this.status(sig);
      if (s !== "unknown") return s;
      if (height > lastValidBlockHeight) return "unknown";
      await Bun.sleep(1_000);
    }
  }

  async received(sig: string, owner: string, mint: string): Promise<bigint> {
    const tx = await this.conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) throw new Error(`transaction ${sig} not found`);
    const sum = (list: typeof tx.meta.preTokenBalances) =>
      (list ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
    let delta = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    if (mint === NATIVE_MINT) {
      const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
      const i = keys.indexOf(owner);
      if (i >= 0) {
        delta += BigInt(tx.meta.postBalances[i]! - tx.meta.preBalances[i]!);
        if (i === 0) delta += BigInt(tx.meta.fee);
      }
    }
    return delta;
  }

  async buildTransfer(mint: string, to: string, amount: bigint): Promise<SignedTx> {
    const tx = new Transaction();
    const dest = new PublicKey(to);
    if (mint === NATIVE_MINT) {
      tx.add(SystemProgram.transfer({ fromPubkey: this.keeper.publicKey, toPubkey: dest, lamports: amount }));
    } else {
      const m = new PublicKey(mint);
      const { program, decimals } = await this.requireMint(mint);
      const from = getAssociatedTokenAddressSync(m, this.keeper.publicKey, false, program);
      const toAta = getAssociatedTokenAddressSync(m, dest, true, program);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(this.keeper.publicKey, toAta, dest, m, program));
      tx.add(createTransferCheckedInstruction(from, m, toAta, this.keeper.publicKey, amount, decimals, [], program));
    }
    return this.signLegacy(tx, []);
  }

  async buildBurn(mint: string, amount: bigint): Promise<SignedTx> {
    const m = new PublicKey(mint);
    const { program } = await this.requireMint(mint);
    const ata = getAssociatedTokenAddressSync(m, this.spill.publicKey, false, program);
    return this.signLegacy(new Transaction().add(createBurnInstruction(ata, m, this.spill.publicKey, amount, [], program)), [this.spill]);
  }

  async balance(owner: string, mint: string): Promise<bigint> {
    const o = new PublicKey(owner);
    if (mint === NATIVE_MINT) return BigInt(await this.conn.getBalance(o, "confirmed"));
    const m = await this.mintInfo(mint);
    if (!m) return 0n;
    try {
      const r = await this.conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), o, true, m.program), "confirmed");
      return BigInt(r.value.amount);
    } catch {
      return 0n;
    }
  }

  async isPaused(mint: string): Promise<boolean> {
    if (mint === NATIVE_MINT) return false;
    const m = await this.mintInfo(mint);
    if (!m || m.program.toBase58() !== TOKEN_2022_PROGRAM) return false;
    const key = new PublicKey(mint);
    const info = await this.conn.getAccountInfo(key, "confirmed");
    return !!info && mintPaused(readMint(key, info).mint);
  }
}
