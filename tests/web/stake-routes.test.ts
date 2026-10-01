import { test, expect } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { GET as positionsRoute } from "../../src/app/api/launches/[mint]/positions/route";
import { POST as stakeRoute } from "../../src/app/api/stake/[action]/route";

const OWNER = "Staker11111111111111111111111111111111111111";
const ZEC = "Zec1111111111111111111111111111111111111111";

async function setup() {
  const c = await makeWebContext();
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol)
    values ('CATmint', 'P', 'q', 200, 'c', 'cr', 'live', 1, 'CAT') returning id`;
  await c.sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals) values (${l.id}, ${ZEC}, 10000, 'ZEC', 8)`;
  await c.sql`insert into stake_pools values (${l.id}, 'kamino', 3000, 'Spill', 'ready')`;
  await c.sql`insert into stake_tiers values (${l.id}, '7d', 604800, 10000, 'farm7'), (${l.id}, '30d', 2592000, 15000, 'farm30')`;
  const now = Math.floor(Date.now() / 1000);
  const staking = c.staking as any;
  staking.positions.set(`${OWNER}:farm7`, { staked: 1_000_000n, activeShares: 1_000_000n * 10n ** 18n, lastStakeTs: now - 302_400, lockSeconds: 604_800, pending: [{ mint: ZEC, amount: 5n }] });
  staking.positions.set(`${OWNER}:farm30`, { staked: 2_000_000n, activeShares: 1n, lastStakeTs: now - 2_600_000, lockSeconds: 2_592_000, pending: [{ mint: ZEC, amount: 0n }] });
  return c;
}
const get = (owner: string) => positionsRoute(new Request(`http://x/api/launches/CATmint/positions?owner=${owner}`), { params: Promise.resolve({ mint: "CATmint" }) });
const post = (action: string, body: object) => stakeRoute(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });

test("positions include pending rewards with symbols and an exit preview for locked stakes", async () => {
  await setup();
  const { positions } = await (await get(OWNER)).json();
  const p7 = positions.find((p: any) => p.tierId === "7d");
  expect(p7.locked).toBe(true);
  expect(p7.pending).toEqual([{ mint: ZEC, symbol: "ZEC", decimals: 8, amount: "5" }]);
  expect(Math.abs(Number(p7.exitPreview.burned) - 150_000)).toBeLessThanOrEqual(100);
  expect(BigInt(p7.exitPreview.back) + BigInt(p7.exitPreview.burned)).toBe(1_000_000n);
  const p30 = positions.find((p: any) => p.tierId === "30d");
  expect(p30.locked).toBe(false);
  expect(p30.exitPreview).toBeNull();
});

test("stake validates amount and tier, and returns an unsigned transaction", async () => {
  const c = await setup();
  expect((await post("stake", { mint: "CATmint", tierId: "7d", owner: OWNER, amount: "abc" })).status).toBe(400);
  const bad = await post("stake", { mint: "CATmint", tierId: "999d", owner: OWNER, amount: "10" });
  expect(bad.status).toBe(400);
  const ok = await (await post("stake", { mint: "CATmint", tierId: "7d", owner: OWNER, amount: "10" })).json();
  expect(ok.transaction).toEqual({ base64: "dHg=", versioned: false });
  expect((c.staking as any).built.at(-1)).toMatchObject({ action: "stake", farm: "farm7", amount: 10n });
});

test("exit and withdraw refuse the wrong state with plain messages", async () => {
  await setup();
  const e = await post("exit", { mint: "CATmint", tierId: "30d", owner: OWNER });
  expect(e.status).toBe(400);
  expect((await e.json()).error.message).toBe("This stake is unlocked, withdraw it instead");
  const w = await post("withdraw", { mint: "CATmint", tierId: "7d", owner: OWNER });
  expect(w.status).toBe(400);
  expect((await w.json()).error.message).toBe("This stake is still locked");
  expect((await post("exit", { mint: "CATmint", tierId: "7d", owner: OWNER })).status).toBe(200);
  expect((await post("withdraw", { mint: "CATmint", tierId: "30d", owner: OWNER })).status).toBe(200);
  expect((await post("claim", { mint: "CATmint", tierId: "7d", owner: OWNER })).status).toBe(200);
  expect((await post("dance", { mint: "CATmint", tierId: "7d", owner: OWNER })).status).toBe(400);
});

test("positions and stake actions are rate limited", async () => {
  await setup();
  const codes = new Set<number>();
  for (let i = 0; i < 70; i++) codes.add((await get(OWNER)).status);
  expect(codes.has(429)).toBe(true);
  const stakeCodes = new Set<number>();
  for (let i = 0; i < 40; i++) stakeCodes.add((await post("claim", { mint: "CATmint", tierId: "7d", owner: OWNER })).status);
  expect(stakeCodes.has(429)).toBe(true);
});

test("staking is refused while the pool is pending", async () => {
  const c = await setup();
  await c.sql`update stake_pools set status = 'pending'`;
  const r = await post("stake", { mint: "CATmint", tierId: "7d", owner: OWNER, amount: "10" });
  expect(r.status).toBe(400);
});
