import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { z } from "zod";
import { candles, market, TIMEFRAMES } from "@/web/server/chart";
import { queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({ tf: z.enum(TIMEFRAMES).default("5M") });

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    rateLimit(req, "chart", 240);
    const { tf } = Query.parse(queryOf(req));
    const { sql } = getContext();
    const [l] = await sql`select id from launches where mint = ${(await params).mint}`;
    if (!l) return json({ error: { code: "not_found", message: "Token not found" } }, 404);
    const [c, m] = await Promise.all([candles(sql, Number(l.id), tf), market(sql, Number(l.id))]);
    return json({ ...c, market: m });
  } catch (e) {
    return jsonError(e);
  }
}
