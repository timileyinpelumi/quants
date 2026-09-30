import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return json({ tokens: [] });
    return json({ tokens: (await getContext().jupiter.searchVerified(q)).slice(0, 20) });
  } catch (e) {
    return jsonError(e);
  }
}
