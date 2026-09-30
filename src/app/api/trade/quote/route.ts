import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { quoteTrade } from "@/web/server/trade";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(req, "quote", 120);
    return json(await quoteTrade(getContext(), new URL(req.url).searchParams));
  } catch (e) {
    return jsonError(e);
  }
}
