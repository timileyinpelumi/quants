import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { recentTrades } from "@/web/server/landing";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const { sql } = getContext();
    const [l] = await sql`select id from launches where mint = ${(await params).mint}`;
    if (!l) return json({ error: { code: "not_found", message: "No token here" } }, 404);
    return json({ trades: await recentTrades(sql, Number(l.id), 25) });
  } catch (e) {
    return jsonError(e);
  }
}
