import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { loadEnv } from "../src/env";
import { loadKeypair } from "../src/chain/solana";
import { buildQuantsConfig, configKeyName, FEE_TIERS_BPS } from "../src/meteora/config";
import { quoteCoins } from "../src/domain/quotes";

const env = loadEnv();
const conn = new Connection(env.RPC_URL, "confirmed");
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const client = DynamicBondingCurveClient.create(conn);
const quotes = quoteCoins().map((c) => ({ mint: c.mint, decimals: c.decimals, migrationQuoteThreshold: c.graduation }));
const out: Record<string, string> = {};
for (const q of quotes) {
  if (!Number.isFinite(q.migrationQuoteThreshold) || q.migrationQuoteThreshold <= 0) throw new Error(`graduation threshold missing for ${q.mint}`);
  for (const bps of FEE_TIERS_BPS) {
    const config = Keypair.generate();
    const tx = await client.partner.createConfig({
      config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey,
      quoteMint: new PublicKey(q.mint), payer: keeper.publicKey,
      ...buildQuantsConfig(bps, q),
    });
    await sendAndConfirmTransaction(conn, tx, [keeper, config]);
    out[configKeyName(q.mint, bps)] = config.publicKey.toBase58();
    console.error("created", configKeyName(q.mint, bps));
  }
}
console.log(JSON.stringify(out, null, 2));
