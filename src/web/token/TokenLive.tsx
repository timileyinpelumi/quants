"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { TokenLive } from "@/web/server/token-live";

const POLL_MS = 5_000;
const Ctx = createContext<TokenLive | null>(null);

export function TokenLiveProvider({ mint, initial, children }: { mint: string; initial: TokenLive | null; children: ReactNode }) {
  const [live, setLive] = useState(initial);
  const router = useRouter();
  const status = useRef(initial?.status);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/token/${mint}/live`, { cache: "no-store" });
          if (r.ok && !stop) {
            const next = (await r.json()) as TokenLive;
            setLive(next);
            // graduation moves trading to a new pool, which the server render picks up
            if (status.current && next.status !== status.current) router.refresh();
            status.current = next.status;
          }
        } catch { /* keep the last data */ }
      }
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [mint, router]);

  return <Ctx.Provider value={live}>{children}</Ctx.Provider>;
}

export const useTokenLive = () => useContext(Ctx);
