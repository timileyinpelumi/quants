import Link from "next/link";
import { WalletButton } from "@/web/wallet/WalletButton";
import { PhoneNav } from "./PhoneNav";

const links = [
  { href: "/", label: "Home", key: "home" },
  { href: "/launch", label: "Launch", key: "launch" },
  { href: "/explore", label: "Explore", key: "explore" },
  { href: "/rewards", label: "Rewards", key: "rewards" },
  { href: "/portfolio", label: "Portfolio", key: "portfolio" },
  { href: "/docs", label: "Docs", key: "docs" },
] as const;

export type HeaderKey = (typeof links)[number]["key"] | "token" | "admin" | "other";

function Search({ className }: { className: string }) {
  return (
    <form action="/explore" role="search" className={className}>
      <label className="flex items-center gap-2.5 h-11 px-4 rounded-full bg-raised-2 border border-white/[0.08] focus-within:border-white/20 w-full">
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span className="sr-only">Search tokens</span>
        <input name="q" type="search" placeholder="Search tokens" className="bg-transparent outline-none text-sm w-full placeholder:text-faint" />
      </label>
    </form>
  );
}

export function Header({ active }: { active: HeaderKey }) {
  const cls = (k: string) => (active === k ? "text-ink" : "text-muted hover:text-ink");
  return (
    <header className="border-b line">
      <div className="wrap flex items-center gap-3 md:gap-8 py-3 md:py-5">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 min-h-11" aria-label="quants home">
          <img src="/brand/quants-mark.svg" alt="" width={32} height={32} className="w-8 h-8" />
          <span className="font-display font-black text-xl md:text-2xl tracking-tight max-[359px]:hidden">quants</span>
        </Link>
        <nav aria-label="Main" className="hidden lg:flex gap-7 text-[15px] font-medium shrink-0">
          {links.map((l) => <Link key={l.href} href={l.href} className={cls(l.key)}>{l.label}</Link>)}
        </nav>
        <Search className="hidden md:block flex-1 min-w-44 max-w-md" />
        <div className="ml-auto flex items-center gap-2 md:gap-2.5 shrink-0">
          <PhoneNav links={links} active={active} />
          <Link href="/launch" className={`hidden md:flex items-center gap-1.5 font-display font-bold rounded-full px-5 min-h-11 ${active === "launch" ? "bg-raised-2 border border-white/10" : "text-ground bg-accent"}`}>
            <span aria-hidden className="text-lg leading-none">+</span> Launch
          </Link>
          <WalletButton />
        </div>
      </div>
      <div className="hidden md:flex lg:hidden wrap flex-col gap-3 pb-3">
        <nav aria-label="Main" className="flex gap-6 text-sm font-medium overflow-x-auto">
          {links.map((l) => <Link key={l.href} href={l.href} className={`${cls(l.key)} min-h-9 flex items-center shrink-0`}>{l.label}</Link>)}
        </nav>
      </div>
    </header>
  );
}
