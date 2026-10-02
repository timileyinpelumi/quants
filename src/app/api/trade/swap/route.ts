import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit, readJson } from "@/web/server/http";
import { buildTrade } from "@/web/server/trade";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    rateLimit(req, "swap", 30);
    return json({ transaction: await buildTrade(getContext(), await readJson(req)) });
  } catch (e) {
    return jsonError(e);
  }
}
