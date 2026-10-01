"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

type Page<T, C> = { items: T[]; next: C | null };

export function usePaged<T, C>(initial: T[], initialNext: C | null, load: (next: C) => Promise<Page<T, C>>, keyOf: (t: T) => string) {
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [pages, setPages] = useState(0);
  const busy = useRef(false);
  const more = async () => {
    if (busy.current || next === null) return;
    busy.current = true;
    setState("loading");
    try {
      const r = await load(next);
      setItems((xs) => {
        const seen = new Set(xs.map(keyOf));
        return [...xs, ...r.items.filter((x) => !seen.has(keyOf(x)))];
      });
      setNext(r.next);
      setPages((n) => n + 1);
      setState("idle");
    } catch {
      setState("error");
    } finally {
      busy.current = false;
    }
  };
  return { items, done: next === null, state, pages, more };
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Fallback button for paging; with `auto`, also loads when scrolled near. */
export function LoadMore({ done, state, onMore, auto = false, label = "Load more", doneText }: {
  done: boolean; state: "idle" | "loading" | "error"; onMore: () => void; auto?: boolean; label?: string; doneText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onMore);
  useEffect(() => { cb.current = onMore; });
  useEffect(() => {
    if (!auto || done || state !== "idle" || !ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) cb.current(); }, { rootMargin: "600px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [auto, done, state]);

  if (done) return doneText ? <p className="m-0 pt-4 border-t line text-center text-[13px] text-faint">{doneText}</p> : null;
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 pt-4 border-t line">
      {state === "error" && <p role="alert" className="m-0 text-[13px] text-burn">Could not load more.</p>}
      <Button variant="ghost" size="sm" onClick={onMore} disabled={state === "loading"}>
        {state === "loading" ? "Loading" : state === "error" ? "Try again" : label}
      </Button>
    </div>
  );
}
