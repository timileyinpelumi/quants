import type { SQL } from "bun";
import { z } from "zod";
import { NATIVE_MINT, type FeeSplit, type LockTier } from "./types";
import { BUILTIN_QUOTE_SYMBOLS, seedQuoteSettings, setQuoteSettings, type QuoteSettings } from "./quotes";
import { FEE_TIERS_BPS } from "./fees";

type Env = Record<string, string | undefined>;
const big = z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const bps = z.number().int().min(0).max(10_000);
const DAY = 86_400;
const addr = z.string().regex(/^[1-9A-Za-z]{32,44}$/, "Platform token mint is not an address");
const https = (what: string) => z.union([
  z.literal(""),
  z.string().max(300).url(`${what} must be a link`).refine((u) => u.startsWith("https://"), `${what} must start with https://`),
]);
const target = z.number().finite().positive("Graduation targets must be above 0").max(1e12);

const Schema = z.object({
  split: z.object({ basketBps: bps, platformBps: bps, creatorBps: bps })
    .refine((s) => s.basketBps + s.platformBps + s.creatorBps === 10_000, "split must sum to 10000 bps"),
  creatorPayoutMin: z.record(z.string(), big),
  tiers: z.array(z.object({ id: z.string().min(1).max(16), lockSeconds: z.number().int().positive(), multiplierBps: z.number().int().min(10_000).max(100_000) }))
    .min(1).max(8)
    .refine((t) => new Set(t.map((x) => x.id)).size === t.length, "tier ids must be unique"),
  maxPenaltyBps: z.number().int().min(1).max(9_999),
  rewardPeriodSeconds: z.number().int().min(3_600),
  slippageBps: z.number().int().min(1).max(1_000),
  devBuyCapBps: z.number().int().min(0).max(7_500),
  keeperIntervalSeconds: z.number().int().min(60).max(86_400),
  defaultBackend: z.literal("kamino"),
  quotes: z.record(z.string(), z.object({ enabled: z.boolean(), graduation: target }))
    .refine((q) => Object.keys(q).every((k) => BUILTIN_QUOTE_SYMBOLS.includes(k)), "Unknown pair token"),
  platformToken: z.object({
    mint: z.union([z.literal(""), addr]),
    symbol: z.string().regex(/^[A-Za-z0-9]{1,10}$/, "Platform token symbol is 1 to 10 letters or numbers"),
    decimals: z.number().int().min(0).max(12),
    graduation: z.number().finite().min(0).max(1e12),
    enabled: z.boolean(),
  }).refine((p) => !p.enabled || (p.mint !== "" && p.graduation > 0), "Set the platform token mint and its graduation target before offering it as a pair"),
  feeTiersBps: z.array(z.number().int().min(25, "Fee tiers are 0.25% to 10%").max(1_000, "Fee tiers are 0.25% to 10%")).min(1, "Offer at least one fee tier").max(4, "Offer at most 4 fee tiers")
    .refine((f) => new Set(f).size === f.length, "Each fee tier once")
    .transform((f) => [...f].sort((a, b) => a - b)),
  featured: z.object({
    headline: z.string().trim().min(1, "Featured headline is empty").max(140),
    body: z.string().trim().max(400),
    prelaunch: z.string().trim().min(1, "Prelaunch message is empty").max(300),
  }),
  xUrl: https("X link"),
  alertWebhookUrl: https("Alert webhook"),
  launchesPaused: z.boolean(),
  bannerMessage: z.string().trim().max(200, "Banner is 200 characters at most"),
  stockPairs: z.boolean(),
});

export type Settings = {
  split: FeeSplit; creatorPayoutMin: Record<string, bigint>; tiers: LockTier[]; maxPenaltyBps: number;
  rewardPeriodSeconds: number; slippageBps: number; devBuyCapBps: number;
  keeperIntervalSeconds: number; defaultBackend: "kamino";
  feeTiersBps: number[];
  featured: { headline: string; body: string; prelaunch: string };
  xUrl: string; alertWebhookUrl: string; launchesPaused: boolean; bannerMessage: string; stockPairs: boolean;
} & QuoteSettings;
export type VersionedSettings = Settings & { version: number };

/** Values added after the first settings versions; older rows get them from the env, as before. */
function seedExtras(env: Env) {
  return {
    ...seedQuoteSettings(env),
    feeTiersBps: [...FEE_TIERS_BPS],
    featured: {
      headline: "Every buy of a {symbol} pair is a buy of {symbol}.",
      body: "Launch with {symbol} as the pair and your curve fills in {symbol}. Hold it and you hold what every one of those launches trades against.",
      prelaunch: "{symbol} launches on quants soon. Follow us on X to catch it first.",
    },
    xUrl: "",
    alertWebhookUrl: env.ALERT_WEBHOOK_URL ?? "",
    launchesPaused: false,
    bannerMessage: "",
    stockPairs: env.STOCK_PAIRS === "1",
  };
}

export const parseSettings = (input: unknown, env: Env = process.env): Settings => {
  const o = input && typeof input === "object" ? input : {};
  return Schema.parse({ ...seedExtras(env), ...o }) as Settings;
};

export function defaultSettings(ourtokenMint: string, env: Env = process.env): Settings {
  const seed = seedExtras({ ...env, OURTOKEN_MINT: ourtokenMint || undefined });
  const p = seed.platformToken;
  p.enabled = p.enabled && p.graduation > 0;
  return parseSettings({
    split: { basketBps: 6000, platformBps: 1500, creatorBps: 2500 },
    creatorPayoutMin: { [NATIVE_MINT]: 50_000_000n, ...(ourtokenMint ? { [ourtokenMint]: 0n } : {}) },
    tiers: [
      { id: "1d", lockSeconds: DAY, multiplierBps: 10_000 },
      { id: "3d", lockSeconds: 3 * DAY, multiplierBps: 12_500 },
      { id: "7d", lockSeconds: 7 * DAY, multiplierBps: 15_000 },
      { id: "30d", lockSeconds: 30 * DAY, multiplierBps: 20_000 },
    ],
    maxPenaltyBps: 3000,
    rewardPeriodSeconds: DAY,
    slippageBps: 100,
    devBuyCapBps: 5000,
    keeperIntervalSeconds: 600,
    defaultBackend: "kamino",
    ...seed,
  }, env);
}

const toJson = (s: Settings) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export async function saveSettings(sql: SQL, s: Settings, by: string): Promise<number> {
  const valid = parseSettings(s);
  const [row] = await sql`insert into settings (data, created_by) values (${toJson(valid)}::text::jsonb, ${by}) returning version`;
  invalidateSettingsCache();
  return row.version;
}

/** A fresh database gets its first version from the env; after that the admin page owns these values. */
// Pairs dropped from the platform may still sit in older saved versions; loading leaves them out instead of failing.
export const parseSavedSettings = (data: unknown): Settings => parseSettings(withoutDroppedPairs(data));

function withoutDroppedPairs(data: any) {
  if (!data?.quotes) return data;
  return { ...data, quotes: Object.fromEntries(Object.entries(data.quotes).filter(([k]) => BUILTIN_QUOTE_SYMBOLS.includes(k))) };
}

export async function loadLatestSettings(sql: SQL): Promise<VersionedSettings> {
  let [row] = await sql`select version, data from settings order by version desc limit 1`;
  if (!row) {
    const seed = toJson(defaultSettings(process.env.OURTOKEN_MINT ?? ""));
    await sql`insert into settings (data, created_by) select ${seed}::text::jsonb, 'env seed' where not exists (select 1 from settings)`;
    [row] = await sql`select version, data from settings order by version desc limit 1`;
  }
  const s = { ...parseSettings(withoutDroppedPairs(row.data)), version: row.version };
  setQuoteSettings(s);
  return s;
}

const g = globalThis as { __quantsSettings?: { at: number; p: Promise<VersionedSettings> } };
export const invalidateSettingsCache = () => { g.__quantsSettings = undefined; };

/** loadLatestSettings at most once per `ttlMs`; a change on the admin page applies within that time, without a rebuild. */
export function cachedSettings(sql: SQL, ttlMs = 5_000): Promise<VersionedSettings> {
  const c = g.__quantsSettings;
  if (c && Date.now() - c.at < ttlMs) return c.p;
  const p = loadLatestSettings(sql);
  g.__quantsSettings = { at: Date.now(), p };
  p.catch(() => { if (g.__quantsSettings?.p === p) g.__quantsSettings = undefined; });
  return p;
}

export const fillSymbol = (text: string, symbol: string) => text.replaceAll("{symbol}", symbol);
export const xUrlOf = (s: Pick<Settings, "xUrl">, env: Env = process.env) => s.xUrl || env.NEXT_PUBLIC_X_URL || null;
