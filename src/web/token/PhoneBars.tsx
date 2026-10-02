"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { MobileTabs, useMobileTabs } from "@/web/ui/MobileTabs";

export type SheetTab = "buy" | "sell" | "stake";
type Sheet = { sheet: SheetTab | null; open: (t: SheetTab) => void; close: () => void };
const Ctx = createContext<Sheet | null>(null);

export const useTradeSheet = () => useContext(Ctx);

const TABS = ["chart", "trades", "rewards", "info"];
const PHONE = "(max-width: 767.98px)";

function SheetProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetTab | null>(null);

  const open = useCallback((t: SheetTab) => {
    if (!history.state?.tradeSheet) history.pushState({ tradeSheet: true }, "", location.href);
    setSheet(t);
  }, []);
  const close = useCallback(() => {
    if (history.state?.tradeSheet) history.back();
    else setSheet(null);
  }, []);

  useEffect(() => {
    const onPop = () => { if (!history.state?.tradeSheet) setSheet(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const lock = window.matchMedia(PHONE).matches;
    const prev = document.body.style.overflow;
    if (lock) document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); if (lock) document.body.style.overflow = prev; };
  }, [sheet, close]);

  return (
    <Ctx.Provider value={{ sheet, open, close }}>
      {children}
      {sheet && <div aria-hidden onClick={close} className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />}
    </Ctx.Provider>
  );
}

export function TokenPhoneShell({ children }: { children: ReactNode }) {
  return (
    <MobileTabs ids={TABS} aliases={{ insights: "trades" }}>
      <SheetProvider>{children}</SheetProvider>
    </MobileTabs>
  );
}

const icon = (d: ReactNode) => (
  <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICONS: Record<string, ReactNode> = {
  chart: icon(<><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-7" /></>),
  trades: icon(<><path d="M7 4v16" /><path d="m3 8 4-4 4 4" /><path d="M17 20V4" /><path d="m13 16 4 4 4-4" /></>),
  rewards: icon(<><circle cx="12" cy="9" r="6" /><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7" /></>),
  info: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5v.01" /></>),
};
const LABELS: Record<string, string> = { chart: "Chart", trades: "Trades", rewards: "Rewards", info: "Info" };

export function PhoneBars({ canStake }: { canStake: boolean }) {
  const tabs = useMobileTabs();
  const sheet = useTradeSheet();
  if (!tabs || !sheet) return null;
  const btn = "flex-1 min-h-12 rounded-full font-display font-bold text-[16px] cursor-pointer active:translate-y-px";
  return (
    <div data-phone-bars className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-ground/95 backdrop-blur border-t line">
      <div className="flex gap-2 px-4 pt-2.5 pb-2">
        <button type="button" onClick={() => sheet.open("buy")} className={`${btn} bg-up text-ground`}>Buy</button>
        <button type="button" onClick={() => sheet.open("sell")} className={`${btn} bg-down text-ground`}>Sell</button>
        {canStake && <button type="button" onClick={() => sheet.open("stake")} className={`${btn} bg-stake-light text-ground`}>Stake</button>}
      </div>
      <nav aria-label="Token sections" role="tablist" className="grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const on = tabs.tab === t;
          return (
            <button key={t} type="button" role="tab" aria-selected={on} onClick={() => tabs.setTab(t)}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] font-semibold cursor-pointer ${on ? "text-ink" : "text-faint"}`}>
              {on && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
              <span className={on ? "text-accent" : ""}>{ICONS[t]}</span>
              {LABELS[t]}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function StakeNowButton({ label }: { label: string }) {
  const sheet = useTradeSheet();
  return (
    <button type="button" onClick={() => sheet?.open("stake")} className="md:hidden font-semibold text-[15px] text-stake-light min-h-11 flex items-center shrink-0 cursor-pointer">{label}</button>
  );
}
