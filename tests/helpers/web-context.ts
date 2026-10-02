import { Keypair } from "@solana/web3.js";
import { freshDb } from "./db";
import { FakeChain } from "./fake-chain";
import { FakeMeteora } from "./fake-meteora";
import { FakeStaking } from "./fake-staking";
import { FakeJupiter } from "./fake-jupiter";
import { setContextForTests, type WebContext } from "../../src/web/server/context";
import { TokenIcons } from "../../src/web/server/icons";
import { JupiterPrices } from "../../src/indexer/prices";
import { resetRateLimits } from "../../src/web/server/http";
import { resetStakeCache } from "../../src/web/server/stake";
import type { UploadPort } from "../../src/web/server/uploads";
import { defaultSettings, saveSettings } from "../../src/domain/settings";
import { NATIVE_MINT } from "../../src/domain/types";
import { decodeCodeHash, hashCode } from "../../src/admin-code";

export const OURS = "OURS1111111111111111111111111111111111111111";
export const ADMIN_CODE = "X7232DDUWJDB369DGWUDHKMN";
const ADMIN_HASH = decodeCodeHash(await hashCode(ADMIN_CODE));
export const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export class FakeUploads implements UploadPort {
  files: string[] = [];
  json: any[] = [];
  private n = 0;
  async uploadImage(_f: File, name: string) { this.files.push(name); return `https://res.cloudinary.com/demo/image/upload/quants/u${++this.n}`; }
  async uploadJson(data: object) { this.json.push(data); return `https://res.cloudinary.com/demo/raw/upload/quants/u${++this.n}.json`; }
}

export class FakeTrade {
  calls: any[] = [];
  built: any[] = [];
  fail: string | null = null;
  async quote(target: any, side: any, amountIn: bigint, slippageBps: number) {
    this.calls.push({ target, side, amountIn, slippageBps });
    if (this.fail) throw new Error(this.fail);
    return { amountIn, filledIn: amountIn, amountOut: 1000n, minOut: 990n, fee: 20n, venue: target.dammPool ? "damm" as const : "curve" as const };
  }
  async buildSwapTx(target: any, side: any, amountIn: bigint, minOut: bigint, owner: string) { if (this.fail) throw new Error(this.fail); this.built.push({ target, side, amountIn, minOut, owner }); return "c3dhcA=="; }
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
    uploads: new FakeUploads(),
    trade: new FakeTrade(),
    prices: new JupiterPrices("https://prices.test", undefined, async () => Response.json({})),
    icons: new TokenIcons("https://jup.test/tokens/v2", undefined, async () => Response.json([])),
    configKeys: { [`${NATIVE_MINT}:200`]: "CfgSol200", [`${OURS}:200`]: "CfgOurs200" },
    keeperAddress: "Keeper1111111111111111111111111111111111111",
    spillWallet: Keypair.generate().publicKey,
    ourtokenMint: OURS,
    adminCodeHash: ADMIN_HASH,
    platformAddresses: {},
    sessionSecret: crypto.getRandomValues(new Uint8Array(32)),
    tokenProgramOf: async () => CLASSIC,
    stocks: { list: async () => [], icons: async () => ({}) },
    ...over,
  };
  setContextForTests(ctx);
  resetRateLimits();
  resetStakeCache();
  return Object.assign(ctx, { fakeChain: chain });
}
