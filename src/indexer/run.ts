import type { SQL } from "bun";

export interface PoolSwap {
  eventIndex: number;
  venue: "curve" | "damm";
  side: "buy" | "sell";
  baseAmount: bigint;
  quoteAmount: bigint;
  feeAmount: bigint;
  sqrtPrice: bigint;
  /** Curve only: quote reserve after the swap and the reserve at which the pool graduates. */
  curve?: { reserve: bigint; threshold: bigint };
}
export interface IndexedTx { signature: string; failed: boolean; blockTime: number; slot: number; trader: string; swaps: PoolSwap[] }
export interface MissingTx { signature: string; missing: true }
export interface SignatureInfo { signature: string; blockTime: number | null }

export interface ChainHistory {
  /** Signatures after `until` (all of them when null), oldest first. */
  signaturesSince(address: string, until: string | null): Promise<SignatureInfo[]>;
  /** The given transactions in the same order, with only the swaps that hit `address`. */
  transactions(signatures: string[], address: string): Promise<(IndexedTx | MissingTx)[]>;
}

export interface IndexerDeps {
  sql: SQL;
  history: ChainHistory;
  decimals(mint: string): Promise<number>;
  quoteUsd(mint: string): Promise<number | null>;
  now?: () => number;
}

const MAX_ADDRESSES_PER_PASS = 100;
const MAX_TX_PER_PASS = 500;
const CHUNK = 100;
// RPC nodes can list a signature before they serve the transaction, and pruned nodes never serve old ones
const MISSING_GRACE_MS = 10 * 60_000;
const BASE_DECIMALS = 6; // every quants launch is minted with 6 decimals

export const spotPrice = (sqrtPrice: bigint, baseDecimals: number, quoteDecimals: number) => {
  const s = Number(sqrtPrice) / 2 ** 64;
  return s * s * 10 ** (baseDecimals - quoteDecimals);
};

// RETRY-LOOP-SAFETY: bounded by design, do not add an RPC retry handler here.
//   concurrency: main.ts holds a Postgres advisory lock, so one indexer runs at a time.
//   attempts:    a failing address is skipped for this pass and tried again next pass; nothing is marked done until written.
//                A transaction the RPC will not return is waited on for MISSING_GRACE_MS, then skipped and counted.
//   fan-out:     at most MAX_ADDRESSES_PER_PASS addresses (least recently checked first) and MAX_TX_PER_PASS transactions each;
//                the cursor carries the rest. A graduated token's curve pool is dropped once it has no new signatures.
//   backoff:     the RPC connection has its own 429 retry turned off and a request timeout; the next pass is the retry.
export async function indexOnce(d: IndexerDeps): Promise<{ trades: number; skipped: number; checked: string[]; errors: { address: string; error: string }[] }> {
  const now = d.now?.() ?? Date.now();
  const launches = await d.sql`select id, pool, damm_pool, quote_mint, status from launches`;
  const cursors = new Map<string, { last: string | null; checked: number; finished: boolean }>(
    (await d.sql`select address, last_signature, checked_at, finished from index_cursors`).map((r: any) =>
      [r.address, { last: r.last_signature, checked: new Date(r.checked_at).getTime(), finished: r.finished }]),
  );
  const targets = launches
    .flatMap((l: any) => [{ l, address: l.pool as string, curve: true }, ...(l.damm_pool ? [{ l, address: l.damm_pool as string, curve: false }] : [])])
    .filter((t: any) => !cursors.get(t.address)?.finished)
    .sort((a: any, b: any) => (cursors.get(a.address)?.checked ?? 0) - (cursors.get(b.address)?.checked ?? 0))
    .slice(0, MAX_ADDRESSES_PER_PASS);

  let trades = 0;
  let skipped = 0;
  const errors: { address: string; error: string }[] = [];
  for (const { l, address, curve } of targets) {
    try {
      const sigs = (await d.history.signaturesSince(address, cursors.get(address)?.last ?? null)).slice(0, MAX_TX_PER_PASS);
      const finished = curve && l.status === "graduated" && sigs.length === 0;
      await d.sql`insert into index_cursors (address, checked_at, finished) values (${address}, now(), ${finished})
        on conflict (address) do update set checked_at = now(), finished = excluded.finished`;
      if (sigs.length === 0) continue;
      const [quoteDecimals, quoteUsd] = await Promise.all([d.decimals(l.quote_mint), d.quoteUsd(l.quote_mint)]);
      const times = new Map(sigs.map((x) => [x.signature, x.blockTime]));
      chunks: for (let i = 0; i < sigs.length; i += CHUNK) {
        const got = await d.history.transactions(sigs.slice(i, i + CHUNK).map((x) => x.signature), address);
        const ready: IndexedTx[] = [];
        let waitOn: string | null = null;
        for (const t of got) {
          if (!("missing" in t)) { ready.push(t); continue; }
          const at = times.get(t.signature);
          if (at && now - at * 1000 > MISSING_GRACE_MS) { skipped++; continue; }
          waitOn = t.signature;
          break;
        }
        const rows = ready
          .filter((t) => !t.failed)
          .flatMap((t) => t.swaps.map((s) => ({
            signature: t.signature, event_index: s.eventIndex, launch_id: l.id, venue: s.venue, side: s.side, trader: t.trader,
            base_amount: s.baseAmount.toString(), quote_amount: s.quoteAmount.toString(), fee_amount: s.feeAmount.toString(),
            quote_value: Number(s.quoteAmount) / 10 ** quoteDecimals,
            price: spotPrice(s.sqrtPrice, BASE_DECIMALS, quoteDecimals), quote_usd: quoteUsd,
            curve_reserve: s.curve?.reserve.toString() ?? null, curve_threshold: s.curve?.threshold.toString() ?? null,
            block_time: new Date(t.blockTime * 1000), slot: t.slot,
          })));
        if (rows.length) {
          const written = await d.sql`insert into trades ${d.sql(rows)} on conflict (signature, event_index) do nothing returning 1`;
          trades += written.length;
        }
        const done = waitOn ? got.slice(0, got.findIndex((t) => t.signature === waitOn)) : got;
        if (done.length) await d.sql`update index_cursors set last_signature = ${done.at(-1)!.signature} where address = ${address}`;
        if (waitOn) { errors.push({ address, error: `transaction ${waitOn} not available yet` }); break chunks; }
      }
    } catch (e) {
      errors.push({ address, error: String(e) });
    }
  }
  return { trades, skipped, checked: targets.map((t: any) => t.address as string), errors };
}
