import { test, expect } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeWebContext, ADMIN_CODE } from "../helpers/web-context";
import { POST as loginRoute, GET as sessionRoute } from "../../src/app/api/whitehouse/session/route";
import { GET as getSettings, POST as postSettings } from "../../src/app/api/whitehouse/settings/route";
import { GET as listCodes, POST as createCode, DELETE as revokeCode } from "../../src/app/api/whitehouse/codes/route";
import { GET as walletsRoute } from "../../src/app/api/whitehouse/wallets/route";
import { MAX_READ_CODES } from "../../src/web/server/admin";
import { decodeCodeHash, generateCode, hashCode } from "../../src/admin-code";
import { loadLatestSettings, saveSettings } from "../../src/domain/settings";

const ORIGIN = "http://x";
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
const login = (code: string, headers: Record<string, string> = {}) =>
  loginRoute(new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN, ...headers }, body: JSON.stringify({ code }) }));
const req = (cookie: string | null, init: RequestInit = {}) =>
  new Request(ORIGIN, { ...init, headers: { origin: ORIGIN, ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });

async function signIn(code = ADMIN_CODE) {
  const r = await login(code);
  expect(r.status).toBe(200);
  return cookieOf(r);
}

async function readSession(label = "auditor") {
  const full = await signIn();
  const made = await createCode(req(full, { method: "POST", body: JSON.stringify({ label }) }));
  expect(made.status).toBe(200);
  const { code, item } = await made.json();
  return { full, code: code as string, id: item.id as number, read: await signIn(code) };
}

test("a read only code is shown once, stored only as an argon2id hash, and signs in as read", async () => {
  const c = await makeWebContext();
  const { code, id, read } = await readSession();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{24}$/);
  const [row] = await c.sql`select label, hash from admin_codes where id = ${id}`;
  expect(row.label).toBe("auditor");
  expect(row.hash).toStartWith("$argon2id$");
  expect(JSON.stringify(row)).not.toContain(code);
  expect(await (await sessionRoute(req(read))).json()).toEqual({ role: "read" });
  const [s] = await c.sql`select role, code_id from admin_sessions where code_id is not null`;
  expect(s).toMatchObject({ role: "read", code_id: String(id) });
  const listed = (await (await listCodes(req(await signIn()))).json()).codes;
  expect(listed[0]).toMatchObject({ id, label: "auditor", revokedAt: null });
  expect(listed[0].lastUsedAt).not.toBeNull();
  expect(JSON.stringify(listed)).not.toContain("argon2");
});

test("a read only session reads settings but cannot save them", async () => {
  const c = await makeWebContext();
  const { read } = await readSession();
  const before = (await loadLatestSettings(c.sql)).version;
  const r = await getSettings(req(read));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const { settings } = await r.json();
  const saved = await postSettings(req(read, { method: "POST", body: JSON.stringify(settings) }));
  expect(saved.status).toBe(403);
  expect((await loadLatestSettings(c.sql)).version).toBe(before);
});

test("the alert webhook URL never reaches a read only session", async () => {
  const c = await makeWebContext();
  const s = await loadLatestSettings(c.sql);
  await saveSettings(c.sql, { ...s, alertWebhookUrl: "https://hooks.slack.com/services/T/B/secret" }, "t");
  const { full, read } = await readSession();
  expect((await (await getSettings(req(read))).json()).settings.alertWebhookUrl).toBe("hidden");
  expect((await (await getSettings(req(full))).json()).settings.alertWebhookUrl).toBe("https://hooks.slack.com/services/T/B/secret");
});

test("wallet derivation paths are left out of the response for a read only session", async () => {
  await makeWebContext({ platformAddresses: { keeper: "Keeper1111111111111111111111111111111111111" }, conn: { getBalance: async () => 1 } as any });
  const { full, read } = await readSession();
  const asRead = await (await walletsRoute(req(read))).json();
  expect(asRead.wallets[0].address).toBe("Keeper1111111111111111111111111111111111111");
  expect(asRead.wallets.every((w: object) => !("path" in w))).toBe(true);
  expect(JSON.stringify(asRead)).not.toContain("m/44'");
  expect((await (await walletsRoute(req(full))).json()).wallets[0].path).toBe("m/44'/501'/0'/0'");
});

test("revoking a read only code ends its sessions at once and the code stops working", async () => {
  const c = await makeWebContext();
  const { full, code, id, read } = await readSession();
  const other = await readSession("second");
  expect((await revokeCode(req(other.read, { method: "DELETE", body: JSON.stringify({ id }) }))).status).toBe(403);
  expect((await revokeCode(req(full, { method: "DELETE", body: JSON.stringify({ id }) }))).status).toBe(200);
  expect((await getSettings(req(read))).status).toBe(401);
  expect((await login(code)).status).toBe(401);
  expect((await getSettings(req(other.read))).status).toBe(200);
  // even a session row someone left open is refused once its code is revoked
  await c.sql`update admin_sessions set revoked_at = null`;
  expect((await getSettings(req(read))).status).toBe(401);
  expect((await revokeCode(req(full, { method: "DELETE", body: JSON.stringify({ id: 999 }) }))).status).toBe(400);
});

test("rotating the full code ends read only sessions too", async () => {
  const c = await makeWebContext();
  const { read, code } = await readSession();
  c.adminCodeHash = decodeCodeHash(await hashCode(generateCode()));
  expect((await getSettings(req(read))).status).toBe(401);
  // the read only code itself still signs in under the new full code until it is revoked
  expect((await login(code)).status).toBe(200);
});

test("wrong guesses count toward the lockout whichever code they aim at", async () => {
  const c = await makeWebContext();
  const { code } = await readSession();
  process.env.TRUST_PROXY = "1";
  try {
    for (let i = 0; i < 5; i++) expect((await login(generateCode(), { "x-forwarded-for": "9.9.9.9" })).status).toBe(401);
    expect((await login(code, { "x-forwarded-for": "9.9.9.9" })).status).toBe(429);
    expect((await login(ADMIN_CODE, { "x-forwarded-for": "9.9.9.9" })).status).toBe(429);
  } finally {
    delete process.env.TRUST_PROXY;
  }
  await c.sql`insert into admin_logins (ip, ok) select 'ip' || g, false from generate_series(1, 50) g`;
  expect((await login(code)).status).toBe(429);
});

test("read only codes are capped and need a label", async () => {
  await makeWebContext();
  const full = await signIn();
  const make = (label: string) => createCode(req(full, { method: "POST", body: JSON.stringify({ label }) }));
  expect((await make("  ")).status).toBe(400);
  expect((await make("x".repeat(41))).status).toBe(400);
  for (let i = 0; i < MAX_READ_CODES; i++) expect((await make(`code ${i}`)).status).toBe(200);
  expect((await make("one too many")).status).toBe(400);
});

test("in production the session cookie is __Host- prefixed, Secure, httpOnly and SameSite=Strict", async () => {
  await makeWebContext();
  const env = process.env as Record<string, string | undefined>;
  const was = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const r = await login(ADMIN_CODE);
    const set = r.headers.get("set-cookie")!;
    expect(set).toStartWith("__Host-quants_admin=");
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) expect(set).toContain(flag);
    expect(set).not.toContain("Domain");
    expect(r.headers.get("cache-control")).toBe("no-store");
    // the dev cookie name is not accepted in production
    const plain = `quants_admin=${set.split(";")[0]!.split("=").slice(1).join("=")}`;
    expect((await getSettings(req(plain))).status).toBe(401);
    expect((await getSettings(req(set.split(";")[0]!))).status).toBe(200);
  } finally {
    env.NODE_ENV = was;
  }
});

test("a forged, truncated or expired session all get the same 401", async () => {
  const c = await makeWebContext();
  const good = await signIn();
  const [name, value] = good.split("=") as [string, string];
  const [token, mac] = value.split(".") as [string, string];
  const bodies = new Set<string>();
  for (const cookie of [`${name}=${token}.${mac.slice(0, -2)}xx`, `${name}=${token}`, `${name}=garbage`, `other=${value}`]) {
    const r = await getSettings(req(cookie));
    expect(r.status).toBe(401);
    bodies.add(await r.text());
  }
  await c.sql`update admin_sessions set expires_at = now() - interval '1 second'`;
  const expired = await getSettings(req(good));
  expect(expired.status).toBe(401);
  bodies.add(await expired.text());
  expect(bodies.size).toBe(1);
});

// Every admin route file, walked from disk so a new route cannot skip these checks.
const DIR = join(import.meta.dir, "../../src/app/api/whitehouse");
const WRITES = ["POST", "PUT", "PATCH", "DELETE"] as const;
const routes = readdirSync(DIR).filter((d) => existsSync(join(DIR, d, "route.ts")));

test("the admin route list is what these tests expect", () => {
  expect(routes.sort()).toEqual(["analytics", "basket", "codes", "session", "settings", "stake-payouts", "status", "votes", "wallets"]);
});

for (const name of routes) {
  test(`${name}: no session gets 401 with no detail, a read only session cannot write`, async () => {
    await makeWebContext();
    const mod = await import(join(DIR, name, "route.ts"));
    const { read } = await readSession();
    for (const method of ["GET", ...WRITES]) {
      const handler = mod[method] as ((r: Request) => Promise<Response>) | undefined;
      if (!handler) continue;
      // Signing in and out are the only handlers that work without a session.
      if (name === "session" && method !== "GET") continue;
      const anon = await handler(req(null, { method, body: method === "GET" ? undefined : "{}" }));
      expect(anon.status, `${method} ${name} without a session`).toBe(401);
      expect((await anon.json()).error.message).toBe("Sign in first");
      if (method === "GET") continue;
      const r = await handler(req(read, { method, body: "{}" }));
      expect(r.status, `${method} ${name} as read only`).toBe(403);
    }
  });
}

test("read only sessions can read every GET route except access codes", async () => {
  await makeWebContext();
  const { read } = await readSession();
  for (const name of routes) {
    const mod = await import(join(DIR, name, "route.ts"));
    if (!mod.GET) continue;
    const r = await mod.GET(req(read));
    expect(r.status, name).toBe(name === "codes" ? 403 : 200);
  }
});

test("the creator payout hold list never reaches a read only session", async () => {
  const c = await makeWebContext();
  const s = await loadLatestSettings(c.sql);
  const mint = "3JMpdC7tXi5Wga8vgUjgLSSihuBxHfzPdeSvqsATiLgE";
  await saveSettings(c.sql, { ...s, creatorPayoutHold: [mint] }, "t");
  const { full, read } = await readSession();
  const asRead = await (await getSettings(req(read))).text();
  expect(asRead).not.toContain("creatorPayoutHold");
  expect(asRead).not.toContain(mint);
  expect((await (await getSettings(req(full))).json()).settings.creatorPayoutHold).toEqual([mint]);
});
