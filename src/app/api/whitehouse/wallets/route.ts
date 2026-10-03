import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { platformWallets } from "@/web/server/platform-wallets";
import { usdPrices } from "@/web/server/prices";
import { NATIVE_MINT } from "@/domain/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    const sol = (await usdPrices(c, [NATIVE_MINT]).catch(() => ({} as Record<string, number | null>)))[NATIVE_MINT] ?? null;
    return json({ wallets: await platformWallets(c, sol) });
  } catch (e) {
    return jsonError(e);
  }
}
