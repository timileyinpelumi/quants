import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { walletOverview } from "@/web/server/wallet";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ owner: string }> }) {
  try {
    rateLimit(req, "wallet", 60);
    return json(await walletOverview(getContext(), (await params).owner));
  } catch (e) {
    return jsonError(e);
  }
}
