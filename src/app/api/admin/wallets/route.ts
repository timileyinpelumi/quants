import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { platformWallets } from "@/web/server/platform-wallets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    return json({ wallets: await platformWallets(c) });
  } catch (e) {
    return jsonError(e);
  }
}
