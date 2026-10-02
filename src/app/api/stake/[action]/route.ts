import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit, readJson } from "@/web/server/http";
import { buildStakeAction } from "@/web/server/stake";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    rateLimit(req, "stake", 30);
    return json({ transaction: await buildStakeAction(getContext(), (await params).action, await readJson(req)) });
  } catch (e) {
    return jsonError(e);
  }
}
