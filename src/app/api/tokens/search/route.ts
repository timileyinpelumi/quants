import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { platformRewardToken, popularRewardTokens, rewardTokens, searchTokens } from "@/web/server/token-search";
import type { VerifiedToken } from "@/jupiter/port";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(req, "search", 120);
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    const c = getContext();
    const own = await platformRewardToken(c);
    const lead = (list: VerifiedToken[], show: boolean) => (own && show ? [own, ...list.filter((t) => t.mint !== own.mint)] : list);
    if (q.length === 0) return json({ tokens: lead(await popularRewardTokens(c.jupiter, c.rewardMints), true), popular: true });
    if (q.length < 2 || q.length > 64) return json({ tokens: [] });
    const ql = q.toLowerCase();
    const matches = !!own && (own.symbol.toLowerCase().includes(ql) || own.name.toLowerCase().includes(ql) || own.mint === q);
    return json({ tokens: lead(await rewardTokens(c.rewardMints, await searchTokens(c.jupiter, q)), matches) });
  } catch (e) {
    return jsonError(e);
  }
}
