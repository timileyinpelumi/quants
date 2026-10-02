import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { loadLaunches } from "../../src/keeper/launch-row";
import { processLaunch } from "../../src/keeper/run";
import { splitStep } from "../../src/keeper/steps/split";
import { getBalance } from "../../src/ledger/ledger";
import { runTxStep, MAX_ATTEMPTS } from "../../src/ledger/run-step";
import { splitFees } from "../../src/domain/weights";

const STOCK = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const pausedError = () => Object.assign(new Error("Simulation failed."), { logs: ["Program log: Transferring, minting, and burning is paused on this mint", "custom program error: 0x43"] });

test("trading only splits send the basket share to platform and creator pro rata", () => {
  expect(splitFees(1_000_000n, { basketBps: 6000, platformBps: 2500, creatorBps: 1500 }, true)).toEqual({ basket: 0n, platform: 625_000n, creator: 375_000n });
  expect(splitFees(1_001n, { basketBps: 6000, platformBps: 2500, creatorBps: 1500 }, true)).toEqual({ basket: 0n, platform: 625n, creator: 376n });
  expect(splitFees(100n, { basketBps: 10_000, platformBps: 0, creatorBps: 0 }, true)).toEqual({ basket: 0n, platform: 100n, creator: 0n });
});

test("a trading only launch claims, splits without a basket and pays out, with no staking steps", async () => {
  const { sql, chain, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "PS", quote_mint: STOCK, trading_only: true });
  meteora.partnerFee.set("PS", 1_000_000n);
  const [launch] = await loadLaunches(sql);
  expect(launch!.tradingOnly).toBe(true);
  await processLaunch(deps, launch!, settings, "r1");
  expect(await getBalance(sql, id, "basket", STOCK)).toBe(0n);
  expect(await getBalance(sql, id, "treasury", STOCK)).toBe(0n);
  const kinds = (await sql`select kind from distributions where launch_id = ${id} and status = 'confirmed' order by id`).map((r: any) => r.kind);
  expect(kinds).toEqual(["claim", "split", "payout", "payout"]);
  expect(await sql`select * from escrow where launch_id = ${id} and bucket = 'basket'`).toHaveLength(0);
  expect(chain.sent.filter((s) => s.startsWith("transfer"))).toHaveLength(2);
});

test("a paused stock skips migrate, claim and payout without recording failures, then resumes", async () => {
  const { sql, chain, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "PP", quote_mint: STOCK, trading_only: true });
  meteora.partnerFee.set("PP", 1_000_000n);
  meteora.curve.set("PP", { migrated: false, complete: true });
  chain.paused.add(STOCK);
  const [launch] = await loadLaunches(sql);
  for (const run of ["r1", "r2", "r3"]) await processLaunch(deps, launch!, settings, run);
  expect(await sql`select * from distributions where launch_id = ${id}`).toHaveLength(0);
  expect(chain.sent).toHaveLength(0);

  chain.paused.delete(STOCK);
  await processLaunch(deps, launch!, settings, "r4");
  const kinds = (await sql`select kind from distributions where launch_id = ${id} and status = 'confirmed' order by id`).map((r: any) => r.kind);
  expect(kinds).toEqual(["migrate", "claim", "split", "payout", "payout"]);
});

test("a paused error while building or sending does not count toward the retry cap", async () => {
  const { sql, chain, deps } = await keeperFixture();
  const id = await insertLaunch(sql, { quote_mint: STOCK, trading_only: true });
  const spec = (run: string, build: () => Promise<any>) => ({
    launchId: id, idemKey: `migrate:${id}`, stepKey: `migrate:${id}`, kind: "migrate" as const, settingsVersion: 1, detail: { run },
    build, resolve: async () => [],
  });
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    expect(await runTxStep(sql, chain, spec(`b${i}`, async () => { throw pausedError(); }))).toBe("pending");
  }
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    const t = chain.tx("migrate");
    expect(await runTxStep(sql, chain, spec(`s${i}`, async () => ({ ...t, send: async () => { throw pausedError(); } })))).toBe("pending");
  }
  const [row] = await sql`select status, attempts, error from distributions where idem_key = ${`migrate:${id}`}`;
  expect(row).toEqual({ status: "failed", attempts: 0, error: "mint paused" });
  expect(await runTxStep(sql, chain, spec("ok", async () => chain.tx("migrate")))).toBe("confirmed");
});

test("split of a trading only launch ignores a basket split setting of 100%", async () => {
  const { sql, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "PB", quote_mint: STOCK, trading_only: true });
  meteora.partnerFee.set("PB", 1_000n);
  const [launch] = await loadLaunches(sql);
  await sql`insert into escrow (launch_id, bucket, mint, amount) values (${id}, 'unsplit', ${STOCK}, 1000)`;
  await splitStep(deps, launch!, { ...settings, split: { basketBps: 10_000, platformBps: 0, creatorBps: 0 } }, "r1");
  expect(await getBalance(sql, id, "treasury", STOCK)).toBe(1_000n);
  expect(await getBalance(sql, id, "basket", STOCK)).toBe(0n);
});
