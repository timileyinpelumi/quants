import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { db } from "../src/db/client";
import { RpcHistory } from "../src/indexer/history";
import { JupiterPrices } from "../src/indexer/prices";
import { indexOnce } from "../src/indexer/run";

const e = process.env;
// No built-in 429 retry and a hard timeout: a slow or throttled address fails this pass and is retried on the next.
const conn = new Connection(e.RPC_URL!, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetch: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })) as typeof fetch,
});
const prices = new JupiterPrices(e.JUPITER_PRICE_URL ?? "https://api.jup.ag/price/v3", e.JUPITER_API_KEY);
const r = await indexOnce({
  sql: db(e.DATABASE_URL),
  history: new RpcHistory(conn),
  quoteUsd: (m) => prices.usd(m),
  decimals: async (m) => (await getMint(conn, new PublicKey(m))).decimals,
});
console.log(JSON.stringify(r));
process.exit(0);
