import Link from "next/link";
import { Header } from "@/web/ui/Header";

export default function NotFound() {
  return (
    <div className="bg-launch flex-1">
      <Header active="other" />
      <main className="flex flex-col items-start gap-5 wrap pt-16 pb-24">
        <span className="font-display font-black text-[88px] md:text-[140px] leading-none text-lime tracking-tight">404</span>
        <h1 className="m-0 font-display font-black text-3xl md:text-4xl tracking-tight">Nothing here.</h1>
        <p className="m-0 text-muted text-lg max-w-lg">The link is out of date or the token address is wrong.</p>
        <div className="flex gap-3">
          <Link href="/explore" className="font-display font-bold text-ground bg-lime glow-lime rounded-full px-6 min-h-12 flex items-center">Explore tokens</Link>
          <Link href="/launch" className="font-display font-bold rounded-full px-6 min-h-12 flex items-center bg-raised-2 border border-white/10">Launch a token</Link>
        </div>
      </main>
    </div>
  );
}
