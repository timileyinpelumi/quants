import { Lru } from "@/domain/lru";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const BATCH = 100;

// Logos are never stored: Jupiter serves an icon URL for any mint, cached here so a page asks once per mint per TTL.
export class TokenIcons {
  private cache: Lru<string, { at: number; icon: string | null }>;
  constructor(private base: string, private apiKey: string | undefined, private fetchFn: Fetch = fetch, private ttlMs = 6 * 3_600_000, maxEntries = 5_000) {
    this.cache = new Lru(maxEntries);
  }

  async get(mints: string[]): Promise<Record<string, string | null>> {
    const now = Date.now();
    const missing = [...new Set(mints)].filter((m) => { const c = this.cache.get(m); return !c || now - c.at > this.ttlMs; });
    const out: Record<string, string | null> = {};
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      try {
        const res = await this.fetchFn(`${this.base}/search?query=${encodeURIComponent(batch.join(","))}`, {
          headers: this.apiKey ? { "x-api-key": this.apiKey } : {}, signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) continue;
        const found = new Map(((await res.json()) as { id: string; icon?: string | null }[]).map((t) => [t.id, t.icon ?? null]));
        for (const m of batch) {
          out[m] = found.get(m) ?? null;
          this.cache.set(m, { at: now, icon: out[m] });
        }
      } catch {
        continue;
      }
    }
    return Object.fromEntries(mints.map((m) => [m, m in out ? out[m]! : this.cache.get(m)?.icon ?? null]));
  }
}

const PLATFORM_ICON = "/brand/quants-icon.svg";

/** Icons for any mix of mints; quote coins resolve through their mainnet mint so local stand-ins still get real logos. */
export async function iconsFor(icons: TokenIcons, mints: string[], quotes: { mint: string; iconMint: string | null; platform: boolean }[]) {
  const byMint = new Map(quotes.map((q) => [q.mint, q]));
  const lookup = mints.map((m) => byMint.get(m)?.iconMint ?? m);
  const found = await icons.get(lookup.filter((m) => !byMint.get(m)?.platform));
  return Object.fromEntries(mints.map((m, i) => [m, byMint.get(m)?.platform ? PLATFORM_ICON : found[lookup[i]!] ?? null])) as Record<string, string | null>;
}
