import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { launchDetail } from "@/web/server/reads";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    rateLimit(req, "launch", 240);
    const d = await launchDetail(getContext(), (await params).mint);
    return d ? json(d) : json({ error: { code: "not_found", message: "Token not found" } }, 404);
  } catch (e) {
    return jsonError(e);
  }
}
