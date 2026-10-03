import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { voteTotals } from "@/web/server/votes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    return json({ tokens: await voteTotals(c.sql, 100) });
  } catch (e) {
    return jsonError(e);
  }
}
