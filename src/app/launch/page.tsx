import { Header } from "@/web/ui/Header";
import { LaunchForm } from "@/web/launch/LaunchForm";
import { getContext } from "@/web/server/context";
import { cachedSettings } from "@/domain/settings";
import { launchableQuotes, quoteIcons } from "@/web/server/quotes";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ pair?: string }> }) {
  const { pair } = await searchParams;
  const ctx = getContext();
  const s = await cachedSettings(ctx.sql);
  const coins = await launchableQuotes(ctx);
  const icons = await quoteIcons(ctx, coins.map((c) => c.mint), coins);
  const quotes = coins.map((c) => ({ mint: c.mint, symbol: c.symbol, name: c.name, decimals: c.decimals, graduation: c.graduation, icon: icons[c.mint] ?? null, kind: c.kind, tradingOnly: c.tradingOnly }));
  return (
    <div className="flex-1 bg-launch">
      <Header active="launch" />
      <LaunchForm split={s.split} tiers={s.tiers} maxPenaltyBps={s.maxPenaltyBps} quotes={quotes} feeTiers={s.feeTiersBps} paused={s.launchesPaused} initialPair={quotes.some((q) => q.mint === pair) ? pair : undefined} />
    </div>
  );
}
