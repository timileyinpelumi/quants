import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { firstBuyEstimate } from "@/web/server/first-buy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(req, "first-buy", 60);
    return json(await firstBuyEstimate(getContext(), new URL(req.url).searchParams));
  } catch (e) {
    return jsonError(e);
  }
}
