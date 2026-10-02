import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { FakeChain } from "../helpers/fake-chain";
import { FakeMeteora } from "../helpers/fake-meteora";
import { markConfigLive, resolveConfig, seedConfigKeys, thresholdOf } from "../../src/launch/config-keys";
import { prepareLaunch, launchOnly } from "../../src/launch/prepare";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

const KEEPER = "Keeper1111111111111111111111111111111111111";
const SOL = { mint: NATIVE_MINT, decimals: 9, graduation: 85, tradingOnly: false };

async function setup() {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings("OURS1111111111111111111111111111111111111111"), "t");
  const meteora = new FakeMeteora(new FakeChain());
  return { sql, meteora, deps: { sql, meteora, keeper: KEEPER } };
}

test("thresholds are exact base units", () => {
  expect(thresholdOf(85, 9)).toBe(85_000_000_000n);
  expect(thresholdOf(12_000, 6)).toBe(12_000_000_000n);
  expect(thresholdOf(0.5, 6)).toBe(500_000n);
});

test("the first launch on a pair claims one config address and every launch until it lands gets the same one", async () => {
  const { sql, deps } = await setup();
  const [a, b] = await Promise.all([resolveConfig(deps, SOL, 200), resolveConfig(deps, SOL, 200)]);
  expect(a!.create).toBeDefined();
  expect(a!.configKey).toBe(b!.configKey);
  expect(a!.create!.config.publicKey.toBase58()).toBe(a!.configKey);
  expect(a!.create!.quote).toEqual({ mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 });
  expect(a!.create!.keeper).toBe(KEEPER);
  const rows = await sql`select status, threshold::text as t from config_keys`;
  expect(rows.map((r: any) => [r.status, r.t])).toEqual([["pending", "85000000000"]]);
  const other = await resolveConfig(deps, SOL, 300);
  expect(other!.configKey).not.toBe(a!.configKey);
});

test("a pending config seen on chain with our parameters becomes live and drops its secret", async () => {
  const { sql, meteora, deps } = await setup();
  const first = await resolveConfig(deps, SOL, 200);
  meteora.configs.set(first!.configKey, { feeClaimer: KEEPER, quoteMint: NATIVE_MINT, threshold: 85_000_000_000n });
  const again = await resolveConfig(deps, SOL, 200);
  expect(again).toEqual({ configKey: first!.configKey });
  const [row] = await sql`select status, secret from config_keys`;
  expect(row).toEqual({ status: "live", secret: null });
});

test("a pending address that exists on chain with other parameters is dropped for a new one", async () => {
  const { meteora, deps } = await setup();
  const first = await resolveConfig(deps, SOL, 200);
  meteora.configs.set(first!.configKey, { feeClaimer: "Someone111111111111111111111111111111111111", quoteMint: NATIVE_MINT, threshold: 85_000_000_000n });
  const next = await resolveConfig(deps, SOL, 200);
  expect(next!.configKey).not.toBe(first!.configKey);
  expect(next!.create).toBeDefined();
});

test("a pending config not on chain and not handed out for 2 minutes is dropped for a fresh keypair; a recent one is reused", async () => {
  const { sql, meteora, deps } = await setup();
  const first = await resolveConfig(deps, SOL, 200);
  await sql`update config_keys set issued_at = now() - interval '90 seconds'`;
  expect((await resolveConfig(deps, SOL, 200))!.configKey).toBe(first!.configKey);
  await sql`update config_keys set issued_at = now() - interval '3 minutes'`;
  const next = await resolveConfig(deps, SOL, 200);
  expect(next!.configKey).not.toBe(first!.configKey);
  expect(next!.create).toBeDefined();
  expect((await sql`select address from config_keys`).map((r: any) => r.address)).toEqual([next!.configKey]);
  // a stale row whose transaction did land is kept and goes live
  await sql`update config_keys set issued_at = now() - interval '3 minutes'`;
  meteora.configs.set(next!.configKey, { feeClaimer: KEEPER, quoteMint: NATIVE_MINT, threshold: 85_000_000_000n });
  expect(await resolveConfig(deps, SOL, 200)).toEqual({ configKey: next!.configKey });
});

test("a new graduation target gets its own config key; the old one stays for its pools", async () => {
  const { sql, deps } = await setup();
  const a = await resolveConfig(deps, SOL, 200);
  await markConfigLive(sql, a!.configKey);
  expect(await resolveConfig(deps, SOL, 200)).toEqual({ configKey: a!.configKey });
  const b = await resolveConfig(deps, { ...SOL, graduation: 100 }, 200);
  expect(b!.configKey).not.toBe(a!.configKey);
  expect(b!.create!.quote.migrationQuoteThreshold).toBe(100);
});

test("config keys from the env are recorded with their on-chain threshold and reused", async () => {
  const { sql, meteora, deps } = await setup();
  meteora.thresholds.set("CfgSol200", 85_000_000_000n);
  const STOCK = "Stock111111111111111111111111111111111111111";
  meteora.thresholds.set("CfgStock200", 5_000_000_000n);
  expect(await seedConfigKeys(sql, meteora, { [`${NATIVE_MINT}:200`]: "CfgSol200", [`${STOCK}:200`]: "CfgStock200" })).toBe(2);
  expect(await seedConfigKeys(sql, meteora, { [`${NATIVE_MINT}:200`]: "CfgSol200" })).toBe(0);
  expect(await resolveConfig(deps, SOL, 200)).toEqual({ configKey: "CfgSol200" });
  expect(await resolveConfig(deps, { mint: STOCK, decimals: 8, graduation: 50, tradingOnly: true }, 200)).toEqual({ configKey: "CfgStock200" });
  expect(await resolveConfig(deps, { mint: STOCK, decimals: 8, graduation: 50, tradingOnly: true }, 300)).toBeNull();
});

test("a launch on a pair with no config key yet returns the config step alone; once it is on chain the next call returns the launch", async () => {
  const { sql, meteora, deps } = await setup();
  const prepDeps = {
    sql, meteora, quoteMints: [NATIVE_MINT], configFor: (q: string, f: number) => resolveConfig(deps, { ...SOL, mint: q }, f),
    isVerified: async () => true, tokenProgramOf: async () => "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  };
  const input = {
    name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", creator: "Creator111111111111111111111111111111111111",
    quoteMint: NATIVE_MINT, feeTierBps: 200, devBuyQuoteAmount: "1000", basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }],
  };
  const first = await prepareLaunch(prepDeps, input);
  expect(first.step).toBe("config");
  if (first.step !== "config") return;
  expect(meteora.firstBuyQuotes[0]!.configKey).toBe("new:200");
  expect(meteora.launches).toEqual([]);
  expect(meteora.configTxs[0]!.create.config.publicKey.toBase58()).toBe(first.configKey);
  expect((await sql`select mint from prepared_launches`).length).toBe(0);
  // asking again before it lands builds the same config key, never a second one
  const again = await prepareLaunch(prepDeps, input);
  expect(again).toMatchObject({ step: "config", configKey: first.configKey });

  meteora.configs.set(first.configKey, { feeClaimer: KEEPER, quoteMint: NATIVE_MINT, threshold: 85_000_000_000n });
  const launch = launchOnly(await prepareLaunch(prepDeps, input));
  expect(meteora.launches[0]!.configKey).toBe(first.configKey);
  const [p] = await sql`select config_key from prepared_launches where mint = ${launch.mint}`;
  expect(p.config_key).toBe(first.configKey);
  const [row] = await sql`select status from config_keys where address = ${first.configKey}`;
  expect(row.status).toBe("live");
});
