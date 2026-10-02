import { test, expect } from "bun:test";
import { makeWebContext, ADMIN_CODE } from "../helpers/web-context";
import { POST as loginRoute, DELETE as logoutRoute } from "../../src/app/api/admin/session/route";
import { GET as getSettings, POST as postSettings } from "../../src/app/api/admin/settings/route";
import { GET as statusRoute } from "../../src/app/api/admin/status/route";
import { POST as basketRoute } from "../../src/app/api/admin/basket/route";
import { loadLatestSettings } from "../../src/domain/settings";
import { beginStep, failStep } from "../../src/ledger/ledger";
import { decodeCodeHash, generateCode, hashCode, CODE_ALPHABET } from "../../src/admin-code";

const ORIGIN = "http://x";
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
const login = (code: string, headers: Record<string, string> = {}) =>
  loginRoute(new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN, ...headers }, body: JSON.stringify({ code }) }));
async function signIn() {
  const r = await login(ADMIN_CODE);
  expect(r.status).toBe(200);
  return cookieOf(r);
}
const withCookie = (cookie: string, init: RequestInit = {}) =>
  new Request(ORIGIN, { ...init, headers: { origin: ORIGIN, ...(init.headers ?? {}), cookie } });

test("generated codes are 24 characters from the unambiguous alphabet", () => {
  const a = generateCode();
  expect(a).toHaveLength(24);
  expect([...a].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
  expect(generateCode()).not.toBe(a);
  expect(CODE_ALPHABET).not.toMatch(/[IO01]/);
});

test("the right code opens a session that reads settings", async () => {
  await makeWebContext();
  const r = await login(ADMIN_CODE.toLowerCase().replace(/(.{4})/g, "$1 "));
  expect(r.status).toBe(200);
  const set = r.headers.get("set-cookie")!;
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Strict");
  expect(set).toContain("Path=/");
  expect(set).toContain("Max-Age=43200");
  const s = await getSettings(withCookie(cookieOf(r)));
  expect(s.status).toBe(200);
  expect((await s.json()).settings.split.basketBps).toBe(6000);
});

test("a wrong code, a missing cookie and a forged cookie are refused", async () => {
  await makeWebContext();
  expect((await login("WRONGWRONGWRONGWRONGWRON")).status).toBe(401);
  expect((await getSettings(new Request(ORIGIN))).status).toBe(401);
  const cookie = await signIn();
  const [name, value] = cookie.split("=");
  const [token] = value!.split(".");
  expect((await getSettings(withCookie(`${name}=${token}.forged`))).status).toBe(401);
  expect((await getSettings(withCookie(`${name}=${token}`))).status).toBe(401);
});

test("cross site requests are refused even with a session", async () => {
  await makeWebContext();
  const cookie = await signIn();
  expect((await login(ADMIN_CODE, { origin: "https://evil.test" })).status).toBe(403);
  expect((await loginRoute(new Request(ORIGIN, { method: "POST", body: JSON.stringify({ code: ADMIN_CODE }) }))).status).toBe(403);
  expect((await getSettings(new Request(ORIGIN, { headers: { cookie, origin: "https://evil.test" } }))).status).toBe(403);
  expect((await getSettings(new Request(ORIGIN, { headers: { cookie, "sec-fetch-site": "cross-site" } }))).status).toBe(403);
  expect((await postSettings(new Request(ORIGIN, { method: "POST", headers: { cookie }, body: "{}" }))).status).toBe(403);
});

test("five wrong codes from one address lock that address, others can still sign in", async () => {
  const c = await makeWebContext();
  process.env.TRUST_PROXY = "1";
  try {
    for (let i = 0; i < 5; i++) expect((await login("WRONGWRONGWRONGWRONGWRON", { "x-forwarded-for": "1.1.1.1" })).status).toBe(401);
    const locked = await login(ADMIN_CODE, { "x-forwarded-for": "1.1.1.1" });
    expect(locked.status).toBe(429);
    expect((await login(ADMIN_CODE, { "x-forwarded-for": "2.2.2.2" })).status).toBe(200);
    const [n] = await c.sql`select count(*)::int as n from admin_logins where ip = '1.1.1.1' and not ok`;
    expect(n.n).toBe(5);
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test("fifty wrong codes in an hour lock sign in for everyone", async () => {
  const c = await makeWebContext();
  await c.sql`insert into admin_logins (ip, ok) select 'ip' || g, false from generate_series(1, 50) g`;
  expect((await login(ADMIN_CODE)).status).toBe(429);
  await c.sql`update admin_logins set at = now() - interval '61 minutes'`;
  expect((await login(ADMIN_CODE)).status).toBe(200);
});

test("signing out ends the session on the server", async () => {
  await makeWebContext();
  const cookie = await signIn();
  const out = await logoutRoute(withCookie(cookie, { method: "DELETE" }));
  expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await getSettings(withCookie(cookie))).status).toBe(401);
});

test("an expired session is refused", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  await c.sql`update admin_sessions set expires_at = now() - interval '1 second'`;
  expect((await getSettings(withCookie(cookie))).status).toBe(401);
});

test("rotating the code ends every session", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const next = generateCode();
  c.adminCodeHash = decodeCodeHash(await hashCode(next));
  expect((await getSettings(withCookie(cookie))).status).toBe(401);
  expect((await login(ADMIN_CODE)).status).toBe(401);
  expect((await login(next)).status).toBe(200);
});

test("saving settings validates and creates a new version", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const current = (await (await getSettings(withCookie(cookie))).json()).settings;
  const bad = await postSettings(withCookie(cookie, { method: "POST", body: JSON.stringify({ ...current, split: { basketBps: 5000, platformBps: 2500, creatorBps: 1500 } }) }));
  expect(bad.status).toBe(400);
  const before = (await loadLatestSettings(c.sql)).version;
  const ok = await postSettings(withCookie(cookie, { method: "POST", body: JSON.stringify({ ...current, split: { basketBps: 7000, platformBps: 2000, creatorBps: 1000 } }) }));
  expect(ok.status).toBe(200);
  const after = await loadLatestSettings(c.sql);
  expect(after.version).toBe(before + 1);
  expect(after.split.basketBps).toBe(7000);
});

test("status lists failed steps and launches with steps in flight", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M1', 'P1', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  const row = await beginStep(c.sql, { launchId: Number(l.id), idemKey: "k1", kind: "payout", settingsVersion: 1, detail: {} });
  await failStep(c.sql, row.id, "transaction failed on-chain");
  const s = await (await statusRoute(withCookie(cookie))).json();
  expect(s.failed[0]).toMatchObject({ mint: "M1", kind: "payout", error: "transaction failed on-chain" });
  expect(s.lastActivity).not.toBeNull();
  expect(s.inFlight).toEqual([]);
});

test("status pages failed steps from a cursor", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M1', 'P1', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  for (let i = 0; i < 5; i++) {
    const row = await beginStep(c.sql, { launchId: Number(l.id), idemKey: `k${i}`, kind: "payout", settingsVersion: 1, detail: {} });
    await failStep(c.sql, row.id, `fail ${i}`);
  }
  const get = async (qs: string) => (await statusRoute(new Request(`http://x?${qs}`, { headers: { cookie, origin: ORIGIN } }))).json();
  const p1 = await get("limit=2");
  const p2 = await get(`limit=2&before=${p1.failedNext}`);
  const p3 = await get(`limit=2&before=${p2.failedNext}`);
  expect([...p1.failed, ...p2.failed, ...p3.failed].map((f: any) => f.error)).toEqual(["fail 4", "fail 3", "fail 2", "fail 1", "fail 0"]);
  expect(p3.failedNext).toBeNull();
  expect((await statusRoute(new Request("http://x?limit=0", { headers: { cookie, origin: ORIGIN } }))).status).toBe(400);
});

test("basket override replaces a pending launch's basket and is refused once farms exist", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M1', 'P1', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  await c.sql`insert into baskets (launch_id, reward_mint, weight_bps) values (${l.id}, 'Old1111111111111111111111111111111111111111', 10000)`;
  await c.sql`insert into stake_pools values (${l.id}, 'kamino', 3000, 'S', 'pending')`;
  const body = { mint: "M1", basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 6000, symbol: "ZEC", decimals: 8 }, { mint: "Cate111111111111111111111111111111111111111", weightBps: 4000 }] };
  const bad = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify({ ...body, basket: [{ ...body.basket[0], weightBps: 5000 }] }) }));
  expect(bad.status).toBe(400);
  const ok = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify(body) }));
  expect(ok.status).toBe(200);
  const rows = await c.sql`select reward_mint, weight_bps from baskets where launch_id = ${l.id} order by weight_bps desc`;
  expect(rows.map((r: any) => r.weight_bps)).toEqual([6000, 4000]);
  // the rent is sized for the basket, so taking it fixes the basket too
  await c.sql`insert into distributions (launch_id, idem_key, step_key, kind, status, detail) values (${l.id}, 'rent:x', 'rent:x', 'rent', 'confirmed', '{}')`;
  const afterRent = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify(body) }));
  expect(afterRent.status).toBe(400);
  await c.sql`delete from distributions where launch_id = ${l.id}`;
  await c.sql`insert into stake_tiers values (${l.id}, '7d', 604800, 10000, 'FarmA')`;
  const late = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify(body) }));
  expect(late.status).toBe(400);
  expect((await late.json()).error.message).toBe("Farms already exist for this launch");
});

test("basket override is refused for a trading only launch", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, trading_only) values ('MS', 'PS', 'q', 200, 'c', 'cr', 'live', 1, true)`;
  const r = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify({ mint: "MS", basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }] }) }));
  expect(r.status).toBe(400);
  expect((await c.sql`select count(*)::int n from baskets`)[0].n).toBe(0);
});

test("basket override can keep a token that was already in the basket", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M2', 'P2', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  await c.sql`insert into baskets (launch_id, reward_mint, weight_bps) values (${l.id}, 'Zec1111111111111111111111111111111111111111', 10000)`;
  await c.sql`insert into stake_pools values (${l.id}, 'kamino', 3000, 'S', 'pending')`;
  const r = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify({ mint: "M2", basket: [
    { mint: "Zec1111111111111111111111111111111111111111", weightBps: 5000 }, { mint: "Cate111111111111111111111111111111111111111", weightBps: 5000 }] }) }));
  expect(r.status).toBe(200);
  expect((await c.sql`select count(*)::int n from baskets where launch_id = ${l.id}`)[0].n).toBe(2);
  const r2 = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify({ mint: "M2", basket: [
    { mint: "Cate111111111111111111111111111111111111111", weightBps: 10000, symbol: "CATE", decimals: 6 }] }) }));
  expect(r2.status).toBe(200);
  const rows = await c.sql`select reward_mint, weight_bps, symbol, decimals from baskets where launch_id = ${l.id}`;
  expect(rows.map((x: any) => [x.reward_mint, x.weight_bps, x.symbol, x.decimals])).toEqual([["Cate111111111111111111111111111111111111111", 10000, "CATE", 6]]);
});

test("basket override is refused once any farm or swap exists", async () => {
  const c = await makeWebContext();
  const cookie = await signIn();
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M3', 'P3', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  await c.sql`insert into stake_pools values (${l.id}, 'kamino', 3000, 'S', 'pending')`;
  await c.sql`insert into stake_tiers values (${l.id}, '7d', 604800, 10000, 'FarmA'), (${l.id}, '30d', 2592000, 15000, null)`;
  const r = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify({ mint: "M3", basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }] }) }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.message).toBe("Farms already exist for this launch");
});
