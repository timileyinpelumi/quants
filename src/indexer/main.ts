import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { db } from "../db/client";
import { RpcHistory } from "./history";
import { JupiterPrices } from "./prices";
import { indexOnce } from "./run";
import { makeAlerter, sqlThrottle, Streaks, indexerPassAlerts } from "../ops/alerts";

const e = process.env;
if (!e.DATABASE_URL || !e.RPC_URL) throw new Error("DATABASE_URL and RPC_URL are required");
const sql = db(e.DATABASE_URL);
// No built-in 429 retry and a hard timeout: a slow or throttled address fails this pass and is retried on the next.
const conn = new Connection(e.RPC_URL, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })) as typeof fetch,
});
const prices = new JupiterPrices(e.JUPITER_PRICE_URL ?? "https://api.jup.ag/price/v3", e.JUPITER_API_KEY);
const decimals = new Map<string, number>();
const intervalMs = Number(e.INDEXER_INTERVAL_SECONDS ?? 5) * 1000;

// Session-level advisory lock on a reserved connection: a second indexer exits instead of double reading.
const lockConn = await sql.reserve();
const [{ ok }] = await lockConn`select pg_try_advisory_lock(hashtext('quants-indexer')) as ok`;
if (!ok) {
  console.error(JSON.stringify({ at: new Date().toISOString(), fatal: "another indexer holds the lock" }));
  process.exit(1);
}

const deps = {
  sql,
  history: new RpcHistory(conn),
  quoteUsd: (mint: string) => prices.usd(mint),
  decimals: async (mint: string) => {
    if (!decimals.has(mint)) decimals.set(mint, (await getMint(conn, new PublicKey(mint))).decimals);
    return decimals.get(mint)!;
  },
};

const alert = makeAlerter({ url: e.ALERT_WEBHOOK_URL || undefined, source: "indexer", store: sqlThrottle(sql) });
const addressStreaks = new Streaks(5);

while (true) {
  const started = Date.now();
  try {
    const { checked, ...r } = await indexOnce(deps);
    if (r.trades || r.skipped || r.errors.length) console.log(JSON.stringify({ at: new Date().toISOString(), ...r }));
    indexerPassAlerts(alert, addressStreaks, { ...r, checked });
  } catch (err) {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: String(err) }));
    void alert("indexer-pass", `pass failed: ${String(err)}`);
  }
  await Bun.sleep(Math.max(0, intervalMs - (Date.now() - started)));
}
