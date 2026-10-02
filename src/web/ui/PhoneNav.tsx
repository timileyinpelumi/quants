"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string; key: string };

const iconBtn = "w-11 h-11 flex items-center justify-center rounded-full bg-raised-2 border border-white/[0.08] text-ink cursor-pointer shrink-0";

function useSheet(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close]);
}

export function PhoneNav({ links, active }: { links: readonly NavLink[]; active: string }) {
  const [open, setOpen] = useState<"menu" | "search" | null>(null);
  const close = useRef(() => setOpen(null)).current;
  const input = useRef<HTMLInputElement>(null);
  const path = usePathname();
  useSheet(open !== null, close);
  useEffect(() => { setOpen(null); }, [path]);
  useEffect(() => { if (open === "search") input.current?.focus(); }, [open]);

  return (
    <>
      <button type="button" aria-label="Search tokens" onClick={() => setOpen("search")} className={`md:hidden ${iconBtn}`}>
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
      <button type="button" aria-label="Menu" aria-expanded={open === "menu"} onClick={() => setOpen("menu")} className={`md:hidden order-last ${iconBtn}`}>
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>

      {open && <div aria-hidden onClick={close} className="md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]" />}

      {open === "search" && (
        <div role="dialog" aria-modal aria-label="Search" className="md:hidden fixed inset-x-0 top-0 z-[61] bg-surface border-b line px-4 pt-3 pb-4 flex flex-col gap-3">
          <form action="/explore" role="search" onSubmit={close} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2.5 h-12 px-4 rounded-full bg-raised-2 border border-white/[0.12] focus-within:border-white/25 min-w-0">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <span className="sr-only">Search tokens</span>
              <input ref={input} name="q" type="search" placeholder="Name, symbol or address" className="bg-transparent outline-none text-base w-full min-w-0 placeholder:text-faint" />
            </label>
            <button type="button" onClick={close} className="min-h-11 px-3 text-sm font-semibold text-muted cursor-pointer shrink-0">Cancel</button>
          </form>
        </div>
      )}

      {open === "menu" && (
        <div role="dialog" aria-modal aria-label="Menu" className="md:hidden fixed inset-x-0 bottom-0 z-[61] bg-surface border-t line rounded-t-[28px] px-4 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="relative flex items-center justify-center min-h-11">
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/20" />
            <button type="button" onClick={close} aria-label="Close" className="absolute right-0 top-0 w-11 h-11 flex items-center justify-center rounded-full text-muted hover:text-ink cursor-pointer">
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <nav aria-label="Main" className="flex flex-col">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={close} aria-current={active === l.key ? "page" : undefined}
                className={`flex items-center justify-between min-h-14 border-b line last:border-b-0 font-display font-bold text-xl ${active === l.key ? "text-ink" : "text-muted"}`}>
                {l.label}
                {active === l.key && <span aria-hidden className="w-2 h-2 rounded-full bg-accent" />}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
