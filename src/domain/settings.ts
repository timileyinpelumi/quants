import type { SQL } from "bun";
import { z } from "zod";
import { NATIVE_MINT, type FeeSplit, type LockTier } from "./types";

const big = z.union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const bps = z.number().int().min(0).max(10_000);
const DAY = 86_400;

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
  keeperIntervalSeconds: z.number().int().min(60),
  defaultBackend: z.literal("kamino"),
});

export type Settings = {
  split: FeeSplit; creatorPayoutMin: Record<string, bigint>; tiers: LockTier[]; maxPenaltyBps: number;
  rewardPeriodSeconds: number; slippageBps: number; devBuyCapBps: number;
  keeperIntervalSeconds: number; defaultBackend: "kamino";
};
export type VersionedSettings = Settings & { version: number };

export const parseSettings = (input: unknown): Settings => Schema.parse(input);

export function defaultSettings(ourtokenMint: string): Settings {
  return parseSettings({
    split: { basketBps: 6000, platformBps: 2500, creatorBps: 1500 },
    creatorPayoutMin: { [NATIVE_MINT]: 50_000_000n, [ourtokenMint]: 0n },
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
  });
}

const toJson = (s: Settings) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export async function saveSettings(sql: SQL, s: Settings, by: string): Promise<number> {
  const valid = parseSettings(s);
  const [row] = await sql`insert into settings (data, created_by) values (${toJson(valid)}::text::jsonb, ${by}) returning version`;
  return row.version;
}

export async function loadLatestSettings(sql: SQL): Promise<VersionedSettings> {
  const [row] = await sql`select version, data from settings order by version desc limit 1`;
  if (!row) throw new Error("no settings saved");
  return { ...parseSettings(row.data), version: row.version };
}
