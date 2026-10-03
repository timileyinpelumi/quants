import { getContext } from "@/web/server/context";
import { adminJson, jsonError, readJson } from "@/web/server/http";
import { requireAdmin, type AdminRole } from "@/web/server/admin";
import { loadLatestSettings, saveSettings, parseSettings, type Settings } from "@/domain/settings";
import { quoteCoins } from "@/domain/quotes";
import { curveProblem } from "@/meteora/config";
import { LaunchError } from "@/launch/prepare";

export const dynamic = "force-dynamic";

// Pair rows the editor shows; read after settings load so targets and switches follow the saved version.
const pairs = () => quoteCoins().filter((c) => !c.platform)
  .map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, decimals: c.decimals, payoutMin: c.payoutMin.toString(), graduation: c.graduation, enabled: c.enabled }));

// The alert webhook URL lets anyone post to that channel, so read only sessions only learn whether one is set.
// The creator payout hold list is for the full code only and is left out entirely.
const forRole = <T extends { alertWebhookUrl: string; creatorPayoutHold?: string[] }>(s: T, role: AdminRole) => {
  if (role === "full") return s;
  const { creatorPayoutHold: _hold, ...rest } = s;
  return { ...rest, alertWebhookUrl: s.alertWebhookUrl ? "hidden" : "" };
};

/** A target the curve builder refuses would break every launch on that pair, so it is refused at save. */
function checkCurves(s: Settings) {
  for (const c of quoteCoins(undefined, s)) {
    if (!c.enabled || c.tradingOnly || !(c.graduation > 0)) continue;
    if (curveProblem({ mint: c.mint, decimals: c.decimals, migrationQuoteThreshold: c.graduation }, s.feeTiersBps)) {
      throw new LaunchError("invalid_input", `${c.symbol} cannot graduate at ${c.graduation.toLocaleString("en-US")}: no valid curve has that target. Pick another one.`);
    }
  }
}

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
    const next = parseSettings(await readJson(req));
    checkCurves(next);
    await saveSettings(c.sql, next, by);
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return adminJson({ version, settings, pairs: pairs() });
  } catch (e) {
    return jsonError(e);
  }
}
