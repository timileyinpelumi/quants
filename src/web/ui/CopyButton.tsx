"use client";
import { useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="px-3 min-h-9 whitespace-nowrap rounded-full bg-raised-2 border border-white/[0.08] font-mono text-[13px] cursor-pointer hover:border-white/20"
      aria-label={`Copy ${value}`}
    >
      {done ? "Copied" : label}
    </button>
  );
}
