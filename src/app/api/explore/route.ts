import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { iconsFor } from "@/web/server/icons";
import { quoteCoins } from "@/domain/quotes";
import { EXPLORE_FILTERS, EXPLORE_SORTS, exploreTokens } from "@/web/server/landing";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({
  sort: z.enum(EXPLORE_SORTS).default("trending"),
  filter: z.enum(EXPLORE_FILTERS).default("all"),
  q: z.string().max(100).default(""),
  quote: z.string().max(64).optional(),
  ...pageParams(30),
});

export async function GET(req: Request) {
  try {
    const o = Query.parse(queryOf(req));
    const ctx = getContext();
    const r = page(await exploreTokens(ctx.sql, { ...o, limit: o.limit + 1 }, Date.now(), (m) => iconsFor(ctx.icons, m, quoteCoins())), o.limit);
    return json({ tokens: r.rows, nextOffset: r.more ? o.offset + o.limit : null });
  } catch (e) {
    return jsonError(e);
  }
}
