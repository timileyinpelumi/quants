import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createBurnInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { JupiterPort, SwapQuote } from "../../src/jupiter/port";
import type { SolanaChain } from "../../src/chain/solana";
import { NATIVE_MINT } from "../../src/domain/types";

type Raw = { input: string; output: string };

// Local validators have no Jupiter: the keeper holds mint authority over the local reward mints and mints the swap output instead.
// A swap to SOL burns the input from the keeper and pays SOL from an airdropped market wallet, one lamport per base unit.
export function localJupiter(chain: SolanaChain, rewardMints: string[]): JupiterPort {
  const market = Keypair.generate();
  return {
    async quote(input, output, amount) {
      if (output === NATIVE_MINT && input !== NATIVE_MINT) return { inAmount: amount, outAmount: amount, priceImpactBps: 0, raw: { input, output } };
      if (!rewardMints.includes(output)) return null;
      return { inAmount: amount, outAmount: amount / 10n, priceImpactBps: 0, raw: { input, output } };
    },
    async buildSwap(q: SwapQuote) {
      const { input, output } = q.raw as Raw;
      const keeper = chain.keeper.publicKey;
      if (output === NATIVE_MINT) {
        if (BigInt(await chain.conn.getBalance(market.publicKey)) < q.outAmount + BigInt(LAMPORTS_PER_SOL)) {
          const lamports = Number(q.outAmount) + 10 * LAMPORTS_PER_SOL;
          await chain.conn.confirmTransaction(await chain.conn.requestAirdrop(market.publicKey, lamports), "confirmed");
        }
        const mint = new PublicKey(input);
        return chain.signLegacy(new Transaction().add(
          createBurnInstruction(getAssociatedTokenAddressSync(mint, keeper), mint, keeper, q.inAmount),
          SystemProgram.transfer({ fromPubkey: market.publicKey, toPubkey: keeper, lamports: q.outAmount }),
        ), [market]);
      }
      const mint = new PublicKey(output);
      const ata = getAssociatedTokenAddressSync(mint, keeper);
      return chain.signLegacy(new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(keeper, ata, keeper, mint),
        createMintToInstruction(mint, ata, keeper, q.outAmount),
      ), []);
    },
    async buildUnsignedSwap() { throw new Error("no Jupiter on a local validator"); },
    async isVerified() { return true; },
    async searchVerified() { return []; },
    async popularVerified() { return []; },
  };
}
