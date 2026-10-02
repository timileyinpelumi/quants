import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { tokenLive } from "@/web/server/token-live";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    rateLimit(req, "live", 240);
    const live = await tokenLive(getContext(), (await params).mint);
    if (!live) return json({ error: { code: "not_found", message: "Token not found" } }, 404);
    return json(live);
  } catch (e) {
    return jsonError(e);
  }
}
