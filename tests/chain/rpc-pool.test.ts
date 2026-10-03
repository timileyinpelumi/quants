import { test, expect } from "bun:test";
import { RpcPool } from "../../src/chain/rpc-pool";

const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 1 }));
const limited = () => new Response("Too Many Requests", { status: 429 });
const limitedJson = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "Too Many Requests" } }));

function pool(behaviour: Record<string, () => Response>, now: { t: number }) {
  const hits: string[] = [];
  const p = new RpcPool(["https://a", "https://b", "https://c"], {
    fetch: (async (url: string) => { const h = new URL(url).host; hits.push(h); return behaviour[h]!(); }) as any,
    now: () => now.t,
  });
  return { p, hits };
}

test("the primary serves everything while it is healthy", async () => {
  const now = { t: 0 };
  const { p, hits } = pool({ a: ok, b: ok, c: ok }, now);
  for (let i = 0; i < 3; i++) await p.fetch("https://a", { method: "POST", body: "{}" });
  expect(hits).toEqual(["a", "a", "a"]);
});

test("a rate limited request is answered by the next provider", async () => {
  const now = { t: 0 };
  const { p, hits } = pool({ a: limited, b: ok, c: ok }, now);
  const r = await p.fetch("https://a", { method: "POST", body: "{}" });
  expect(r.status).toBe(200);
  expect(hits).toEqual(["a", "b"]);
});

test("after three limits in a row the primary cools down, then comes back", async () => {
  const now = { t: 0 };
  const b = { a: limitedJson, b: ok, c: ok };
  const { p, hits } = pool(b, now);
  for (let i = 0; i < 3; i++) await p.fetch("https://a", { method: "POST", body: "{}" });
  hits.length = 0;
  await p.fetch("https://a", { method: "POST", body: "{}" });
  expect(hits).toEqual(["b"]);
  b.a = ok;
  now.t += 31_000;
  hits.length = 0;
  await p.fetch("https://a", { method: "POST", body: "{}" });
  expect(hits).toEqual(["a"]);
});

test("cool downs double for a provider that keeps failing, up to ten minutes", async () => {
  const now = { t: 0 };
  const { p } = pool({ a: limited, b: ok, c: ok }, now);
  const waits: number[] = [];
  for (let round = 0; round < 7; round++) {
    for (let i = 0; i < 3; i++) await p.fetch("https://a", { method: "POST", body: "{}" });
    const until = p.coolingUntil("https://a");
    waits.push(until - now.t);
    now.t = until + 1;
  }
  expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
});

test("when every provider is cooling the one that recovers first is used", async () => {
  const now = { t: 0 };
  const { p, hits } = pool({ a: limited, b: limited, c: limited }, now);
  for (let i = 0; i < 3; i++) await p.fetch("https://a", { method: "POST", body: "{}" });
  hits.length = 0;
  const r = await p.fetch("https://a", { method: "POST", body: "{}" });
  expect(r.status).toBe(429);
  expect(hits.length).toBe(1);
});
