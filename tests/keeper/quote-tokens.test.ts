import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { loadLaunches } from "../../src/keeper/launch-row";
import { processLaunch } from "../../src/keeper/run";
import { getBalance } from "../../src/ledger/ledger";
import { launchCost } from "../../src/domain/launch-cost";
import { quoteCoins } from "../../src/domain/quotes";
import { NATIVE_MINT } from "../../src/domain/types";

const TIER = { id: "7d", lockSeconds: 604_800, multiplierBps: 10_000 };
const RENT = launchCost({ tiers: [TIER] }, 2).rent;

// Each added pair goes through the same keeper path as USDC: claim, split, creator payout at that pair's minimum,
// a rent swap to SOL through Jupiter, then reward swaps from the pair token and from the SOL left over.
for (const coin of quoteCoins({}).filter((c) => !["SOL", "USDC", "USDT"].includes(c.symbol))) {
  test(`a ${coin.symbol} launch pays out at its minimum, swaps rent to SOL and buys rewards from ${coin.symbol}`, async () => {
    const f = await keeperFixture();
    const staking = new FakeStaking(f.chain);
    const jupiter = new FakeJupiter(f.chain);
    jupiter.rates.set(NATIVE_MINT, 1).set("ZEC", 1).set("CATE", 1);
    const deps = { ...f.deps, staking, jupiter };
    const id = await insertLaunch(f.sql, { pool: "P1", quote_mint: coin.mint });
    await f.sql`insert into baskets values (${id}, 'ZEC', 5000), (${id}, 'CATE', 5000)`;
    await f.sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
    await f.sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values (${id}, ${TIER.id}, ${TIER.lockSeconds}, ${TIER.multiplierBps})`;
    const launch = async () => (await loadLaunches(f.sql)).find((l) => l.id === id)!;

    // Fees worth the rent several times over, and a creator share above the pair's payout minimum.
    const fees = 10n * RENT + 10n * coin.payoutMin;
    f.meteora.partnerFee.set("P1", fees);
    await processLaunch(deps, await launch(), f.settings, "r1");

    const payouts = await f.sql`select detail from distributions where launch_id = ${id} and kind = 'payout' and status = 'confirmed'`;
    const creator = payouts.find((p: any) => p.detail.bucket === "creator");
    expect(creator?.detail).toMatchObject({ mint: coin.mint, amount: ((fees * 2500n) / 10_000n).toString() });

    const swaps = await f.sql`select detail from distributions where launch_id = ${id} and kind = 'swap' and status = 'confirmed' order by id`;
    expect(swaps[0].detail).toMatchObject({ inputMint: coin.mint, outputMint: NATIVE_MINT, toBucket: "basket" });
    const fromPair = swaps.filter((s: any) => s.detail.inputMint === coin.mint && s.detail.outputMint !== NATIVE_MINT);
    expect(fromPair.map((s: any) => s.detail.outputMint).sort()).toEqual(["CATE", "ZEC"]);
    expect((await f.sql`select 1 from distributions where launch_id = ${id} and kind = 'rent' and status = 'confirmed'`).length).toBe(1);
    expect(await getBalance(f.sql, id, "basket", coin.mint)).toBe(0n);
    expect(await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBe(0n);
    expect((await f.sql`select status from stake_pools where launch_id = ${id}`)[0].status).toBe("ready");
  });
}

test("a creator share under the pair's payout minimum waits in escrow", async () => {
  const bonk = quoteCoins({}).find((c) => c.symbol === "BONK")!;
  const f = await keeperFixture();
  const id = await insertLaunch(f.sql, { pool: "P1", quote_mint: bonk.mint, trading_only: true });
  f.meteora.partnerFee.set("P1", bonk.payoutMin);
  await processLaunch(f.deps, (await loadLaunches(f.sql)).find((l) => l.id === id)!, f.settings, "r1");
  const creator = await getBalance(f.sql, id, "creator", bonk.mint);
  expect(creator).toBeGreaterThan(0n);
  expect(creator).toBeLessThan(bonk.payoutMin);
  expect((await f.sql`select 1 from distributions where launch_id = ${id} and kind = 'payout' and detail->>'bucket' = 'creator'`).length).toBe(0);
});
