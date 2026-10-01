import { test, expect } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { prepareLaunch } from "../../src/launch/prepare";
import { confirmLaunch } from "../../src/launch/confirm";
import { listLaunches, launchDetail } from "../../src/web/server/reads";
import { beginStep, confirmStep } from "../../src/ledger/ledger";
import { GET as detailRoute } from "../../src/app/api/launches/[mint]/route";
import { NATIVE_MINT } from "../../src/domain/types";

const ZEC = "Zec1111111111111111111111111111111111111111";
const CREATOR = "Creator111111111111111111111111111111111111";

async function launch(c: Awaited<ReturnType<typeof makeWebContext>>, symbol: string) {
  const p = await prepareLaunch(
    { sql: c.sql, meteora: c.meteora, configKeys: c.configKeys, quoteMints: [NATIVE_MINT, c.ourtokenMint], isVerified: async () => true, tokenProgramOf: c.tokenProgramOf },
    { name: `${symbol} Coin`, symbol, uri: "https://ipfs.io/ipfs/m", image: "https://ipfs.io/ipfs/i", creator: CREATOR, quoteMint: NATIVE_MINT, feeTierBps: 200,
      basket: [{ mint: ZEC, weightBps: 10_000, symbol: "ZEC", decimals: 8 }] },
  );
  (c.meteora as any).pools.set(p.pool, { baseMint: p.mint, config: "CfgSol200", creator: CREATOR });
  const id = await confirmLaunch({ sql: c.sql, conn: { getSignatureStatuses: async () => ({ value: [{ err: null }] }) } as any, meteora: c.meteora, spillWallet: c.spillWallet }, { signature: "s", mint: p.mint });
  return { ...p, id };
}

async function step(c: any, launchId: number, key: string, kind: string, detail: object) {
  const r = await beginStep(c.sql, { launchId, idemKey: key, kind: kind as any, settingsVersion: 1, detail });
  await confirmStep(c.sql, r, []);
}

test("listLaunches returns newest first with metadata and burned totals", async () => {
  const c = await makeWebContext();
  const a = await launch(c, "CAT");
  const b = await launch(c, "DOG");
  await step(c, a.id, "burn1", "burn", { mint: a.mint, amount: "300" });
  const list = await listLaunches(c.sql, {});
  expect(list.map((l) => l.symbol)).toEqual(["DOG", "CAT"]);
  expect(list[1]!.burned).toBe("300");
  expect(list[1]!.basket).toEqual([{ mint: ZEC, symbol: "ZEC" }]);
  expect(list[1]!.image).toBe("https://ipfs.io/ipfs/i");
  expect((await listLaunches(c.sql, { graduated: true })).length).toBe(0);
  void b;
});

test("launches route pages by offset", async () => {
  const c = await makeWebContext();
  const { GET } = await import("../../src/app/api/launches/route");
  for (const s of ["AAA", "BBB", "CCC"]) await launch(c, s);
  const get = async (qs: string) => (await GET(new Request(`http://x/api/launches?${qs}`))).json();
  const p1 = await get("limit=2");
  expect(p1.launches.map((l: any) => l.symbol)).toEqual(["CCC", "BBB"]);
  expect(p1.nextOffset).toBe(2);
  const p2 = await get("limit=2&offset=2");
  expect(p2.launches.map((l: any) => l.symbol)).toEqual(["AAA"]);
  expect(p2.nextOffset).toBeNull();
  expect((await GET(new Request("http://x/api/launches?limit=51"))).status).toBe(400);
});

test("launchDetail sums paid out and burned, and weights tier shares by multiplier", async () => {
  const c = await makeWebContext();
  const a = await launch(c, "CAT");
  const tiers = await c.sql`select tier_id from stake_tiers where launch_id = ${a.id} order by lock_seconds`;
  for (const t of tiers) await c.sql`update stake_tiers set farm = ${"farm-" + t.tier_id} where launch_id = ${a.id} and tier_id = ${t.tier_id}`;
  const staking = c.staking as any;
  staking.staked.set("farm-7d", 100n).set("farm-30d", 100n);
  (c.meteora as any).progress.set(a.pool, { quoteReserve: 40n, threshold: 80n, migrated: false });
  await step(c, a.id, "f1", "fund", { farm: "farm-7d", rewardMint: ZEC, amount: "100" });
  await step(c, a.id, "f2", "fund", { farm: "farm-30d", rewardMint: ZEC, amount: "50" });
  await step(c, a.id, "b1", "burn", { mint: a.mint, amount: "300" });
  const d = (await launchDetail(c, a.mint))!;
  expect(d.launch.symbol).toBe("CAT");
  expect(d.basket).toEqual([{ mint: ZEC, symbol: "ZEC", decimals: 8, weightBps: 10_000, paidOut: "150" }]);
  expect(d.burned).toBe("300");
  // 7d is 1.5x and 30d is 2x, so equal stakes split 3 to 4
  expect(d.tiers.map((t) => t.sharePct)).toEqual([0, 0, 43, 57]);
  expect(d.tiers[2]!.staked).toBe("100");
  expect(d.curve).toEqual({ quoteReserve: "40", threshold: "80", migrated: false });
  expect(await launchDetail(c, "unknown")).toBeNull();
});

test("detail route returns 404 json for an unknown mint", async () => {
  await makeWebContext();
  const r = await detailRoute(new Request("http://x"), { params: Promise.resolve({ mint: "nope" }) });
  expect(r.status).toBe(404);
  expect((await r.json()).error.code).toBe("not_found");
});

test("a failing stake read shows unknown instead of breaking the page", async () => {
  const c = await makeWebContext();
  const a = await launch(c, "CAT");
  await c.sql`update stake_tiers set farm = 'farmX' where launch_id = ${a.id}`;
  (c.staking as any).totalStaked = async () => { throw new Error("429"); };
  const d = (await launchDetail(c, a.mint))!;
  expect(d.tiers.every((t) => t.staked === null && t.sharePct === 0)).toBe(true);
});

test("launchDetail shows how close staking is to opening until the farms are ready", async () => {
  const c = await makeWebContext();
  const a = await launch(c, "CAT");
  const [sp] = await c.sql`select rent_lamports from stake_pools where launch_id = ${a.id}`;
  const rent = BigInt(sp.rent_lamports);
  const value = (rent * 42n) / 100n + 1n;
  await c.sql`update stake_pools set basket_value_lamports = ${value.toString()} where launch_id = ${a.id}`;
  const d = (await launchDetail(c, a.mint))!;
  expect(d.stakeReady).toBe(false);
  expect(d.stakingOpens).toEqual({ percent: 42, rentLamports: rent.toString(), neededLamports: (rent - value).toString() });
  await c.sql`update stake_pools set status = 'ready' where launch_id = ${a.id}`;
  expect((await launchDetail(c, a.mint))!.stakingOpens).toBeNull();
});
