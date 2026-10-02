import { Connection } from "@solana/web3.js";
import { loadEnv } from "../env";
import { db } from "../db/client";
import { SolanaChain, loadKeypair } from "../chain/solana";
import { MeteoraLive } from "../meteora/port";
import { swapPortFor } from "../jupiter/select";
import { KaminoBackend } from "../staking/kamino";
import { loadLatestSettings } from "../domain/settings";
import { runKeeper, ReconcileError } from "./run";
import { makeAlerter, sqlThrottle, Streaks, keeperRunAlerts } from "../ops/alerts";

const env = loadEnv();
const sql = db(env.DATABASE_URL);
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const spill = loadKeypair(env.SPILL_KEYPAIR);
const chain = new SolanaChain(new Connection(env.RPC_URL, "confirmed"), keeper, spill);
const deps = {
  sql, chain,
  meteora: new MeteoraLive(chain, env.DAMM_V2_MIGRATION_CONFIG),
  jupiter: swapPortFor(process.env, chain),
  staking: new KaminoBackend(chain, env.RPC_URL, env.KAMINO_GLOBAL_CONFIG),
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: env.TREASURY_ADDRESS },
};

// The webhook is an admin setting (seeded from ALERT_WEBHOOK_URL); each run refreshes it.
let webhook: string | undefined = env.ALERT_WEBHOOK_URL;
const alert = makeAlerter({ url: () => webhook, source: "keeper", store: sqlThrottle(sql) });
const launchStreaks = new Streaks(3);

// A ReconcileError exits so a supervisor restart loop is visible and no funds move while the ledger is wrong.
while (true) {
  const started = Date.now();
  try {
    webhook = (await loadLatestSettings(sql)).alertWebhookUrl || undefined;
    const r = await runKeeper(deps);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
    keeperRunAlerts(alert, launchStreaks, r);
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), fatal: String(e) }));
    if (e instanceof ReconcileError) {
      await alert("keeper-reconcile", `stopped, nothing is sent until the ledger and wallets agree. ${e.message}`);
      process.exit(1);
    }
    void alert("keeper-fatal", `run failed: ${String(e)}`);
  }
  const { keeperIntervalSeconds } = await loadLatestSettings(sql).catch(() => ({ keeperIntervalSeconds: 60 }));
  await Bun.sleep(Math.max(0, keeperIntervalSeconds * 1000 - (Date.now() - started)));
}
