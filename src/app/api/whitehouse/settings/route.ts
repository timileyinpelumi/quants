import { getContext } from "@/web/server/context";
import { adminJson, jsonError, readJson } from "@/web/server/http";
import { requireAdmin, type AdminRole } from "@/web/server/admin";
import { loadLatestSettings, saveSettings, parseSettings } from "@/domain/settings";
import { quoteCoins } from "@/domain/quotes";

export const dynamic = "force-dynamic";

// Pair rows the editor shows; read after settings load so targets and switches follow the saved version.
const pairs = () => quoteCoins().filter((c) => !c.platform)
  .map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, decimals: c.decimals, payoutMin: c.payoutMin.toString(), graduation: c.graduation, enabled: c.enabled }));

// The alert webhook URL lets anyone post to that channel, so read only sessions only learn whether one is set.
const forRole = <T extends { alertWebhookUrl: string }>(s: T, role: AdminRole) =>
  role === "full" ? s : { ...s, alertWebhookUrl: s.alertWebhookUrl ? "hidden" : "" };

export async function GET(req: Request) {
  try {
    const c = getContext();
    const { role } = await requireAdmin(c, req, "read");
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return adminJson({ version, settings: forRole(settings, role), pairs: pairs() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getContext();
    const { by } = await requireAdmin(c, req, "full");
    await saveSettings(c.sql, parseSettings(await readJson(req)), by);
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return adminJson({ version, settings, pairs: pairs() });
  } catch (e) {
    return jsonError(e);
  }
}
