import { test, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { freshDb } from "../helpers/db";
import { StockRegistry } from "../../src/stocks/registry";
import { fetchXStocks, parseBackpack } from "../../src/stocks/sources";
import { quoteCoin } from "../../src/domain/quotes";
import { mintAccount, mintData, pausable, scaledUi, transferFee } from "../helpers/mint-data";

const addr = () => Keypair.generate().publicKey.toBase58();
const NVDAX = addr(), TSLAX = addr(), FEEX = addr(), SPCX = addr(), AAPL = addr();

const xPage = (page: number, hasNextPage: boolean, nodes: { symbol: string; mint: string }[]) => ({
  page: { currentPage: page, hasNextPage },
  nodes: nodes.map((n) => ({
    symbol: n.symbol, name: `${n.symbol} xStock`, logo: `https://logos.test/${n.symbol}.png`,
    deployments: [{ network: "Ethereum", address: "0xabc" }, { network: "Solana", address: n.mint }],
  })),
});
const backpack = [
  { symbol: "SPCX.US", displayName: "SpaceX", tokens: [{ blockchain: "Solana", contractAddress: SPCX }] },
  { symbol: "AAPL.US", displayName: "Apple Inc.", tokens: [{ blockchain: "Solana", contractAddress: AAPL }] },
  { symbol: "BTC", displayName: "Bitcoin", tokens: [{ blockchain: "Solana", contractAddress: addr() }] },
  { symbol: "MSFT.US", displayName: "Microsoft", tokens: [{ blockchain: "Ethereum", contractAddress: "0x1" }] },
];

test("xStocks pages are read until there is no next page", async () => {
  const pages = [xPage(0, true, [{ symbol: "NVDAx", mint: NVDAX }]), xPage(1, false, [{ symbol: "TSLAx", mint: TSLAX }])];
  const urls: string[] = [];
  const list = await fetchXStocks(async (u) => { urls.push(String(u)); return Response.json(pages[urls.length - 1]); });
  expect(urls.map((u) => new URL(u).searchParams.get("page"))).toEqual(["0", "1"]);
  expect(list).toEqual([
    { mint: NVDAX, issuer: "xstocks", symbol: "NVDAx", name: "NVDAx xStock", icon: "https://logos.test/NVDAx.png" },
    { mint: TSLAX, issuer: "xstocks", symbol: "TSLAx", name: "TSLAx xStock", icon: "https://logos.test/TSLAx.png" },
  ]);
});

test("Backpack stocks are the .US symbols with a Solana mint", () => {
  expect(parseBackpack(backpack).map((s) => s.symbol)).toEqual(["SPCX.US", "AAPL.US"]);
});

function setup(over: { configKeys?: Record<string, string>; now?: () => number; fail?: boolean } = {}) {
  let fetches = 0;
  const fetchFn = async (u: string | URL) => {
    fetches++;
    if (over.fail) return new Response("down", { status: 503 });
    if (String(u).includes("xstocks")) return Response.json(xPage(0, false, [{ symbol: "NVDAx", mint: NVDAX }, { symbol: "TSLAx", mint: TSLAX }, { symbol: "FEEx", mint: FEEX }]));
    return Response.json(backpack);
  };
  const accounts = new Map([
    [NVDAX, mintAccount(mintData(8, [pausable(false), scaledUi(1)]))],
    [TSLAX, mintAccount(mintData(8))],
    [FEEX, mintAccount(mintData(8, [transferFee()]))],
    [SPCX, mintAccount(mintData(6))],
  ]);
  const reads: string[] = [];
  const conn = { getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => { reads.push(k.toBase58()); return accounts.get(k.toBase58()) ?? null; }) };
  const configKeys = over.configKeys ?? {
    [`${NVDAX}:100`]: "CfgN100", [`${NVDAX}:200`]: "CfgN200", [`${FEEX}:200`]: "CfgF", [`${SPCX}:200`]: "CfgS", [`${AAPL}:200`]: "CfgA",
    "So11111111111111111111111111111111111111112:200": "CfgSol",
  };
  const thresholds: Record<string, bigint> = { CfgN100: 50n * 10n ** 8n, CfgS: 3_000n * 10n ** 6n };
  return { fetchFn, conn, configKeys, thresholds, reads, fetches: () => fetches };
}

test("lists only checked stocks that have config keys, with graduation from the config", async () => {
  const sql = await freshDb();
  const s = setup();
  const reg = new StockRegistry({ sql, conn: s.conn as any, fetch: s.fetchFn, configKeys: s.configKeys, threshold: async (k) => s.thresholds[k] ?? 0n, log: () => {} });
  const list = await reg.list();
  expect(list.map((c) => [c.symbol, c.kind, c.decimals, c.graduation, c.tradingOnly])).toEqual([
    ["NVDAx", "xstocks", 8, 50, true],
    ["SPCX.US", "backpack", 6, 3000, true],
  ]);
  // TSLAx has no config keys so it is never read; AAPL has keys but no mint on this network.
  expect(s.reads.sort()).toEqual([NVDAX, FEEX, SPCX, AAPL].sort());
  const [fee] = await sql`select ok, problem from stock_quotes where mint = ${FEEX}`;
  expect(fee).toEqual({ ok: false, problem: "has a transfer fee" });
  expect(quoteCoin(NVDAX)?.symbol).toBe("NVDAx");
  expect(await reg.icons([NVDAX])).toEqual({ [NVDAX]: "https://logos.test/NVDAx.png" });
});

test("mints are checked once and lists refresh after a day, keeping the old list when an issuer is down", async () => {
  const sql = await freshDb();
  let now = Date.parse("2026-10-01T00:00:00Z");
  const s = setup({ now: () => now });
  const reg = new StockRegistry({ sql, conn: s.conn as any, fetch: s.fetchFn, configKeys: s.configKeys, threshold: async (k) => s.thresholds[k] ?? 0n, now: () => now, log: () => {} });
  await reg.list();
  const reads = s.reads.length, fetches = s.fetches();
  now += 10 * 60_000;
  await reg.list();
  expect(s.fetches()).toBe(fetches);
  expect(s.reads.length).toBe(reads);

  now += 25 * 3_600_000;
  const down = new StockRegistry({ sql, conn: s.conn as any, fetch: setup({ fail: true }).fetchFn, configKeys: s.configKeys, threshold: async () => 0n, now: () => now, log: () => {} });
  await down.list();
  await down.refresh();
  expect((await down.list()).map((c) => c.symbol)).toEqual(["NVDAx", "SPCX.US"]);
});

test("local listings stand in for the issuers", async () => {
  const sql = await freshDb();
  const s = setup();
  const reg = new StockRegistry({
    sql, conn: s.conn as any, fetch: async () => { throw new Error("no network"); }, configKeys: { [`${TSLAX}:200`]: "CfgT" }, threshold: async () => 10n ** 9n,
    local: [{ mint: TSLAX, issuer: "xstocks", symbol: "TSLAx", name: "Tesla stand-in", icon: null }], log: () => {},
  });
  expect((await reg.list()).map((c) => [c.symbol, c.graduation])).toEqual([["TSLAx", 10]]);
});
