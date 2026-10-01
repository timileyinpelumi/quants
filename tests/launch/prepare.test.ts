import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { FakeChain } from "../helpers/fake-chain";
import { FakeMeteora } from "../helpers/fake-meteora";
import { prepareLaunch, LaunchError } from "../../src/launch/prepare";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

const OURS = "OURS1111111111111111111111111111111111111111";
const configKeys = { [`${NATIVE_MINT}:200`]: "CfgSol200", [`${OURS}:200`]: "CfgOurs200" };
const valid = {
  name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", creator: "Creator111111111111111111111111111111111111",
  quoteMint: NATIVE_MINT, feeTierBps: 200,
  basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 5000 }, { mint: "Cate111111111111111111111111111111111111111", weightBps: 5000 }],
};

async function setup(verified = true, tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "test");
  const meteora = new FakeMeteora(new FakeChain());
  return { sql, meteora, deps: { sql, meteora, configKeys, quoteMints: [NATIVE_MINT, OURS], isVerified: async () => verified, tokenProgramOf: async () => tokenProgram } };
}

test("prepares a transaction against the right config key with no launch fee", async () => {
  const { deps, meteora } = await setup();
  const r = await prepareLaunch(deps, valid);
  expect(r.pool).toStartWith("pool-");
  expect(typeof r.transaction).toBe("string");
  expect(meteora.launches[0]!.configKey).toBe("CfgSol200");
  expect(Object.keys(meteora.launches[0]!).filter((k) => /fee/i.test(k))).toEqual([]);
});

test("rejects bad input", async () => {
  const { deps } = await setup();
  const bad = [
    { ...valid, name: "" },
    { ...valid, symbol: "TOOLONGSYMBOL" },
    { ...valid, feeTierBps: 250 },
    { ...valid, feeTierBps: 500 },
    { ...valid, quoteMint: "Other11111111111111111111111111111111111111" },
    { ...valid, basket: [] },
    { ...valid, basket: [...valid.basket, valid.basket[0], valid.basket[1]] },
    { ...valid, basket: [{ mint: valid.basket[0]!.mint, weightBps: 4000 }] },
    { ...valid, uri: "http://x.test/cat.json" },
  ];
  for (const b of bad) await expect(prepareLaunch(deps, b)).rejects.toBeInstanceOf(LaunchError);
});

test("rejects unverified basket tokens", async () => {
  const { deps } = await setup(false);
  await expect(prepareLaunch(deps, valid)).rejects.toMatchObject({ code: "basket_not_verified" });
});

test("rejects a dev buy over the cap", async () => {
  const { deps } = await setup();
  await expect(prepareLaunch(deps, { ...valid, devBuyQuoteAmount: "1", devBuyMinOut: (600_000_000n * 1_000_000n).toString() }))
    .rejects.toMatchObject({ code: "dev_buy_too_large" });
});

test("the first buy cap is checked against the curve quote, not the client's min out", async () => {
  const { deps, meteora } = await setup();
  const cap = (1_000_000_000n * 1_000_000n * BigInt(defaultSettings(OURS).devBuyCapBps)) / 10_000n;
  meteora.firstBuyOut = async (_cfg, amount) => amount * 1_000n;
  await expect(prepareLaunch(deps, { ...valid, devBuyQuoteAmount: (cap / 1_000n + 1n).toString(), devBuyMinOut: "0" }))
    .rejects.toMatchObject({ code: "dev_buy_too_large" });
  const ok = await prepareLaunch(deps, { ...valid, devBuyQuoteAmount: (cap / 1_000n).toString(), devBuyMinOut: "0" });
  expect(ok.mint).toBeDefined();
  expect(meteora.firstBuyQuotes.at(-1)).toEqual({ configKey: "CfgSol200", amount: cap / 1_000n });
});

test("rejects basket tokens that are not classic SPL tokens", async () => {
  const { deps } = await setup(true, "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  await expect(prepareLaunch(deps, valid)).rejects.toMatchObject({ code: "basket_unsupported" });
});
