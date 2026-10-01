import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { GET as quoteRoute } from "../../src/app/api/trade/quote/route";
import { POST as swapRoute } from "../../src/app/api/trade/swap/route";
import { NATIVE_MINT } from "../../src/domain/types";

const OWNER = "Staker11111111111111111111111111111111111111";

async function setup(status = "live", quote = NATIVE_MINT) {
  const c = await makeWebContext();
  await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, damm_pool)
    values ('CATmint', 'CATpool', ${quote}, 200, 'c', 'cr', ${status}, 1, ${status === "graduated" ? "DAMMpool" : null})`;
  return c;
}
const q = (qs: string) => quoteRoute(new Request(`http://x/api/trade/quote?${qs}`));
const swap = (b: object) => swapRoute(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

test("quotes a buy on the curve with SOL decimals", async () => {
  const c = await setup();
  const r = await (await q("mint=CATmint&side=buy&amount=1000000000&slippageBps=100")).json();
  expect(r).toMatchObject({ amountOut: "1000", venue: "curve" });
  expect((c as any).trade.calls[0]).toMatchObject({ side: "buy", amountIn: 1_000_000_000n, target: { pool: "CATpool", dammPool: null, quoteDecimals: 9, baseDecimals: 6 } });
});

test("graduated launches trade on the DAMM pool", async () => {
  const c = await setup("graduated", OURS);
  await q("mint=CATmint&side=sell&amount=5");
  expect((c as any).trade.calls[0].target).toMatchObject({ dammPool: "DAMMpool", quoteDecimals: 6 });
});

test("a curve that filled up and waits to move says so instead of failing", async () => {
  const c = await setup();
  (c as any).trade.fail = "graduating";
  const r = await q("mint=CATmint&side=buy&amount=5");
  expect(r.status).toBe(400);
  expect((await r.json()).error.message).toMatch(/filled its curve/);
  const OWNER_OK = "11111111111111111111111111111111";
  const s = await swap({ mint: "CATmint", side: "buy", amount: "5", minOut: "1", owner: OWNER_OK });
  expect(s.status).toBe(400);
  expect((await s.json()).error.message).toMatch(/filled its curve/);
});

test("rejects bad input with readable errors", async () => {
  await setup();
  expect((await q("mint=CATmint&side=hold&amount=5")).status).toBe(400);
  expect((await q("mint=CATmint&side=buy&amount=0")).status).toBe(400);
  expect((await q("mint=nope&side=buy&amount=5")).status).toBe(400);
  expect((await q("mint=CATmint&side=buy&amount=5&slippageBps=5000")).status).toBe(400);
  expect((await swap({ mint: "CATmint", side: "buy", amount: "5", minOut: "1", owner: "bad" })).status).toBe(400);
});

test("builds an unsigned swap for the owner", async () => {
  const c = await setup();
  const r = await (await swap({ mint: "CATmint", side: "buy", amount: "5", minOut: "4", owner: OWNER })).json();
  expect(r.transaction).toEqual({ base64: "c3dhcA==", versioned: false });
  expect((c as any).trade.built[0]).toMatchObject({ side: "buy", amountIn: 5n, minOut: 4n, owner: OWNER });
});
