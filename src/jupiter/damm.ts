import {
  ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, type Connection,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT as WSOL, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { CpAmm, getPriceFromSqrtPrice, getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import type { SignedTx } from "../chain/port";
import type { JupiterPort, SwapQuote, VerifiedToken } from "./port";
import { NATIVE_MINT } from "../domain/types";

/** A token with a DAMM v2 pool against SOL. On devnet these stand in for Jupiter's routes and verified list. */
export interface PoolToken { mint: string; symbol: string; name: string; decimals: number; pool: string; icon?: string | null }

export const poolTokens = (env: Record<string, string | undefined> = process.env): PoolToken[] =>
  env.DEVNET_TOKENS ? (JSON.parse(env.DEVNET_TOKENS) as PoolToken[]) : [];

export const DAMM_V2 = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const SWAP_IX = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();
const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const ASSOCIATED_TOKEN = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const SYSTEM = SystemProgram.programId.toBase58();
const SYNC_NATIVE = 17, CLOSE_ACCOUNT = 9, SYSTEM_TRANSFER = 2;

/**
 * The DAMM v2 counterpart of assertSafeSwap: only a DAMM v2 swap on one of `pools` paid by the keeper into its own
 * token accounts, compute budget, the keeper's token accounts and wrapping or unwrapping its own SOL.
 */
export function assertSafeDammSwap(ixs: TransactionInstruction[], keeper: PublicKey, pools: Set<string>) {
  const me = keeper.toBase58();
  const wsol = getAssociatedTokenAddressSync(WSOL, keeper).toBase58();
  for (const ix of ixs) {
    const program = ix.programId.toBase58();
    const k = (i: number) => ix.keys[i]?.pubkey.toBase58();
    if (program === DAMM_V2) {
      if (ix.data.length < 8 || !ix.data.subarray(0, 8).equals(SWAP_IX)) throw new Error("swap refused: DAMM v2 instruction other than swap");
      if (!pools.has(k(1)!)) throw new Error(`swap refused: pool ${k(1)} is not a known pool`);
      if (k(8) !== me) throw new Error("swap refused: DAMM v2 swap not paid by the keeper");
      const ownAtas = [6, 7].map((m, i) => getAssociatedTokenAddressSync(ix.keys[m]!.pubkey, keeper, true, ix.keys[9 + i]!.pubkey).toBase58());
      if (!ownAtas.includes(k(2)!) || !ownAtas.includes(k(3)!)) throw new Error("swap refused: DAMM v2 swap uses token accounts the keeper does not own");
      continue;
    }
    if (program === COMPUTE_BUDGET) continue;
    if (program === SYSTEM) {
      const ok = ix.data.length === 12 && ix.data.readUInt32LE(0) === SYSTEM_TRANSFER && k(0) === me && k(1) === wsol;
      if (!ok) throw new Error("swap refused: System instruction other than wrapping SOL into the keeper's wSOL account");
      continue;
    }
    if (program === TOKEN || program === TOKEN_2022) {
      const ok = (ix.data.length === 1 && ix.data[0] === SYNC_NATIVE)
        || (ix.data.length === 1 && ix.data[0] === CLOSE_ACCOUNT && k(1) === me && k(2) === me);
      if (!ok) throw new Error("swap refused: Token instruction other than sync or closing to the keeper");
      continue;
    }
    if (program === ASSOCIATED_TOKEN) {
      const ok = (ix.data.length === 0 || (ix.data.length === 1 && ix.data[0]! <= 1)) && k(0) === me && k(2) === me;
      if (!ok) throw new Error("swap refused: Associated Token instruction not creating a keeper account");
      continue;
    }
    throw new Error(`swap refused: program ${program} is not allowed`);
  }
}

/** What the adapter needs from DAMM v2; DammLive talks to the chain, tests use a fake. */
export interface DammBackend {
  quote(pool: string, inputMint: string, amountIn: bigint, slippageBps: number): Promise<{ out: bigint; minOut: bigint; impactBps: number }>;
  swapIxs(pool: string, inputMint: string, amountIn: bigint, minOut: bigint, payer: PublicKey): Promise<TransactionInstruction[]>;
  /** SOL per whole token. */
  priceInSol(pool: string, mint: string): Promise<number | null>;
}

interface Signer { keeper: { publicKey: PublicKey }; signLegacy(tx: Transaction, signers: []): Promise<SignedTx> }
type Raw = { pool: string; inputMint: string; outputMint: string; minOut: string };
const CLASSIC = TOKEN_PROGRAM_ID.toBase58();

/**
 * JupiterPort over single hop DAMM v2 pools against SOL, for clusters Jupiter does not serve. Quotes and swaps are real
 * on-chain swaps with a minimum out from the slippage cap. Token to token (for example a QUANTS basket into a reward)
 * has no route and quotes null, so that share waits in escrow like a failed Jupiter quote.
 */
export class DammSwap implements JupiterPort {
  private byMint: Map<string, PoolToken>;
  private pools: Set<string>;
  constructor(private chain: Signer, private backend: DammBackend, private tokens: PoolToken[], private blockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>) {
    this.byMint = new Map(tokens.map((t) => [t.mint, t]));
    this.pools = new Set(tokens.map((t) => t.pool));
  }

  private route(input: string, output: string): PoolToken | null {
    if (input === NATIVE_MINT && output !== NATIVE_MINT) return this.byMint.get(output) ?? null;
    if (output === NATIVE_MINT && input !== NATIVE_MINT) return this.byMint.get(input) ?? null;
    return null;
  }

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null> {
    const t = this.route(inputMint, outputMint);
    if (!t || amount <= 0n) return null;
    const q = await this.backend.quote(t.pool, inputMint, amount, slippageBps);
    if (q.out <= 0n) return null;
    const raw: Raw = { pool: t.pool, inputMint, outputMint, minOut: q.minOut.toString() };
    return { inAmount: amount, outAmount: q.out, priceImpactBps: q.impactBps, raw };
  }

  private async ixs(q: SwapQuote, payer: PublicKey) {
    const r = q.raw as Raw;
    if (!this.pools.has(r.pool)) throw new Error(`swap refused: pool ${r.pool} is not a known pool`);
    return this.backend.swapIxs(r.pool, r.inputMint, q.inAmount, BigInt(r.minOut), payer);
  }

  async buildSwap(q: SwapQuote): Promise<SignedTx> {
    const keeper = this.chain.keeper.publicKey;
    const ixs = await this.ixs(q, keeper);
    assertSafeDammSwap(ixs, keeper, this.pools);
    return this.chain.signLegacy(new Transaction().add(...ixs), []);
  }

  async buildUnsignedSwap(q: SwapQuote, user: string) {
    const payer = new PublicKey(user);
    const ixs = await this.ixs(q, payer);
    const { blockhash, lastValidBlockHeight } = await this.blockhash();
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    return { base64: Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64"), lastValidBlockHeight: BigInt(lastValidBlockHeight) };
  }

  private verified = (t: PoolToken): VerifiedToken => ({ mint: t.mint, symbol: t.symbol, name: t.name, icon: t.icon ?? null, decimals: t.decimals, tokenProgram: CLASSIC });

  async isVerified(mint: string) { return this.byMint.has(mint); }
  async popularVerified() { return this.tokens.map(this.verified); }
  async searchVerified(query: string) {
    const q = query.toLowerCase();
    return this.tokens.filter((t) => `${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(q)).map(this.verified);
  }
}

const bn = (v: bigint) => new BN(v.toString());
const big = (v: { toString(): string }) => BigInt(v.toString());

export class DammLive implements DammBackend {
  private cp: CpAmm;
  constructor(private conn: Connection, private decimals: (mint: string) => number) {
    this.cp = new CpAmm(conn);
  }

  async quote(pool: string, inputMint: string, amountIn: bigint, slippageBps: number) {
    const poolState = await this.cp.fetchPoolState(new PublicKey(pool));
    const slot = await this.conn.getSlot("confirmed");
    const time = (await this.conn.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    const q = this.cp.getQuote({
      inAmount: bn(amountIn), inputTokenMint: new PublicKey(inputMint), slippage: slippageBps / 100, poolState, currentTime: time, currentSlot: slot,
      tokenADecimal: this.decimals(poolState.tokenAMint.toBase58()), tokenBDecimal: this.decimals(poolState.tokenBMint.toBase58()),
    });
    const out = big(q.swapOutAmount);
    return { out, minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n, impactBps: Math.ceil(Number(q.priceImpact) * 100) };
  }

  async swapIxs(pool: string, inputMint: string, amountIn: bigint, minOut: bigint, payer: PublicKey) {
    const key = new PublicKey(pool);
    const s = await this.cp.fetchPoolState(key);
    const input = new PublicKey(inputMint);
    const output = input.equals(s.tokenAMint) ? s.tokenBMint : s.tokenAMint;
    const tx = await this.cp.swap({
      payer, pool: key, inputTokenMint: input, outputTokenMint: output, amountIn: bn(amountIn), minimumAmountOut: bn(minOut),
      tokenAMint: s.tokenAMint, tokenBMint: s.tokenBMint, tokenAVault: s.tokenAVault, tokenBVault: s.tokenBVault,
      tokenAProgram: getTokenProgram(s.tokenAFlag), tokenBProgram: getTokenProgram(s.tokenBFlag), referralTokenAccount: null, poolState: s,
    });
    return tx.instructions;
  }

  async priceInSol(pool: string, mint: string) {
    const s = await this.cp.fetchPoolState(new PublicKey(pool));
    const a = s.tokenAMint.toBase58(), b = s.tokenBMint.toBase58();
    const aInB = Number(getPriceFromSqrtPrice(s.sqrtPrice, this.decimals(a), this.decimals(b)));
    if (!Number.isFinite(aInB) || aInB <= 0) return null;
    if (a === mint && b === NATIVE_MINT) return aInB;
    if (b === mint && a === NATIVE_MINT) return 1 / aInB;
    return null;
  }
}

export function dammDecimals(tokens: PoolToken[]) {
  const d = new Map<string, number>([[NATIVE_MINT, 9], ...tokens.map((t) => [t.mint, t.decimals] as [string, number])]);
  return (mint: string) => {
    const v = d.get(mint);
    if (v === undefined) throw new Error(`decimals unknown for ${mint}`);
    return v;
  };
}
