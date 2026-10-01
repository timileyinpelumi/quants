"use client";
import { fmtCompact, fmtPrice } from "@/web/ui/format";
import { useTokenLive } from "./TokenLive";

export function MarketStats({ quoteSymbol }: { quoteSymbol: string }) {
  const live = useTokenLive();
  const m = live?.market ?? null;
  const changes = (live?.activity ?? []).filter((a) => a.change !== null);
  const dash = <span className="font-sans font-normal text-base text-faint">No trades yet</span>;
  const price = m && (m.priceUsd !== null ? `$${fmtPrice(m.priceUsd)}` : `${fmtPrice(m.price)} ${quoteSymbol}`);
  const cap = m && (m.fdvUsd !== null ? `$${fmtCompact(m.fdvUsd)}` : `${fmtCompact(m.price * 1e9)} ${quoteSymbol}`);
  const vol = m && (m.volume24hUsd !== null ? `$${fmtCompact(m.volume24hUsd)}` : `${fmtCompact(m.volume24h)} ${quoteSymbol}`);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Price</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? price : dash}</span>
        {m && <span className={`font-mono text-sm ${m.change24h >= 0 ? "text-accent" : "text-burn"}`}>{m.change24h >= 0 ? "+" : ""}{m.change24h.toFixed(1)}% today</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Market cap</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? cap : dash}</span>
        <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[12px]">
          {changes.length ? changes.map((a) => (
            <span key={a.window} className="text-muted">{a.window} <span className={a.change! >= 0 ? "text-accent" : "text-burn"}>{a.change! >= 0 ? "+" : ""}{a.change!.toFixed(1)}%</span></span>
          )) : <span className="text-muted">1B supply</span>}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Volume today</span>
        <span className="font-display font-bold text-2xl md:text-[30px]">{m ? vol : dash}</span>
        {m && <span className="font-mono text-sm text-muted">{m.trades24h} {m.trades24h === 1 ? "trade" : "trades"}</span>}
      </div>
    </>
  );
}

export function GraduationBar({ initial, quoteSymbol, quoteDecimals }: { initial: { reserve: string; threshold: string; progress: number; migrated: boolean }; quoteSymbol: string; quoteDecimals: number }) {
  const live = useTokenLive();
  const graduated = live?.status === "graduated" || initial.migrated;
  const c = live?.curve ?? initial;
  const whole = (v: string) => (Number(BigInt(v)) / 10 ** quoteDecimals).toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (graduated) {
    return (
      <>
        <span className="text-[13px] text-muted">Graduated</span>
        <span className="font-mono text-sm text-accent">Trading on Meteora DAMM v2</span>
      </>
    );
  }
  return (
    <>
      <span className="flex justify-between text-[13px] text-muted"><span>To graduation</span><span className="font-mono text-ink">{c.progress}%</span></span>
      <span className="h-3 rounded-full bg-white/[0.07] overflow-hidden flex"><span className="rounded-full transition-[width] duration-700" style={{ width: `${c.progress}%`, background: "linear-gradient(90deg, #9D8CFF, #4C9DFF)" }} /></span>
      <span className="font-mono text-[13px] text-muted">{whole(c.reserve)} of {whole(c.threshold)} {quoteSymbol}{live?.quoteUsd ? ` · $${fmtCompact(Number(BigInt(c.threshold)) / 10 ** quoteDecimals * live.quoteUsd)} target` : ""}</span>
    </>
  );
}
