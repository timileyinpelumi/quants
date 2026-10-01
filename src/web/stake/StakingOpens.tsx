"use client";
import { fmtAmount } from "@/web/ui/format";
import { useUsd, usdText } from "@/web/ui/usd";
import { useTokenLive } from "@/web/token/TokenLive";
import type { StakingOpens as Opens } from "@/web/server/reads";

const SOL = "So11111111111111111111111111111111111111112";
const sol = (lamports: string) => `${fmtAmount(lamports, 9, 3)} SOL`;

/** Progress toward opening staking; renders nothing once staking is open. Follows the live token feed when there is one. */
export function StakingOpens({ initial }: { initial: Opens | null }) {
  const live = useTokenLive();
  const solUsd = useUsd([SOL])[SOL];
  const o = live ? live.staking : initial;
  if (!o) return null;
  const usd = (lamports: string) => usdText(Number(BigInt(lamports)) / 1e9, solUsd);
  const needed = o.neededLamports;
  return (
    <div role="group" className="flex flex-col gap-2" aria-label="Staking progress">
      <span className="flex justify-between text-[13px] text-muted"><span>Staking opens at 100%</span><span className="font-mono text-ink">{o.percent}%</span></span>
      <span className="h-2 rounded-full bg-white/[0.07] overflow-hidden flex">
        <span className="rounded-full bg-stake-light transition-[width] duration-700" style={{ width: `${o.percent}%` }} />
      </span>
      <span className="text-[13px] text-muted leading-normal">
        {needed === null
          ? "The stakers' share of trading fees first pays for the staking farms."
          : needed === "0"
            ? "The farms are paid for. Staking opens within a few minutes."
            : `The stakers' share of trading fees first pays the ${sol(o.rentLamports)} farm setup. ${sol(needed)}${usd(needed) ? ` (${usd(needed)})` : ""} to go.`}
      </span>
    </div>
  );
}
