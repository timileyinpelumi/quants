import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { usdPrices } from "@/web/server/prices";

export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: Request) {
  try {
    rateLimit(req, "prices", 120);
    const mints = (new URL(req.url).searchParams.get("mints") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    if (mints.length > 100) return json({ error: { code: "invalid_input", message: "At most 100 mints" } }, 400);
    if (mints.some((m) => !MINT.test(m))) return json({ error: { code: "invalid_input", message: "Mints must be base58 addresses" } }, 400);
    return json({ prices: await usdPrices(getContext(), mints) });
  } catch (e) {
    return jsonError(e);
  }
}
