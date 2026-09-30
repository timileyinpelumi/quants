import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import type { Timeframe } from "@/web/server/chart";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const c = getContext();
    const [l] = await c.sql`select pool, damm_pool, status from launches where mint = ${(await params).mint}`;
    if (!l) return json({ error: { code: "not_found", message: "No token here" } }, 404);
    const tfRaw = new URL(req.url).searchParams.get("tf");
    const tf: Timeframe = tfRaw === "1H" || tfRaw === "1W" ? tfRaw : "1D";
    const pool = l.status === "graduated" && l.damm_pool ? l.damm_pool : l.pool;
    const [candles, market] = await Promise.all([c.chart.candles(pool, tf), c.chart.market(pool)]);
    return json({ candles, market });
  } catch (e) {
    return jsonError(e);
  }
}
