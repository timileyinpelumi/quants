import { VersionedTransaction } from "@solana/web3.js";
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
}

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
const CLASSIC_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
type TokenRow = { id: string; symbol: string; name: string; icon?: string | null; decimals: number; tags?: string[]; isVerified?: boolean; tokenProgram?: string };

export class JupiterLive implements JupiterPort {
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
    return this.chain.signVersioned(tx, [], BigInt(lastValidBlockHeight));
  }

  async buildUnsignedSwap(q: SwapQuote, user: string) {
    const { swapTransaction, lastValidBlockHeight } = await this.swapTx(q, user);
    return { base64: swapTransaction, lastValidBlockHeight: BigInt(lastValidBlockHeight) };
  }

  private async search(query: string): Promise<TokenRow[]> {
    const res = await this.fetchFn(`${this.tokensBase}/search?query=${encodeURIComponent(query)}`, { headers: this.headers() });
    if (!res.ok) return [];
    return await res.json() as TokenRow[];
  }

  async isVerified(mint: string): Promise<boolean> {
    const t = (await this.search(mint)).find((x) => x.id === mint);
    return !!t && (t.isVerified === true || (t.tags ?? []).includes("verified"));
  }

  async searchVerified(query: string): Promise<VerifiedToken[]> {
    return (await this.search(query))
      .filter((t) => t.isVerified === true && t.tokenProgram === CLASSIC_TOKEN_PROGRAM)
      .map((t) => ({ mint: t.id, symbol: t.symbol, name: t.name, icon: t.icon ?? null, decimals: t.decimals, tokenProgram: t.tokenProgram! }));
  }
}
