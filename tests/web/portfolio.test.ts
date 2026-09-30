import { test, expect } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { GET } from "../../src/app/api/portfolio/route";

const OWNER = "Staker11111111111111111111111111111111111111";

test("groups a wallet's stakes by token across launches", async () => {
  const c = await makeWebContext();
  for (const [mint, sym] of [["CATmint", "CAT"], ["DOGmint", "DOG"], ["EMUmint", "EMU"]]) {
    const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol)
      values (${mint}, ${mint + "pool"}, 'q', 200, 'c', 'cr', 'live', 1, ${sym}) returning id`;
    await c.sql`insert into stake_pools values (${l.id}, 'kamino', 3000, 'S', 'ready')`;
    await c.sql`insert into stake_tiers values (${l.id}, '7d', 604800, 10000, ${mint + "-7d"}), (${l.id}, '30d', 2592000, 15000, ${mint + "-30d"})`;
  }
  const staking = c.staking as any;
  const now = Math.floor(Date.now() / 1000);
  staking.userFarmList = ["CATmint-7d", "DOGmint-30d", "DOGmint-7d", "SomeoneElsesFarm"];
  staking.positions.set(`${OWNER}:CATmint-7d`, { staked: 5n, activeShares: 5n, lastStakeTs: now, lockSeconds: 604800, pending: [] });
  staking.positions.set(`${OWNER}:DOGmint-30d`, { staked: 7n, activeShares: 7n, lastStakeTs: now, lockSeconds: 2592000, pending: [] });
  const r = await (await GET(new Request(`http://x/api/portfolio?owner=${OWNER}`))).json();
  expect(r.launches.map((l: any) => [l.symbol, l.positions.map((p: any) => p.tierId)])).toEqual([["CAT", ["7d"]], ["DOG", ["30d"]]]);
});

test("an empty wallet has no stakes", async () => {
  await makeWebContext();
  const r = await (await GET(new Request(`http://x/api/portfolio?owner=${OWNER}`))).json();
  expect(r.launches).toEqual([]);
});
