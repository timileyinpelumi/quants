import { test, expect, beforeEach } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { GET } from "../../src/app/api/launch/first-buy/route";
import { resetFirstBuyCache } from "../../src/web/server/first-buy";
import { buildQuantsConfig } from "../../src/meteora/config";
import { curveOfParams, firstBuyOut } from "../../src/meteora/first-buy";
import { NATIVE_MINT } from "../../src/domain/types";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const get = (q: string) => GET(new Request(`http://x/api/launch/first-buy?${q}`));
const sol85 = (fee: number, amount: bigint) => firstBuyOut(curveOfParams(buildQuantsConfig(fee, { mint: NATIVE_MINT, decimals: 9, migrationQuoteThreshold: 85 })), amount);

beforeEach(() => resetFirstBuyCache());

test("a SOL first buy is estimated on the curve of the config key the launch would use", async () => {
  const c = await makeWebContext();
  await c.sql`insert into config_keys (quote_mint, fee_bps, threshold, address, status) values (${NATIVE_MINT}, 200, ${(85n * 10n ** 9n).toString()}::numeric, 'CfgSol200', 'live')`;
  const r = await get(`quoteMint=${NATIVE_MINT}&fee=200&sol=1000000000`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j).toEqual({ tokens: sol85(200, 1_000_000_000n)!.toString(), quoteAmount: "1000000000", overCap: false });
  expect((c.meteora as any).curveCalls).toEqual(["CfgSol200"]);
});

test("without a config key yet the estimate uses the curve the setup step would create", async () => {
  const c = await makeWebContext();
  const j = await (await get(`quoteMint=${NATIVE_MINT}&fee=300&sol=500000000`)).json();
  expect(j.tokens).toBe(sol85(300, 500_000_000n)!.toString());
  expect((c.meteora as any).curveCalls[0]).toMatchObject({ feeBps: 300, quote: { mint: NATIVE_MINT, migrationQuoteThreshold: 85 } });
});

test("a USDC first buy goes through the Jupiter quote at the slippage floor first", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(USDC, 0.15);
  const j = await (await get(`quoteMint=${USDC}&fee=200&sol=1000000000`)).json();
  // 1 SOL is 150 USDC at this rate, less the 1% slippage cap
  expect(j.quoteAmount).toBe("148500000");
  const want = firstBuyOut(curveOfParams(buildQuantsConfig(200, { mint: USDC, decimals: 6, migrationQuoteThreshold: 12_000 })), 148_500_000n);
  expect(j.tokens).toBe(want!.toString());
  expect(j.overCap).toBe(false);
});

test("no Jupiter route gives no estimate instead of an error", async () => {
  await makeWebContext();
  const r = await get(`quoteMint=${USDC}&fee=200&sol=1000000000`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ tokens: null, quoteAmount: null, overCap: false });
});

test("a first buy past the cap is flagged, and bad input is refused", async () => {
  await makeWebContext();
  expect((await (await get(`quoteMint=${NATIVE_MINT}&fee=200&sol=80000000000`)).json()).overCap).toBe(true);
  expect((await (await get(`quoteMint=${NATIVE_MINT}&fee=200&sol=0`)).json()).tokens).toBe("0");
  expect((await get(`quoteMint=${NATIVE_MINT}&fee=150&sol=1`)).status).toBe(400);
  expect((await get(`quoteMint=Bad1111111111111111111111111111111111111111&fee=200&sol=1`)).status).toBe(400);
  expect((await get(`quoteMint=${NATIVE_MINT}&fee=200&sol=-1`)).status).toBe(400);
});
