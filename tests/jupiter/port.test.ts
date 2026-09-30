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
