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
