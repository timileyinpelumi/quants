import { test, expect } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { insertLaunch } from "../helpers/fixtures";
import { JupiterPrices } from "../../src/indexer/prices";
import { GET } from "../../src/app/api/prices/route";

test("prices launched tokens from their last trade and everything else from Jupiter", async () => {
  const c = await makeWebContext();
  const asked: string[] = [];
  c.prices = new JupiterPrices("https://p", undefined, async (u) => { asked.push(String(u)); return Response.json({ So11111111111111111111111111111111111111112: { usdPrice: 150 } }); });
  const id = await insertLaunch(c.sql, { mint: "CATmint" });
  await c.sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values ('s', 0, ${id}, 'curve', 'buy', 'w', 1, 1, 0, 1, 0.000002, 150, now(), 1)`;
  const r = await (await GET(new Request("http://x/api/prices?mints=CATmint,So11111111111111111111111111111111111111112,Nope"))).json();
  expect(r.prices.CATmint).toBeCloseTo(0.0003, 9);
  expect(r.prices.So11111111111111111111111111111111111111112).toBe(150);
  expect(r.prices.Nope).toBeNull();
  expect(asked[0]).not.toContain("CATmint");
});

test("asks for at most 100 mints", async () => {
  await makeWebContext();
  const many = Array.from({ length: 101 }, (_, i) => `M${i}`).join(",");
  expect((await GET(new Request(`http://x/api/prices?mints=${many}`))).status).toBe(400);
});
