import { test, expect } from "bun:test";
import { JupiterPrices } from "../../src/indexer/prices";

test("reads the USD price from Jupiter with the key and caches it", async () => {
  const calls: [string, Record<string, string>][] = [];
  const f = async (url: string | URL, init?: RequestInit) => {
    calls.push([String(url), init?.headers as Record<string, string>]);
    return Response.json({ So11111111111111111111111111111111111111112: { usdPrice: 151.5 } });
  };
  const p = new JupiterPrices("https://api.jup.ag/price/v3", "k1", f);
  expect(await p.usd("So11111111111111111111111111111111111111112")).toBe(151.5);
  expect(await p.usd("So11111111111111111111111111111111111111112")).toBe(151.5);
  expect(calls).toHaveLength(1);
  expect(calls[0]![0]).toBe("https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112");
  expect(calls[0]![1]["x-api-key"]).toBe("k1");
});

test("returns null when Jupiter has no price or fails", async () => {
  expect(await new JupiterPrices("https://x", undefined, async () => Response.json({})).usd("m")).toBeNull();
  expect(await new JupiterPrices("https://x", undefined, async () => new Response("no", { status: 401 })).usd("m")).toBeNull();
  expect(await new JupiterPrices("https://x", undefined, async () => { throw new Error("down"); }).usd("m")).toBeNull();
});

test("prices many mints in one request and serves repeats from the cache", async () => {
  const urls: string[] = [];
  const p = new JupiterPrices("https://api.jup.ag/price/v3", undefined, async (u) => {
    urls.push(String(u));
    return Response.json({ A: { usdPrice: 1 }, B: { usdPrice: 2 } });
  });
  expect(await p.usdMany(["A", "B", "C"])).toEqual({ A: 1, B: 2, C: null });
  expect(await p.usdMany(["A", "C"])).toEqual({ A: 1, C: null });
  expect(urls).toEqual(["https://api.jup.ag/price/v3?ids=A,B,C"]);
  expect(await p.usd("B")).toBe(2);
});

test("encodes each id in the request URL", async () => {
  const urls: string[] = [];
  const p = new JupiterPrices("https://p", undefined, async (u) => { urls.push(String(u)); return Response.json({}); });
  await p.usdMany(["A&x=1", "B"]);
  expect(urls).toEqual(["https://p?ids=A%26x%3D1,B"]);
});

test("the cache holds at most maxEntries mints", async () => {
  let n = 0;
  const p = new JupiterPrices("https://p", undefined, async () => { n++; return Response.json({}); }, 60_000, 2);
  await p.usdMany(["A"]); await p.usdMany(["B"]); await p.usdMany(["C"]);
  expect(n).toBe(3);
  await p.usdMany(["A"]);
  expect(n).toBe(4);
  await p.usdMany(["C"]);
  expect(n).toBe(4);
});

test("a failed price lookup keeps the last good price and is asked again next time", async () => {
  const { JupiterPrices } = await import("../../src/indexer/prices");
  let mode: "ok" | "limited" = "ok";
  let calls = 0;
  const p = new JupiterPrices("https://p.test", undefined, async () => { calls++; return mode === "ok" ? Response.json({ M: { usdPrice: 2 } }) : new Response("slow", { status: 429 }); }, -1);
  expect(await p.usd("M")).toBe(2);
  mode = "limited";
  expect(await p.usd("M")).toBe(2);
  mode = "ok";
  expect(await p.usd("M")).toBe(2);
  expect(calls).toBe(3);
  const fresh = new JupiterPrices("https://p.test", undefined, async () => new Response("slow", { status: 429 }), 60_000);
  expect(await fresh.usd("X")).toBeNull();
  let again = 0;
  const retry = new JupiterPrices("https://p.test", undefined, async () => { again++; return new Response("slow", { status: 429 }); }, 60_000);
  await retry.usd("X"); await retry.usd("X");
  expect(again).toBe(2);
});
