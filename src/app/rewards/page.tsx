import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { fmtAgo, fmtCompact, fmtPrice } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { rewardsOverview } from "@/web/server/rewards";
import { usdPrices } from "@/web/server/prices";

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-12">
          <section className="flex flex-col">
            <h2 className="m-0 pb-3 font-display font-bold text-xl">Top tokens for stakers</h2>
            {r.top.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No fees collected yet.</p> : r.top.map((t, i) => (
              <Link key={t.mint} href={`/t/${t.mint}`} className="grid grid-cols-[28px_40px_minmax(0,1fr)_auto] gap-3 items-center py-3 border-t line hover:bg-white/[0.02]">
                <span className="font-mono text-sm text-faint">{i + 1}</span>
                <Avatar seed={t.mint} label={t.symbol} image={t.image} size={40} />
                <span className="flex flex-col min-w-0">
                  <span className="font-display font-bold truncate">{t.symbol}</span>
                  <span className="text-[12px] text-muted truncate">Pays {t.basket.join(", ")}</span>
                </span>
                <span className="flex flex-col items-end font-mono text-sm">
                  <span>${fmtPrice(t.setAsideUsd)}</span>
                  <span className="text-[12px] text-muted">{t.payments} {t.payments === 1 ? "payment" : "payments"}</span>
                </span>
              </Link>
            ))}
          </section>

          <section className="flex flex-col">
            <h2 className="m-0 pb-3 font-display font-bold text-xl">Latest reward payments</h2>
            {r.recent.length === 0 ? <p className="m-0 py-6 border-t line text-muted text-sm">No rewards paid yet. They start once someone stakes.</p> : r.recent.map((p) => (
              <div key={p.signature} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center py-3 border-t line text-sm">
                <span className="flex flex-col min-w-0">
                  <Link href={`/t/${p.mint}`} className="font-display font-bold hover:text-lime truncate">{p.symbol} stakers</Link>
                  <span className="font-mono text-[12px] text-muted">{fmtCompact(p.amount)} {p.reward}{px[p.rewardMint] != null ? ` ($${fmtPrice(p.amount * px[p.rewardMint]!)})` : ""} added to the farm</span>
                </span>
                <a href={`https://solscan.io/tx/${p.signature}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-muted hover:text-ink text-right">{fmtAgo(p.at)}</a>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
