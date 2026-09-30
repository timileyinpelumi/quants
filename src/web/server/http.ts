import { ZodError } from "zod";
import { LaunchError } from "@/launch/prepare";

export class LimitError extends Error {
  constructor(public status: 413 | 429, message: string) { super(message); }
}

const hits = new Map<string, { count: number; resetAt: number }>();
export const resetRateLimits = () => hits.clear();

// In-memory and per process: enough for one web server behind Caddy, which sets x-forwarded-for.
export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.resetAt < now) { hits.set(key, { count: 1, resetAt: now + windowMs }); return; }
  if (++h.count > limit) throw new LimitError(429, "Too many requests, wait a minute and try again");
}

export function limitBody(req: Request, maxBytes: number) {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new LimitError(413, "That upload is too large");
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, replacer), { status, headers: { "content-type": "application/json" } });

export function jsonError(e: unknown): Response {
  if (e instanceof LaunchError) return json({ error: { code: e.code, message: e.message } }, 400);
  if (e instanceof LimitError) return json({ error: { code: e.status === 413 ? "too_large" : "rate_limited", message: e.message } }, e.status);
  if (e instanceof AuthError) return json({ error: { code: e.status === 401 ? "unauthorized" : "forbidden", message: e.message } }, e.status);
  if (e instanceof ZodError) return json({ error: { code: "invalid_input", message: e.issues.map((i) => i.message).join("; ") } }, 400);
  console.error(e);
  return json({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new LaunchError("invalid_input", "Body must be JSON");
  }
}
