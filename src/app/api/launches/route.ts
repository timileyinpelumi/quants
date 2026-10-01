import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { listLaunches } from "@/web/server/reads";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({ graduated: z.string().optional(), ...pageParams(50) });

export async function GET(req: Request) {
  try {
    const o = Query.parse(queryOf(req));
    const r = page(await listLaunches(getContext().sql, { graduated: o.graduated === "1" ? true : undefined, limit: o.limit + 1, offset: o.offset }), o.limit);
    return json({ launches: r.rows, nextOffset: r.more ? o.offset + o.limit : null });
  } catch (e) {
    return jsonError(e);
  }
}
