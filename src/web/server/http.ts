import { ZodError } from "zod";
import { LaunchError } from "@/launch/prepare";

export class LimitError extends Error {
  constructor(public status: 411 | 413 | 429, message: string) { super(message); }
}

const hits = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 10_000;
export const resetRateLimits = () => hits.clear();
export const limiterSize = () => hits.size;

function evict(now: number) {
  for (const [k, h] of hits) if (h.resetAt < now) hits.delete(k);
  for (const k of hits.keys()) {
    if (hits.size <= MAX_KEYS) break;
    hits.delete(k);
  }
}

// In-memory and per process. x-forwarded-for is only trusted with TRUST_PROXY=1 (behind Caddy or Vercel);
// otherwise any client could pick its own bucket, so every request shares one.
export const clientIp = (req: Request) =>
  (process.env.TRUST_PROXY === "1" && req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()) || "local";

export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000) {
  const ip = clientIp(req);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.resetAt < now) {
    hits.delete(key);
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > MAX_KEYS) evict(now);
    return;
  }
  if (++h.count > limit) throw new LimitError(429, "Too many requests. Wait a minute and try again.");
}

// Chunked bodies have no length to check up front, so they are refused.
export function limitBody(req: Request, maxBytes: number) {
  const raw = req.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) throw new LimitError(411, "Upload size is missing. Try again.");
  if (Number(raw) > maxBytes) throw new LimitError(413, "Upload is too large");
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, replacer), { status, headers: { "content-type": "application/json" } });

export function jsonError(e: unknown): Response {
  if (e instanceof LaunchError) return json({ error: { code: e.code, message: e.message } }, 400);
  if (e instanceof LimitError) return json({ error: { code: e.status === 413 ? "too_large" : e.status === 411 ? "length_required" : "rate_limited", message: e.message } }, e.status);
  if (e instanceof AuthError) return json({ error: { code: e.status === 401 ? "unauthorized" : "forbidden", message: e.message } }, e.status);
  if (e instanceof ZodError) return json({ error: { code: "invalid_input", message: e.issues.map((i) => i.message).join("; ") } }, 400);
  console.error(e);
  return json({ error: { code: "internal", message: "Something went wrong. Try again." } }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new LaunchError("invalid_input", "Request body must be JSON");
  }
}
