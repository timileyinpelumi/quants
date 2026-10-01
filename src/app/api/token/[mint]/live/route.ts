import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { tokenLive } from "@/web/server/token-live";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const live = await tokenLive(getContext(), (await params).mint);
    if (!live) return json({ error: { code: "not_found", message: "Token not found" } }, 404);
    return json(live);
  } catch (e) {
    return jsonError(e);
  }
}
