import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/web/ui/Header";
import { Avatar } from "@/web/ui/Avatar";
import { shortAddr } from "@/web/ui/format";
import { getContext } from "@/web/server/context";
import { launchDetail } from "@/web/server/reads";
import { StakeApp } from "@/web/stake/StakeApp";

export const dynamic = "force-dynamic";

export default async function StakePage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const d = await launchDetail(getContext(), mint);
  if (!d) notFound();
  const symbol = d.launch.symbol ?? shortAddr(mint);
  return (
    <div className="flex-1 bg-stake-page">
      <Header active="token" />
      <div className="wrap pt-8">
        <Link href={`/t/${mint}`} className="inline-flex items-center gap-3 min-h-11 text-muted hover:text-ink">
          <Avatar seed={mint} label={symbol} image={d.launch.image} size={32} />
          <span className="font-semibold">{symbol}</span>
          <span className="text-sm">Back to token</span>
        </Link>
      </div>
      <StakeApp
        mint={mint}
        symbol={symbol}
        tiers={d.tiers.map((t) => ({ id: t.tierId, lockSeconds: t.lockSeconds, multiplierBps: t.multiplierBps }))}
        maxPenaltyBps={d.maxPenaltyBps}
        ready={d.stakeReady}
        opens={d.stakingOpens}
      />
    </div>
  );
}
