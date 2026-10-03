import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { popularRewardTokens, rewardTokens, searchTokens } from "@/web/server/token-search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(req, "search", 120);
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    const c = getContext();
    if (q.length === 0) return json({ tokens: await popularRewardTokens(c.jupiter, c.rewardMints), popular: true });
    if (q.length < 2 || q.length > 64) return json({ tokens: [] });
    return json({ tokens: await rewardTokens(c.rewardMints, await searchTokens(c.jupiter, q)) });
  } catch (e) {
    return jsonError(e);
  }
}
