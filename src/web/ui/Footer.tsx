import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t line">
      <div className="wrap py-10 flex flex-col md:flex-row gap-6 md:items-center justify-between">
      <div className="flex items-center gap-3">
        <img src="/brand/quants-mark.svg" alt="" width={28} height={28} />
        <span className="text-sm text-muted">Trading fees, paid to stakers.</span>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/docs" className="text-muted hover:text-ink min-h-11 flex items-center">Docs</Link>
        <Link href="/explore" className="text-muted hover:text-ink min-h-11 flex items-center">Explore</Link>
        <Link href="/rewards" className="text-muted hover:text-ink min-h-11 flex items-center">Rewards</Link>
        <Link href="/portfolio" className="text-muted hover:text-ink min-h-11 flex items-center">Portfolio</Link>
        <Link href="/terms" className="text-muted hover:text-ink min-h-11 flex items-center">Terms and risks</Link>
      </nav>
      </div>
    </footer>
  );
}
