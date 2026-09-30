import { VersionedTransaction } from "@solana/web3.js";
import type { SignedTx } from "../chain/port";
import type { SolanaChain } from "../chain/solana";

export interface SwapQuote { inAmount: bigint; outAmount: bigint; priceImpactBps: number; raw: unknown }
export interface JupiterPort {
  quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null>;
  buildSwap(q: SwapQuote): Promise<SignedTx>;
  isVerified(mint: string): Promise<boolean>;
}

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class JupiterLive implements JupiterPort {
  constructor(private baseUrl: string, private chain: SolanaChain, private fetchFn: Fetch = fetch) {}

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<SwapQuote | null> {
    const url = new URL(`${this.baseUrl}/quote`);
    url.search = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: "true" }).toString();
    const res = await this.fetchFn(url);
    if (!res.ok) return null;
    const q = await res.json() as { inAmount: string; outAmount: string; priceImpactPct: string };
    return { inAmount: BigInt(q.inAmount), outAmount: BigInt(q.outAmount), priceImpactBps: Math.round(Number(q.priceImpactPct) * 10_000), raw: q };
  }

  async buildSwap(q: SwapQuote): Promise<SignedTx> {
    const res = await this.fetchFn(`${this.baseUrl}/swap`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteResponse: q.raw, userPublicKey: this.chain.keeper.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
    });
    if (!res.ok) throw new Error(`jupiter swap build failed: ${res.status}`);
    const { swapTransaction, lastValidBlockHeight } = await res.json() as { swapTransaction: string; lastValidBlockHeight: number };
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    return this.chain.signVersioned(tx, [], BigInt(lastValidBlockHeight));
  }

  async isVerified(mint: string): Promise<boolean> {
    const res = await this.fetchFn(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (!res.ok) return false;
    const list = await res.json() as { id: string; tags?: string[]; isVerified?: boolean }[];
    const t = list.find((x) => x.id === mint);
    return !!t && (t.isVerified === true || (t.tags ?? []).includes("verified"));
  }
}
