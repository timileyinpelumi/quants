import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit, readJson } from "@/web/server/http";
import { prepareWithSwap } from "@/web/server/launch";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    rateLimit(req, "prepare", 20);
    return json(await prepareWithSwap(getContext(), await readJson(req)));
  } catch (e) {
    return jsonError(e);
  }
}
