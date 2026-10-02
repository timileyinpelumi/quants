import { test, expect } from "bun:test";
import { filterPairs, pairTabs, type PairOption } from "../../src/web/launch/PairPicker";

const pair = (symbol: string, kind: PairOption["kind"], name = symbol): PairOption => ({
  mint: `${symbol}Mint`, symbol, name, decimals: 6, graduation: 1, icon: null, kind, tradingOnly: kind !== "crypto",
});
const quotes = [pair("SOL", "crypto", "Solana"), pair("USDC", "crypto", "USD Coin"), pair("NVDAx", "xstocks", "NVIDIA xStock"), pair("TSLAx", "xstocks", "Tesla xStock"), pair("SPCX.US", "backpack", "SpaceX")];

test("tabs count every pair and each group", () => {
  expect(pairTabs(quotes).map((t) => `${t.label} ${t.count}`)).toEqual(["All 5", "Crypto 2", "xStocks 2", "Backpack 1"]);
});

test("filter by tab and by symbol, name or mint", () => {
  expect(filterPairs(quotes, "xstocks", "").map((q) => q.symbol)).toEqual(["NVDAx", "TSLAx"]);
  expect(filterPairs(quotes, "all", "nvidia").map((q) => q.symbol)).toEqual(["NVDAx"]);
  expect(filterPairs(quotes, "all", "spcx").map((q) => q.symbol)).toEqual(["SPCX.US"]);
  expect(filterPairs(quotes, "crypto", "tesla")).toEqual([]);
});

test("groups with no pairs get no tab", () => {
  const crypto = quotes.filter((q) => q.kind === "crypto");
  expect(pairTabs(crypto).map((t) => t.label)).toEqual(["All", "Crypto"]);
});
