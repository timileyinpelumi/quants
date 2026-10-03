import { test, expect, beforeEach } from "bun:test";
import { makeWebContext, ADMIN_CODE } from "../helpers/web-context";
import { POST as loginRoute } from "../../src/app/api/whitehouse/session/route";
import { GET as analyticsRoute } from "../../src/app/api/whitehouse/analytics/route";
import { resetAnalyticsCache } from "../../src/web/server/analytics";

const ORIGIN = "http://x";
const url = (q = "") => `${ORIGIN}/api/whitehouse/analytics${q}`;

async function signIn() {
  const r = await loginRoute(new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ code: ADMIN_CODE }) }));
  expect(r.status).toBe(200);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

beforeEach(() => resetAnalyticsCache());

test("analytics needs an admin session from this site", async () => {
  await makeWebContext();
  expect((await analyticsRoute(new Request(url()))).status).toBe(401);
  const cookie = await signIn();
  expect((await analyticsRoute(new Request(url(), { headers: { cookie, origin: "https://evil.test" } }))).status).toBe(403);
  expect((await analyticsRoute(new Request(url(), { headers: { cookie, "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  const ok = await analyticsRoute(new Request(url("?range=24h"), { headers: { cookie } }));
  expect(ok.status).toBe(200);
  const body = await ok.json();
  expect(body.range).toBe("24h");
  expect(body.unit).toBe("hour");
  expect(body.overview.launches).toEqual({ value: 0, prev: 0 });
});

test("an unknown range is refused", async () => {
  await makeWebContext();
  const cookie = await signIn();
  const r = await analyticsRoute(new Request(url("?range=1y"), { headers: { cookie } }));
  expect(r.status).toBe(400);
});

test("a report is reused for 30 seconds", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const first = await (await analyticsRoute(new Request(url("?range=7d"), { headers: { cookie } }))).json();
  await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('m', 'p', 'q', 200, 'c', 'cr', 'live', 1)`;
  const second = await (await analyticsRoute(new Request(url("?range=7d"), { headers: { cookie } }))).json();
  expect(second.overview.launches.value).toBe(first.overview.launches.value);
  resetAnalyticsCache();
  const third = await (await analyticsRoute(new Request(url("?range=7d"), { headers: { cookie } }))).json();
  expect(third.overview.launches.value).toBe(1);
});
