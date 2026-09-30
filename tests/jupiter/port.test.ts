import { test, expect } from "bun:test";
import { JupiterLive } from "../../src/jupiter/port";

test("quote returns null when Jupiter has no route", async () => {
  const j = new JupiterLive("https://jup.test", {} as any, async () => new Response(JSON.stringify({ error: "No routes found" }), { status: 400 }));
  expect(await j.quote("a", "b", 100n, 100)).toBeNull();
});

test("quote parses amounts and price impact", async () => {
  const body = { inAmount: "100", outAmount: "250", priceImpactPct: "0.0123" };
  const j = new JupiterLive("https://jup.test", {} as any, async (url) => {
    expect(String(url)).toContain("slippageBps=100");
    return new Response(JSON.stringify(body));
  });
  expect(await j.quote("a", "b", 100n, 100)).toMatchObject({ inAmount: 100n, outAmount: 250n, priceImpactBps: 123 });
});

test("isVerified reads the verified tag", async () => {
  const j = new JupiterLive("https://jup.test", {} as any, async () => new Response(JSON.stringify([{ id: "m", tags: ["verified"] }])));
  expect(await j.isVerified("m")).toBe(true);
});

test("sends the api key header when one is set", async () => {
  let seen = null as string | null;
  const j = new JupiterLive("https://api.jup.ag/swap/v1", {} as any, async (_url, init) => {
    seen = new Headers(init?.headers).get("x-api-key");
    return new Response(JSON.stringify({ inAmount: "1", outAmount: "2", priceImpactPct: "0" }));
  }, "k123");
  await j.quote("a", "b", 1n, 100);
  expect(seen).toBe("k123");
});

test("searchVerified keeps verified classic SPL tokens only", async () => {
  let url = "";
  const j = new JupiterLive("https://api.jup.ag/swap/v1", {} as any, async (u) => { url = String(u); return new Response(JSON.stringify([
    { id: "A", symbol: "AAA", name: "A", icon: "https://i/a.png", decimals: 6, isVerified: true, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { id: "B", symbol: "BBB", name: "B", icon: null, decimals: 6, isVerified: false, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { id: "C", symbol: "CCC", name: "C", icon: null, decimals: 6, isVerified: true, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
  ])); });
  expect((await j.searchVerified("a")).map((t) => t.mint)).toEqual(["A"]);
  expect(url).toBe("https://api.jup.ag/tokens/v2/search?query=a");
});
