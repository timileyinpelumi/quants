"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Tabs = { tab: string; setTab: (t: string) => void };
const Ctx = createContext<Tabs | null>(null);

export function useMobileTabs() {
  return useContext(Ctx);
}

/** Phone only tabs: below md just the active panel shows, md and up shows every panel. The active tab lives in the URL hash. */
export function MobileTabs({ ids, aliases = {}, children }: { ids: string[]; aliases?: Record<string, string>; children: ReactNode }) {
  const [tab, setState] = useState(ids[0]!);

  useEffect(() => {
    const read = () => {
      const h = decodeURIComponent(location.hash.slice(1));
      const id = aliases[h] ?? h;
      setState(ids.includes(id) ? id : ids[0]!);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("hashchange", read); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const current = useRef(tab);
  current.current = tab;
  const setTab = useCallback((t: string) => {
    if (current.current !== t) history.pushState(null, "", `${location.pathname}${location.search}#${t}`);
    current.current = t;
    setState(t);
    window.scrollTo({ top: 0 });
  }, []);

  return <Ctx.Provider value={{ tab, setTab }}>{children}</Ctx.Provider>;
}

/** Shows its children on phones only while one of `show` (space separated) is the active tab. */
export function TabPanel({ show, className = "contents", children }: { show: string; className?: string; children: ReactNode }) {
  const t = useMobileTabs();
  const on = !t || show.split(" ").includes(t.tab);
  return <div className={`${className} ${on ? "" : "max-md:hidden"}`}>{children}</div>;
}

/** Swipeable pill row for phones, hidden from md up. */
export function TabRow({ tabs, label }: { tabs: [string, string, number?][]; label: string }) {
  const t = useMobileTabs();
  if (!t) return null;
  return (
    <div role="tablist" aria-label={label} className="md:hidden flex gap-1 overflow-x-auto -mx-4 px-4 no-scrollbar">
      {tabs.map(([id, name, count]) => (
        <button key={id} type="button" role="tab" aria-selected={t.tab === id} onClick={() => t.setTab(id)}
          className={`px-4 min-h-10 flex items-center gap-1.5 rounded-full text-sm font-semibold shrink-0 cursor-pointer ${t.tab === id ? "bg-raised-2 border border-white/10 text-ink" : "text-muted"}`}>
          {name}{count !== undefined && <span className="font-mono text-[12px] text-faint">{count}</span>}
        </button>
      ))}
    </div>
  );
}
