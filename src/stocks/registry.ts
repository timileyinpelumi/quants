import type { SQL } from "bun";
import { PublicKey, type Connection } from "@solana/web3.js";
import { readMint, stockMintProblem } from "../chain/mints";
import { setStockQuotes, type QuoteCoin } from "../domain/quotes";
import { fetchBackpack, fetchXStocks, type Fetch, type StockIssuer, type StockListing } from "./sources";

const DAY_MS = 86_400_000;
const MEMORY_MS = 5 * 60_000;

export interface StockRegistryDeps {
  sql: SQL;
  conn: Pick<Connection, "getMultipleAccountsInfo">;
  fetch: Fetch;
  /** Config keys by `${quoteMint}:${feeBps}`; a stock is offered only when its curve configs exist on this network. */
  configKeys: Record<string, string>;
  threshold: (configKey: string) => Promise<bigint>;
  /** Stand-in listings for a local validator, used instead of the issuers' lists. */
  local?: StockListing[];
  now?: () => number;
  log?: (msg: string) => void;
}

/** Approved stock pairs: issuer listings refreshed daily, each mint checked on chain once, limited to mints with config keys. */
export class StockRegistry {
  private memory: { at: number; list: QuoteCoin[] } | null = null;
  private refreshing: Promise<void> | null = null;
  private now: () => number;
  private log: (msg: string) => void;
  constructor(private d: StockRegistryDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? ((m) => console.error(JSON.stringify({ at: new Date().toISOString(), stocks: m })));
  }

  private configMints() {
    const mints = new Map<string, string>();
    for (const [name, key] of Object.entries(this.d.configKeys)) {
      const mint = name.split(":")[0]!;
      if (!mints.has(mint)) mints.set(mint, key);
    }
    return mints;
  }

  async list(): Promise<QuoteCoin[]> {
    if (this.memory && this.now() - this.memory.at < MEMORY_MS) return this.memory.list;
    const [r] = await this.d.sql`select max(listed_at) as at from stock_quotes`;
    if (!r?.at) await this.refresh();
    else if (this.now() - new Date(r.at).getTime() > DAY_MS) void this.refresh().catch((e) => this.log(`refresh failed: ${e}`));
    await this.check();
    const keyed = this.configMints();
    const rows = keyed.size ? await this.d.sql`select * from stock_quotes where ok and mint in ${this.d.sql([...keyed.keys()])} order by symbol` : [];
    const list: QuoteCoin[] = rows.map((r: any) => ({
      mint: r.mint, symbol: r.symbol, name: r.name, decimals: r.decimals, graduation: Number(r.graduation ?? 0), iconMint: r.mint,
      platform: false, payoutMin: 0n, kind: r.issuer as StockIssuer, tradingOnly: true,
    }));
    this.memory = { at: this.now(), list };
    setStockQuotes(list);
    return list;
  }

  /** Issuer icon for each listed mint, for stocks Jupiter has no logo for. */
  async icons(mints: string[]): Promise<Record<string, string | null>> {
    if (!mints.length) return {};
    const rows = await this.d.sql`select mint, icon from stock_quotes where mint in ${this.d.sql(mints)}`;
    return Object.fromEntries(rows.map((r: any) => [r.mint, r.icon]));
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async load() {
    const started = new Date(this.now());
    const sources: [StockIssuer, () => Promise<StockListing[]>][] = this.d.local
      ? [["xstocks", async () => this.d.local!.filter((s) => s.issuer === "xstocks")], ["backpack", async () => this.d.local!.filter((s) => s.issuer === "backpack")]]
      : [["xstocks", () => fetchXStocks(this.d.fetch)], ["backpack", () => fetchBackpack(this.d.fetch)]];
    const seen = new Set<string>();
    for (const [issuer, get] of sources) {
      let listed: StockListing[];
      try {
        listed = await get();
      } catch (e) {
        // Keep the last good listing for an issuer whose API is down.
        this.log(`${issuer} list failed: ${e}`);
        continue;
      }
      // A mint both issuers list stays with the first one.
      const rows = listed.filter((s) => !seen.has(s.mint));
      for (const s of rows) seen.add(s.mint);
      if (rows.length) {
        await this.d.sql`insert into stock_quotes ${this.d.sql(rows.map((s) => ({ mint: s.mint, issuer: s.issuer, symbol: s.symbol, name: s.name, icon: s.icon, listed_at: started })))}
          on conflict (mint) do update set issuer = excluded.issuer, symbol = excluded.symbol, name = excluded.name, icon = excluded.icon, listed_at = excluded.listed_at`;
      }
      await this.d.sql`delete from stock_quotes where issuer = ${issuer} and listed_at < ${started}`;
    }
    this.memory = null;
  }

  /** Checks listed mints that have config keys and were never checked: Token-2022, no transfer fee, no transfer hook program. */
  private async check() {
    const keyed = this.configMints();
    if (!keyed.size) return;
    const pending = await this.d.sql`select mint from stock_quotes where checked_at is null and mint in ${this.d.sql([...keyed.keys()])}`;
    const mints: string[] = pending.map((r: any) => r.mint);
    for (let i = 0; i < mints.length; i += 100) {
      const batch = mints.slice(i, i + 100);
      const infos = await this.d.conn.getMultipleAccountsInfo(batch.map((m) => new PublicKey(m)), "confirmed");
      for (const [j, mint] of batch.entries()) {
        const info = infos[j];
        let problem: string | null = "mint not found";
        let decimals: number | null = null;
        let graduation: number | null = null;
        try {
          if (info) {
            const m = readMint(new PublicKey(mint), info);
            decimals = m.decimals;
            problem = stockMintProblem(m);
            if (!problem) graduation = Number(await this.d.threshold(keyed.get(mint)!)) / 10 ** m.decimals;
          }
        } catch (e) {
          this.log(`check ${mint} failed: ${e}`);
          continue;
        }
        await this.d.sql`update stock_quotes set checked_at = ${new Date(this.now())}, ok = ${problem === null}, problem = ${problem},
          decimals = ${decimals}, graduation = ${graduation} where mint = ${mint}`;
      }
    }
  }
}
