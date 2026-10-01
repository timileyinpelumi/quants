import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { searchTokens } from "@/web/server/token-search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(req, "search", 120);
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length === 0) return json({ tokens: await getContext().jupiter.popularVerified(), popular: true });
    if (q.length < 2 || q.length > 64) return json({ tokens: [] });
    return json({ tokens: await searchTokens(getContext().jupiter, q) });
  } catch (e) {
    return jsonError(e);
  }
}
