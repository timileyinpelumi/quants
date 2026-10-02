import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { POST as prepare } from "../../src/app/api/launch/prepare/route";
import { POST as confirm } from "../../src/app/api/launch/confirm/route";
import { GET as search } from "../../src/app/api/tokens/search/route";
import { NATIVE_MINT } from "../../src/domain/types";

const body = (over: object = {}) => ({
  name: "Cat", symbol: "CAT", uri: "https://ipfs.io/ipfs/x", creator: "Creator111111111111111111111111111111111111",
  quoteMint: NATIVE_MINT, feeTierBps: 200, basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }], ...over,
});
const post = (h: (r: Request) => Promise<Response>, b: object) => h(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

test("SOL launch returns one legacy transaction and passes the first buy through", async () => {
  const c = await makeWebContext();
  const r = await post(prepare, body({ devBuySol: "1000000000" }));
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.transactions.map((t: any) => t.versioned)).toEqual([false]);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_000_000_000n);
});

test("OURTOKEN launch with a first buy puts the Jupiter swap first and caps the buy by slippage", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(OURS, 2);
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000" }));
  const j = await r.json();
  expect(j.transactions.map((t: any) => t.versioned)).toEqual([true, false]);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_980_000_000n);
});

const STOCK = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const stock = { mint: STOCK, symbol: "NVDAx", name: "NVIDIA xStock", decimals: 8, graduation: 50, iconMint: STOCK, platform: false, payoutMin: 0n, kind: "xstocks" as const, tradingOnly: true, enabled: true };

test("with STOCK_PAIRS=1 a stock pair from the registry launches trading only, with no basket", async () => {
  process.env.STOCK_PAIRS = "1";
  try {
    const c = await makeWebContext({ stocks: { list: async () => [stock], icons: async () => ({}) } });
    c.configKeys[`${STOCK}:200`] = "CfgStock200";
    const r = await post(prepare, body({ quoteMint: STOCK, basket: [] }));
    const j = await r.json();
    expect(r.status).toBe(200);
    const [p] = await c.sql`select trading_only, basket from prepared_launches where mint = ${j.mint}`;
    expect(p).toEqual({ trading_only: true, basket: [] });
    const withBasket = await post(prepare, body({ quoteMint: STOCK }));
    expect(withBasket.status).toBe(400);
  } finally {
    delete process.env.STOCK_PAIRS;
  }
});

test("stock pairs are not launchable unless STOCK_PAIRS=1", async () => {
  delete process.env.STOCK_PAIRS;
  const c = await makeWebContext({ stocks: { list: async () => [stock], icons: async () => ({}) } });
  c.configKeys[`${STOCK}:200`] = "CfgStock200";
  const r = await post(prepare, body({ quoteMint: STOCK, basket: [] }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("invalid_input");
  const { launchableQuotes, allQuotes } = await import("../../src/web/server/quotes");
  expect((await launchableQuotes(c)).some((q) => q.tradingOnly)).toBe(false);
  // existing stock launches still trade, so lookups keep stock pairs
  expect((await allQuotes(c)).some((q) => q.mint === STOCK)).toBe(true);
});

test("OURTOKEN first buy with no route is a readable 400", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000" }));
  expect(r.status).toBe(400);
});

test("prepare maps validation errors to 400", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ symbol: "TOO LONG SYMBOL" }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("invalid_input");
});

test("confirm returns 400 with a readable code for an unknown mint", async () => {
  await makeWebContext();
  const r = await post(confirm, { signature: "5".repeat(64), mint: "Mint1111111111111111111111111111111111111111" });
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("not_found_on_chain");
});

test("token search proxies verified tokens and ignores short queries", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).searchVerified = async () => [{ mint: "Z", symbol: "ZEC", name: "Zcash", icon: null, decimals: 8, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }];
  expect((await (await search(new Request("http://x/api/tokens/search?q=zec"))).json()).tokens[0].symbol).toBe("ZEC");
  expect((await (await search(new Request("http://x/api/tokens/search?q=z"))).json()).tokens).toEqual([]);
});

test("token search caches results briefly and is rate limited", async () => {
  const c = await makeWebContext();
  let calls = 0;
  (c.jupiter as any).searchVerified = async () => { calls++; return []; };
  await search(new Request("http://x/api/tokens/search?q=zec"));
  await search(new Request("http://x/api/tokens/search?q=ZEC"));
  expect(calls).toBe(1);
  const codes = new Set<number>();
  for (let i = 0; i < 130; i++) codes.add((await search(new Request(`http://x/api/tokens/search?q=q${i}`))).status);
  expect(codes.has(429)).toBe(true);
});

test("an invalid creator is refused before any Jupiter call", async () => {
  const c = await makeWebContext();
  let quoted = false;
  (c.jupiter as any).quote = async () => { quoted = true; return null; };
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000", creator: "not-an-address" }));
  expect(r.status).toBe(400);
  expect(quoted).toBe(false);
});

test("basket symbols and decimals come from the server, not the request", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).searchVerified = async (q: string) => q === "Zec1111111111111111111111111111111111111111"
    ? [{ mint: q, symbol: "ZEC", name: "Zcash", icon: null, decimals: 8, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }] : [];
  const r = await post(prepare, body({ basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000, symbol: "BTC", decimals: 2 }] }));
  expect(r.status).toBe(200);
  const { mint } = await r.json();
  const [p] = await c.sql`select basket from prepared_launches where mint = ${mint}`;
  const basket = typeof p.basket === "string" ? JSON.parse(p.basket) : p.basket;
  expect(basket[0]).toMatchObject({ symbol: "ZEC", decimals: 8 });
});

test("an empty search returns popular tokens", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).popularVerified = async () => [{ mint: "S", symbol: "SOL", name: "Solana", icon: null, decimals: 9, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }];
  const j = await (await search(new Request("http://x/api/tokens/search?q="))).json();
  expect(j.tokens.map((t: any) => t.symbol)).toEqual(["SOL"]);
  expect(j.popular).toBe(true);
});

test("the first USDC launch creates its config key in an optional setup transaction, then swaps SOL to USDC", async () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(USDC, 150);
  const r = await post(prepare, body({ quoteMint: USDC, devBuySol: "1000000000" }));
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.transactions.map((t: any) => [t.versioned, t.optional ?? false])).toEqual([[false, true], [true, false], [false, false]]);
  const launch = (c.meteora as any).launches[0];
  expect(launch.quoteMint).toBe(USDC);
  expect(launch.createConfig.quote).toEqual({ mint: USDC, decimals: 6, migrationQuoteThreshold: 12_000 });
  expect(launch.createConfig.keeper).toBe(c.keeperAddress);
  const [row] = await c.sql`select address, status from config_keys where quote_mint = ${USDC} and fee_bps = 200`;
  expect(row).toMatchObject({ address: launch.configKey, status: "pending" });
});

test("a keeper below 0.01 SOL is topped up inside the launch transaction, a funded one is not", async () => {
  const c = await makeWebContext({ conn: { getBalance: async () => 4_000_000 } as any });
  await post(prepare, body());
  expect((c.meteora as any).launches[0].keeperTopUp).toEqual({ to: c.keeperAddress, lamports: 6_000_000n });
  const funded = await makeWebContext({ conn: { getBalance: async () => 2_000_000_000 } as any });
  await post(prepare, body());
  expect((funded.meteora as any).launches[0].keeperTopUp).toBeUndefined();
});

test("a pair token outside the supported list is refused", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ quoteMint: "BONK111111111111111111111111111111111111111" }));
  expect(r.status).toBe(400);
});

test("with an upload store set, metadata and images from elsewhere are refused", async () => {
  await makeWebContext({ uploadPrefix: "https://res.cloudinary.com/demo/" });
  const bad = await post(prepare, body());
  expect(bad.status).toBe(400);
  expect((await bad.json()).error.message).toContain("uploaded through quants");
  const ok = await post(prepare, body({ uri: "https://res.cloudinary.com/demo/raw/upload/quants/a.json", image: "https://res.cloudinary.com/demo/image/upload/quants/a" }));
  expect(ok.status).toBe(200);
  const evil = await post(prepare, body({ uri: "https://res.cloudinary.com/demo/raw/upload/quants/a.json", image: "https://evil.test/a.png" }));
  expect(evil.status).toBe(400);
});
