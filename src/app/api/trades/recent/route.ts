import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { recentBuys } from "@/web/server/landing";
import { pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({ limit: pageParams(12).limit });

export async function GET(req: Request) {
  try {
    const o = Query.parse(queryOf(req));
    return json({ buys: await recentBuys(getContext().sql, o.limit) });
  } catch (e) {
    return jsonError(e);
  }
}
