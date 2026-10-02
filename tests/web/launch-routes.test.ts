import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { POST as prepare } from "../../src/app/api/launch/prepare/route";
import { POST as confirm } from "../../src/app/api/launch/confirm/route";
import { GET as search } from "../../src/app/api/tokens/search/route";
import { NATIVE_MINT } from "../../src/domain/types";
import { POST as cosign } from "../../src/app/api/launch/cosign/route";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

const body = (over: object = {}) => ({
  name: "Cat", symbol: "CAT", uri: "https://ipfs.io/ipfs/x", creator: "Creator111111111111111111111111111111111111",
  quoteMint: NATIVE_MINT, feeTierBps: 200, basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }], ...over,
});
const post = (h: (r: Request) => Promise<Response>, b: object) => h(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

test("SOL launch is one launch step: the wallet signs first, then the server checks it, adds the mint's signature and sends it", async () => {
  const sent: Buffer[] = [];
  const c = await makeWebContext({ conn: { sendRawTransaction: async (raw: Buffer) => { sent.push(Buffer.from(raw)); return "sig-launch"; } } as any });
  const user = Keypair.generate();
  const r = await post(prepare, body({ devBuySol: "1000000000", creator: user.publicKey.toBase58() }));
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.step).toBe("launch");
  expect(j.transaction.versioned).toBe(false);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_000_000_000n);
  const tx = VersionedTransaction.deserialize(Buffer.from(j.transaction.base64, "base64"));
  expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  expect(typeof j.transaction.cosign).toBe("string");
  const [row] = await c.sql`select creator from prepared_launches where mint = ${j.mint}`;
  expect(row.creator).toBe(user.publicKey.toBase58());
  expect(c.simulated.length).toBe(1);
  const signed = Transaction.from(Buffer.from(j.transaction.base64, "base64"));
  signed.partialSign(user);
  const cr = await post(cosign, { id: j.transaction.cosign, transaction: signed.serialize({ requireAllSignatures: false }).toString("base64") });
  expect(await cr.json()).toEqual({ signature: "sig-launch" });
  const landed = Transaction.from(sent[0]!);
  expect(landed.verifySignatures()).toBe(true);
  expect(landed.signatures.some((s) => s.publicKey.toBase58() === j.mint)).toBe(true);
  expect(c.simulated.length).toBe(2);
});

test("OURTOKEN launch with a first buy swaps first, and the launch is built only on the next call", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(OURS, 2);
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000" }));
  const j = await r.json();
  expect(j.step).toBe("swap");
  expect(j.transaction.versioned).toBe(true);
  expect(j.transaction.cosign).toBeUndefined();
  expect(j.quoteBought).toBe("1980000000");
  expect((c.meteora as any).launches).toEqual([]);
  expect((await c.sql`select mint from prepared_launches`).length).toBe(0);
  let quoted = 0;
  (c.jupiter as any).quote = async () => { quoted++; return null; };
  const next = await (await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000", quoteBought: j.quoteBought }))).json();
  expect(next.step).toBe("launch");
  expect(quoted).toBe(0);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_980_000_000n);
  expect(c.simulated.length).toBe(2);
});

test("a swap step is refused when the first buy is over the cap, before any swap is built", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(OURS, 2);
  (c.meteora as any).firstBuyOut = async () => 10n ** 17n;
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000" }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("dev_buy_too_large");
  expect(c.simulated.length).toBe(0);
});

test("a launch that would fail on chain is refused with a readable error and never reaches the wallet", async () => {
  const c = await makeWebContext();
  c.conn.simulateTransaction = async () => ({ context: { slot: 1 }, value: { err: "AccountNotFound", logs: [], accounts: null, unitsConsumed: 0, returnData: null } }) as any;
  const r = await post(prepare, body({ devBuySol: "1000000000" }));
  expect(r.status).toBe(400);
  expect((await r.json()).error).toEqual({ code: "simulation_failed", message: "Your wallet needs about 1.03 SOL for this launch. Add SOL and try again." });
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

test("the first USDC launch creates its config key in its own step, then swaps, then launches", async () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(USDC, 150);
  const call = async (over: object = {}) => (await post(prepare, body({ quoteMint: USDC, devBuySol: "1000000000", ...over }))).json();

  const first = await call();
  expect(first.step).toBe("config");
  const meteora = c.meteora as any;
  const cfg = meteora.configTxs[0];
  expect(cfg.create.quote).toEqual({ mint: USDC, decimals: 6, migrationQuoteThreshold: 12_000 });
  expect(cfg.create.keeper).toBe(c.keeperAddress);
  expect(cfg.creator).toBe(body().creator);
  const configKey = cfg.create.config.publicKey.toBase58();
  expect(typeof first.transaction.cosign).toBe("string");
  expect(meteora.launches).toEqual([]);
  const [row] = await c.sql`select address, status from config_keys where quote_mint = ${USDC} and fee_bps = 200`;
  expect(row).toMatchObject({ address: configKey, status: "pending" });

  // not landed yet: the same config key again
  expect((await call()).step).toBe("config");
  expect(meteora.configTxs[1].create.config.publicKey.toBase58()).toBe(configKey);

  meteora.configs.set(configKey, { feeClaimer: c.keeperAddress, quoteMint: USDC, threshold: 12_000_000_000n });
  const swap = await call();
  expect(swap.step).toBe("swap");
  const launch = await call({ quoteBought: swap.quoteBought });
  expect(launch.step).toBe("launch");
  expect(meteora.launches[0]).toMatchObject({ quoteMint: USDC, configKey });
  expect(c.simulated.length).toBe(4);
});

test("a launch never pays the keeper, even when the keeper has no SOL", async () => {
  const c = await makeWebContext({ conn: { getBalance: async () => 0 } as any });
  await post(prepare, body());
  expect((c.meteora as any).launches[0].keeperTopUp).toBeUndefined();
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
