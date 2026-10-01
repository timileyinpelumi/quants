import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { rewardsOverview } from "../../src/web/server/rewards";
import { defaultSettings, saveSettings } from "../../src/domain/settings";

test("totals, ranks tokens by what they set aside for stakers, and lists recent reward payments", async () => {
  const sql = await freshDb();
  const v = await saveSettings(sql, defaultSettings("OURS"), "t");
  const a = await insertLaunch(sql, { mint: "AAA" });
  const b = await insertLaunch(sql, { mint: "BBB" });
  await sql`update launches set symbol = case mint when 'AAA' then 'AAA' else 'BBB' end`;
  await sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals) values (${a}, 'zec', 10000, 'ZEC', 8), (${b}, 'jup', 10000, 'JUP', 6)`;
  for (const [id, n] of [[a, 1], [b, 2]] as const) {
    await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
      values (${`t${n}`}, 0, ${id}, 'curve', 'buy', 'w', 1, 1000000000, 0, 1, 0.001, 100, now(), ${n})`;
  }
  const split = (id: number, key: string, amount: string) => sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail, settings_version)
    values (${id}, ${key}, ${key}, 'split', 'confirmed', ${JSON.stringify({ amount })}::text::jsonb, ${v})`;
  await split(a, "s1", "100000000");
  await split(b, "s2", "1000000000");
  await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, signature, detail, settings_version) values
    (${b}, 'f1', 'f1', 'fund', 'confirmed', 'sigF1', ${JSON.stringify({ farm: "F", rewardMint: "jup", amount: "2500000" })}::text::jsonb, ${v}),
    (${b}, 'f2', 'f2', 'fund', 'failed', null, ${JSON.stringify({ farm: "F", rewardMint: "jup", amount: "9" })}::text::jsonb, ${v}),
    (${a}, 'b1', 'b1', 'burn', 'confirmed', 'sigB1', ${JSON.stringify({ mint: "AAA", amount: "5" })}::text::jsonb, ${v})`;
  const r = await rewardsOverview(sql);
  expect(Math.round(r.stats.setAsideUsd)).toBe(66);
  expect(r.stats).toMatchObject({ payments: 1, payingTokens: 1, burns: 1 });
  expect(r.top.map((t) => [t.symbol, Math.round(t.setAsideUsd), t.payments])).toEqual([["BBB", 60, 1], ["AAA", 6, 0]]);
  expect(r.recent).toHaveLength(1);
  expect(r.recent[0]).toMatchObject({ symbol: "BBB", reward: "JUP", amount: 2.5, signature: "sigF1" });
  expect(r.topNext).toBeNull();
  expect(r.recentNext).toBeNull();
});

test("staker tokens and reward payments page through routes", async () => {
  const { makeWebContext } = await import("../helpers/web-context");
  const tokensRoute = (await import("../../src/app/api/rewards/tokens/route")).GET;
  const paymentsRoute = (await import("../../src/app/api/rewards/payments/route")).GET;
  const { sql } = await makeWebContext();
  const [{ version: v }] = await sql`select max(version) as version from settings`;
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    const id = await insertLaunch(sql, { mint: `M${i}` });
    ids.push(id);
    await sql`update launches set symbol = ${`S${i}`} where id = ${id}`;
    await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
      values (${`t${i}`}, 0, ${id}, 'curve', 'buy', 'w', 1, 1000000000, 0, 1, 0.001, 100, now(), ${i})`;
    await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail, settings_version)
      values (${id}, ${`s${i}`}, ${`s${i}`}, 'split', 'confirmed', ${JSON.stringify({ amount: String((i + 1) * 100000000) })}::text::jsonb, ${v})`;
    for (let k = 0; k < 2; k++) await sql`insert into distributions (launch_id, idem_key, step_key, kind, status, signature, detail, settings_version, updated_at)
      values (${id}, ${`f${i}${k}`}, ${`f${i}${k}`}, 'fund', 'confirmed', ${`sig${i}${k}`}, ${JSON.stringify({ farm: "F", rewardMint: "jup", amount: "1" })}::text::jsonb, ${v}, now() - ${`${i} minutes`}::interval)`;
  }
  const tok = async (qs: string) => (await tokensRoute(new Request(`http://x?${qs}`))).json();
  const t1 = await tok("limit=2");
  const t2 = await tok(`limit=2&offset=${t1.nextOffset}`);
  const t3 = await tok(`limit=2&offset=${t2.nextOffset}`);
  expect([...t1.tokens, ...t2.tokens, ...t3.tokens].map((t: any) => t.symbol)).toEqual(["S4", "S3", "S2", "S1", "S0"]);
  expect(t3.nextOffset).toBeNull();
  const pay = async (qs: string) => (await paymentsRoute(new Request(`http://x?${qs}`))).json();
  const seen: string[] = [];
  let next: string | null = "";
  while (next !== null) {
    const p: any = await pay(`limit=3${next ? `&before=${next}` : ""}`);
    seen.push(...p.payments.map((x: any) => x.signature));
    next = p.next;
  }
  expect(seen).toHaveLength(10);
  expect(new Set(seen).size).toBe(10);
  expect(seen.slice(0, 2).sort()).toEqual(["sig00", "sig01"]);
  expect((await paymentsRoute(new Request("http://x?before=abc"))).status).toBe(400);
  expect((await tokensRoute(new Request("http://x?limit=500"))).status).toBe(400);
  const first = await rewardsOverview(sql, 2);
  expect(first.top).toHaveLength(2);
  expect(first.topNext).toBe(2);
  expect(first.recent).toHaveLength(2);
  expect(first.recentNext).not.toBeNull();
});
