import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { loadLaunches } from "../../src/keeper/launch-row";
import { earnStep, returnEarnings, stakePayoutStep } from "../../src/keeper/steps/earn";
import { getBalance } from "../../src/ledger/ledger";

const DAY = 86_400;
const T0 = 1_800_000_000;
const tokens = (n: number) => BigInt(n) * 10n ** 6n;

async function setup(paused = false) {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const deps = { ...f.deps, staking };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await f.sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'ready')`;
  await f.sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps, farm) values (${id}, '1d', ${DAY}, 10000, 'F1'), (${id}, '30d', ${30 * DAY}, 20000, 'F30')`;
  await f.sql`insert into escrow (launch_id, bucket, mint, amount) values (${id}, 'reward', 'ZEC', 30000000)`;
  const [launch] = await loadLaunches(f.sql);
  const s = { ...f.settings, rewardFundingPaused: paused, earnPeriodDays: 30, earnTargetBps: 5000 };
  return { f, staking, deps, id, launch: launch!, s };
}
const periods = (sql: any, id: number) => sql`select owner, tier_id, status, extract(epoch from ends_at)::bigint::text as ends,
  coalesce((select sum(amount) from stake_earnings e where e.period_id = p.id), 0)::text as earned from stake_periods p where launch_id = ${id} order by id`;

test("earnings move from the reserve to owed while staked, and the period is due when the lock ends", async () => {
  const { f, staking, deps, id, launch, s } = await setup();
  staking.stakers.set("F1", [{ owner: "Alice", staked: tokens(500_000), lastStakeTs: T0 }]);
  await earnStep(deps, launch, s, T0 + 60);
  await earnStep(deps, launch, s, T0 + 60 + DAY / 2);
  let p = await periods(f.sql, id);
  expect([...p]).toMatchObject([{ owner: "Alice", tier_id: "1d", status: "accruing", ends: String(T0 + DAY), earned: "500" }]);
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBe(500n);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(30_000_000n - 500n);

  await earnStep(deps, launch, s, T0 + DAY + 60);
  p = await periods(f.sql, id);
  expect(p.map((r: any) => [r.status, r.ends])).toEqual([["due", String(T0 + DAY)], ["accruing", String(T0 + 2 * DAY)]]);
});

test("unstaking during the lock forfeits the period back to the reserve", async () => {
  const { f, staking, deps, id, launch, s } = await setup();
  staking.stakers.set("F30", [{ owner: "Bob", staked: tokens(1_000_000), lastStakeTs: T0 }]);
  await earnStep(deps, launch, s, T0 + 60);
  await earnStep(deps, launch, s, T0 + 60 + DAY);
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBeGreaterThan(0n);
  staking.stakers.set("F30", [{ owner: "Bob", staked: 0n, lastStakeTs: T0 }]);
  await earnStep(deps, launch, s, T0 + 60 + 2 * DAY);
  expect((await periods(f.sql, id)).map((r: any) => r.status)).toEqual(["forfeited"]);
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBe(0n);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(30_000_000n);
});

test("while paused nothing accrues and the paused time is never back paid", async () => {
  const { f, staking, deps, id, launch, s } = await setup(true);
  staking.stakers.set("F1", [{ owner: "Alice", staked: tokens(500_000), lastStakeTs: T0 }]);
  await earnStep(deps, launch, s, T0 + 60);
  await earnStep(deps, launch, s, T0 + 60 + DAY / 2);
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBe(0n);
  await earnStep(deps, launch, { ...s, rewardFundingPaused: false }, T0 + 60 + DAY / 2 + 600);
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBe(6n);
});

test("an approved period is paid by the keeper, a rejected one returns to the reserve", async () => {
  const { f, staking, deps, id, launch, s } = await setup();
  staking.stakers.set("F1", [{ owner: "Alice", staked: tokens(500_000), lastStakeTs: T0 }, { owner: "Carol", staked: tokens(500_000), lastStakeTs: T0 }]);
  await earnStep(deps, launch, s, T0 + 60);
  await earnStep(deps, launch, s, T0 + 60 + DAY / 2);
  staking.stakers.set("F1", []);
  await earnStep(deps, launch, s, T0 + DAY + 60);
  const [a, c] = await f.sql`select id, owner from stake_periods where launch_id = ${id} and status = 'due' order by owner`;
  await f.sql`update stake_periods set status = 'approved' where id = ${a.id}`;
  expect(await returnEarnings(f.sql, Number(c.id), "due", "rejected", "admin")).toBe(true);
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBe(500n);

  await stakePayoutStep(deps, launch, s);
  expect(f.chain.sent.filter((x) => x.startsWith("transfer")).length).toBe(1);
  const [paid] = await f.sql`select status from stake_periods where id = ${a.id}`;
  expect(paid.status).toBe("paid");
  expect(await getBalance(f.sql, id, "owed", "ZEC")).toBe(0n);
  await stakePayoutStep(deps, launch, s);
  expect(f.chain.sent.filter((x) => x.startsWith("transfer")).length).toBe(1);
});

test("a wallet on the auto pay list is paid when its lock ends without waiting for approval", async () => {
  const { f, staking, deps, id, launch, s } = await setup();
  staking.stakers.set("F1", [{ owner: "Alice", staked: tokens(500_000), lastStakeTs: T0 }, { owner: "Carol", staked: tokens(500_000), lastStakeTs: T0 }]);
  await earnStep(deps, launch, s, T0 + 60);
  await earnStep(deps, launch, s, T0 + 60 + DAY / 2);
  staking.stakers.set("F1", []);
  await earnStep(deps, launch, s, T0 + DAY + 60);
  await stakePayoutStep(deps, launch, { ...s, stakeAutoPay: ["Alice"] });
  const rows = await f.sql`select owner, status, decided_by from stake_periods where launch_id = ${id} order by owner`;
  expect(rows.map((r: any) => [r.owner, r.status, r.decided_by])).toEqual([["Alice", "paid", "auto pay list"], ["Carol", "due", null]]);
  expect(f.chain.sent.filter((x) => x.startsWith("transfer")).length).toBe(1);
});
