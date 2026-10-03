import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { WebContext } from "./context";
import { AuthError, LimitError, clientIp } from "./http";
import { LaunchError } from "@/launch/prepare";
import { generateCode, hashCodePhc, normalizeCode } from "@/admin-code";

const prod = () => process.env.NODE_ENV === "production";
// __Host- makes browsers refuse the cookie unless it is Secure, host only and Path=/.
export const adminCookie = () => (prod() ? "__Host-quants_admin" : "quants_admin");
const SESSION_SECONDS = 12 * 3600;
export const LOGIN_LIMITS = { perIp: 5, perIpMinutes: 15, global: 50, globalMinutes: 60 };
/** Each sign in checks the code against every live read only code, one argon2id hash at a time, so they are capped. */
export const MAX_READ_CODES = 10;

export type AdminRole = "full" | "read";
export type AdminSession = { by: string; role: AdminRole };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const fingerprint = (hash: string) => sha256(hash).slice(0, 32);
const sign = (secret: Uint8Array, token: string) => createHmac("sha256", secret).update(token).digest("base64url");

const cookie = (value: string, maxAge: number) =>
  `${adminCookie()}=${value}; HttpOnly;${prod() ? " Secure;" : ""} SameSite=Strict; Path=/; Max-Age=${maxAge}`;

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
  const raw = readCookie(req, adminCookie());
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

/** Which code this is: the full code from ADMIN_CODE_HASH, a live read only code, or neither. */
async function matchCode(ctx: WebContext, code: string): Promise<{ role: AdminRole; codeId: number | null } | null> {
  const c = normalizeCode(code);
  if (!ctx.adminCodeHash || c.length < 16) return null;
  if (await Bun.password.verify(c, ctx.adminCodeHash)) return { role: "full", codeId: null };
  const codes = await ctx.sql`select id, hash from admin_codes where revoked_at is null order by id limit ${MAX_READ_CODES}`;
  for (const r of codes) {
    if (await Bun.password.verify(c, r.hash)) return { role: "read", codeId: Number(r.id) };
  }
  return null;
}

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
  let match: Awaited<ReturnType<typeof matchCode>> = null;
  try {
    match = await matchCode(ctx, code);
  } catch {
    match = null;
  } finally {
    checking = false;
  }
  await ctx.sql`insert into admin_logins (ip, ok) values (${ip}, ${!!match})`;
  log({ adminLogin: match ? "ok" : "wrong code", ip, ...(match ? { role: match.role } : {}) });
  if (!match) throw new AuthError(401, "That code is not right");
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await ctx.sql`
    with gone as (delete from admin_sessions where expires_at < now() - interval '7 days'),
    old as (delete from admin_logins where at < now() - interval '7 days'),
    used as (update admin_codes set last_used_at = now() where id = ${match.codeId})
    insert into admin_sessions (id, code, ip, expires_at, role, code_id)
    values (${sha256(token)}, ${fingerprint(ctx.adminCodeHash)}, ${ip}, now() + make_interval(secs => ${SESSION_SECONDS}), ${match.role}, ${match.codeId})`;
  return cookie(`${token}.${sign(ctx.sessionSecret, token)}`, SESSION_SECONDS);
}

export async function logout(ctx: WebContext, req: Request): Promise<string> {
  assertSameOrigin(req);
  const token = tokenOf(ctx, req);
  if (token) await ctx.sql`update admin_sessions set revoked_at = now() where id = ${sha256(token)} and revoked_at is null`;
  return cookie("", 0);
}

/**
 * The signed in session, refused with 401 unless it is live, made with the current ADMIN_CODE_HASH and, for a read only
 * session, its code is not revoked. `need` "full" refuses read only sessions with 403. Every admin route calls this
 * before reading its input.
 */
export async function requireAdmin(ctx: WebContext, req: Request, need: AdminRole): Promise<AdminSession> {
  assertSameOrigin(req);
  const token = tokenOf(ctx, req);
  if (!token) throw new AuthError(401, "Sign in first");
  const id = sha256(token);
  const [s] = await ctx.sql`
    with s as (
      select s.role, s.code_id from admin_sessions s
      where s.id = ${id} and s.revoked_at is null and s.expires_at > now() and s.code = ${fingerprint(ctx.adminCodeHash)}
        and ((s.role = 'full' and s.code_id is null)
          or (s.role = 'read' and exists (select 1 from admin_codes c where c.id = s.code_id and c.revoked_at is null)))
    ), used as (
      update admin_codes set last_used_at = now()
      where id = (select code_id from s) and (last_used_at is null or last_used_at < now() - interval '1 minute')
    )
    select role from s`;
  if (!s) throw new AuthError(401, "Sign in first");
  const role = s.role as AdminRole;
  if (need === "full" && role !== "full") throw new AuthError(403, "Read only access cannot change anything");
  return { by: `${role === "full" ? "admin" : "read"}:${id.slice(0, 8)}`, role };
}

export type ReadCode = { id: number; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

export async function listReadCodes(ctx: WebContext): Promise<ReadCode[]> {
  const rows = await ctx.sql`select id, label, created_at, last_used_at, revoked_at from admin_codes order by revoked_at is not null, id desc limit 50`;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r: any) => ({ id: Number(r.id), label: r.label, createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at), revokedAt: iso(r.revoked_at) }));
}

const Label = z.object({ label: z.string().trim().min(1, "Give the code a label").max(40, "Labels are 40 characters at most") });

/** Makes a read only code. The plain code is returned once; only its argon2id hash is stored. */
export async function createReadCode(ctx: WebContext, raw: unknown): Promise<{ code: string; item: ReadCode }> {
  const { label } = Label.parse(raw);
  const code = generateCode();
  const hash = await hashCodePhc(code);
  const [row] = await ctx.sql`
    insert into admin_codes (label, hash)
    select ${label}, ${hash} where (select count(*) from admin_codes where revoked_at is null) < ${MAX_READ_CODES}
    returning id, label, created_at`;
  if (!row) throw new LaunchError("invalid_input", `There are ${MAX_READ_CODES} live read only codes already. Revoke one first.`);
  log({ adminCode: "created", id: Number(row.id) });
  return { code, item: { id: Number(row.id), label: row.label, createdAt: new Date(row.created_at).toISOString(), lastUsedAt: null, revokedAt: null } };
}

/** Revokes a read only code and ends every session made with it, in one statement. */
export async function revokeReadCode(ctx: WebContext, raw: unknown): Promise<void> {
  const { id } = z.object({ id: z.number().int().positive() }).parse(raw);
  const [r] = await ctx.sql`
    with code as (update admin_codes set revoked_at = coalesce(revoked_at, now()) where id = ${id} returning id),
    ended as (update admin_sessions set revoked_at = now() where code_id = ${id} and revoked_at is null)
    select count(*)::int as n from code`;
  if (!r.n) throw new LaunchError("invalid_input", "That code does not exist");
  log({ adminCode: "revoked", id });
}
