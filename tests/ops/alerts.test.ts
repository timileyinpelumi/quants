import { test, expect } from "bun:test";
import { makeAlerter, memoryThrottle, sqlThrottle, Streaks, keeperRunAlerts, indexerPassAlerts } from "../../src/ops/alerts";
import { freshDb } from "../helpers/db";

function fakeFetch(respond: () => Promise<Response> = async () => new Response("ok")) {
  const calls: { url: string; body: any; signal: AbortSignal | null | undefined }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), signal: init.signal });
    return respond();
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("posts the text as JSON to the webhook", async () => {
  const { f, calls } = fakeFetch();
  const alert = makeAlerter({ url: "https://hook", source: "keeper", fetch: f });
  await alert("k", "ledger exceeds wallet");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://hook");
  expect(calls[0]!.body).toEqual({ text: "quants keeper: ledger exceeds wallet" });
  expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
});

test("does nothing without a webhook url", async () => {
  const { f, calls } = fakeFetch();
  await makeAlerter({ url: undefined, source: "keeper", fetch: f })("k", "x");
  expect(calls).toHaveLength(0);
});

test("sends the same key at most once per window", async () => {
  let t = 0;
  const { f, calls } = fakeFetch();
  const alert = makeAlerter({ url: "https://hook", source: "indexer", fetch: f, store: memoryThrottle(() => t) });
  await alert("a", "one");
  await alert("a", "two");
  await alert("b", "three");
  t = 59 * 60_000;
  await alert("a", "four");
  t = 60 * 60_000;
  await alert("a", "five");
  expect(calls.map((c) => c.body.text)).toEqual(["quants indexer: one", "quants indexer: three", "quants indexer: five"]);
});

test("never throws when the webhook fails, hangs or the store fails", async () => {
  const errors: unknown[] = [];
  const log = (e: unknown) => errors.push(e);
  const failing = fakeFetch(async () => { throw new Error("down"); });
  await makeAlerter({ url: "https://hook", source: "k", fetch: failing.f, log })("a", "x");

  const bad = fakeFetch(async () => new Response("no", { status: 500 }));
  await makeAlerter({ url: "https://hook", source: "k", fetch: bad.f, log })("a", "x");

  const hanging = (async (_: string, init: RequestInit) => new Promise((_r, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
  })) as unknown as typeof fetch;
  const started = Date.now();
  await makeAlerter({ url: "https://hook", source: "k", fetch: hanging, timeoutMs: 50, log })("a", "x");
  expect(Date.now() - started).toBeLessThan(2000);

  const ok = fakeFetch();
  const brokenStore = { claim: async () => { throw new Error("db down"); } };
  await makeAlerter({ url: "https://hook", source: "k", fetch: ok.f, store: brokenStore, log })("a", "x");
  expect(ok.calls).toHaveLength(1);
  expect(errors.length).toBe(4);
});

test("long text is cut to fit chat limits", async () => {
  const { f, calls } = fakeFetch();
  await makeAlerter({ url: "https://hook", source: "k", fetch: f })("a", "x".repeat(5000));
  expect(calls[0]!.body.text.length).toBeLessThanOrEqual(1900);
});

test("the Postgres throttle survives a restart", async () => {
  const sql = await freshDb();
  const store = sqlThrottle(sql);
  expect(await store.claim("reconcile", 3_600_000)).toBe(true);
  expect(await sqlThrottle(sql).claim("reconcile", 3_600_000)).toBe(false);
  expect(await store.claim("other", 3_600_000)).toBe(true);
  await sql`update alerts_sent set sent_at = now() - interval '2 hours' where key = 'reconcile'`;
  expect(await store.claim("reconcile", 3_600_000)).toBe(true);
});

test("streaks report a key once it fails the threshold number of times in a row", () => {
  const s = new Streaks(3);
  expect(s.update(["1", "2"])).toEqual([]);
  expect(s.update(["1", "2"])).toEqual([]);
  expect(s.update(["1"])).toEqual(["1"]);
  expect(s.update(["1", "2"])).toEqual(["1"]);
  expect(s.count("2")).toBe(1);
});

test("streaks only reset keys that were attempted when the attempted set is given", () => {
  const s = new Streaks(2);
  s.update(["a", "b"], ["a", "b"]);
  expect(s.update(["a"], ["a"])).toEqual(["a"]);
  expect(s.update(["b"], ["b"])).toEqual(["b"]);
  expect(s.update([], ["a"])).toEqual([]);
  expect(s.count("a")).toBe(0);
  expect(s.count("b")).toBe(2);
});

function recorder() {
  const sent: [string, string][] = [];
  const alert = async (key: string, text: string) => { sent.push([key, text]); };
  return { sent, alert };
}

test("keeper alerts when the same launch fails three runs in a row", () => {
  const { sent, alert } = recorder();
  const s = new Streaks(3);
  const run = (errors: { launchId: number; error: string }[]) => keeperRunAlerts(alert, s, { errors });
  run([{ launchId: 7, error: "rpc timeout" }]);
  run([{ launchId: 7, error: "rpc timeout" }]);
  expect(sent).toEqual([]);
  run([{ launchId: 7, error: "Error: rpc timeout" }]);
  expect(sent).toEqual([["keeper-launch-7", "launch 7 failed 3 runs in a row: Error: rpc timeout"]]);
});

test("indexer alerts on an address failing five passes in a row and on skipped transactions", () => {
  const { sent, alert } = recorder();
  const s = new Streaks(5);
  for (let i = 0; i < 4; i++) indexerPassAlerts(alert, s, { skipped: 0, checked: ["P1"], errors: [{ address: "P1", error: "rpc 429" }] });
  expect(sent).toEqual([]);
  indexerPassAlerts(alert, s, { skipped: 2, checked: ["P1"], errors: [{ address: "P1", error: "rpc 429" }] });
  expect(sent).toEqual([
    ["indexer-address-P1", "P1 failed 5 passes in a row: rpc 429"],
    ["indexer-skipped", "skipped 2 transactions the RPC would not return"],
  ]);
});
