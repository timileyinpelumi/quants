import { getContext } from "@/web/server/context";
import { adminJson, jsonError, readJson } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { decidePayouts, listPayouts } from "@/web/server/stake-payouts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "read");
    return adminJson({ payouts: await listPayouts(c) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getContext();
    const s = await requireAdmin(c, req, "full");
    return adminJson(await decidePayouts(c, await readJson(req), s.by));
  } catch (e) {
    return jsonError(e);
  }
}
