import { freshDb } from "./db";
import { FakeChain } from "./fake-chain";
import { FakeMeteora } from "./fake-meteora";
import { defaultSettings, saveSettings, loadLatestSettings } from "../../src/domain/settings";
import type { KeeperDeps } from "../../src/keeper/deps";

export const OURS = "OURS1111111111111111111111111111111111111111";
export const WALLETS = { keeper: "Keeper", spill: "Spill", treasury: "Treasury" };

export async function keeperFixture(extra: Partial<KeeperDeps> = {}) {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "t");
  const chain = new FakeChain();
  const meteora = new FakeMeteora(chain);
  const deps = { sql, chain, meteora, wallets: WALLETS, ourtokenMint: OURS, ...extra } as KeeperDeps;
  return { sql, chain, meteora, deps, settings: await loadLatestSettings(sql) };
}
