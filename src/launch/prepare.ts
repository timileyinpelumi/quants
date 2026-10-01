import type { SQL } from "bun";
import { z } from "zod";
import type { MeteoraPort } from "../meteora/port";
import { configKeyName, FEE_TIERS_BPS } from "../meteora/config";
import { loadLatestSettings } from "../domain/settings";
import { NATIVE_MINT } from "../domain/types";

export class LaunchError extends Error {
  constructor(public code: "invalid_input" | "basket_not_verified" | "basket_unsupported" | "dev_buy_too_large" | "not_found_on_chain" | "pool_mismatch", message: string) { super(message); }
}

// ALLOW_LOCAL_URIS is set only by scripts/dev-seed.ts so local uploads served over http work.
const publicUri = (u: string) => u.startsWith("https://") || (process.env.ALLOW_LOCAL_URIS === "1" && u.startsWith("http://localhost"));
const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Address is not valid");
const uint = z.string().regex(/^\d+$/).default("0").transform((v) => BigInt(v));

const launchInput = (quoteMints: string[]) => z.object({
  name: z.string().trim().min(1, "Add a name").max(32, "Name is 32 characters at most"),
  symbol: z.string().regex(/^[A-Za-z0-9]{1,10}$/, "Symbol is 1 to 10 letters or numbers"),
  uri: z.string().url().refine(publicUri, "Metadata link must be HTTPS"),
  image: z.string().url().refine(publicUri, "Image link must be HTTPS").optional(),
  creator: addr,
  quoteMint: z.string().refine((m) => quoteMints.includes(m), "That pair token is not supported"),
  feeTierBps: z.number().refine((v) => (FEE_TIERS_BPS as readonly number[]).includes(v), "Trading fee must be 1%, 2% or 3%"),
  basket: z.array(z.object({ mint: addr, weightBps: z.number().int().positive(), symbol: z.string().max(20).optional(), decimals: z.number().int().min(0).max(18).optional() })).min(1, "Pick at least one reward token").max(10, "Pick at most 10 reward tokens")
    .refine((b) => new Set(b.map((x) => x.mint)).size === b.length, "Each reward token can be picked once")
    .refine((b) => b.reduce((a, x) => a + x.weightBps, 0) === 10_000, "Basket weights must add up to 100"),
  devBuyQuoteAmount: uint,
  devBuyMinOut: uint,
});
export type LaunchInput = z.infer<ReturnType<typeof launchInput>>;

// Kamino farms are configured with the classic Token program for every reward mint.
const CLASSIC_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SUPPLY_BASE_UNITS = 1_000_000_000n * 1_000_000n;

export async function prepareLaunch(
  deps: { sql: SQL; meteora: MeteoraPort; configKeys: Record<string, string>; quoteMints: string[];
    isVerified: (mint: string) => Promise<boolean>; tokenProgramOf: (mint: string) => Promise<string> },
  raw: unknown,
) {
  const parsed = launchInput(deps.quoteMints).safeParse(raw);
  if (!parsed.success) throw new LaunchError("invalid_input", parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  for (const b of input.basket) {
    if (!(await deps.isVerified(b.mint))) throw new LaunchError("basket_not_verified", `${b.symbol ?? b.mint} is not on the Jupiter verified list. Pick another reward token.`);
    if ((await deps.tokenProgramOf(b.mint)) !== CLASSIC_TOKEN_PROGRAM) {
      throw new LaunchError("basket_unsupported", `${b.symbol ?? b.mint} is not a classic SPL token, which Kamino farms require. Pick another reward token.`);
    }
  }
  const settings = await loadLatestSettings(deps.sql);
  if (input.devBuyMinOut * 10_000n > SUPPLY_BASE_UNITS * BigInt(settings.devBuyCapBps)) {
    throw new LaunchError("dev_buy_too_large", `First buy is capped at ${settings.devBuyCapBps / 100}% of supply. Lower the first buy.`);
  }
  const configKey = deps.configKeys[configKeyName(input.quoteMint, input.feeTierBps)];
  if (!configKey) throw new LaunchError("invalid_input", "This pair and trading fee are not available. Pick another pair or fee.");
  if (input.devBuyQuoteAmount > 0n) {
    const out = await deps.meteora.firstBuyMaxOut(configKey, input.devBuyQuoteAmount);
    if (out * 10_000n > SUPPLY_BASE_UNITS * BigInt(settings.devBuyCapBps)) {
      throw new LaunchError("dev_buy_too_large", `First buy is capped at ${settings.devBuyCapBps / 100}% of supply. Lower the first buy.`);
    }
  }
  const { tx, baseMint, pool } = await deps.meteora.buildLaunchTx({
    name: input.name, symbol: input.symbol, uri: input.uri, creator: input.creator, configKey, quoteMint: input.quoteMint,
    devBuyQuoteAmount: input.devBuyQuoteAmount, devBuyMinOut: input.devBuyMinOut,
  });
  const mint = baseMint.publicKey.toBase58();
  await deps.sql`insert into prepared_launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, basket, settings_version, name, symbol, uri, image)
    values (${mint}, ${pool}, ${input.quoteMint}, ${input.feeTierBps}, ${configKey}, ${input.creator},
            ${JSON.stringify(input.basket)}::text::jsonb, ${settings.version}, ${input.name}, ${input.symbol}, ${input.uri}, ${input.image ?? null})`;
  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    mint,
    pool,
    settingsVersion: settings.version,
  };
}
