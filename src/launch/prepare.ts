import { EXCLUDED_MINTS } from "../domain/quotes";
import { JupiterUnavailable } from "../jupiter/port";
import type { SQL } from "bun";
import type { Keypair } from "@solana/web3.js";
import { z } from "zod";
import type { MeteoraPort } from "../meteora/port";
import type { ConfigFor } from "./config-keys";
import { loadLatestSettings } from "../domain/settings";
import { NATIVE_MINT } from "../domain/types";

export class LaunchError extends Error {
  constructor(public code: "invalid_input" | "launches_paused" | "basket_not_verified" | "basket_unsupported" | "dev_buy_too_large" | "not_found_on_chain" | "pool_mismatch" | "simulation_failed" | "tx_too_large" | "cosign_refused" | "blockhash_expired" | "jupiter_unavailable", message: string) { super(message); }
}

// ALLOW_LOCAL_URIS is set only by scripts/dev-seed.ts so local uploads served over http work.
const publicUri = (u: string) => u.startsWith("https://") || (process.env.ALLOW_LOCAL_URIS === "1" && u.startsWith("http://localhost"));
const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Address is not valid");
const uint = z.string().regex(/^\d+$/).default("0").transform((v) => BigInt(v));

const basketItem = z.object({ mint: addr, weightBps: z.number().int().positive(), symbol: z.string().max(20).optional(), decimals: z.number().int().min(0).max(18).optional() });
const basketInput = z.array(basketItem).min(1, "Pick at least one reward token").max(10, "Pick at most 10 reward tokens")
  .refine((b) => new Set(b.map((x) => x.mint)).size === b.length, "Each reward token can be picked once")
  .refine((b) => b.reduce((a, x) => a + x.weightBps, 0) === 10_000, "Basket weights must add up to 100");
const noBasket = z.array(basketItem).max(0, "Tokens paired with a stock are trading only and have no reward basket").default([]);

const feeList = (fees: number[]) => {
  const p = fees.map((b) => `${b / 100}%`);
  return p.length > 1 ? `${p.slice(0, -1).join(", ")} or ${p.at(-1)}` : p[0];
};

const launchInput = (quoteMints: string[], tradingOnly: boolean, fees: number[]) => z.object({
  name: z.string().trim().min(1, "Add a name").max(32, "Name is 32 characters at most"),
  symbol: z.string().regex(/^[A-Za-z0-9]{1,10}$/, "Symbol is 1 to 10 letters or numbers"),
  uri: z.string().url().refine(publicUri, "Metadata link must be HTTPS"),
  image: z.string().url().refine(publicUri, "Image link must be HTTPS").optional(),
  creator: addr,
  quoteMint: z.string().refine((m) => quoteMints.includes(m), "That pair token is not supported"),
  feeTierBps: z.number().refine((v) => fees.includes(v), `Trading fee must be ${feeList(fees)}`),
  basket: tradingOnly ? noBasket : basketInput,
  devBuyQuoteAmount: uint,
  devBuyMinOut: uint,
});
export type LaunchInput = z.infer<ReturnType<typeof launchInput>>;

// Kamino farms are configured with the classic Token program for every reward mint.
const CLASSIC_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SUPPLY_BASE_UNITS = 1_000_000_000n * 1_000_000n;

/**
 * A launch is up to two wallet prompts, each built only once the one before confirmed so it simulates on its own:
 * `config` creates a config key the pair and fee do not have yet, then `launch` creates the pool with the first buy.
 * `ready` is returned instead of `launch` when the caller asked to stop before it (a swap to the pair token comes first).
 */
export type PreparedStep =
  | { step: "config"; transaction: string; configKey: string; signers: Keypair[] }
  | { step: "ready"; configKey: string }
  | { step: "launch"; transaction: string; mint: string; pool: string; settingsVersion: number; signers: Keypair[] };

export function launchOnly(p: PreparedStep) {
  if (p.step !== "launch") throw new Error(`expected the launch step, got ${p.step}`);
  return p;
}

export async function prepareLaunch(
  deps: { sql: SQL; meteora: MeteoraPort; configFor: ConfigFor; quoteMints: string[];
    /** Lamports to send the keeper inside the launch transaction while it is below its floor, else null. */
    keeperTopUp?: () => Promise<{ to: string; lamports: bigint } | null>;
    /** Pair tokens that cannot back staking farms (tokenized stocks): their launches have no basket and no stake pool. */
    tradingOnlyMints?: string[];
    isVerified: (mint: string) => Promise<boolean>; tokenProgramOf: (mint: string) => Promise<string> },
  raw: unknown,
  opts: { stopBeforeLaunch?: boolean } = {},
): Promise<PreparedStep> {
  const settings = await loadLatestSettings(deps.sql);
  if (settings.launchesPaused) throw new LaunchError("launches_paused", "New launches are paused for now. Trading and staking carry on as normal. Try again later.");
  const tradingOnly = (deps.tradingOnlyMints ?? []).includes((raw as { quoteMint?: unknown } | null)?.quoteMint as string);
  const parsed = launchInput(deps.quoteMints, tradingOnly, settings.feeTiersBps).safeParse(raw);
  if (!parsed.success) throw new LaunchError("invalid_input", parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  for (const b of input.basket) {
    if (EXCLUDED_MINTS.has(b.mint)) throw new LaunchError("basket_not_verified", `${b.symbol ?? b.mint} is not offered as a reward token. Pick another one.`);
    // The pair token is already vetted as a pair; paying it out needs no swap.
    const verified = b.mint === input.quoteMint || await deps.isVerified(b.mint).catch((e) => {
      if (e instanceof JupiterUnavailable) throw new LaunchError("jupiter_unavailable", "We couldn't check the reward tokens with Jupiter right now. Try again in a moment.");
      throw e;
    });
    if (!verified) throw new LaunchError("basket_not_verified", `${b.symbol ?? b.mint} is not on the Jupiter verified list. Pick another reward token.`);
    if ((await deps.tokenProgramOf(b.mint)) !== CLASSIC_TOKEN_PROGRAM) {
      throw new LaunchError("basket_unsupported", `${b.symbol ?? b.mint} is not a classic SPL token, which Kamino farms require. Pick another reward token.`);
    }
  }
  if (input.devBuyMinOut * 10_000n > SUPPLY_BASE_UNITS * BigInt(settings.devBuyCapBps)) {
    throw new LaunchError("dev_buy_too_large", `First buy is capped at ${settings.devBuyCapBps / 100}% of supply. Lower the first buy.`);
  }
  const config = await deps.configFor(input.quoteMint, input.feeTierBps);
  if (!config) throw new LaunchError("invalid_input", "This pair and trading fee are not available. Pick another pair or fee.");
  const { configKey, create } = config;
  if (input.devBuyQuoteAmount > 0n) {
    const out = await deps.meteora.firstBuyMaxOut(create ? { feeBps: create.feeBps, quote: create.quote } : configKey, input.devBuyQuoteAmount);
    if (out * 10_000n > SUPPLY_BASE_UNITS * BigInt(settings.devBuyCapBps)) {
      throw new LaunchError("dev_buy_too_large", `First buy is capped at ${settings.devBuyCapBps / 100}% of supply. Lower the first buy.`);
    }
  }
  if (create) {
    const tx = await deps.meteora.buildConfigTx({ creator: input.creator, quoteMint: input.quoteMint, create });
    return { step: "config", transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"), configKey, signers: [create.config] };
  }
  if (opts.stopBeforeLaunch) return { step: "ready", configKey };
  const keeperTopUp = (await deps.keeperTopUp?.()) ?? undefined;
  const { tx, baseMint, pool } = await deps.meteora.buildLaunchTx({
    name: input.name, symbol: input.symbol, uri: input.uri, creator: input.creator, configKey, quoteMint: input.quoteMint,
    devBuyQuoteAmount: input.devBuyQuoteAmount, devBuyMinOut: input.devBuyMinOut, keeperTopUp,
  });
  const mint = baseMint.publicKey.toBase58();
  await deps.sql`insert into prepared_launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, basket, settings_version, name, symbol, uri, image, trading_only)
    values (${mint}, ${pool}, ${input.quoteMint}, ${input.feeTierBps}, ${configKey}, ${input.creator},
            ${JSON.stringify(input.basket)}::text::jsonb, ${settings.version}, ${input.name}, ${input.symbol}, ${input.uri}, ${input.image ?? null}, ${tradingOnly})`;
  return { step: "launch", transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"), mint, pool, settingsVersion: settings.version, signers: [baseMint] };
}
