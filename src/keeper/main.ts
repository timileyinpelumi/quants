import { Connection } from "@solana/web3.js";
import { loadEnv } from "../env";
import { db } from "../db/client";
import { SolanaChain, loadKeypair } from "../chain/solana";
import { MeteoraLive } from "../meteora/port";
import { JupiterLive } from "../jupiter/port";
import { KaminoBackend } from "../staking/kamino";
import { loadLatestSettings } from "../domain/settings";
import { runKeeper, ReconcileError } from "./run";

const env = loadEnv();
const sql = db(env.DATABASE_URL);
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const spill = loadKeypair(env.SPILL_KEYPAIR);
const chain = new SolanaChain(new Connection(env.RPC_URL, "confirmed"), keeper, spill);
const deps = {
  sql, chain,
  meteora: new MeteoraLive(chain, env.DAMM_V2_MIGRATION_CONFIG),
  jupiter: new JupiterLive(env.JUPITER_BASE_URL, chain, fetch, env.JUPITER_API_KEY),
  staking: new KaminoBackend(chain, env.RPC_URL, env.KAMINO_GLOBAL_CONFIG),
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: env.TREASURY_ADDRESS },
  ourtokenMint: env.OURTOKEN_MINT,
};

// A ReconcileError exits so a supervisor restart loop is visible and no funds move while the ledger is wrong.
while (true) {
  const started = Date.now();
  try {
    const r = await runKeeper(deps);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), fatal: String(e) }));
    if (e instanceof ReconcileError) process.exit(1);
  }
  const { keeperIntervalSeconds } = await loadLatestSettings(sql);
  await Bun.sleep(Math.max(0, keeperIntervalSeconds * 1000 - (Date.now() - started)));
}
