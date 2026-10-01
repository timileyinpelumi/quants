import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { rewardPayments } from "@/web/server/rewards";
import { usdPrices } from "@/web/server/prices";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({
  limit: pageParams(20).limit,
  before: z.coerce.number().int().positive().optional(),
});

export async function GET(req: Request) {
  try {
    const o = Query.parse(queryOf(req));
    const ctx = getContext();
    const r = page(await rewardPayments(ctx.sql, o.limit + 1, o.before ?? null), o.limit);
    const px = await usdPrices(ctx, r.rows.map((p) => p.rewardMint)).catch(() => ({} as Record<string, number | null>));
    return json({
      payments: r.rows.map((p) => ({ ...p, priceUsd: px[p.rewardMint] ?? null })),
      next: r.more ? String(r.rows.at(-1)!.id) : null,
    });
  } catch (e) {
    return jsonError(e);
  }
}
