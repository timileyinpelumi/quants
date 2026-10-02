import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { shareDescription, tokenShare } from "../../src/web/server/token-share";
import { shareText, telegramShare, xIntent } from "../../src/web/token/share";

const NOW = Date.parse("2026-10-01T12:00:00Z");

test("a shared token previews its symbol, name and market", async () => {
  const sql = await freshDb();
  const [l] = await sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, name)
    values ('mint-CAT', 'pool', 'So11111111111111111111111111111111111111112', 200, 'c', 'cr', 'live', 1, 'CAT', 'Cat coin') returning id`;
  const bare = (await tokenShare(sql, "mint-CAT", NOW))!;
  expect(bare).toEqual({ mint: "mint-CAT", symbol: "CAT", name: "Cat coin", tradingOnly: false, priceUsd: null, mcapUsd: null, change24h: null });
  expect(shareDescription(bare)).toBe("Cat coin (CAT) on quants. No trades yet. Trading fees pay its stakers.");
  await sql`insert into trades (signature, event_index, launch_id, venue, side, trader, base_amount, quote_amount, fee_amount, quote_value, price, quote_usd, block_time, slot)
    values ('a', 0, ${l.id}, 'curve', 'buy', 'w', 1, 1, 0, 1, 0.00001, 100, ${new Date(NOW - 30 * 3_600_000)}, 1),
           ('b', 0, ${l.id}, 'curve', 'buy', 'w', 1, 1, 0, 1, 0.00002, 100, ${new Date(NOW - 60_000)}, 2)`;
  const t = (await tokenShare(sql, "mint-CAT", NOW))!;
  expect(t.priceUsd).toBeCloseTo(0.002, 9);
  expect(shareDescription(t)).toBe("Cat coin (CAT) on quants. Price $0.002, market cap $2M, +100.0% in 24h. Trading fees pay its stakers.");
  expect(await tokenShare(sql, "nope", NOW)).toBeNull();
});

test("share links carry the line and the page URL", () => {
  const text = shareText("CAT", true);
  expect(text).toBe("CAT is trading on quants, where its trading fees pay its stakers.");
  expect(shareText("CAT", false)).toBe("CAT is trading on quants.");
  const x = new URL(xIntent(text, "https://quants.example/t/mint-CAT"));
  expect(x.origin + x.pathname).toBe("https://x.com/intent/post");
  expect(x.searchParams.get("text")).toBe(text);
  expect(x.searchParams.get("url")).toBe("https://quants.example/t/mint-CAT");
  const tg = new URL(telegramShare(text, "https://quants.example/t/mint-CAT"));
  expect(tg.origin + tg.pathname).toBe("https://t.me/share/url");
  expect(tg.searchParams.get("url")).toBe("https://quants.example/t/mint-CAT");
});
