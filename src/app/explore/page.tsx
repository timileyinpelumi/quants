import Link from "next/link";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { fmtAmount, shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { listLaunches } from "@/web/server/reads";

export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ graduated?: string }> }) {
  const graduated = (await searchParams).graduated === "1";
  const launches = await listLaunches(getContext().sql, { graduated: graduated || undefined });
  const tab = (on: boolean) => `px-5 min-h-11 flex items-center rounded-full text-sm font-semibold ${on ? "bg-raised-2 border border-white/10 text-ink" : "text-muted hover:text-ink"}`;

  return (
    <div className="flex-1 bg-launch">
      <Header active="explore" />
      <main className="flex flex-col gap-8 wrap pt-10 md:pt-14 pb-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] tracking-[-0.03em] leading-none">Explore</h1>
          <nav className="flex gap-2" aria-label="Filter">
            <Link href="/explore" className={tab(!graduated)}>All</Link>
            <Link href="/explore?graduated=1" className={tab(graduated)}>Graduated</Link>
          </nav>
        </div>
        {launches.length === 0 ? (
          <div className="flex flex-col items-start gap-4 py-16 border-t line">
            <p className="m-0 text-lg text-muted">Nothing launched yet.</p>
            <Link href="/launch" className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 flex items-center">Launch the first one</Link>
          </div>
        ) : (
          <div className="flex flex-col">
            {launches.map((l) => (
              <Link key={l.mint} href={`/t/${l.mint}`} className="grid grid-cols-[52px_minmax(0,1fr)_auto] md:grid-cols-[52px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_160px] gap-4 md:gap-6 items-center py-4 border-t line hover:bg-white/[0.02]">
                <Avatar seed={l.mint} label={l.symbol ?? "?"} image={l.image} size={52} />
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-display font-bold text-lg truncate">{l.symbol ?? shortAddr(l.mint)}</span>
                  <span className="text-[13px] text-muted truncate">{l.name ?? ""} · {l.quoteMint === SOL ? "SOL" : process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "OURTOKEN"} · {l.feeTierBps / 100}% fee</span>
                </span>
                <span className="hidden md:flex flex-col gap-0.5">
                  <span className="text-[13px] text-muted">Stakers earn</span>
                  <span className="font-semibold truncate">{l.basket.map((b) => b.symbol ?? shortAddr(b.mint)).join(" + ")}</span>
                </span>
                <span className="hidden md:flex flex-col gap-0.5">
                  <span className="text-[13px] text-muted">Burned</span>
                  <span className="font-mono">{fmtAmount(l.burned, 6, 0)}</span>
                </span>
                <span className={`text-sm font-semibold text-right ${l.status === "graduated" ? "text-lime" : "text-muted"}`}>{l.status === "graduated" ? "Graduated" : "On the curve"}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
