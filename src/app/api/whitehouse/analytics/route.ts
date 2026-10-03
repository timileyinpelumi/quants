import { z } from "zod";
import { getContext } from "@/web/server/context";
import { adminJson, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { queryOf } from "@/web/server/paging";
import { RANGES, cachedReport } from "@/web/server/analytics";

export const dynamic = "force-dynamic";

const Query = z.object({ range: z.enum(RANGES, { message: "Pick 24h, 7d, 30d or all" }).default("7d") });

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "read");
    const { range } = Query.parse(queryOf(req));
    return adminJson(await cachedReport(c, range));
  } catch (e) {
    return jsonError(e);
  }
}
