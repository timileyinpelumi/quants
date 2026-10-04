import { getContext } from "@/web/server/context";
import { adminJson, jsonError, readJson } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { approveBurns, listBurns } from "@/web/server/burns";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "read");
    return adminJson({ burns: await listBurns(c) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getContext();
    const s = await requireAdmin(c, req, "full");
    return adminJson(await approveBurns(c, await readJson(req), s.by));
  } catch (e) {
    return jsonError(e);
  }
}
