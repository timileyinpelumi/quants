import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { launchDetail } from "@/web/server/reads";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const d = await launchDetail(getContext(), (await params).mint);
    return d ? json(d) : json({ error: { code: "not_found", message: "Token not found" } }, 404);
  } catch (e) {
    return jsonError(e);
  }
}
