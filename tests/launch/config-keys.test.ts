import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { FakeChain } from "../helpers/fake-chain";
import { FakeMeteora } from "../helpers/fake-meteora";
import { markConfigLive, resolveConfig, seedConfigKeys, thresholdOf } from "../../src/launch/config-keys";
import { prepareLaunch } from "../../src/launch/prepare";
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

test("prepare with a config to create quotes the first buy from its parameters and returns the setup transaction", async () => {
  const { sql, meteora, deps } = await setup();
  const r = await prepareLaunch({
    sql, meteora, quoteMints: [NATIVE_MINT], configFor: (q, f) => resolveConfig(deps, { ...SOL, mint: q }, f),
    isVerified: async () => true, tokenProgramOf: async () => "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  }, {
    name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", creator: "Creator111111111111111111111111111111111111",
    quoteMint: NATIVE_MINT, feeTierBps: 200, devBuyQuoteAmount: "1000", basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }],
  });
  expect(typeof r.setupTransaction).toBe("string");
  expect(meteora.firstBuyQuotes[0]!.configKey).toBe("new:200");
  const [p] = await sql`select config_key from prepared_launches`;
  expect(p.config_key).toBe(meteora.launches[0]!.configKey);
});
