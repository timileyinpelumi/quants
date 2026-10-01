import { test, expect } from "bun:test";
import { keeperFixture, OURS } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeStaking } from "../helpers/fake-staking";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { loadLaunches } from "../../src/keeper/launch-row";
import { processLaunch, reconcile, resume, runKeeper, ReconcileError } from "../../src/keeper/run";
import { openStakingStep } from "../../src/keeper/steps/open";
import { beginStep, confirmStep, getBalance } from "../../src/ledger/ledger";
import { launchCost } from "../../src/domain/launch-cost";
import { NATIVE_MINT } from "../../src/domain/types";

const TIER = { id: "7d", lockSeconds: 604_800, multiplierBps: 10_000 };
const RENT = launchCost({ tiers: [TIER] }, 1).rent;

async function setup(quote = NATIVE_MINT) {
  const f = await keeperFixture();
  const staking = new FakeStaking(f.chain);
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 1);
  const deps = { ...f.deps, staking, jupiter };
  const id = await insertLaunch(f.sql, { pool: "P1", quote_mint: quote });
  await f.sql`insert into baskets values (${id}, 'ZEC', 10000)`;
  await f.sql`insert into stake_pools values (${id}, 'kamino', 3000, 'SpillAta', 'pending')`;
  await f.sql`insert into stake_tiers (launch_id, tier_id, lock_seconds, multiplier_bps) values (${id}, ${TIER.id}, ${TIER.lockSeconds}, ${TIER.multiplierBps})`;
  const launch = async () => (await loadLaunches(f.sql, OURS)).find((l) => l.id === id)!;
  const seed = async (mint: string, amount: bigint) => {
    const r = await beginStep(f.sql, { launchId: id, idemKey: `seed:${crypto.randomUUID()}`, kind: "split", settingsVersion: 1, detail: {} });
    await confirmStep(f.sql, r, [{ bucket: "basket", mint, amount }]);
  };
  const pool = async () => (await f.sql`select status, rent_lamports, basket_value_lamports from stake_pools where launch_id = ${id}`)[0];
  const rentSteps = async () => (await f.sql`select status from distributions where launch_id = ${id} and kind = 'rent'`).map((r: any) => r.status);
  return { ...f, deps, staking, jupiter, id, launch, seed, pool, rentSteps };
}

test("below the rent the basket stays in escrow and nothing is swapped, funded or created", async () => {
  const t = await setup();
  await t.seed(NATIVE_MINT, RENT - 1n);
  t.staking.totalStaked = async () => 1n;
  await processLaunch(t.deps, await t.launch(), t.settings, "r1");
  expect(await getBalance(t.sql, t.id, "basket", NATIVE_MINT)).toBe(RENT - 1n);
  expect(t.chain.sent).toEqual([]);
  expect(await t.rentSteps()).toEqual([]);
  const p = await t.pool();
  expect(p.status).toBe("pending");
  expect(BigInt(p.rent_lamports)).toBe(RENT);
  expect(BigInt(p.basket_value_lamports)).toBe(RENT - 1n);
});

test("staking opens on the run the SOL basket reaches the rent, and the remainder buys rewards", async () => {
  const t = await setup();
  await t.seed(NATIVE_MINT, RENT - 1n);
  await processLaunch(t.deps, await t.launch(), t.settings, "r1");
  await t.seed(NATIVE_MINT, 1_001n);
  await processLaunch(t.deps, await t.launch(), t.settings, "r2");
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  expect((await t.pool()).status).toBe("ready");
  expect(await getBalance(t.sql, t.id, "basket", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(t.sql, t.id, "reward", "ZEC")).toBe(1_000n);
});

test("a rerun after opening does not take the rent again or create farms twice", async () => {
  const t = await setup();
  await t.seed(NATIVE_MINT, RENT);
  await processLaunch(t.deps, await t.launch(), t.settings, "r1");
  await processLaunch(t.deps, await t.launch(), t.settings, "r2");
  await t.seed(NATIVE_MINT, RENT);
  await processLaunch(t.deps, await t.launch(), t.settings, "r3");
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  expect(t.chain.sent.filter((s) => s.startsWith("create_farm")).length).toBe(1);
  expect(await getBalance(t.sql, t.id, "reward", "ZEC")).toBe(RENT);
});

test("a crash after the rent is taken and before the farms exist resumes the farm setup without a second debit", async () => {
  const t = await setup();
  await t.seed(NATIVE_MINT, RENT);
  const orig = t.staking.buildCreateFarm.bind(t.staking);
  t.staking.buildCreateFarm = async () => { throw new Error("keeper died"); };
  await processLaunch(t.deps, await t.launch(), t.settings, "r1");
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  expect((await t.pool()).status).toBe("pending");
  t.staking.buildCreateFarm = orig;
  await resume(t.deps);
  await processLaunch(t.deps, await t.launch(), t.settings, "r2");
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  expect((await t.pool()).status).toBe("ready");
  expect(await getBalance(t.sql, t.id, "basket", NATIVE_MINT)).toBe(0n);
});

test("the rent can only be taken once per launch", async () => {
  const t = await setup();
  await t.seed(NATIVE_MINT, 2n * RENT);
  const a = await beginStep(t.sql, { launchId: t.id, idemKey: "rent:a", stepKey: `rent:${t.id}`, kind: "rent", settingsVersion: 1, detail: {} });
  const b = await beginStep(t.sql, { launchId: t.id, idemKey: "rent:b", stepKey: `rent:${t.id}`, kind: "rent", settingsVersion: 1, detail: {} });
  await confirmStep(t.sql, a, [{ bucket: "basket", mint: NATIVE_MINT, amount: -RENT }]);
  await expect(confirmStep(t.sql, b, [{ bucket: "basket", mint: NATIVE_MINT, amount: -RENT }])).rejects.toThrow();
  expect(await getBalance(t.sql, t.id, "basket", NATIVE_MINT)).toBe(RENT);
});

test("the ledger reconciles against a keeper wallet that paid the rent out of the stakers' share", async () => {
  const t = await setup();
  const claimed = 2n * RENT;
  t.meteora.partnerFee.set("P1", claimed);
  t.chain.balances.set(`Keeper:${NATIVE_MINT}`, claimed);
  await processLaunch(t.deps, await t.launch(), t.settings, "r1");
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  const [paid] = await t.sql`select coalesce(sum((detail->>'amount')::numeric), 0)::text as n from distributions where kind = 'payout' and status = 'confirmed'`;
  const [swapped] = await t.sql`select coalesce(sum((detail->>'amountIn')::numeric), 0)::text as n from distributions where kind = 'swap' and status = 'confirmed'`;
  const wallet = claimed - BigInt(paid.n) - BigInt(swapped.n) - RENT;
  t.chain.balances.set(`Keeper:${NATIVE_MINT}`, wallet);
  t.chain.balances.set("Keeper:ZEC", 10n ** 18n);
  await reconcile(t.deps);
  t.chain.balances.set(`Keeper:${NATIVE_MINT}`, wallet - 1n);
  await expect(reconcile(t.deps)).rejects.toBeInstanceOf(ReconcileError);
});

test("a non-SOL basket opens once its SOL value covers the rent, swapping only what the rent needs", async () => {
  const t = await setup(OURS);
  t.jupiter.rates.set(NATIVE_MINT, 0.5);
  await t.seed(OURS, 2n * RENT - 2n);
  await processLaunch(t.deps, await t.launch(), t.settings, "r1");
  expect(t.chain.sent).toEqual([]);
  expect(BigInt((await t.pool()).basket_value_lamports)).toBe(RENT - 1n);
  expect(await t.rentSteps()).toEqual([]);

  await t.seed(OURS, 1_000n);
  await processLaunch(t.deps, await t.launch(), t.settings, "r2");
  const [swap] = await t.sql`select detail from distributions where launch_id = ${t.id} and kind = 'swap' and detail->>'outputMint' = ${NATIVE_MINT}`;
  const amountIn = BigInt(swap.detail.amountIn);
  const cap = (2n * RENT * BigInt(10_000 + t.settings.slippageBps)) / 10_000n + 2n;
  expect(amountIn).toBeGreaterThanOrEqual(2n * RENT);
  expect(amountIn).toBeLessThanOrEqual(cap);
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  expect((await t.pool()).status).toBe("ready");
  expect(await getBalance(t.sql, t.id, "basket", OURS)).toBe(0n);
  expect(await getBalance(t.sql, t.id, "basket", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(t.sql, t.id, "reward", "ZEC")).toBeGreaterThan(0n);
});

test("a rent swap still in flight holds the launch until it lands, then the rent is taken once", async () => {
  const t = await setup(OURS);
  t.jupiter.rates.set(NATIVE_MINT, 0.5);
  t.chain.balances.set(`Keeper:${NATIVE_MINT}`, 10n ** 18n);
  t.chain.balances.set(`Keeper:${OURS}`, 10n ** 18n);
  await t.seed(OURS, 4n * RENT);
  t.chain.nextOutcome = "unknown";
  await runKeeper(t.deps);
  const sent = t.chain.sent.filter((s) => s.startsWith("swap"));
  expect(sent.length).toBe(1);
  expect(await t.rentSteps()).toEqual([]);
  t.chain.nextOutcome = "confirmed";
  await runKeeper(t.deps);
  expect(t.chain.sent.filter((s) => s.startsWith("swap")).length).toBe(1);
  t.chain.states.set(sent[0]!, "confirmed");
  await runKeeper(t.deps);
  expect(await t.rentSteps()).toEqual(["confirmed"]);
  expect((await t.pool()).status).toBe("ready");
  const rentSwaps = await t.sql`select status from distributions where kind = 'swap' and detail->>'outputMint' = ${NATIVE_MINT}`;
  expect(rentSwaps.map((r: any) => r.status)).toEqual(["confirmed"]);
});

test("a launch made while the launch fee existed opens without taking rent from stakers", async () => {
  const t = await setup();
  await t.sql`update settings set data = data || '{"launchFeeLamports": "300000000"}'::jsonb where version = 1`;
  expect(await openStakingStep(t.deps, await t.launch(), t.settings, "r1")).toBe(true);
  expect(await t.rentSteps()).toEqual([]);
  expect(BigInt((await t.pool()).basket_value_lamports)).toBe(BigInt((await t.pool()).rent_lamports));
});
