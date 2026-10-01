import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { indexOnce, type ChainHistory, type IndexedTx, type PoolSwap } from "../../src/indexer/run";

const Q64 = 1n << 64n;
// 1e3 raw quote units per raw base unit: 1 SOL per whole token at 6 and 9 decimals
const SQRT = BigInt(Math.round(Math.sqrt(1e3) * Number(Q64)));

const swap = (over: Partial<PoolSwap> = {}): PoolSwap => ({
  eventIndex: 0, venue: "curve", side: "buy", baseAmount: 1_000_000n, quoteAmount: 1_000_000_000n, feeAmount: 10_000_000n, sqrtPrice: SQRT, curve: { reserve: 2_000_000_000n, threshold: 5_000_000_000n }, ...over,
});

class FakeHistory implements ChainHistory {
  txs = new Map<string, IndexedTx[]>(); // address -> oldest first
  sinceCalls: [string, string | null][] = [];
  failFor = new Set<string>();
  add(address: string, tx: Partial<IndexedTx> & { signature: string }) {
    const list = this.txs.get(address) ?? [];
    list.push({ failed: false, blockTime: 1_790_000_000 + list.length, slot: 1000 + list.length, trader: "trader1", swaps: [swap()], ...tx });
    this.txs.set(address, list);
  }
  missing = new Set<string>();
  async signaturesSince(address: string, until: string | null) {
    this.sinceCalls.push([address, until]);
    if (this.failFor.has(address)) throw new Error("rpc 429");
    const list = (this.txs.get(address) ?? []).map((t) => ({ signature: t.signature, blockTime: t.blockTime }));
    return until ? list.slice(list.findIndex((x) => x.signature === until) + 1) : list;
  }
  async transactions(sigs: string[], address: string) {
    return (this.txs.get(address) ?? []).filter((t) => sigs.includes(t.signature))
      .map((t) => (this.missing.has(t.signature) ? { signature: t.signature, missing: true as const } : t));
  }
}

const deps = (sql: Awaited<ReturnType<typeof freshDb>>, history: ChainHistory, now = 1_790_000_000_000) => ({
  sql, history, now: () => now, decimals: async (m: string) => (m.startsWith("So1") ? 9 : 6), quoteUsd: async () => 150,
});

test("records swaps from each pool once, skips failed transactions and moves the cursor", async () => {
  const sql = await freshDb();
  const id = await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  h.add("P1", { signature: "s1" });
  h.add("P1", { signature: "s2", failed: true });
  h.add("P1", { signature: "s3", trader: "trader2", swaps: [swap({ side: "sell", eventIndex: 2 })] });

  expect((await indexOnce(deps(sql, h))).trades).toBe(2);
  const rows = await sql`select signature, event_index, launch_id, venue, side, trader, base_amount::text, quote_amount::text, price, quote_usd, quote_value, curve_reserve::text, curve_threshold::text from trades order by signature`;
  expect(rows.map((r: any) => [r.signature, r.event_index, Number(r.launch_id), r.side, r.trader])).toEqual([["s1", 0, id, "buy", "trader1"], ["s3", 2, id, "sell", "trader2"]]);
  expect(rows[0].base_amount).toBe("1000000");
  expect(rows[0].price).toBeCloseTo(1, 6);
  expect(rows[0].quote_usd).toBe(150);
  expect(rows[0].quote_value).toBe(1);
  expect(Number((await sql`select slot from trades where signature = 's3'`)[0].slot)).toBe(1002);
  expect([rows[0].curve_reserve, rows[0].curve_threshold]).toEqual(["2000000000", "5000000000"]);
  expect((await sql`select last_signature from index_cursors where address = 'P1'`)[0].last_signature).toBe("s3");

  h.add("P1", { signature: "s4" });
  expect((await indexOnce(deps(sql, h))).trades).toBe(1);
  expect(h.sinceCalls.at(-1)).toEqual(["P1", "s3"]);
  expect((await sql`select count(*)::int as n from trades`)[0].n).toBe(3);
});

test("a re-read after a crash does not double count", async () => {
  const sql = await freshDb();
  await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  h.add("P1", { signature: "s1" });
  await indexOnce(deps(sql, h));
  await sql`delete from index_cursors`;
  await indexOnce(deps(sql, h));
  expect((await sql`select count(*)::int as n from trades`)[0].n).toBe(1);
});

test("indexes the graduated pool as well and keeps going when one address fails", async () => {
  const sql = await freshDb();
  const id = await insertLaunch(sql, { pool: "P1", status: "graduated" });
  await sql`update launches set damm_pool = 'D1' where id = ${id}`;
  await insertLaunch(sql, { pool: "P2" });
  const h = new FakeHistory();
  h.add("P1", { signature: "s1" });
  h.add("D1", { signature: "d1", swaps: [swap({ venue: "damm", curve: undefined })] });
  h.add("P2", { signature: "x1" });
  h.failFor.add("P1");

  const r = await indexOnce(deps(sql, h));
  expect(r.trades).toBe(2);
  expect(r.errors).toEqual([{ address: "P1", error: "Error: rpc 429" }]);
  expect(r.checked.sort()).toEqual(["D1", "P1", "P2"]);
  const d =(await sql`select venue, curve_reserve from trades where signature = 'd1'`)[0];
  expect([d.venue, d.curve_reserve]).toEqual(["damm", null]);
});

test("works through a long backlog a bounded batch per pass", async () => {
  const sql = await freshDb();
  await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  for (let i = 0; i < 1200; i++) h.add("P1", { signature: `s${i}` });
  expect((await indexOnce(deps(sql, h))).trades).toBe(500);
  expect((await indexOnce(deps(sql, h))).trades).toBe(500);
  expect((await indexOnce(deps(sql, h))).trades).toBe(200);
  expect((await sql`select last_signature from index_cursors`)[0].last_signature).toBe("s1199");
});

test("stores no USD value when the quote price is unknown", async () => {
  const sql = await freshDb();
  await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  h.add("P1", { signature: "s1" });
  await indexOnce({ ...deps(sql, h), quoteUsd: async () => null });
  expect((await sql`select quote_usd from trades`)[0].quote_usd).toBeNull();
});

test("stops reading a graduated token's curve pool once it goes quiet", async () => {
  const sql = await freshDb();
  const id = await insertLaunch(sql, { pool: "P1", status: "graduated" });
  await sql`update launches set damm_pool = 'D1' where id = ${id}`;
  const h = new FakeHistory();
  h.add("P1", { signature: "s1" });
  await indexOnce(deps(sql, h));
  await indexOnce(deps(sql, h));
  const before = h.sinceCalls.filter(([a]) => a === "P1").length;
  await indexOnce(deps(sql, h));
  expect(h.sinceCalls.filter(([a]) => a === "P1").length).toBe(before);
  expect(h.sinceCalls.filter(([a]) => a === "D1").length).toBe(3);
});

test("a live token's curve pool keeps being read when quiet", async () => {
  const sql = await freshDb();
  await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  for (let i = 0; i < 3; i++) await indexOnce(deps(sql, h));
  expect(h.sinceCalls.filter(([a]) => a === "P1").length).toBe(3);
});

test("reads at most 100 addresses a pass, least recently checked first", async () => {
  const sql = await freshDb();
  for (let i = 0; i < 120; i++) await insertLaunch(sql, { pool: `P${i}` });
  const h = new FakeHistory();
  await indexOnce(deps(sql, h));
  expect(h.sinceCalls).toHaveLength(100);
  const first = new Set(h.sinceCalls.map(([a]) => a));
  h.sinceCalls = [];
  await indexOnce(deps(sql, h));
  expect(h.sinceCalls).toHaveLength(100);
  const missed = h.sinceCalls.slice(0, 20).map(([a]) => a);
  expect(missed.every((a) => !first.has(a))).toBe(true);
});

test("a transaction the RPC cannot return yet holds the cursor just before it", async () => {
  const sql = await freshDb();
  await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  h.add("P1", { signature: "s1", blockTime: 1_790_000_000 });
  h.add("P1", { signature: "s2", blockTime: 1_790_000_100 });
  h.add("P1", { signature: "s3", blockTime: 1_790_000_101 });
  h.missing.add("s2");
  const r = await indexOnce(deps(sql, h, 1_790_000_200_000));
  expect(r.trades).toBe(1);
  expect(r.errors[0]!.error).toContain("s2");
  expect((await sql`select last_signature from index_cursors`)[0].last_signature).toBe("s1");
  h.missing.clear();
  expect((await indexOnce(deps(sql, h, 1_790_000_200_000))).trades).toBe(2);
});

test("a transaction missing for more than ten minutes is skipped and counted", async () => {
  const sql = await freshDb();
  await insertLaunch(sql, { pool: "P1" });
  const h = new FakeHistory();
  h.add("P1", { signature: "s1", blockTime: 1_790_000_000 });
  h.add("P1", { signature: "s2", blockTime: 1_790_000_001 });
  h.missing.add("s1");
  const r = await indexOnce(deps(sql, h, 1_790_000_000_000 + 11 * 60_000));
  expect(r).toMatchObject({ trades: 1, skipped: 1, errors: [] });
  expect((await sql`select last_signature from index_cursors`)[0].last_signature).toBe("s2");
});
