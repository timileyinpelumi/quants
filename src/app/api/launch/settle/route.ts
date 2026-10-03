import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, readJson, rateLimit } from "@/web/server/http";
import { confirmLaunch } from "@/launch/confirm";
import { waitForSignature } from "@/web/server/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ signature: z.string().min(32).max(100), mint: z.string().min(32).max(44) });

/** Waits (up to ~40s) for a launch transaction through the server's providers and records the launch once it lands. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "settle", 30);
    const c = getContext();
    const b = Body.parse(await readJson(req));
    const [known] = await c.sql`select id from launches where mint = ${b.mint}`;
    if (known) return json({ state: "recorded", launchId: Number(known.id) });
    const state = await waitForSignature(c.conn, b.signature, { timeoutMs: 40_000, pollMs: 1_000 });
    if (state !== "confirmed") return json({ state });
    const launchId = await confirmLaunch({ sql: c.sql, conn: c.conn, meteora: c.meteora, spillWallet: c.spillWallet }, b);
    return json({ state: "recorded", launchId });
  } catch (e) {
    return jsonError(e);
  }
}
