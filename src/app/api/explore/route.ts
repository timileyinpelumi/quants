import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { allQuotes, quoteIcons } from "@/web/server/quotes";
import { EXPLORE_FILTERS, EXPLORE_SORTS, exploreTokens, withSparks } from "@/web/server/landing";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({
  sort: z.enum(EXPLORE_SORTS).default("trending"),
  filter: z.enum(EXPLORE_FILTERS).default("all"),
  q: z.string().max(100).default(""),
  quote: z.string().max(64).optional(),
  spark: z.enum(["1"]).optional(),
  ...pageParams(30),
});

export async function GET(req: Request) {
  try {
    const o = Query.parse(queryOf(req));
    const ctx = getContext();
    const now = Date.now();
    const r = page(await exploreTokens(ctx.sql, { ...o, limit: o.limit + 1 }, now, async (m) => quoteIcons(ctx, m, await allQuotes(ctx))), o.limit);
    return json({ tokens: o.spark ? await withSparks(ctx.sql, r.rows, now) : r.rows, nextOffset: r.more ? o.offset + o.limit : null });
  } catch (e) {
    return jsonError(e);
  }
}
