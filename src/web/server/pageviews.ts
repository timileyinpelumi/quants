import type { SQL } from "bun";
import { createHash, randomBytes } from "node:crypto";

// Only these pages are counted, by pattern, so a token page never stores its mint and scanners add nothing.
const PATTERNS: [RegExp, string][] = [
  [/^\/$/, "/"],
  [/^\/explore$/, "/explore"],
  [/^\/launch$/, "/launch"],
  [/^\/portfolio$/, "/portfolio"],
  [/^\/rewards$/, "/rewards"],
  [/^\/docs$/, "/docs"],
  [/^\/terms$/, "/terms"],
  [/^\/t\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, "/t/[mint]"],
  [/^\/t\/[1-9A-HJ-NP-Za-km-z]{32,44}\/stake$/, "/t/[mint]/stake"],
];

export function pathPattern(pathname: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [re, name] of PATTERNS) if (re.test(p)) return name;
  return null;
}

const BOT = /bot|crawl|spider|slurp|archiver|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|curl|wget|python|httpx|aiohttp|go-http|java\/|okhttp|node-fetch|axios|undici|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|scanner|zgrab|masscan|nmap/i;
export const isBot = (ua: string | null) => !ua || ua.length < 10 || BOT.test(ua);

export function isPrefetch(h: Headers): boolean {
  const purpose = `${h.get("purpose") ?? ""} ${h.get("sec-purpose") ?? ""} ${h.get("x-purpose") ?? ""}`.toLowerCase();
  return purpose.includes("prefetch") || purpose.includes("prerender") || h.has("next-router-prefetch") || h.has("x-middleware-prefetch");
}

/** The referring site's host, or null for direct visits and links within this site. */
export function referrerHost(referer: string | null, ownHost: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const own = ownHost?.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
    return !host || host === own ? null : host.slice(0, 100);
  } catch {
    return null;
  }
}

export type View = { at: number; path: string; ip: string; ua: string; referrer: string | null };

/** What to count for a request, or null when it is not a human page view. Nothing here reads or sets a cookie. */
export function viewOf(req: Request, ip: string, now = Date.now()): View | null {
  if (req.method !== "GET") return null;
  const url = new URL(req.url);
  const path = pathPattern(url.pathname);
  if (!path) return null;
  const ua = req.headers.get("user-agent");
  if (isBot(ua) || isPrefetch(req.headers)) return null;
  const own = process.env.SITE_URL ? new URL(process.env.SITE_URL).host : req.headers.get("host") ?? url.host;
  return { at: now, path, ip, ua: ua!, referrer: referrerHost(req.headers.get("referer"), own) };
}

// Same rule as clientIp in http.ts, kept here so the proxy bundle stays small.
export const viewerIp = (req: Request) =>
  (process.env.TRUST_PROXY === "1" && req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()) || "local";

export const visitorHash =(salt: Uint8Array, ip: string, ua: string) =>
  createHash("sha256").update(salt).update(ip).update("\n").update(ua).digest("hex").slice(0, 32);

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The salt for a UTC day, created on first use. Salts of earlier days are deleted, so yesterday's hashes cannot be recomputed. */
export async function daySalt(sql: SQL, day: string): Promise<Uint8Array> {
  await sql`insert into analytics_salts (day, salt) values (${day}::date, ${randomBytes(32)}) on conflict (day) do nothing`;
  await sql`delete from analytics_salts where day < ${day}::date`;
  const [r] = await sql`select salt from analytics_salts where day = ${day}::date`;
  return new Uint8Array(r.salt);
}

const MAX_BUFFER = 5_000;
const FLUSH_MS = 5_000;
type Buffer = { views: View[]; timer: ReturnType<typeof setTimeout> | null; salts: Map<string, Uint8Array>; sql: (() => SQL) | null };
const g = globalThis as { __quantsViews?: Buffer };
const buf = (): Buffer => (g.__quantsViews ??= { views: [], timer: null, salts: new Map(), sql: null });

/** Turns buffered views into rows: IP and user agent never leave memory, only the day's hash does. */
export async function flushViews(sql: SQL): Promise<number> {
  const b = buf();
  const views = b.views.splice(0);
  if (!views.length) return 0;
  const rows = [];
  for (const v of views) {
    const day = utcDay(v.at);
    let salt = b.salts.get(day);
    if (!salt) {
      salt = await daySalt(sql, day);
      b.salts.clear();
      b.salts.set(day, salt);
    }
    rows.push({ at: new Date(v.at), path: v.path, visitor: visitorHash(salt, v.ip, v.ua), referrer: v.referrer });
  }
  await sql`insert into page_views ${sql(rows)}`;
  return rows.length;
}

export const pendingViews = () => buf().views.length;
export function resetViews() {
  const b = buf();
  if (b.timer) clearTimeout(b.timer);
  b.views = []; b.timer = null; b.salts.clear();
}

/** Never awaited by the request: views wait in memory and are written in one insert every few seconds. */
export function recordView(req: Request, ip: string, sql: () => SQL, now = Date.now()) {
  const v = viewOf(req, ip, now);
  if (!v) return;
  const b = buf();
  if (b.views.length >= MAX_BUFFER) return;
  b.views.push(v);
  b.sql = sql;
  if (b.timer) return;
  b.timer = setTimeout(() => {
    b.timer = null;
    flushViews(b.sql!()).catch((e) => console.error("page view flush failed", e));
  }, FLUSH_MS);
  (b.timer as { unref?: () => void }).unref?.();
}
