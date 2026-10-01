export type StockIssuer = "xstocks" | "backpack";
export interface StockListing { mint: string; issuer: StockIssuer; symbol: string; name: string; icon: string | null }
export type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const XSTOCKS_URL = "https://api.xstocks.fi/api/v2/public/assets";
export const BACKPACK_URL = "https://api.backpack.exchange/api/v1/assets";

export function parseXStocksPage(j: any): StockListing[] {
  const out: StockListing[] = [];
  for (const a of j?.nodes ?? []) {
    for (const d of a?.deployments ?? []) {
      if (d?.network !== "Solana" || typeof d.address !== "string" || !ADDRESS.test(d.address)) continue;
      out.push({ mint: d.address, issuer: "xstocks", symbol: String(a.symbol), name: String(a.name ?? a.symbol), icon: typeof a.logo === "string" ? a.logo : null });
    }
  }
  return out;
}

// Pages are numbered from 0; stop when the API says there is no next page or a page adds nothing new.
export async function fetchXStocks(f: Fetch, maxPages = 40): Promise<StockListing[]> {
  const out = new Map<string, StockListing>();
  for (let page = 0; page < maxPages; page++) {
    const res = await f(`${XSTOCKS_URL}?page=${page}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`xStocks answered ${res.status}`);
    const j = await res.json();
    const before = out.size;
    for (const s of parseXStocksPage(j)) out.set(s.mint, s);
    if (!j?.page?.hasNextPage || out.size === before) break;
  }
  return [...out.values()];
}

// Backpack lists stocks as SYMBOL.US with their Solana mint in tokens[].contractAddress.
export function parseBackpack(j: any): StockListing[] {
  const out: StockListing[] = [];
  for (const a of Array.isArray(j) ? j : []) {
    if (typeof a?.symbol !== "string" || !a.symbol.endsWith(".US")) continue;
    const t = (a.tokens ?? []).find((x: any) => x?.blockchain === "Solana" && typeof x.contractAddress === "string" && ADDRESS.test(x.contractAddress));
    if (!t) continue;
    out.push({ mint: t.contractAddress, issuer: "backpack", symbol: a.symbol, name: String(a.displayName ?? a.symbol), icon: null });
  }
  return out;
}

export async function fetchBackpack(f: Fetch): Promise<StockListing[]> {
  const res = await f(BACKPACK_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Backpack answered ${res.status}`);
  return parseBackpack(await res.json());
}
