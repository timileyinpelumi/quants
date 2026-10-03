import { getContext } from "@/web/server/context";
import { adminJson, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { platformWallets } from "@/web/server/platform-wallets";
import { usdPrices } from "@/web/server/prices";
import { NATIVE_MINT } from "@/domain/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    const { role } = await requireAdmin(c, req, "read");
    const sol = (await usdPrices(c, [NATIVE_MINT]).catch(() => ({} as Record<string, number | null>)))[NATIVE_MINT] ?? null;
    const wallets = await platformWallets(c, sol);
    // Derivation paths never reach a read only session.
    return adminJson({ wallets: role === "full" ? wallets : wallets.map(({ path: _path, ...w }) => w) });
  } catch (e) {
    return jsonError(e);
  }
}
