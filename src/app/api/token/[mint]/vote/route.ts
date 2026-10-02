import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit, readJson } from "@/web/server/http";
import { castVote, voteOf, type Vote } from "@/web/server/votes";

export const dynamic = "force-dynamic";

const Wallet = z.string().min(32).max(44).refine((s) => { try { new PublicKey(s); return true; } catch { return false; } }, "wallet must be a Solana address");
const Body = z.object({ vote: z.enum(["up", "down"]).nullable(), wallet: Wallet.optional() });
const toVote = (v: "up" | "down" | null): Vote => (v === "up" ? 1 : v === "down" ? -1 : 0);
const fromVote = (v: Vote) => (v === 1 ? "up" : v === -1 ? "down" : null);

const cookieVoter = (req: Request) => /(?:^|;\s*)quants_voter=([0-9a-f]{32})(?:;|$)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? null;

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    rateLimit(req, "vote-read", 120);
    const { mint } = await params;
    const wallet = new URL(req.url).searchParams.get("wallet");
    const voter = wallet ? Wallet.parse(wallet) : cookieVoter(req);
    return json({ vote: voter ? fromVote(await voteOf(getContext().sql, mint, voter)) : null });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    rateLimit(req, "vote", 30);
    const { mint } = await params;
    const body = Body.parse(await readJson(req));
    const { sql } = getContext();
    const [launch] = await sql`select 1 from launches where mint = ${mint}`;
    if (!launch) return json({ error: { code: "not_found", message: "No token with that address" } }, 404);
    let voter = body.wallet ?? cookieVoter(req);
    let setCookie: string | null = null;
    if (!voter) {
      voter = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
      setCookie = `quants_voter=${voter}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${365 * 86_400}`;
    }
    const vote = toVote(body.vote);
    await castVote(sql, mint, voter, vote);
    const res = json({ vote: fromVote(vote) });
    if (setCookie) res.headers.set("set-cookie", setCookie);
    return res;
  } catch (e) {
    return jsonError(e);
  }
}
