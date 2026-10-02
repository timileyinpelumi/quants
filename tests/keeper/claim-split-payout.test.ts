import { test, expect } from "bun:test";
import { keeperFixture } from "../helpers/keeper-deps";
import { insertLaunch } from "../helpers/fixtures";
import { loadLaunches } from "../../src/keeper/launch-row";
import { claimStep } from "../../src/keeper/steps/claim";
import { splitStep } from "../../src/keeper/steps/split";
import { payoutStep } from "../../src/keeper/steps/payout";
import { getBalance } from "../../src/ledger/ledger";
import { saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

test("claim credits the exact pending partner fee, then split moves it by the settings", async () => {
  const { sql, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P1" });
  meteora.partnerFee.set("P1", 1_000_000n);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  expect(await claimStep(deps, launch!, settings, "r1")).toBe("confirmed");
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(1_000_000n);
  expect(await splitStep(deps, launch!, settings, "r1")).toBe(true);
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(sql, id, "basket", NATIVE_MINT)).toBe(600_000n);
  expect(await getBalance(sql, id, "treasury", NATIVE_MINT)).toBe(150_000n);
  expect(await getBalance(sql, id, "creator", NATIVE_MINT)).toBe(250_000n);
});

test("claim is skipped when nothing is pending", async () => {
  const { sql, deps, settings } = await keeperFixture();
  await insertLaunch(sql, { pool: "P2" });
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  expect(await claimStep(deps, launch!, settings, "r1")).toBe("skipped");
});

test("split uses the settings version passed in, even if a newer one is saved mid-run", async () => {
  const { sql, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P3" });
  meteora.partnerFee.set("P3", 1_000n);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  await claimStep(deps, launch!, settings, "r1");
  await saveSettings(sql, { ...settings, split: { basketBps: 10_000, platformBps: 0, creatorBps: 0 } }, "admin");
  await splitStep(deps, launch!, settings, "r1");
  expect(await getBalance(sql, id, "basket", NATIVE_MINT)).toBe(600n);
  const [d] = await sql`select settings_version from distributions where kind = 'split'`;
  expect(d.settings_version).toBe(settings.version);
});

test("payout sends treasury every run and creator only above the minimum", async () => {
  const { sql, chain, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P4" });
  meteora.partnerFee.set("P4", 100_000_000n);
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  await claimStep(deps, launch!, settings, "r1");
  await splitStep(deps, launch!, settings, "r1");
  await payoutStep(deps, launch!, settings, "r1");
  expect(await getBalance(sql, id, "treasury", NATIVE_MINT)).toBe(0n);
  expect(await getBalance(sql, id, "creator", NATIVE_MINT)).toBe(25_000_000n);
  expect(chain.sent.filter((s) => s.startsWith("transfer")).length).toBe(1);

  meteora.partnerFee.set("P4", 300_000_000n);
  await claimStep(deps, launch!, settings, "r2");
  await splitStep(deps, launch!, settings, "r2");
  await payoutStep(deps, launch!, settings, "r2");
  expect(await getBalance(sql, id, "creator", NATIVE_MINT)).toBe(0n);
});

test("graduated launches claim from the DAMM position and credit the measured amount", async () => {
  const { sql, chain, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P5", status: "graduated" });
  await sql`update launches set damm_pool = 'D5', damm_position = 'Pos5', damm_position_nft_account = 'Nft5' where id = ${id}`;
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  const orig = chain.tx.bind(chain);
  chain.tx = (label) => { const t = orig(label); chain.receipts.set(t.signature, 777n); return t; };
  expect(await claimStep(deps, launch!, settings, "r1")).toBe("confirmed");
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(777n);
});

test("a graduated launch still claims partner fee left on the bonding curve", async () => {
  const { sql, chain, meteora, deps, settings } = await keeperFixture();
  const id = await insertLaunch(sql, { pool: "P6", status: "graduated" });
  await sql`update launches set damm_pool = 'D6', damm_position = 'Pos6', damm_position_nft_account = 'Nft6' where id = ${id}`;
  meteora.partnerFee.set("P6", 500n);
  const orig = chain.tx.bind(chain);
  chain.tx = (label) => { const t = orig(label); if (label?.startsWith("claimpos")) chain.receipts.set(t.signature, 100n); return t; };
  const [launch] = await loadLaunches(sql, deps.ourtokenMint);
  await claimStep(deps, launch!, settings, "r1");
  expect(await getBalance(sql, id, "unsplit", NATIVE_MINT)).toBe(600n);
});
