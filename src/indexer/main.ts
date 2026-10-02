import { Connection } from "@solana/web3.js";
import { fetchMint } from "../chain/mints";
import { db } from "../db/client";
import { RpcHistory } from "./history";
import { JupiterPrices } from "./prices";
import { applyClusterDefaults } from "../cluster";
import { pricesFor } from "../jupiter/select";
import { indexOnce } from "./run";
import { cachedSettings } from "../domain/settings";
import { makeAlerter, sqlThrottle, Streaks, indexerPassAlerts } from "../ops/alerts";

const e = applyClusterDefaults(process.env);
if (!e.DATABASE_URL || !e.RPC_URL) throw new Error("DATABASE_URL and RPC_URL are required");
const sql = db(e.DATABASE_URL);
// No built-in 429 retry and a hard timeout: a slow or throttled address fails this pass and is retried on the next.
const conn = new Connection(e.RPC_URL, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })) as typeof fetch,
});
const prices = pricesFor(e, conn, new JupiterPrices(e.JUPITER_PRICE_URL ?? "https://api.jup.ag/price/v3", e.JUPITER_API_KEY));
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
    if (!decimals.has(mint)) decimals.set(mint, (await fetchMint(conn, mint)).decimals);
    return decimals.get(mint)!;
  },
};

// The webhook is an admin setting (seeded from ALERT_WEBHOOK_URL); each pass refreshes it.
let webhook: string | undefined = e.ALERT_WEBHOOK_URL || undefined;
const alert = makeAlerter({ url: () => webhook, source: "indexer", store: sqlThrottle(sql) });
const addressStreaks = new Streaks(5);
// The first pass always logs, so a deploy can see the indexer reach the RPC and the database.
let first = true;

while (true) {
  const started = Date.now();
  webhook = (await cachedSettings(sql, 30_000).catch(() => null))?.alertWebhookUrl || webhook;
  try {
    const { checked, ...r } = await indexOnce(deps);
    if (first || r.trades || r.skipped || r.errors.length) console.log(JSON.stringify({ at: new Date().toISOString(), checked: checked.length, ...r }));
    first = false;
    indexerPassAlerts(alert, addressStreaks, { ...r, checked });
  } catch (err) {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: String(err) }));
    void alert("indexer-pass", `pass failed: ${String(err)}`);
  }
  await Bun.sleep(Math.max(0, intervalMs - (Date.now() - started)));
}
