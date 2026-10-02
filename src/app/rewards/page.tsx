import type { Metadata } from "next";
import { Header } from "@/web/ui/Header";
import { fmtCompact } from "@/web/ui/format";
import { PaymentsList, StakerTokensList } from "@/web/rewards/RewardsLists";
import { getContext } from "@/web/server/context";
import { rewardsOverview } from "@/web/server/rewards";
import { usdPrices } from "@/web/server/prices";
import { MobileTabs, TabPanel, TabRow } from "@/web/ui/MobileTabs";

export const metadata: Metadata = { title: "Rewards", description: "What every token has set aside for its stakers, and each reward payment on chain." };
export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const ctx = getContext();
  const r = await rewardsOverview(ctx.sql);
  const px = await usdPrices(ctx, r.recent.map((p) => p.rewardMint)).catch(() => ({} as Record<string, number | null>));
  const stats: [string, string, string][] = [
    ["Set aside for stakers", `$${fmtCompact(r.stats.setAsideUsd)}`, "Basket share of every trading fee, valued now"],
    ["Reward payments", fmtCompact(r.stats.payments), "One per farm funding transaction"],
    ["Tokens paying", fmtCompact(r.stats.payingTokens), "Have paid stakers at least once"],
    ["Early exit burns", fmtCompact(r.stats.burns), "Penalties burned on chain"],
  ];
  return (
    <div className="flex-1 bg-launch">
      <Header active="rewards" />
      <main className="wrap flex flex-col gap-12 pt-8 md:pt-12 pb-20">
        <div className="flex flex-col gap-3 max-w-3xl">
          <h1 className="m-0 font-display font-black text-[36px] md:text-[48px] tracking-[-0.03em] leading-none">Rewards</h1>
          <p className="m-0 text-lg text-muted leading-relaxed">Fees are collected every few minutes. The stakers&apos; share buys each token&apos;s reward basket and funds its farms. Every payment below links to its transaction.</p>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6 md:py-6 md:border-y line">
          {stats.map(([l, v, sub]) => (
            <div key={l} className="flex flex-col gap-1">
              <span className="text-[13px] text-muted">{l}</span>
              <span className="font-display font-bold text-2xl md:text-[30px]">{v}</span>
              <span className="text-[12px] text-faint">{sub}</span>
            </div>
          ))}
        </section>

        <MobileTabs ids={["tokens", "payments"]}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-12 max-md:gap-y-5">
          <TabRow label="Reward lists" tabs={[["tokens", "Top tokens"], ["payments", "Latest payments"]]} />
          <TabPanel show="tokens">
          <section className="flex flex-col">
            <h2 className="m-0 pb-3 font-display font-bold text-xl">Top tokens for stakers</h2>
            <StakerTokensList initial={r.top} nextOffset={r.topNext} />
          </section>
          </TabPanel>

          <TabPanel show="payments">
          <section className="flex flex-col">
            <h2 className="m-0 pb-3 font-display font-bold text-xl">Latest reward payments</h2>
            <PaymentsList initial={r.recent.map((p) => ({ ...p, priceUsd: px[p.rewardMint] ?? null }))} next={r.recentNext} />
          </section>
          </TabPanel>
        </div>
        </MobileTabs>
      </main>
    </div>
  );
}
