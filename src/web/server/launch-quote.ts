import type { WebContext } from "./context";
import { allQuotes, launchableQuotes } from "./quotes";
import { thresholdOf } from "@/launch/config-keys";
import { CONFIG_RENT, LAUNCH_FEES, LAUNCH_RENT } from "@/domain/launch-cost";
import { keeperTopUp } from "./keeper-topup";

export type LaunchCostParts = { config: string; accounts: string; network: string; keeper: string };

/** The fixed SOL a launch on (pair, fee) costs before any first buy; config rent only when that config does not exist yet. Read only. */
export async function launchCostParts(ctx: WebContext, quoteMint: string, feeBps: number): Promise<LaunchCostParts> {
  const coin = (await launchableQuotes(ctx, await allQuotes(ctx))).find((c) => c.mint === quoteMint);
  let configLive = false;
  if (coin && coin.graduation > 0) {
    const threshold = thresholdOf(coin.graduation, coin.decimals);
    const [row] = await ctx.sql`select 1 from config_keys where quote_mint = ${quoteMint} and fee_bps = ${feeBps} and threshold = ${threshold.toString()}::numeric and status = 'live'`;
    configLive = !!row;
  }
  const topUp = (await keeperTopUp(ctx))?.lamports ?? 0n;
  return { config: (configLive ? 0n : CONFIG_RENT).toString(), accounts: LAUNCH_RENT.toString(), network: LAUNCH_FEES.toString(), keeper: topUp.toString() };
}
