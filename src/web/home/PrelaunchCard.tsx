"use client";
import { useState } from "react";
import { XIcon } from "@/web/ui/XIcon";

const face = "relative [grid-area:card] [backface-visibility:hidden] rounded-[28px] overflow-hidden border border-accent";

/** The featured slot before the platform token exists: no market numbers, and a tap flips it to the launch message. */
export function PrelaunchCard({ symbol, headline, body, message, xUrl }: { symbol: string; headline: string; body: string; message: string; xUrl: string | null }) {
  const [flipped, setFlipped] = useState(false);
  const flip = () => setFlipped((f) => !f);
  return (
    <section aria-label="Featured" data-featured data-prelaunch className="[perspective:1600px]">
      <div
        role="button" tabIndex={0} aria-pressed={flipped} aria-label={flipped ? `Back to ${symbol}` : `When ${symbol} launches`}
        onClick={flip} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } }}
        className={`grid [grid-template-areas:'card'] cursor-pointer select-none transition-transform duration-700 ease-[cubic-bezier(.2,.7,.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent rounded-[28px] ${flipped ? "[transform:rotateY(180deg)] motion-reduce:[transform:none]" : ""}`}
      >
        <div data-face="front" aria-hidden={flipped} className={`${face} bg-accent text-ground p-6 md:p-10 flex flex-col gap-6 md:gap-8 motion-reduce:transition-opacity motion-reduce:duration-300 ${flipped ? "motion-reduce:opacity-0 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-4 min-w-0">
            <img src="/brand/quants-icon-tile.svg" alt="" width={64} height={64} className="w-14 h-14 md:w-16 md:h-16 rounded-2xl shrink-0" />
            <span className="flex flex-col gap-1.5 min-w-0">
              <span className="flex items-center gap-2.5 min-w-0 flex-wrap">
                <span className="font-display font-black text-[32px] md:text-[40px] leading-none tracking-tight">{symbol}</span>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-ground text-accent shrink-0">Launching soon</span>
              </span>
              <span className="text-sm font-semibold opacity-75">The quants platform token</span>
            </span>
          </div>
          <div className="flex flex-col gap-2 max-w-2xl">
            <p className="m-0 font-display font-black text-[24px] md:text-[34px] leading-[1.08] tracking-[-0.02em]">{headline}</p>
            {body && <p className="m-0 text-[15px] md:text-base leading-relaxed font-medium opacity-80">{body}</p>}
          </div>
          <span className="mt-auto self-start font-display font-bold rounded-full px-6 min-h-12 flex items-center bg-ground text-ink">When does it launch?</span>
          <img src="/brand/quants-icon-tile.svg" alt="" width={224} height={224} className="hidden lg:block absolute right-12 top-1/2 -translate-y-1/2 w-56 h-56 rounded-[48px] rotate-6 shadow-2xl" />
        </div>

        <div data-face="back" aria-hidden={!flipped} className={`${face} bg-surface p-6 md:p-10 flex flex-col gap-6 md:gap-8 [transform:rotateY(180deg)] motion-reduce:[transform:none] motion-reduce:transition-opacity motion-reduce:duration-300 ${flipped ? "" : "motion-reduce:opacity-0 pointer-events-none"}`}>
          <div className="flex items-center gap-3">
            <img src="/brand/quants-icon-tile.svg" alt="" width={40} height={40} className="w-10 h-10 rounded-xl shrink-0" />
            <span className="font-display font-black text-2xl tracking-tight">{symbol}</span>
          </div>
          <p className="m-0 font-display font-black text-[26px] md:text-[38px] leading-[1.1] tracking-[-0.02em] max-w-3xl">{message}</p>
          <div className="mt-auto flex flex-wrap items-center gap-3">
            {xUrl && (
              <a href={xUrl} target="_blank" rel="noreferrer" tabIndex={flipped ? 0 : -1} onClick={(e) => e.stopPropagation()}
                className="font-display font-bold rounded-full px-6 min-h-12 flex items-center gap-2.5 bg-accent text-ground hover:brightness-110">
                <XIcon size={16} /> Follow on X
              </a>
            )}
            <span className="text-sm text-muted">Tap the card to flip it back</span>
          </div>
        </div>
      </div>
    </section>
  );
}
