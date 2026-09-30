import { Keypair } from "@solana/web3.js";
import { freshDb } from "./db";
import { FakeChain } from "./fake-chain";
import { FakeMeteora } from "./fake-meteora";
import { FakeStaking } from "./fake-staking";
import { FakeJupiter } from "./fake-jupiter";
import { setContextForTests, type WebContext } from "../../src/web/server/context";
import { resetRateLimits } from "../../src/web/server/http";
import type { PinataPort } from "../../src/web/server/pinata";
import type { Candle, ChartSource, Market } from "../../src/web/server/chart";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";

export const OURS = "OURS1111111111111111111111111111111111111111";
export const ADMIN = Keypair.generate();
export const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export class FakePinata implements PinataPort {
  files: string[] = [];
  json: any[] = [];
  private n = 0;
  async uploadFile(_f: File, name: string) { this.files.push(name); return `cid-${++this.n}`; }
  async uploadJson(data: object) { this.json.push(data); return `cid-${++this.n}`; }
}

export class FakeChart implements ChartSource {
  fail = false;
  data: Candle[] = [{ time: 100, open: 1, high: 2, low: 0.5, close: 1.5 }];
  market_: Market = { priceUsd: 0.0004, fdvUsd: 410_000, change24h: 38.2 };
  async candles() { if (this.fail) return []; return this.data; }
  async market() { return this.fail ? null : this.market_; }
}

export async function makeWebContext(over: Partial<WebContext> = {}) {
  const sql = await freshDb();
  await saveSettings(sql, defaultSettings(OURS), "t");
  const chain = new FakeChain();
  const ctx: WebContext = {
    sql,
    conn: {} as any,
    meteora: new FakeMeteora(chain),
    staking: new FakeStaking(chain),
    jupiter: new FakeJupiter(chain),
    pinata: new FakePinata(),
    chart: new FakeChart(),
    configKeys: { [`${NATIVE_MINT}:200`]: "CfgSol200", [`${OURS}:200`]: "CfgOurs200" },
    keeperAddress: "Keeper1111111111111111111111111111111111111",
    spillWallet: Keypair.generate().publicKey,
    ourtokenMint: OURS,
    adminWallets: new Set([ADMIN.publicKey.toBase58()]),
    sessionSecret: crypto.getRandomValues(new Uint8Array(32)),
    tokenProgramOf: async () => CLASSIC,
    ...over,
  };
  setContextForTests(ctx);
  resetRateLimits();
  return Object.assign(ctx, { fakeChain: chain });
}
