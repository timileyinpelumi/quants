import { test, expect } from "bun:test";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { SignJWT } from "jose";
import { makeWebContext, ADMIN } from "../helpers/web-context";
import { POST as nonceRoute } from "../../src/app/api/admin/nonce/route";
import { POST as sessionRoute } from "../../src/app/api/admin/session/route";
import { GET as getSettings, POST as postSettings } from "../../src/app/api/admin/settings/route";
import { GET as statusRoute } from "../../src/app/api/admin/status/route";
import { POST as basketRoute } from "../../src/app/api/admin/basket/route";
import { loadLatestSettings } from "../../src/domain/settings";
import { beginStep, failStep } from "../../src/ledger/ledger";

const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;

async function signIn(kp: Keypair, tamper = false, sessionUrl = "http://x") {
  const n = await nonceRoute(new Request("http://x", { method: "POST" }));
  const { message } = await n.json();
  const signed = tamper ? message.replace(/Nonce: \w+/, "Nonce: deadbeef") : message;
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(signed), kp.secretKey));
  return sessionRoute(new Request(sessionUrl, { method: "POST", headers: { cookie: cookieOf(n) }, body: JSON.stringify({ wallet: kp.publicKey.toBase58(), signature }) }));
}
const withCookie = (cookie: string, init: RequestInit = {}) => new Request("http://x", { ...init, headers: { ...(init.headers ?? {}), cookie } });

test("an allowlisted wallet signs in and can read settings", async () => {
  await makeWebContext();
  const s = await signIn(ADMIN);
  expect(s.status).toBe(200);
  expect(s.headers.get("set-cookie")).toContain("HttpOnly");
  const r = await getSettings(withCookie(cookieOf(s)));
  expect(r.status).toBe(200);
  expect((await r.json()).settings.split.basketBps).toBe(6000);
});

test("non admin wallets, tampered messages and missing cookies are refused", async () => {
  await makeWebContext();
  expect((await signIn(Keypair.generate())).status).toBe(403);
  expect((await signIn(ADMIN, true)).status).toBe(401);
  expect((await getSettings(new Request("http://x"))).status).toBe(401);
});

test("the sign in message names the site, its URI and when it was issued", async () => {
  await makeWebContext();
  const { message } = await (await nonceRoute(new Request("https://quants.example/api/admin/nonce", { method: "POST" }))).json();
  expect(message).toStartWith("quants.example wants you to sign in to quants admin");
  expect(message).toContain("URI: https://quants.example");
  expect(message).toMatch(/Issued At: \d{4}-\d\d-\d\dT/);
});

test("a signature collected for one host is refused on another", async () => {
  await makeWebContext();
  expect((await signIn(ADMIN, false, "http://evil.test")).status).toBe(401);
});

test("SITE_URL fixes the domain regardless of the request host", async () => {
  await makeWebContext();
  process.env.SITE_URL = "https://quants.example";
  try {
    const { message } = await (await nonceRoute(new Request("http://x", { method: "POST" }))).json();
    expect(message).toStartWith("quants.example wants you");
    expect((await signIn(ADMIN)).status).toBe(200);
  } finally {
    delete process.env.SITE_URL;
  }
});

test("an expired nonce is refused", async () => {
  const c = await makeWebContext();
  const message = "Sign in to quants admin\nNonce: abc\nIssued: 2020-01-01T00:00:00.000Z";
  const old = await new SignJWT({ message }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2).sign(c.sessionSecret);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), ADMIN.secretKey));
  const r = await sessionRoute(new Request("http://x", { method: "POST", headers: { cookie: `quants_nonce=${old}` }, body: JSON.stringify({ wallet: ADMIN.publicKey.toBase58(), signature }) }));
  expect(r.status).toBe(401);
});

test("a session stops working once the wallet leaves the allowlist", async () => {
  const c = await makeWebContext();
  const cookie = cookieOf(await signIn(ADMIN));
  c.adminWallets.delete(ADMIN.publicKey.toBase58());
  expect((await getSettings(withCookie(cookie))).status).toBe(403);
});

test("saving settings validates and creates a new version", async () => {
  const c = await makeWebContext();
  const cookie = cookieOf(await signIn(ADMIN));
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
  const cookie = cookieOf(await signIn(ADMIN));
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
  const cookie = cookieOf(await signIn(ADMIN));
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M1', 'P1', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  for (let i = 0; i < 5; i++) {
    const row = await beginStep(c.sql, { launchId: Number(l.id), idemKey: `k${i}`, kind: "payout", settingsVersion: 1, detail: {} });
    await failStep(c.sql, row.id, `fail ${i}`);
  }
  const get = async (qs: string) => (await statusRoute(new Request(`http://x?${qs}`, { headers: { cookie } }))).json();
  const p1 = await get("limit=2");
  const p2 = await get(`limit=2&before=${p1.failedNext}`);
  const p3 = await get(`limit=2&before=${p2.failedNext}`);
  expect([...p1.failed, ...p2.failed, ...p3.failed].map((f: any) => f.error)).toEqual(["fail 4", "fail 3", "fail 2", "fail 1", "fail 0"]);
  expect(p3.failedNext).toBeNull();
  expect((await statusRoute(new Request("http://x?limit=0", { headers: { cookie } }))).status).toBe(400);
});

test("basket override replaces a pending launch's basket and is refused once farms exist", async () => {
  const c = await makeWebContext();
  const cookie = cookieOf(await signIn(ADMIN));
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

test("basket override can keep a token that was already in the basket", async () => {
  const c = await makeWebContext();
  const cookie = cookieOf(await signIn(ADMIN));
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
  const cookie = cookieOf(await signIn(ADMIN));
  const [l] = await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version) values ('M3', 'P3', 'q', 200, 'c', 'cr', 'live', 1) returning id`;
  await c.sql`insert into stake_pools values (${l.id}, 'kamino', 3000, 'S', 'pending')`;
  await c.sql`insert into stake_tiers values (${l.id}, '7d', 604800, 10000, 'FarmA'), (${l.id}, '30d', 2592000, 15000, null)`;
  const r = await basketRoute(withCookie(cookie, { method: "POST", body: JSON.stringify({ mint: "M3", basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }] }) }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.message).toBe("Farms already exist for this launch");
});

test("a nonce and signature can only open one session", async () => {
  await makeWebContext();
  const n = await nonceRoute(new Request("http://x", { method: "POST" }));
  const { message } = await n.json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), ADMIN.secretKey));
  const req = () => sessionRoute(new Request("http://x", { method: "POST", headers: { cookie: cookieOf(n) }, body: JSON.stringify({ wallet: ADMIN.publicKey.toBase58(), signature }) }));
  expect((await req()).status).toBe(200);
  expect((await req()).status).toBe(401);
});
