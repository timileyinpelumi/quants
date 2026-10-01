import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { parseTradeCursor, recentTrades, tradeCursor } from "@/web/server/landing";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({
  limit: pageParams(25).limit,
  before: z.string().optional().transform((s, c) => {
    if (s === undefined) return null;
    const cur = parseTradeCursor(s);
    if (!cur) c.addIssue({ code: "custom", message: "before must be a trade cursor" });
    return cur;
  }),
});

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const o = Query.parse(queryOf(req));
    const { sql } = getContext();
    const [l] = await sql`select id from launches where mint = ${(await params).mint}`;
    if (!l) return json({ error: { code: "not_found", message: "Token not found" } }, 404);
    const r = page(await recentTrades(sql, Number(l.id), o.limit + 1, o.before), o.limit);
    return json({ trades: r.rows, next: r.more ? tradeCursor(r.rows.at(-1)!) : null });
  } catch (e) {
    return jsonError(e);
  }
}
