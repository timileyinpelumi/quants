import Link from "next/link";
import { XIcon, xUrl } from "./XIcon";

export function Footer() {
  const x = xUrl();
  return (
    <footer data-site-footer className="mt-auto border-t line">
      <div className="wrap py-10 flex flex-col md:flex-row gap-6 md:items-center justify-between">
      <div className="flex items-center gap-3">
        <img src="/brand/quants-icon.svg" alt="" width={28} height={28} className="rounded-md" />
        <span className="text-sm text-muted">Trading fees, paid to stakers.</span>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/docs" className="text-muted hover:text-ink min-h-11 flex items-center">Docs</Link>
        <Link href="/explore" className="text-muted hover:text-ink min-h-11 flex items-center">Explore</Link>
        <Link href="/rewards" className="text-muted hover:text-ink min-h-11 flex items-center">Rewards</Link>
        <Link href="/portfolio" className="text-muted hover:text-ink min-h-11 flex items-center">Portfolio</Link>
        <Link href="/terms" className="text-muted hover:text-ink min-h-11 flex items-center">Terms and risks</Link>
        {x && <a href={x} target="_blank" rel="noreferrer" aria-label="quants on X" className="text-muted hover:text-ink min-h-11 min-w-11 flex items-center justify-center"><XIcon size={18} /></a>}
      </nav>
      </div>
    </footer>
  );
}
