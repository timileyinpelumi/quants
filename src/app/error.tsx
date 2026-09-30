"use client";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex-1 flex flex-col items-start gap-5 px-4 md:px-16 pt-24 pb-24 bg-launch">
      <h1 className="m-0 font-display font-black text-3xl md:text-5xl tracking-tight">Something broke on our side.</h1>
      <p className="m-0 text-muted text-lg max-w-lg">Your funds are not affected. Try again, and if it keeps happening come back in a few minutes.</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 cursor-pointer">Try again</button>
        <Link href="/" className="font-display font-bold rounded-full px-6 min-h-12 flex items-center bg-raised-2 border border-white/10">Home</Link>
      </div>
    </main>
  );
}
