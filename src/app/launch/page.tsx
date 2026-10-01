import { Header } from "@/web/ui/Header";
import { LaunchForm } from "@/web/launch/LaunchForm";
import { getContext } from "@/web/server/context";
import { loadLatestSettings } from "@/domain/settings";
import { launchableQuotes, quoteIcons } from "@/web/server/quotes";

export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const ctx = getContext();
  const s = await loadLatestSettings(ctx.sql);
  // only pairs whose curve configs exist on this network can be launched
  const coins = await launchableQuotes(ctx);
  const icons = await quoteIcons(ctx, coins.map((c) => c.mint), coins);
  const quotes = coins.map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, graduation: c.graduation, icon: icons[c.mint] ?? null, kind: c.kind, tradingOnly: c.tradingOnly }));
  return (
    <div className="flex-1 bg-launch">
      <Header active="launch" />
      <LaunchForm split={s.split} tiers={s.tiers} maxPenaltyBps={s.maxPenaltyBps} quotes={quotes} />
    </div>
  );
}
