"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { XIcon } from "@/web/ui/XIcon";
import { shareText, telegramShare, xIntent } from "./share";

const pill = "flex items-center whitespace-nowrap rounded-full bg-raised-2 border border-white/[0.08] hover:border-white/20 cursor-pointer";
const item = "flex items-center gap-3 w-full min-h-12 md:min-h-11 px-4 text-left text-[15px] md:text-sm font-semibold text-ink hover:bg-white/[0.05] cursor-pointer";


function TelegramIcon() {
  return <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 4.3 18.9 19.04c-.23 1.03-.83 1.29-1.69.8l-4.66-3.44-2.25 2.17c-.25.25-.46.46-.94.46l.34-4.76 8.66-7.83c.38-.34-.08-.53-.58-.19L7.07 13.05 2.46 11.6c-1-.31-1.02-1 .21-1.48l18.02-6.95c.84-.31 1.57.19 1.25 1.13Z" /></svg>;
}
function LinkIcon() {
  return <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></svg>;
}
function ShareIcon() {
  return <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13" /><path d="m7 8 5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>;
}

export function ShareMenu({ mint, symbol, stakes }: { mint: string; symbol: string; stakes: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setNative(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const url = () => `${window.location.origin}/t/${mint}`;
  const text = shareText(symbol, stakes);
  const go = (href: string) => { window.open(href, "_blank", "noopener,noreferrer"); setOpen(false); };
  const copy = async () => {
    await navigator.clipboard.writeText(url());
    setCopied(true);
    setTimeout(() => { setCopied(false); setOpen(false); }, 900);
  };
  const shareNative = async () => {
    setOpen(false);
    try { await navigator.share({ title: `${symbol} on quants`, text, url: url() }); } catch {}
  };

  const items = (
    <>
      {native && <button type="button" role="menuitem" onClick={shareNative} className={item}><ShareIcon />Share with an app</button>}
      <button type="button" role="menuitem" onClick={() => go(xIntent(text, url()))} className={item}><XIcon />Share on X</button>
      <button type="button" role="menuitem" onClick={() => go(telegramShare(text, url()))} className={item}><TelegramIcon />Share on Telegram</button>
      <button type="button" role="menuitem" onClick={copy} className={item}><LinkIcon />{copied ? "Link copied" : "Copy link"}</button>
    </>
  );

  return (
    <div ref={box} className="relative flex">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${pill} gap-1.5 px-3 py-1.5 font-semibold`}>
        <ShareIcon />Share
      </button>
      {open && (
        <>
          <div role="menu" aria-label={`Share ${symbol}`} className="hidden md:flex flex-col absolute left-0 top-[calc(100%+8px)] z-50 w-60 py-2 rounded-2xl bg-raised border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            {items}
          </div>
          <div aria-hidden onClick={() => setOpen(false)} className="md:hidden fixed inset-0 z-[60] bg-black/60" />
          <div role="menu" aria-label={`Share ${symbol}`} className="md:hidden fixed inset-x-0 bottom-0 z-[61] flex flex-col bg-surface border-t line rounded-t-[28px] pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <span className="px-4 pb-2 font-display font-bold text-lg">Share {symbol}</span>
            {items}
          </div>
        </>
      )}
    </div>
  );
}

function Thumb({ down = false }: { down?: boolean }) {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={down ? { transform: "rotate(180deg)" } : undefined}>
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
      <path d="M7 10l4-7a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.3 8a2 2 0 0 1-2 1.7H7" />
    </svg>
  );
}

type V = "up" | "down" | null;

export function VoteButtons({ mint, symbol }: { mint: string; symbol: string }) {
  const wallet = useWallet();
  const owner = wallet.publicKey?.toBase58();
  const [vote, setVote] = useState<V>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/token/${mint}/vote${owner ? `?wallet=${owner}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setVote(j.vote); }, () => {});
    return () => { live = false; };
  }, [mint, owner]);

  const cast = async (v: "up" | "down") => {
    if (busy) return;
    const next: V = vote === v ? null : v;
    const prev = vote;
    setVote(next);
    setBusy(true);
    try {
      const r = await fetch(`/api/token/${mint}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vote: next, ...(owner ? { wallet: owner } : {}) }) });
      if (!r.ok) setVote(prev);
    } catch {
      setVote(prev);
    } finally {
      setBusy(false);
    }
  };

  const btn = (v: "up" | "down") => {
    const on = vote === v;
    const tone = on ? (v === "up" ? "text-up" : "text-down") : "text-muted hover:text-ink";
    return (
      <button type="button" aria-pressed={on} aria-label={v === "up" ? `Thumbs up for ${symbol}` : `Thumbs down for ${symbol}`} title={v === "up" ? "I like this token" : "Not for me"}
        onClick={() => cast(v)} className={`w-10 md:w-9 flex items-center justify-center cursor-pointer ${tone}`}>
        <Thumb down={v === "down"} />
      </button>
    );
  };
  return (
    <span role="group" aria-label={`Rate ${symbol}`} className="flex items-stretch rounded-full bg-raised-2 border border-white/[0.08] overflow-hidden divide-x divide-white/[0.08]">
      {btn("up")}
      {btn("down")}
    </span>
  );
}
