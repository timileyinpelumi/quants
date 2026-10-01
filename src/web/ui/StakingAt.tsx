export function StakingAt({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return <span className="font-mono text-[12px] text-stake-light shrink-0 whitespace-nowrap">Staking at {pct}%</span>;
}
