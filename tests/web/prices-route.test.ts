import { test, expect } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { insertLaunch } from "../helpers/fixtures";
import { JupiterPrices } from "../../src/indexer/prices";
import { GET } from "../../src/app/api/prices/route";

const CAT = "CATm1nt111111111111111111111111111111111111";
const NOPE = "Nope1111111111111111111111111111111111111111";

test("prices launched tokens from their last trade and everything else from Jupiter", async () => {
  const c = await makeWebContext();
  const asked: string[] = [];
  c.prices = new JupiterPrices("https://p", undefined, async (u) => { asked.push(String(u)); return Response.json({ So11111111111111111111111111111111111111112: { usdPrice: 150 } }); });
  const id = await insertLaunch(c.sql, { mint: CAT });
  await c.sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values ('s', 0, ${id}, 'curve', 'buy', 'w', 1, 1, 0, 1, 0.000002, 150, now(), 1)`;
  const r = await (await GET(new Request(`http://x/api/prices?mints=${CAT},So11111111111111111111111111111111111111112,${NOPE}`))).json();
  expect(r.prices[CAT]).toBeCloseTo(0.0003, 9);
  expect(r.prices.So11111111111111111111111111111111111111112).toBe(150);
  expect(r.prices[NOPE]).toBeNull();
  expect(asked[0]).not.toContain(CAT);
});

test("asks for at most 100 mints", async () => {
  await makeWebContext();
  const many = Array.from({ length: 101 }, (_, i) => `M${i}`).join(",");
  expect((await GET(new Request(`http://x/api/prices?mints=${many}`))).status).toBe(400);
});

test("refuses mints that are not base58 addresses", async () => {
  await makeWebContext();
  const r = await GET(new Request(`http://x/api/prices?mints=${CAT},abc%26ids%3DX`));
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("invalid_input");
});

test("is rate limited", async () => {
  await makeWebContext();
  const codes = new Set<number>();
  for (let i = 0; i < 130; i++) codes.add((await GET(new Request(`http://x/api/prices?mints=${NOPE}`))).status);
  expect(codes.has(429)).toBe(true);
});
