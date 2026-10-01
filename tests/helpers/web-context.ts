import { Keypair } from "@solana/web3.js";
import { freshDb } from "./db";
import { FakeChain } from "./fake-chain";
import { FakeMeteora } from "./fake-meteora";
import { FakeStaking } from "./fake-staking";
import { FakeJupiter } from "./fake-jupiter";
import { setContextForTests, type WebContext } from "../../src/web/server/context";
import { resetRateLimits } from "../../src/web/server/http";
import type { PinataPort } from "../../src/web/server/pinata";
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
    pinata: new FakePinata(),
    trade: new FakeTrade(),
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
