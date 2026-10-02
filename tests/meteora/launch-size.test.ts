import { test, expect } from "bun:test";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { MeteoraLive } from "../../src/meteora/port";
import { buildQuantsConfig, type QuoteSpec } from "../../src/meteora/config";
import { walletTx, TX_LIMIT } from "../../src/web/server/tx-check";

// Real Meteora builders against a stub RPC, at the worst case: no token accounts yet (both ATAs created), longest
// name and symbol, a long metadata link, a first buy, the keeper top up, and a Token-2022 pair with its badge.
const MARGIN = 100;
const SOL: QuoteSpec = { mint: "So11111111111111111111111111111111111111112", decimals: 9, migrationQuoteThreshold: 85 };
const USDC: QuoteSpec = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, migrationQuoteThreshold: 12_000 };
const STOCK: QuoteSpec = { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, migrationQuoteThreshold: 50 };
const token2022 = new Set([STOCK.mint]);

function live(q: QuoteSpec) {
  const mint = new PublicKey(q.mint);
  const badge = deriveTokenBadgeAddress(mint);
  const account = (owner: PublicKey, size: number) => ({ owner, data: Buffer.alloc(size), lamports: 1, executable: false });
  const conn = {
    commitment: "confirmed",
    rpcEndpoint: "http://stub",
    getAccountInfo: async (k: PublicKey) => {
      if (k.equals(mint)) return account(token2022.has(q.mint) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID, 82);
      if (k.equals(badge)) return account(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"), 200);
      return null;
    },
    getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
  } as unknown as Connection;
  const m = new MeteoraLive({ conn, keeper: Keypair.generate() } as any, "11111111111111111111111111111111");
  const p = buildQuantsConfig(200, q);
  (m as any).dbc.creator.state.getPoolConfig = async () => ({
    quoteMint: mint, tokenType: 0, quoteTokenFlag: token2022.has(q.mint) ? 1 : 0, poolFees: p.poolFees, activationType: p.activationType, migrationOption: p.migrationOption,
  });
  return m;
}

const input = (q: QuoteSpec) => ({
  name: "N".repeat(32), symbol: "S".repeat(10), uri: `https://res.cloudinary.com/quants-production/raw/upload/v1727890000/quants/${"a".repeat(32)}.json`,
  creator: Keypair.generate().publicKey.toBase58(), configKey: Keypair.generate().publicKey.toBase58(), quoteMint: q.mint,
  devBuyQuoteAmount: 1_000_000_000n, devBuyMinOut: 0n, keeperTopUp: { to: Keypair.generate().publicKey.toBase58(), lamports: 10_000_000n },
});
const sizeOf = (base64: string) => Buffer.from(walletTx(base64).base64, "base64").length;

test("every launch transaction stays at least 100 bytes under the size limit", async () => {
  const sizes: Record<string, number> = {};
  for (const [label, q] of [["sol", SOL], ["usdc", USDC], ["token2022", STOCK]] as const) {
    const m = live(q);
    const { tx } = await m.buildLaunchTx(input(q));
    sizes[`launch ${label}`] = sizeOf(tx.serialize({ requireAllSignatures: false }).toString("base64"));
    const cfg = await m.buildConfigTx({
      creator: Keypair.generate().publicKey.toBase58(), quoteMint: q.mint,
      create: { config: Keypair.generate(), feeBps: 200, quote: q, keeper: Keypair.generate().publicKey.toBase58() },
    });
    sizes[`config ${label}`] = sizeOf(cfg.serialize({ requireAllSignatures: false }).toString("base64"));
  }
  console.log(JSON.stringify(sizes));
  for (const [label, size] of Object.entries(sizes)) {
    if (size > TX_LIMIT - MARGIN) throw new Error(`${label} is ${size} bytes, within ${MARGIN} of the ${TX_LIMIT} byte limit`);
  }
  expect(Object.keys(sizes).length).toBe(6);
});
