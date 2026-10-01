import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { topTraders } from "@/web/server/live";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object(pageParams(10));

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const o = Query.parse(queryOf(req));
    const { sql } = getContext();
    const [l] = await sql`select l.id, (select price from trades where launch_id = l.id order by slot desc, seq desc limit 1) as price
      from launches l where l.mint = ${(await params).mint}`;
    if (!l) return json({ error: { code: "not_found", message: "No token here" } }, 404);
    const r = page(await topTraders(sql, Number(l.id), l.price ?? 0, o.limit + 1, o.offset), o.limit);
    return json({ traders: r.rows, nextOffset: r.more ? o.offset + o.limit : null });
  } catch (e) {
    return jsonError(e);
  }
}
