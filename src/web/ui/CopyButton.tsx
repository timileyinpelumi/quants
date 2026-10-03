"use client";
import { useState } from "react";

const copyIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const checkIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="inline-flex items-center gap-1.5 px-3 min-h-10 md:min-h-9 whitespace-nowrap rounded-full bg-raised-2 border border-white/[0.08] font-mono text-[13px] cursor-pointer hover:border-white/20"
      aria-label={`Copy ${value}`}
    >
      {done ? "Copied" : label}
      <span className={done ? "text-up" : "text-muted"}>{done ? checkIcon : copyIcon}</span>
    </button>
  );
}
