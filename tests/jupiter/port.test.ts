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

test("searchVerified keeps verified classic and Token-2022 tokens", async () => {
  let url = "";
  const j = new JupiterLive("https://api.jup.ag/swap/v1", {} as any, async (u) => { url = String(u); return new Response(JSON.stringify([
    { id: "A", symbol: "AAA", name: "A", icon: "https://i/a.png", decimals: 6, isVerified: true, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { id: "B", symbol: "BBB", name: "B", icon: null, decimals: 6, isVerified: false, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { id: "C", symbol: "CCC", name: "C", icon: null, decimals: 6, isVerified: true, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
    { id: "D", symbol: "DDD", name: "D", icon: null, decimals: 6, isVerified: true, tokenProgram: "SomethingElse111111111111111111111111111111" },
  ])); });
  expect((await j.searchVerified("a")).map((t) => [t.mint, t.tokenProgram])).toEqual([
    ["A", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], ["C", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"],
  ]);
  expect(url).toBe("https://api.jup.ag/tokens/v2/search?query=a");
});

test("popularVerified ranks the verified list by organic score, keeps a few spare past 200 and caches it", async () => {
  const urls: string[] = [];
  const rows = Array.from({ length: 450 }, (_, i) => ({
    id: `M${i}`, symbol: `T${i}`, name: `Token ${i}`, icon: null, decimals: 6, isVerified: i !== 7, organicScore: i % 97,
    tokenProgram: i % 5 === 0 ? "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" : "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  }));
  const j = new JupiterLive("https://api.jup.ag/swap/v1", {} as any, async (u) => { urls.push(String(u)); return new Response(JSON.stringify(rows)); });
  const list = await j.popularVerified();
  expect(urls).toEqual(["https://api.jup.ag/tokens/v2/tag?query=verified"]);
  expect(list).toHaveLength(300);
  const scores = list.map((t) => rows.find((r) => r.id === t.mint)!.organicScore);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  expect(list.some((t) => t.mint === "M7")).toBe(false);
  expect(list.some((t) => t.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")).toBe(true);
  await j.popularVerified();
  expect(urls).toHaveLength(1);
});

test("isVerified retries a failed lookup once, then reports Jupiter as unavailable instead of unverified", async () => {
  const { JupiterUnavailable } = await import("../../src/jupiter/port");
  let calls = 0;
  const flaky = new JupiterLive("https://jup.test", {} as any, async () => (++calls === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify([{ id: "m", isVerified: true }]))));
  expect(await flaky.isVerified("m")).toBe(true);
  expect(calls).toBe(2);
  const down = new JupiterLive("https://jup.test", {} as any, async () => new Response("busy", { status: 503 }));
  await expect(down.isVerified("m")).rejects.toBeInstanceOf(JupiterUnavailable);
});

test("isVerified remembers tokens already seen as verified in search results", async () => {
  let calls = 0;
  const j = new JupiterLive("https://jup.test", {} as any, async () => { calls++; return new Response(JSON.stringify([{ id: "A", symbol: "A", name: "A", decimals: 6, isVerified: true, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }])); });
  await j.searchVerified("A");
  expect(await j.isVerified("A")).toBe(true);
  expect(calls).toBe(1);
});
