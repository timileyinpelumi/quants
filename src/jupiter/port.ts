import { ComputeBudgetProgram, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { SignedTx } from "../chain/port";
import type { SolanaChain } from "../chain/solana";

export interface SwapQuote { inAmount: bigint; outAmount: bigint; priceImpactBps: number; raw: unknown }
export interface VerifiedToken { mint: string; symbol: string; name: string; icon: string | null; decimals: number; tokenProgram: string }
export interface JupiterPort {
  quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null>;
  buildSwap(q: SwapQuote): Promise<SignedTx>;
  buildUnsignedSwap(q: SwapQuote, user: string): Promise<{ base64: string; lastValidBlockHeight: bigint }>;
  isVerified(mint: string): Promise<boolean>;
  searchVerified(query: string): Promise<VerifiedToken[]>;
  popularVerified(): Promise<VerifiedToken[]>;
}

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
const CLASSIC_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** Verified classic and Token-2022 tokens. Callers that pay a token out check a Token-2022 mint's extensions on chain. */
const keepVerified = (rows: TokenRow[]): VerifiedToken[] => rows
  .filter((t) => t.isVerified === true && (t.tokenProgram === CLASSIC_TOKEN_PROGRAM || t.tokenProgram === TOKEN_2022_PROGRAM))
  .map((t) => ({ mint: t.id, symbol: t.symbol, name: t.name, icon: t.icon ?? null, decimals: t.decimals, tokenProgram: t.tokenProgram! }));
type TokenRow = { id: string; symbol: string; name: string; icon?: string | null; decimals: number; tags?: string[]; isVerified?: boolean; tokenProgram?: string; organicScore?: number };
/** How many popular tokens the reward picker can browse before searching; a few spare for mints the extension check drops. */
export const POPULAR_SIZE = 200;

const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const ASSOCIATED_TOKEN = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const SYSTEM = SystemProgram.programId.toBase58();
const SYNC_NATIVE = 17, CLOSE_ACCOUNT = 9, SYSTEM_TRANSFER = 2;

/** Throws unless the swap only touches Jupiter, compute budget, token account plumbing and the keeper's own SOL wrapping. */
export function assertSafeSwap(tx: VersionedTransaction, keeper: PublicKey) {
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const me = keeper.toBase58();
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, keeper).toBase58();
  if (keys[0] !== me) throw new Error(`swap refused: fee payer ${keys[0]} is not the keeper`);
  // Accounts that come from lookup tables cannot be checked here, so checked instructions must use static keys.
  const acct = (ix: { accountKeyIndexes: number[] }, i: number, what: string) => {
    const k = keys[ix.accountKeyIndexes[i]!];
    if (!k) throw new Error(`swap refused: ${what} instruction uses an account outside the static keys`);
    return k;
  };
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    if (program === JUPITER_V6 || program === COMPUTE_BUDGET) continue;
    if (program === SYSTEM) {
      const ok = data.length === 12 && data.readUInt32LE(0) === SYSTEM_TRANSFER && acct(ix, 0, "System") === me && acct(ix, 1, "System") === wsol;
      if (!ok) throw new Error("swap refused: System instruction other than wrapping SOL into the keeper's wSOL account");
      continue;
    }
    if (program === CLASSIC_TOKEN_PROGRAM || program === TOKEN_2022) {
      const ok = (data.length === 1 && data[0] === SYNC_NATIVE)
        || (data.length === 1 && data[0] === CLOSE_ACCOUNT && acct(ix, 1, "Token") === me && acct(ix, 2, "Token") === me);
      if (!ok) throw new Error("swap refused: Token instruction other than sync or closing to the keeper");
      continue;
    }
    if (program === ASSOCIATED_TOKEN) {
      const ok = (data.length === 0 || (data.length === 1 && data[0]! <= 1)) && acct(ix, 0, "Associated Token") === me && acct(ix, 2, "Associated Token") === me;
      if (!ok) throw new Error("swap refused: Associated Token instruction not creating a keeper account");
      continue;
    }
    throw new Error(`swap refused: program ${program} is not allowed`);
  }
}

export class JupiterUnavailable extends Error {}

const VERIFIED_TTL = 10 * 60_000;

export class JupiterLive implements JupiterPort {
  private verified = new Map<string, number>();
  private tokensBase: string;
  constructor(private baseUrl: string, private chain: SolanaChain, private fetchFn: Fetch = fetch, private apiKey?: string) {
    this.tokensBase = `${new URL(baseUrl).origin}/tokens/v2`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.apiKey ? { ...extra, "x-api-key": this.apiKey } : extra;
  }

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null> {
    const url = new URL(`${this.baseUrl}/quote`);
    url.search = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: "true" }).toString();
    const res = await this.fetchFn(url, { headers: this.headers() });
    if (!res.ok) return null;
    const q = await res.json() as { inAmount: string; outAmount: string; priceImpactPct: string };
    return { inAmount: BigInt(q.inAmount), outAmount: BigInt(q.outAmount), priceImpactBps: Math.round(Number(q.priceImpactPct) * 10_000), raw: q };
  }

  private async swapTx(q: SwapQuote, user: string) {
    const res = await this.fetchFn(`${this.baseUrl}/swap`, {
      method: "POST", headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ quoteResponse: q.raw, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
    });
    if (!res.ok) throw new Error(`jupiter swap build failed: ${res.status}`);
    return await res.json() as { swapTransaction: string; lastValidBlockHeight: number };
  }

  async buildSwap(q: SwapQuote): Promise<SignedTx> {
    const { swapTransaction, lastValidBlockHeight } = await this.swapTx(q, this.chain.keeper.publicKey.toBase58());
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    assertSafeSwap(tx, this.chain.keeper.publicKey);
    return this.chain.signVersioned(tx, [], BigInt(lastValidBlockHeight));
  }

  async buildUnsignedSwap(q: SwapQuote, user: string) {
    const { swapTransaction, lastValidBlockHeight } = await this.swapTx(q, user);
    return { base64: swapTransaction, lastValidBlockHeight: BigInt(lastValidBlockHeight) };
  }

  private popular: { at: number; list: VerifiedToken[] } | null = null;

  // The top lists stop at 100 tokens of any kind, so the full verified list (about 4,000, 5 MB) is read every 10 minutes
  // and ranked by organic score instead.
  async popularVerified(): Promise<VerifiedToken[]> {
    if (this.popular && Date.now() - this.popular.at < 600_000) return this.popular.list;
    const res = await this.fetchFn(`${this.tokensBase}/tag?query=verified`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return this.popular?.list ?? [];
    const rows = (await res.json() as TokenRow[]).sort((a, b) => (b.organicScore ?? 0) - (a.organicScore ?? 0));
    const list = keepVerified(rows).slice(0, POPULAR_SIZE + 100);
    this.remember(list.map((t) => t.mint));
    this.popular = { at: Date.now(), list };
    return list;
  }

  private remember(mints: string[]) { const now = Date.now(); for (const m of mints) this.verified.set(m, now); }

  // RETRY-LOOP-SAFETY: two attempts at most, 8s timeout each, no sleep; the caller sees JupiterUnavailable after that.
  private async searchStrict(query: string): Promise<TokenRow[]> {
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchFn(`${this.tokensBase}/search?query=${encodeURIComponent(query)}`, { headers: this.headers(), signal: AbortSignal.timeout(8000) });
        if (res.ok) return await res.json() as TokenRow[];
        last = `status ${res.status}`;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
    console.error(JSON.stringify({ at: new Date().toISOString(), jupiterTokenSearchFailed: last }));
    throw new JupiterUnavailable(last);
  }

  private async search(query: string): Promise<TokenRow[]> {
    return this.searchStrict(query).catch(() => []);
  }

  async isVerified(mint: string): Promise<boolean> {
    const seen = this.verified.get(mint);
    if (seen && Date.now() - seen < VERIFIED_TTL) return true;
    const t = (await this.searchStrict(mint)).find((x) => x.id === mint);
    const ok = !!t && (t.isVerified === true || (t.tags ?? []).includes("verified"));
    if (ok) this.remember([mint]);
    return ok;
  }

  async searchVerified(query: string): Promise<VerifiedToken[]> {
    const list = keepVerified(await this.search(query));
    this.remember(list.map((t) => t.mint));
    return list;
  }
}
