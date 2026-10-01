export function StakingAt({ pct, tradingOnly = false }: { pct: number | null; tradingOnly?: boolean }) {
  if (tradingOnly) return <TradingOnly />;
  if (pct === null) return null;
  return <span className="font-mono text-[12px] text-stake-light shrink-0 whitespace-nowrap">Staking at {pct}%</span>;
}

export function TradingOnly() {
  return <span className="text-[11px] font-semibold text-muted shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full border border-white/10">Trading only</span>;
}
