import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { loadLatestSettings, saveSettings, parseSettings } from "@/domain/settings";
import { quoteCoins } from "@/domain/quotes";

export const dynamic = "force-dynamic";

// Pair rows the editor shows; read after settings load so targets and switches follow the saved version.
const pairs = () => quoteCoins().filter((c) => !c.platform)
  .map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, decimals: c.decimals, payoutMin: c.payoutMin.toString(), graduation: c.graduation, enabled: c.enabled }));

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return json({ version, settings, pairs: pairs() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getContext();
    const by = await requireAdmin(c, req);
    await saveSettings(c.sql, parseSettings(await readJson(req)), by);
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return json({ version, settings, pairs: pairs() });
  } catch (e) {
    return jsonError(e);
  }
}
