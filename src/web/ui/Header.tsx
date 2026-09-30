import Link from "next/link";
import { WalletButton } from "@/web/wallet/WalletButton";

const links = [
  { href: "/", label: "Launch", key: "launch" },
  { href: "/explore", label: "Explore", key: "explore" },
  { href: "/portfolio", label: "Portfolio", key: "portfolio" },
  { href: "/docs", label: "Docs", key: "docs" },
] as const;

export type HeaderKey = (typeof links)[number]["key"] | "token" | "admin" | "other";

export function Header({ active }: { active: HeaderKey }) {
  const cls = (k: string) => (active === k ? "text-ink" : "text-muted hover:text-ink");
  return (
    <header className="border-b line">
      <div className="flex items-center justify-between gap-4 px-4 md:px-16 py-4 md:py-6">
        <div className="flex items-center gap-8 md:gap-12">
          <Link href="/" className="flex items-center gap-2.5" aria-label="quants home">
            <img src="/brand/quants-mark.svg" alt="" width={32} height={32} className="w-8 h-8" style={{ filter: "drop-shadow(0 0 16px rgba(200,255,61,0.35))" }} />
            <span className="font-display font-black text-xl md:text-2xl tracking-tight">quants</span>
          </Link>
          <nav aria-label="Main" className="hidden md:flex gap-8 text-[15px] font-medium">
            {links.map((l) => <Link key={l.href} href={l.href} className={cls(l.key)}>{l.label}</Link>)}
          </nav>
        </div>
        <WalletButton />
      </div>
      <nav aria-label="Main" className="md:hidden flex gap-6 px-4 pb-3 text-sm font-medium overflow-x-auto">
        {links.map((l) => <Link key={l.href} href={l.href} className={`${cls(l.key)} min-h-9 flex items-center shrink-0`}>{l.label}</Link>)}
      </nav>
    </header>
  );
}
