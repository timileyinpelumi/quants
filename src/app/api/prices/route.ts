import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { usdPrices } from "@/web/server/prices";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const mints = (new URL(req.url).searchParams.get("mints") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    if (mints.length > 100) return json({ error: { code: "invalid_input", message: "At most 100 mints" } }, 400);
    return json({ prices: await usdPrices(getContext(), mints) });
  } catch (e) {
    return jsonError(e);
  }
}
