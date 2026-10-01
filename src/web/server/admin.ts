import { SignJWT, jwtVerify } from "jose";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { WebContext } from "./context";
import { AuthError } from "./http";

const NONCE = "quants_nonce";
const SESSION = "quants_admin";
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// SITE_URL pins the origin; without it the request's own origin is used (local dev, previews).
function siteOrigin(req: Request): URL {
  if (process.env.SITE_URL) return new URL(process.env.SITE_URL);
  const u = new URL(req.url);
  return new URL(`${u.protocol}//${req.headers.get("host") ?? u.host}`);
}

export async function issueNonce(ctx: WebContext, req: Request): Promise<{ message: string; setCookie: string }> {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  const site = siteOrigin(req);
  const message = `${site.host} wants you to sign in to quants admin\n\nURI: ${site.origin}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  const token = await new SignJWT({ message, domain: site.host, typ: "nonce" }).setProtectedHeader({ alg: "HS256" }).setJti(nonce).setIssuedAt().setExpirationTime("5m").sign(ctx.sessionSecret);
  return { message, setCookie: cookie(NONCE, token, 300) };
}

const SessionBody = z.object({ wallet: z.string().min(32).max(44), signature: z.string().min(40) });

export async function openSession(ctx: WebContext, req: Request, raw: unknown): Promise<string[]> {
  const { wallet, signature } = SessionBody.parse(raw);
  const token = readCookie(req, NONCE);
  if (!token) throw new AuthError(401, "Start sign in again");
  let message: string;
  let domain: string;
  let jti: string;
  try {
    const { payload } = await jwtVerify(token, ctx.sessionSecret);
    if (payload.typ !== "nonce" || !payload.jti) throw new Error("not a nonce");
    message = payload.message as string;
    domain = payload.domain as string;
    jti = payload.jti;
  } catch {
    throw new AuthError(401, "Sign in expired, start again");
  }
  if (domain !== siteOrigin(req).host || !message.startsWith(`${domain} wants you`)) throw new AuthError(401, "Sign in from the site itself");
  let ok = false;
  try {
    ok = nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signature), new PublicKey(wallet).toBytes());
  } catch {
    ok = false;
  }
  if (!ok) throw new AuthError(401, "Signature does not match");
  if (!ctx.adminWallets.has(wallet)) throw new AuthError(403, "This wallet is not an admin");
  const used = await ctx.sql`insert into admin_nonces (jti) values (${jti}) on conflict do nothing returning jti`;
  if (used.length === 0) throw new AuthError(401, "That sign in was already used, start again");
  const session = await new SignJWT({ wallet, typ: "session" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("8h").sign(ctx.sessionSecret);
  return [cookie(SESSION, session, 8 * 3600), cookie(NONCE, "", 0)];
}

export async function requireAdmin(ctx: WebContext, req: Request): Promise<string> {
  const token = readCookie(req, SESSION);
  if (!token) throw new AuthError(401, "Sign in first");
  let wallet: string;
  try {
    const { payload } = await jwtVerify(token, ctx.sessionSecret);
    if (payload.typ !== "session") throw new Error("not a session");
    wallet = payload.wallet as string;
  } catch {
    throw new AuthError(401, "Session expired, sign in again");
  }
  if (!ctx.adminWallets.has(wallet)) throw new AuthError(403, "This wallet is no longer an admin");
  return wallet;
}
