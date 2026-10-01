// Creates one DBC config key per fee tier for each pair token and prints them as JSON to merge into CONFIG_KEYS.
//   bun --env-file=.env scripts/create-configs.ts                       the crypto pairs from src/domain/quotes.ts
//   bun --env-file=.env scripts/create-configs.ts --stocks <mint>[=<graduation>],...  [--graduation-usd 12000]
// A stock graduates at the given whole units, or at --graduation-usd worth of it at the current Jupiter price.
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient, deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getExtensionTypes } from "@solana/spl-token";
import { loadEnv } from "../src/env";
import { loadKeypair } from "../src/chain/solana";
import { readMint, stockMintProblem } from "../src/chain/mints";
import { configKeyName, FEE_TIERS_BPS, type QuoteSpec } from "../src/meteora/config";
import { createConfigTx } from "../src/meteora/create-config";
import { quoteCoins } from "../src/domain/quotes";
import { JupiterPrices } from "../src/indexer/prices";

const env = loadEnv();
const conn = new Connection(env.RPC_URL, "confirmed");
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const client = DynamicBondingCurveClient.create(conn);
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };

async function stockSpecs(list: string, graduationUsd: number): Promise<QuoteSpec[]> {
  const prices = new JupiterPrices(env.JUPITER_API_KEY ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3", env.JUPITER_API_KEY);
  const out: QuoteSpec[] = [];
  for (const item of list.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [mint, units] = item.split("=") as [string, string | undefined];
    const key = new PublicKey(mint);
    const info = await conn.getAccountInfo(key);
    if (!info) throw new Error(`${mint} not found on this network`);
    const m = readMint(key, info);
    const problem = stockMintProblem(m);
    if (problem) throw new Error(`${mint} cannot be a stock pair: ${problem}`);
    if (getExtensionTypes(m.mint.tlvData).length && !(await conn.getAccountInfo(deriveTokenBadgeAddress(key)))) {
      throw new Error(`${mint} has Token-2022 extensions and no DBC token badge; Meteora has to create one before it can be a pair`);
    }
    let graduation = units ? Number(units) : NaN;
    if (!units) {
      const usd = await prices.usd(mint);
      if (!usd) throw new Error(`no Jupiter price for ${mint}; pass ${mint}=<whole units> instead`);
      graduation = Math.ceil(graduationUsd / usd);
    }
    if (!Number.isFinite(graduation) || graduation <= 0) throw new Error(`graduation for ${mint} must be a positive number`);
    out.push({ mint, decimals: m.decimals, migrationQuoteThreshold: graduation });
    console.error(`${mint}: ${m.decimals} decimals, graduates at ${graduation}`);
  }
  return out;
}

const stocks = arg("--stocks");
const quotes = stocks
  ? await stockSpecs(stocks, Number(arg("--graduation-usd") ?? 12_000))
  : quoteCoins().map((c) => ({ mint: c.mint, decimals: c.decimals, migrationQuoteThreshold: c.graduation }));
const out: Record<string, string> = {};
for (const q of quotes) {
  if (!Number.isFinite(q.migrationQuoteThreshold) || q.migrationQuoteThreshold <= 0) throw new Error(`graduation threshold missing for ${q.mint}`);
  for (const bps of FEE_TIERS_BPS) {
    const config = Keypair.generate();
    await sendAndConfirmTransaction(conn, await createConfigTx(client, conn, keeper.publicKey, config.publicKey, bps, q), [keeper, config]);
    out[configKeyName(q.mint, bps)] = config.publicKey.toBase58();
    console.error("created", configKeyName(q.mint, bps));
  }
}
console.log(JSON.stringify(out, null, 2));
