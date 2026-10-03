import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { TickerPicker } from "../../src/web/server/ticker";

async function trade(sql: any, launchId: number, slot: number, trader: string, side = "buy") {
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, block_time, slot)
    values (${`sig${slot}${trader}`}, 0, ${launchId}, 'curve', ${side}, ${trader}, 1000000, 1, 0, 1, 1, now(), ${slot})`;
}

test("with nothing new it takes one trade per token in turn, then trades not seen yet come first, oldest first", async () => {
  const sql = await freshDb();
  const a = await insertLaunch(sql, { mint: "AAA", pool: "PA" });
  const b = await insertLaunch(sql, { mint: "BBB", pool: "PB" });
  await trade(sql, a, 1, "a1"); await trade(sql, a, 2, "a2"); await trade(sql, a, 3, "a3"); await trade(sql, b, 4, "b1");
  const p = new TickerPicker(sql);
  const first = [await p.next(), await p.next(), await p.next(), await p.next()].map((r) => r!.mint);
  expect(first[0]).not.toBe(first[1]);
  expect(first[1]).not.toBe(first[2]);
  await trade(sql, b, 5, "new1"); await trade(sql, a, 6, "new2");
  expect((await p.next())!.trader).toBe("new1");
  expect((await p.next())!.trader).toBe("new2");
});
