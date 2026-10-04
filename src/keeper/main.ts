import { sweepPreparedLaunches } from "./steps/sweep";
import { quickGraduate } from "./steps/graduate";
import { RpcPool, providerOrder } from "../chain/rpc-pool";
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
import { pruneAnalytics, recordKeeperRun } from "../ops/keeper-runs";

const env = loadEnv();
const sql = db(env.DATABASE_URL);
const keeper = loadKeypair(env.KEEPER_KEYPAIR);
const spill = loadKeypair(env.SPILL_KEYPAIR);
// KEEPER_RPC_URL gives the keeper its own provider so its sends do not share a rate limit with the web app.
const rpcUrl = process.env.KEEPER_RPC_URL || env.RPC_URL;
const pool = new RpcPool(providerOrder(rpcUrl, env.RPC_URL, process.env.INDEXER_RPC_URL));
const chain = new SolanaChain(new Connection(rpcUrl, { commitment: "confirmed", fetch: pool.fetch }), keeper, spill);
const deps = {
  sql, chain,
  meteora: new MeteoraLive(chain, env.DAMM_V2_MIGRATION_CONFIG),
  jupiter: swapPortFor(process.env, chain),
  staking: new KaminoBackend(chain, rpcUrl, env.KAMINO_GLOBAL_CONFIG ?? "", [process.env.INDEXER_RPC_URL ?? "", env.RPC_URL]),
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: env.TREASURY_ADDRESS },
};

// The webhook is an admin setting (seeded from ALERT_WEBHOOK_URL); each run refreshes it.
let webhook: string | undefined = env.ALERT_WEBHOOK_URL;
const alert = makeAlerter({ url: () => webhook, source: "keeper", store: sqlThrottle(sql) });
const launchStreaks = new Streaks(3);

// Launches that landed but were not recorded by the web app show up within ~15s instead of waiting for the next run.
// Reads chain and database only, so it needs no SOL. Bounded: one sweep of at most 50 rows every 15s.
void (async () => {
  while (true) {
    await sweepPreparedLaunches(deps, { minAgeSeconds: 20 }).catch((e) => console.error("quick sweep failed", e));
    await quickGraduate(deps).catch((e) => console.error("quick graduate failed", e));
    await Bun.sleep(15_000);
  }
})();

// A ReconcileError exits so a supervisor restart loop is visible and no funds move while the ledger is wrong.
while (true) {
  const started = Date.now();
  try {
    webhook = (await loadLatestSettings(sql)).alertWebhookUrl || undefined;
    const r = await runKeeper(deps);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
    await recordKeeperRun(sql, { startedAt: new Date(started), launches: r.launches, errors: r.errors }).catch((e) => console.error("recording the run failed", e));
    keeperRunAlerts(alert, launchStreaks, r);
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), fatal: String(e) }));
    await recordKeeperRun(sql, { startedAt: new Date(started), fatal: String(e) }).catch(() => {});
    if (e instanceof ReconcileError) {
      await alert("keeper-reconcile", `stopped, nothing is sent until the ledger and wallets agree. ${e.message}`);
      process.exit(1);
    }
    void alert("keeper-fatal", `run failed: ${String(e)}`);
  }
  await pruneAnalytics(sql).catch((e) => console.error("pruning analytics failed", e));
  const { keeperIntervalSeconds } = await loadLatestSettings(sql).catch(() => ({ keeperIntervalSeconds: 60 }));
  await Bun.sleep(Math.max(0, keeperIntervalSeconds * 1000 - (Date.now() - started)));
}
