import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { launchCostParts } from "@/web/server/launch-quote";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(req, "launch-cost", 60);
    const sp = new URL(req.url).searchParams;
    return json(await launchCostParts(getContext(), sp.get("quoteMint") ?? "", Number(sp.get("fee") ?? 0)));
  } catch (e) {
    return jsonError(e);
  }
}
