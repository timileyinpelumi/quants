import { test, expect } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { freshDb } from "../helpers/db";
import { FakeChain } from "../helpers/fake-chain";
import { FakeMeteora } from "../helpers/fake-meteora";
import { prepareLaunch } from "../../src/launch/prepare";
import { confirmLaunch } from "../../src/launch/confirm";
import { NATIVE_MINT } from "../../src/domain/types";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { launchCost } from "../../src/domain/launch-cost";
import { staticConfigs } from "../../src/launch/config-keys";

const OURS = "OURS1111111111111111111111111111111111111111";
const CREATOR = Keypair.generate().publicKey.toBase58();
const SPILL = Keypair.generate().publicKey;
const conn = (ok: boolean) => ({
  getSignatureStatuses: async () => ({ value: [ok ? { err: null, confirmationStatus: "confirmed" } : null] }),
}) as any;

async function prepared(opts: { onChainCreator?: string; onChainConfig?: string } = {}) {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "t");
  const meteora = new FakeMeteora(new FakeChain());
  const configKeys = { [`${NATIVE_MINT}:200`]: "CfgSol200" };
  const p = await prepareLaunch(
    { sql, meteora, configFor: staticConfigs(configKeys), quoteMints: [NATIVE_MINT, OURS], isVerified: async () => true, tokenProgramOf: async () => "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", creator: CREATOR, quoteMint: NATIVE_MINT, feeTierBps: 200,
      basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10_000 }] },
  );
  meteora.pools.set(p.pool, { baseMint: p.mint, config: opts.onChainConfig ?? "CfgSol200", creator: opts.onChainCreator ?? CREATOR });
  return { sql, meteora, p };
}

test("records launch, basket and a pending stake pool from what prepare stored", async () => {
  const { sql, meteora, p } = await prepared();
  const id = await confirmLaunch({ sql, conn: conn(true), meteora, spillWallet: SPILL }, { signature: "sig", mint: p.mint });
  const [l] = await sql`select * from launches where id = ${id}`;
  expect([l.config_key, l.creator, l.pool]).toEqual(["CfgSol200", CREATOR, p.pool]);
  expect((await sql`select reward_mint from baskets where launch_id = ${id}`).map((r: any) => r.reward_mint)).toEqual(["Zec1111111111111111111111111111111111111111"]);
  const [sp] = await sql`select * from stake_pools where launch_id = ${id}`;
  expect(sp.status).toBe("pending");
  expect(sp.max_penalty_bps).toBe(3000);
  expect(sp.spill_account).toBe(getAssociatedTokenAddressSync(new (await import("@solana/web3.js")).PublicKey(p.mint), SPILL).toBase58());
  expect((await sql`select tier_id from stake_tiers where launch_id = ${id} order by lock_seconds`).map((r: any) => r.tier_id)).toEqual(["1d", "3d", "7d", "30d"]);
  expect(BigInt(sp.rent_lamports)).toBe(launchCost(defaultSettings(OURS), 1).rent);
  expect(BigInt(sp.basket_value_lamports)).toBe(0n);
});

test("a trading only launch is recorded without a basket or stake pool", async () => {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "t");
  const meteora = new FakeMeteora(new FakeChain());
  const STOCK = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
  const p = await prepareLaunch(
    { sql, meteora, configFor: staticConfigs({ [`${STOCK}:200`]: "CfgStock200" }), quoteMints: [STOCK], tradingOnlyMints: [STOCK], isVerified: async () => true, tokenProgramOf: async () => "" },
    { name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", creator: CREATOR, quoteMint: STOCK, feeTierBps: 200, basket: [] },
  );
  meteora.pools.set(p.pool, { baseMint: p.mint, config: "CfgStock200", creator: CREATOR });
  const id = await confirmLaunch({ sql, conn: conn(true), meteora, spillWallet: SPILL }, { signature: "sig", mint: p.mint });
  const [l] = await sql`select trading_only, quote_mint from launches where id = ${id}`;
  expect(l).toEqual({ trading_only: true, quote_mint: STOCK });
  expect(await sql`select * from baskets where launch_id = ${id}`).toHaveLength(0);
  expect(await sql`select * from stake_pools where launch_id = ${id}`).toHaveLength(0);
  expect(await sql`select * from stake_tiers where launch_id = ${id}`).toHaveLength(0);
});

test("confirm is idempotent on mint", async () => {
  const { sql, meteora, p } = await prepared();
  const deps = { sql, conn: conn(true), meteora, spillWallet: SPILL };
  expect(await confirmLaunch(deps, { signature: "sig", mint: p.mint })).toBe(await confirmLaunch(deps, { signature: "sig", mint: p.mint }));
});

test("rejects a mint that was never prepared", async () => {
  const { sql, meteora } = await prepared();
  await expect(confirmLaunch({ sql, conn: conn(true), meteora, spillWallet: SPILL }, { signature: "sig", mint: Keypair.generate().publicKey.toBase58() }))
    .rejects.toMatchObject({ code: "not_found_on_chain" });
});

test("rejects when the transaction did not land", async () => {
  const { sql, meteora, p } = await prepared();
  await expect(confirmLaunch({ sql, conn: conn(false), meteora, spillWallet: SPILL }, { signature: "sig", mint: p.mint })).rejects.toMatchObject({ code: "not_found_on_chain" });
});

test("rejects when the on-chain pool's creator or config does not match what was prepared", async () => {
  for (const opts of [{ onChainCreator: Keypair.generate().publicKey.toBase58() }, { onChainConfig: "OtherCfg" }]) {
    const { sql, meteora, p } = await prepared(opts);
    await expect(confirmLaunch({ sql, conn: conn(true), meteora, spillWallet: SPILL }, { signature: "sig", mint: p.mint })).rejects.toMatchObject({ code: "pool_mismatch" });
  }
});
