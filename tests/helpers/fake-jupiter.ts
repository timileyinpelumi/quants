import type { JupiterPort, SwapQuote } from "../../src/jupiter/port";
import type { FakeChain } from "./fake-chain";

export class FakeJupiter implements JupiterPort {
  rates = new Map<string, number>();
  impactBps = new Map<string, number>();
  constructor(private chain: FakeChain) {}
  async quote(input: string, output: string, amount: bigint): Promise<SwapQuote | null> {
    const rate = this.rates.get(output);
    if (rate === undefined) return null;
    return { inAmount: amount, outAmount: BigInt(Math.floor(Number(amount) * rate)), priceImpactBps: this.impactBps.get(output) ?? 5, raw: { input, output } };
  }
  async buildSwap(q: SwapQuote) {
    const t = this.chain.tx("swap");
    this.chain.receipts.set(t.signature, q.outAmount);
    return t;
  }
  async isVerified() { return true; }
  async searchVerified() { return []; }
  async buildUnsignedSwap() { return { base64: "c3dhcA==", lastValidBlockHeight: 1n }; }
}
