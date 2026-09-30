import { Transaction, PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { JupiterPort, SwapQuote } from "../../src/jupiter/port";
import type { SolanaChain } from "../../src/chain/solana";

// Local validators have no Jupiter: the keeper holds mint authority over the local reward mints and mints the swap output instead.
export function localJupiter(chain: SolanaChain, rewardMints: string[]): JupiterPort {
  return {
    async quote(_i, output, amount) {
      if (!rewardMints.includes(output)) return null;
      return { inAmount: amount, outAmount: amount / 10n, priceImpactBps: 0, raw: { output } };
    },
    async buildSwap(q: SwapQuote) {
      const mint = new PublicKey((q.raw as { output: string }).output);
      const keeper = chain.keeper.publicKey;
      const ata = getAssociatedTokenAddressSync(mint, keeper);
      return chain.signLegacy(new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(keeper, ata, keeper, mint),
        createMintToInstruction(mint, ata, keeper, q.outAmount),
      ), []);
    },
    async buildUnsignedSwap() { throw new Error("no Jupiter on a local validator"); },
    async isVerified() { return true; },
    async searchVerified() { return []; },
  };
}
