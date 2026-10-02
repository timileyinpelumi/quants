import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { WebContext } from "./context";
import { AuthError, LimitError, clientIp } from "./http";
import { normalizeCode } from "@/admin-code";

export const ADMIN_COOKIE = "quants_admin";
const SESSION_SECONDS = 12 * 3600;
export const LOGIN_LIMITS = { perIp: 5, perIpMinutes: 15, global: 50, globalMinutes: 60 };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const fingerprint = (hash: string) => sha256(hash).slice(0, 32);
const sign = (secret: Uint8Array, token: string) => createHmac("sha256", secret).update(token).digest("base64url");

const cookie = (value: string, maxAge: number) =>
  `${ADMIN_COOKIE}=${value}; HttpOnly;${process.env.NODE_ENV === "production" ? " Secure;" : ""} SameSite=Strict; Path=/; Max-Age=${maxAge}`;

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// SITE_URL pins the origin; without it the request's own origin is used (local dev, previews).
function siteOrigin(req: Request): string {
  if (process.env.SITE_URL) return new URL(process.env.SITE_URL).origin;
  const u = new URL(req.url);
  return `${u.protocol}//${req.headers.get("host") ?? u.host}`;
}

/** Browsers send Origin on every POST and on cross site GETs; SameSite=Strict already keeps the cookie off cross site requests. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const write = req.method !== "GET" && req.method !== "HEAD";
  if (origin ? origin !== siteOrigin(req) : write) throw new AuthError(403, "Requests from other sites are refused");
  if (site && site !== "same-origin" && site !== "none") throw new AuthError(403, "Requests from other sites are refused");
}

function tokenOf(ctx: WebContext, req: Request): string | null {
  const raw = readCookie(req, ADMIN_COOKIE);
  if (!raw) return null;
  const [token, mac] = raw.split(".");
  if (!token || !mac) return null;
  const want = Buffer.from(sign(ctx.sessionSecret, token));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? token : null;
}

const log = (o: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));

// argon2id takes about 19 MB per check; one at a time keeps a burst of guesses from exhausting memory.
let checking = false;

export async function login(ctx: WebContext, req: Request, raw: unknown): Promise<string> {
  assertSameOrigin(req);
  const { code } = z.object({ code: z.string().max(64, "That code is not right") }).parse(raw);
  const ip = clientIp(req);
  const [r] = await ctx.sql`
    select count(*) filter (where ip = ${ip} and at > now() - make_interval(mins => ${LOGIN_LIMITS.perIpMinutes}))::int as ip,
           count(*)::int as total
    from admin_logins where not ok and at > now() - make_interval(mins => ${LOGIN_LIMITS.globalMinutes})`;
  if (r.total >= LOGIN_LIMITS.global) {
    log({ adminLogin: "locked", ip });
    throw new LimitError(429, "Sign in is locked for now after too many wrong codes. Try again in an hour.");
  }
  if (r.ip >= LOGIN_LIMITS.perIp) {
    log({ adminLogin: "limited", ip });
    throw new LimitError(429, "Too many wrong codes. Wait 15 minutes and try again.");
  }
  if (checking) throw new LimitError(429, "Busy checking another code. Try again in a moment.");
  checking = true;
  let ok = false;
  try {
    const c = normalizeCode(code);
    ok = !!ctx.adminCodeHash && c.length >= 16 && (await Bun.password.verify(c, ctx.adminCodeHash));
  } catch {
    ok = false;
  } finally {
    checking = false;
  }
  await ctx.sql`insert into admin_logins (ip, ok) values (${ip}, ${ok})`;
  log({ adminLogin: ok ? "ok" : "wrong code", ip });
  if (!ok) throw new AuthError(401, "That code is not right");
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await ctx.sql`
    with gone as (delete from admin_sessions where expires_at < now() - interval '7 days'),
    old as (delete from admin_logins where at < now() - interval '7 days')
    insert into admin_sessions (id, code, ip, expires_at)
    values (${sha256(token)}, ${fingerprint(ctx.adminCodeHash)}, ${ip}, now() + make_interval(secs => ${SESSION_SECONDS}))`;
  return cookie(`${token}.${sign(ctx.sessionSecret, token)}`, SESSION_SECONDS);
}

export async function logout(ctx: WebContext, req: Request): Promise<string> {
  assertSameOrigin(req);
  const token = tokenOf(ctx, req);
  if (token) await ctx.sql`update admin_sessions set revoked_at = now() where id = ${sha256(token)} and revoked_at is null`;
  return cookie("", 0);
}

/** Returns a short session label for audit columns such as settings.created_by. */
export async function requireAdmin(ctx: WebContext, req: Request): Promise<string> {
  assertSameOrigin(req);
  const token = tokenOf(ctx, req);
  if (!token) throw new AuthError(401, "Sign in first");
  const id = sha256(token);
  const [s] = await ctx.sql`
    select id from admin_sessions
    where id = ${id} and revoked_at is null and expires_at > now() and code = ${fingerprint(ctx.adminCodeHash)}`;
  if (!s) throw new AuthError(401, "Session ended. Sign in again.");
  return `admin:${id.slice(0, 8)}`;
}
