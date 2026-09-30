import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { FakeJupiter } from "../helpers/fake-jupiter";
import { loadLaunches } from "../../src/keeper/launch-row";
import { swapStep } from "../../src/keeper/steps/swap";
import { beginStep, confirmStep, getBalance } from "../../src/ledger/ledger";
import { NATIVE_MINT } from "../../src/domain/types";

async function seed(sql: any, launchId: number, amount: bigint) {
  const r = await beginStep(sql, { launchId, idemKey: `seed:${launchId}`, kind: "split", settingsVersion: 1, detail: {} });
  await confirmStep(sql, r, [{ bucket: "basket", mint: NATIVE_MINT, amount }]);
}

test("swaps the basket share by weight and credits measured output", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 2).set("CATE", 3);
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, 'ZEC', 7000), (${id}, 'CATE', 3000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_400n);
  expect(await getBalance(f.sql, id, "reward", "CATE")).toBe(900n);
});

test("no route or too much price impact leaves that token's share in escrow, others still swap", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 2).set("CATE", 3);
  jupiter.impactBps.set("CATE", 500);
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, 'ZEC', 5000), (${id}, 'CATE', 3000), (${id}, 'ANSEM', 2000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_000n);
  expect(await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBe(500n);
});

test("a basket token equal to the quote token moves without a swap", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, ${NATIVE_MINT}, 10000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", NATIVE_MINT)).toBe(1_000n);
  expect(f.chain.sent.length).toBe(0);
});

test("a Jupiter network error for one token does not stop the other swaps", async () => {
  const f = await keeperFixture();
  const jupiter = new FakeJupiter(f.chain);
  jupiter.rates.set("ZEC", 2).set("CATE", 3);
  const orig = jupiter.quote.bind(jupiter);
  jupiter.quote = async (i: string, o: string, a: bigint) => { if (o === "CATE") throw new Error("fetch failed"); return orig(i, o, a); };
  const deps = { ...f.deps, jupiter };
  const id = await insertLaunch(f.sql);
  await f.sql`insert into baskets values (${id}, 'ZEC', 5000), (${id}, 'CATE', 5000)`;
  await seed(f.sql, id, 1_000n);
  const [launch] = await loadLaunches(f.sql, deps.ourtokenMint);
  await swapStep(deps, launch!, f.settings, "r1");
  expect(await getBalance(f.sql, id, "reward", "ZEC")).toBe(1_000n);
  expect(await getBalance(f.sql, id, "basket", NATIVE_MINT)).toBe(500n);
});
