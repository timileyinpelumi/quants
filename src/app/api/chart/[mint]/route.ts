import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { candles, market, type Timeframe } from "@/web/server/chart";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const { sql } = getContext();
    const [l] = await sql`select id from launches where mint = ${(await params).mint}`;
    if (!l) return json({ error: { code: "not_found", message: "No token here" } }, 404);
    const tfRaw = new URL(req.url).searchParams.get("tf");
    const tf: Timeframe = tfRaw === "1H" || tfRaw === "1W" ? tfRaw : "1D";
    const [c, m] = await Promise.all([candles(sql, Number(l.id), tf), market(sql, Number(l.id))]);
    return json({ ...c, market: m });
  } catch (e) {
    return jsonError(e);
  }
}
