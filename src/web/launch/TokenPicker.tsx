"use client";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/web/ui/Avatar";
import { shortAddr } from "@/web/ui/format";

export type PickedToken = { mint: string; symbol: string; name: string; icon: string | null; decimals: number };

export function TokenPicker({ open, onClose, onPick, taken, max }: {
  open: boolean;
  onClose: () => void;
  onPick: (t: PickedToken[]) => void;
  taken: string[];
  max: number;
}) {
  const [selected, setSelected] = useState<PickedToken[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PickedToken[]>([]);
  const [state, setState] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [popular, setPopular] = useState<PickedToken[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSelected([]);
    setFound([]);
    setState("idle");
    const t = setTimeout(() => input.current?.focus(), 30);
    if (popular === null) {
      fetch("/api/tokens/search?q=").then((r) => r.json()).then((j) => setPopular(j.tokens ?? [])).catch(() => setPopular([]));
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); setState("idle"); return; }
    setState("searching");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/tokens/search?q=${encodeURIComponent(q.trim())}`);
        if (!r.ok) throw new Error();
        setFound(((await r.json()).tokens ?? []) as PickedToken[]);
        setState("done");
      } catch {
        setState("error");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (!open) return null;
  const browsing = q.trim().length < 2;
  const needle = q.trim().toLowerCase();
  const list = browsing ? (popular ?? []).filter((t) => !needle || `${t.symbol} ${t.name}`.toLowerCase().includes(needle)) : found;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default" />
      <div role="dialog" aria-modal="true" aria-labelledby="picker-title" className="panel relative w-full md:max-w-lg max-h-[85vh] flex flex-col rounded-b-none md:rounded-[32px]">
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
          <h2 id="picker-title" className="m-0 font-display font-black text-2xl tracking-tight">Pick reward tokens</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 rounded-full border border-white/10 text-muted hover:text-ink flex items-center justify-center cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="px-6 pb-4">
          <label className="flex items-center gap-3 bg-ground border border-white/10 rounded-2xl px-4 focus-within:border-lime/60">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9A97A8" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span className="sr-only">Search tokens</span>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, symbol or address" className="flex-1 min-w-0 bg-transparent py-4 text-lg outline-none" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-48">
          {browsing && <p className="m-0 px-3 pt-1 pb-2 text-[13px] text-muted">{popular === null ? "Loading popular tokens" : popular.length ? "Popular" : "Search for a verified token. Stakers of your token will earn it."}</p>}
          {!browsing && state === "searching" && found.length === 0 && <p className="m-0 px-3 py-6 text-sm text-muted">Searching</p>}
          {!browsing && state === "error" && <p className="m-0 px-3 py-6 text-sm text-burn">Search is not answering right now. Try again in a moment.</p>}
          {!browsing && state === "done" && found.length === 0 && <p className="m-0 px-3 py-6 text-sm text-muted">No verified token matches that.</p>}
          {list.map((t) => {
            const added = taken.includes(t.mint);
            const on = selected.some((x) => x.mint === t.mint);
            const full = !on && selected.length >= max;
            return (
              <button
                key={t.mint}
                type="button"
                role="checkbox"
                aria-checked={on || added}
                disabled={added || full}
                onClick={() => setSelected((cur) => (on ? cur.filter((x) => x.mint !== t.mint) : [...cur, t]))}
                className={`w-full grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center px-3 py-3 rounded-2xl text-left cursor-pointer disabled:opacity-40 disabled:cursor-default min-h-14 ${on ? "bg-lime/[0.08]" : "hover:bg-white/[0.04]"}`}
              >
                <Avatar seed={t.mint} label={t.symbol} image={t.icon} size={40} />
                <span className="flex flex-col min-w-0">
                  <span className="font-semibold truncate">{t.symbol}</span>
                  <span className="text-[13px] text-muted truncate">{t.name} · <span className="font-mono">{shortAddr(t.mint)}</span></span>
                </span>
                <span aria-hidden className={`w-6 h-6 rounded-full border flex items-center justify-center ${on || added ? "bg-lime border-lime text-ground" : "border-white/25"}`}>
                  {(on || added) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t line">
          <span className="text-sm text-muted">{selected.length ? selected.map((x) => x.symbol).join(", ") : `Pick up to ${max}`}</span>
          <button type="button" disabled={selected.length === 0} onClick={() => { onPick(selected); onClose(); }}
            className="font-display font-bold text-ground bg-lime rounded-full px-6 min-h-11 cursor-pointer disabled:opacity-40 disabled:cursor-default shrink-0">
            {selected.length > 1 ? `Add ${selected.length} tokens` : "Add token"}
          </button>
        </div>
      </div>
    </div>
  );
}
