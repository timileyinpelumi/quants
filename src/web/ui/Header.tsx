import Link from "next/link";
import { WalletButton } from "@/web/wallet/WalletButton";

const links = [
  { href: "/", label: "Launch", key: "launch" },
  { href: "/explore", label: "Explore", key: "explore" },
] as const;

export function Header({ active }: { active: "launch" | "explore" | "token" | "admin" }) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 md:px-16 py-4 md:py-7 border-b line">
      <div className="flex items-center gap-8 md:gap-12">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-[10px] bg-lime" style={{ boxShadow: "0 0 24px rgba(200,255,61,0.45), inset 0 -4px 0 rgba(0,0,0,0.18)" }} />
          <span className="font-display font-black text-xl md:text-2xl tracking-tight">quants</span>
        </Link>
        <nav className="hidden md:flex gap-8 text-[15px] font-medium">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={active === l.key ? "text-ink" : "text-muted hover:text-ink"}>{l.label}</Link>
          ))}
        </nav>
      </div>
      <WalletButton />
    </header>
  );
}
