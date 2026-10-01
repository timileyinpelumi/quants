"use client";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex-1 bg-launch">
    <main className="flex flex-col items-start gap-5 wrap pt-24 pb-24">
      <h1 className="m-0 font-display font-black text-3xl md:text-5xl tracking-tight">Something went wrong.</h1>
      <p className="m-0 text-muted text-lg max-w-lg">Your funds are not affected. Try again, or come back in a few minutes.</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 cursor-pointer">Try again</button>
        <Link href="/" className="font-display font-bold rounded-full px-6 min-h-12 flex items-center bg-raised-2 border border-white/10">Home</Link>
      </div>
    </main>
    </div>
  );
}
