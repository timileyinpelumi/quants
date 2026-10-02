import { test, expect } from "bun:test";
import { PoolPrices, type PricePort } from "../../src/indexer/prices";
import { NATIVE_MINT } from "../../src/domain/types";

const DEV_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function jupiter(prices: Record<string, number>) {
  const asked: string[][] = [];
  const port: PricePort = {
    usd: async (m) => prices[m] ?? null,
    usdMany: async (ms) => { asked.push(ms); return Object.fromEntries(ms.map((m) => [m, prices[m] ?? null])); },
  };
  return { port, asked };
}

test("stand-in mints use their mainnet mint and pool tokens use the pool price times SOL", async () => {
  const j = jupiter({ [NATIVE_MINT]: 200, [USDC]: 1 });
  const pools: string[] = [];
  const p = new PoolPrices(j.port, { [DEV_USDC]: USDC }, new Set(["dZEC", "QUANTS"]), async (m) => { pools.push(m); return m === "dZEC" ? 0.25 : null; });
  expect(await p.usdMany([NATIVE_MINT, DEV_USDC, "dZEC", "QUANTS", "other"])).toEqual({ [NATIVE_MINT]: 200, [DEV_USDC]: 1, dZEC: 50, QUANTS: null, other: null });
  expect(j.asked[0]!.sort()).toEqual([NATIVE_MINT, USDC, "other"].sort());
  await p.usd("dZEC");
  expect(pools.filter((m) => m === "dZEC")).toHaveLength(1);
});

test("a pool read that fails or a missing SOL price gives no price", async () => {
  const failing = new PoolPrices(jupiter({ [NATIVE_MINT]: 200 }).port, {}, new Set(["dZEC"]), async () => { throw new Error("rpc down"); });
  expect(await failing.usd("dZEC")).toBeNull();
  const noSol = new PoolPrices(jupiter({}).port, {}, new Set(["dZEC"]), async () => 0.25);
  expect(await noSol.usd("dZEC")).toBeNull();
});
