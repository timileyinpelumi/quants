import { Avatar } from "./Avatar";

type Coin = { mint: string; symbol: string; icon: string | null };

export function CoinStack({ coins, size = 20, max = 4 }: { coins: Coin[]; size?: number; max?: number }) {
  if (coins.length === 0) return <span className="text-muted">No basket</span>;
  const shown = coins.slice(0, max);
  const label = coins.length <= 3 ? coins.map((c) => c.symbol).join(", ") : `${coins.slice(0, 2).map((c) => c.symbol).join(", ")} and ${coins.length - 2} more`;
  return (
    <span className="inline-flex items-center gap-2 min-w-0" title={coins.map((c) => c.symbol).join(", ")}>
      <span className="inline-flex shrink-0">
        {shown.map((c, i) => (
          <span key={c.mint} className="rounded-full ring-2 ring-ground" style={{ marginLeft: i ? -size * 0.35 : 0, borderRadius: size }}>
            <Avatar seed={c.mint} label={c.symbol} image={c.icon} size={size} />
          </span>
        ))}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export function CoinTag({ coin, size = 16 }: { coin: Coin; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar seed={coin.mint} label={coin.symbol} image={coin.icon} size={size} />
      {coin.symbol}
    </span>
  );
}
