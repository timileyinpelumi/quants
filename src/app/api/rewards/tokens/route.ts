import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { stakerTokens } from "@/web/server/rewards";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object(pageParams(20));

export async function GET(req: Request) {
  try {
    rateLimit(req, "reward-tokens", 120);
    const o = Query.parse(queryOf(req));
    const r = page(await stakerTokens(getContext().sql, o.limit + 1, o.offset), o.limit);
    return json({ tokens: r.rows, nextOffset: r.more ? o.offset + o.limit : null });
  } catch (e) {
    return jsonError(e);
  }
}
