import { test, expect, beforeEach } from "bun:test";
import { freshDb } from "../helpers/db";
import {
  daySalt, flushViews, isBot, isPrefetch, pathPattern, pendingViews, recordView, referrerHost, resetViews, viewOf, visitorHash,
} from "../../src/web/server/pageviews";
import { traffic, windowOf } from "../../src/web/server/analytics";

const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const D = 86_400_000;
const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://quants.wtf${path}`, { method, headers: { "user-agent": CHROME, host: "quants.wtf", ...headers } });

beforeEach(() => resetViews());

test("pages are counted by pattern; admin, api, files and unknown paths are not", () => {
  expect(pathPattern("/")).toBe("/");
  expect(pathPattern("/explore/")).toBe("/explore");
  expect(pathPattern(`/t/${MINT}`)).toBe("/t/[mint]");
  expect(pathPattern(`/t/${MINT}/stake`)).toBe("/t/[mint]/stake");
  for (const p of ["/admin", "/api/explore", `/t/${MINT}/opengraph-image`, "/wp-login.php", "/t/not-a-mint", "/icon.svg", "/_next/static/x.js"]) {
    expect(pathPattern(p)).toBeNull();
  }
});

test("bots, empty agents and prefetches are skipped", () => {
  expect(isBot(CHROME)).toBe(false);
  for (const ua of [null, "", "Googlebot/2.1 (+http://www.google.com/bot.html)", "curl/8.4.0", "python-requests/2.31", "TelegramBot (like TwitterBot)", "Mozilla/5.0 HeadlessChrome/120"]) {
    expect(isBot(ua)).toBe(true);
  }
  expect(isPrefetch(new Headers({ purpose: "prefetch" }))).toBe(true);
  expect(isPrefetch(new Headers({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
  expect(isPrefetch(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
  expect(isPrefetch(new Headers({}))).toBe(false);
  expect(viewOf(req("/", { purpose: "prefetch" }), "1.1.1.1")).toBeNull();
  expect(viewOf(req("/", { "user-agent": "Twitterbot/1.0" }), "1.1.1.1")).toBeNull();
  expect(viewOf(req("/", {}, "POST"), "1.1.1.1")).toBeNull();
  expect(viewOf(req("/admin"), "1.1.1.1")).toBeNull();
});

test("referrers keep the host only and drop links within the site", () => {
  expect(referrerHost("https://www.x.com/someone/status/1?ref=abc", "quants.wtf")).toBe("x.com");
  expect(referrerHost("https://quants.wtf/explore", "quants.wtf")).toBeNull();
  expect(referrerHost("android-app://com.slack", "quants.wtf")).toBeNull();
  expect(referrerHost("not a url", "quants.wtf")).toBeNull();
  const v = viewOf(req(`/t/${MINT}`, { referer: "https://t.co/abc" }), "1.1.1.1", NOW)!;
  expect(v).toEqual({ at: NOW, path: "/t/[mint]", ip: "1.1.1.1", ua: CHROME, referrer: "t.co" });
});

test("the visitor hash is stable within a day and changes with the day's salt", async () => {
  const sql = await freshDb();
  const day1 = await daySalt(sql, "2026-10-01");
  expect(await daySalt(sql, "2026-10-01")).toEqual(day1);
  const a = visitorHash(day1, "1.1.1.1", CHROME);
  expect(visitorHash(day1, "1.1.1.1", CHROME)).toBe(a);
  expect(visitorHash(day1, "2.2.2.2", CHROME)).not.toBe(a);
  expect(a).toHaveLength(32);
  const day2 = await daySalt(sql, "2026-10-02");
  expect(day2).not.toEqual(day1);
  expect(visitorHash(day2, "1.1.1.1", CHROME)).not.toBe(a);
  const salts = await sql`select day::text as day from analytics_salts`;
  expect(salts.map((s: any) => s.day)).toEqual(["2026-10-02"]);
});

test("views wait in memory, then one flush writes hashes and never the IP or agent", async () => {
  const sql = await freshDb();
  recordView(req("/"), "1.1.1.1", () => sql, NOW);
  recordView(req(`/t/${MINT}`, { referer: "https://x.com/a" }), "1.1.1.1", () => sql, NOW + 1000);
  recordView(req("/", { "user-agent": "curl/8" }), "1.1.1.1", () => sql, NOW);
  recordView(req("/"), "2.2.2.2", () => sql, NOW + D);
  expect(pendingViews()).toBe(3);
  const [before] = await sql`select count(*)::int as n from page_views`;
  expect(before.n).toBe(0);
  expect(await flushViews(sql)).toBe(3);
  expect(pendingViews()).toBe(0);
  const rows = await sql`select at, path, visitor, referrer from page_views order by at`;
  expect(rows.map((r: any) => [r.path, r.referrer])).toEqual([["/", null], ["/t/[mint]", "x.com"], ["/", null]]);
  expect(rows[0].visitor).toBe(rows[1].visitor);
  expect(rows[2].visitor).not.toBe(rows[0].visitor);
  const text = JSON.stringify(await sql`select * from page_views`);
  expect(text).not.toContain("1.1.1.1");
  expect(text).not.toContain("Chrome");
});

test("traffic reads daily views, daily uniques, top pages and referrer hosts", async () => {
  const sql = await freshDb();
  const at = (ago: number) => new Date(NOW - ago);
  await sql`insert into page_views (at, path, visitor, referrer) values
    (${at(D + 1000)}, '/', 'a', 'x.com'), (${at(D + 2000)}, '/', 'a', null), (${at(D + 3000)}, '/t/[mint]', 'b', 'x.com'),
    (${at(1000)}, '/', 'a', 't.co'), (${at(2000)}, '/explore', 'c', null),
    (${at(9 * D)}, '/', 'z', null)`;
  const t = await traffic(sql, windowOf("7d", NOW));
  expect(t.views).toEqual({ value: 5, prev: 1 });
  expect(t.visitors).toEqual({ value: 4, prev: 1 });
  expect(t.days.find((d) => d.t.startsWith("2026-09-30"))).toEqual({ t: "2026-09-30T00:00:00.000Z", views: 3, visitors: 2 });
  expect(t.days.find((d) => d.t.startsWith("2026-10-01"))).toEqual({ t: "2026-10-01T00:00:00.000Z", views: 2, visitors: 2 });
  expect(t.pages).toEqual([{ path: "/", views: 3, visitors: 2 }, { path: "/explore", views: 1, visitors: 1 }, { path: "/t/[mint]", views: 1, visitors: 1 }]);
  expect(t.referrers).toEqual([{ host: "x.com", views: 2 }, { host: "t.co", views: 1 }]);
});
