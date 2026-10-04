import { z } from "zod";
import type { WebContext } from "./context";
import { LaunchError } from "@/launch/prepare";
import { earlyExitPenalty } from "@/domain/penalty";
import { BPS } from "@/domain/types";
import { ttlCache } from "@/domain/lru";
import { checkTx, type WalletTx } from "./tx-check";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Wallet address is not valid");

export interface PositionView {
  tierId: string; farm: string; multiplierBps: number; lockSeconds: number; staked: string; unlocksAt: number; locked: boolean;
  /** Earned and not yet paid, across the running period and any finished ones waiting to be sent. */
  earned: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
  /** When the running period's earnings become payable, or null when nothing is running. */
  paysAt: number | null;
  /** A finished period is waiting to be sent. */
  paying: boolean;
  exitPreview: { back: string; burned: string; penaltyBps: number; daysLeft: number } | null;
}

const farmsByOwner = ttlCache<string[]>(20_000, 2_000);
export const resetStakeCache = () => farmsByOwner.clear();

/** Our farms the owner has a user state in, cached briefly per owner. */
export function stakedFarms(ctx: WebContext, owner: string): Promise<string[]> {
  return farmsByOwner.get(owner, async () => {
    const known = (await ctx.sql`select distinct farm from stake_tiers where farm is not null`).map((r: any) => r.farm as string);
    return known.length ? ctx.staking.userFarms(owner, known) : [];
  });
}

async function launchStake(ctx: WebContext, mint: string) {
  const [l] = await ctx.sql`select l.id, l.mint, sp.status, sp.max_penalty_bps from launches l left join stake_pools sp on sp.launch_id = l.id where l.mint = ${mint}`;
  if (!l) throw new LaunchError("invalid_input", "Token not found");
  const tiers = await ctx.sql`select tier_id, farm, multiplier_bps, lock_seconds from stake_tiers where launch_id = ${l.id} order by lock_seconds`;
  const basket = await ctx.sql`select reward_mint, symbol, decimals from baskets where launch_id = ${l.id}`;
  return { launch: l, tiers, basket };
}

export async function positions(ctx: WebContext, mint: string, ownerRaw: string): Promise<PositionView[]> {
  const owner = addr.parse(ownerRaw);
  const { launch, tiers, basket } = await launchStake(ctx, mint);
  const meta = new Map<string, { symbol: string | null; decimals: number | null }>(basket.map((b: any) => [b.reward_mint, { symbol: b.symbol, decimals: b.decimals }]));
  const now = Math.floor(Date.now() / 1000);
  const periods = await ctx.sql`select p.tier_id, p.status, extract(epoch from p.ends_at)::bigint::int as ends, e.mint, e.amount::text as amount
    from stake_periods p left join stake_earnings e on e.period_id = p.id
    where p.launch_id = ${launch.id} and p.owner = ${owner} and p.status in ('accruing', 'due', 'approved')`;
  const out: PositionView[] = [];
  for (const t of tiers) {
    if (!t.farm) continue;
    const mine = periods.filter((r: any) => r.tier_id === t.tier_id);
    const earnedBy = new Map<string, bigint>();
    for (const r of mine) if (r.mint) earnedBy.set(r.mint, (earnedBy.get(r.mint) ?? 0n) + BigInt(r.amount));
    const earned = [...earnedBy].filter(([, a]) => a > 0n)
      .map(([m, a]) => ({ mint: m, symbol: meta.get(m)?.symbol ?? null, decimals: meta.get(m)?.decimals ?? null, amount: a.toString() }));
    const running = mine.find((r: any) => r.status === "accruing");
    const p = await ctx.staking.position(owner, t.farm);
    if (!p || (p.staked === 0n && earned.length === 0)) continue;
    const unlocksAt = p.lastStakeTs + p.lockSeconds;
    const remaining = unlocksAt - now;
    const locked = remaining > 0 && p.staked > 0n;
    const burned = locked ? earlyExitPenalty(p.staked, launch.max_penalty_bps, p.lockSeconds, remaining) : 0n;
    out.push({
      tierId: t.tier_id, farm: t.farm, multiplierBps: t.multiplier_bps, lockSeconds: p.lockSeconds, staked: p.staked.toString(), unlocksAt, locked,
      earned, paysAt: running ? Number(running.ends) : null, paying: mine.some((r: any) => r.status !== "accruing"),
      exitPreview: locked
        ? { back: (p.staked - burned).toString(), burned: burned.toString(), penaltyBps: Number((BigInt(launch.max_penalty_bps) * BigInt(Math.min(remaining, p.lockSeconds))) / BigInt(p.lockSeconds)), daysLeft: Math.ceil(remaining / 86_400) }
        : null,
    });
  }
  return out;
}

const Body = z.object({ mint: z.string().min(1), tierId: z.string().min(1), owner: addr, amount: z.string().regex(/^\d+$/, "Amount must be a whole number").optional() });
const Action = z.enum(["stake", "claim", "exit", "withdraw"], { message: "Unknown action" });

export async function buildStakeAction(ctx: WebContext, actionRaw: string, raw: unknown): Promise<WalletTx> {
  const transaction = { base64: await stakeActionTx(ctx, actionRaw, raw), versioned: false };
  await checkTx(ctx.conn, transaction);
  return transaction;
}

async function stakeActionTx(ctx: WebContext, actionRaw: string, raw: unknown): Promise<string> {
  const action = Action.parse(actionRaw);
  const b = Body.parse(raw);
  const { launch, tiers } = await launchStake(ctx, b.mint);
  if (launch.status !== "ready") throw new LaunchError("invalid_input", "Staking is not open yet");
  const tier = tiers.find((t: any) => t.tier_id === b.tierId);
  if (!tier?.farm) throw new LaunchError("invalid_input", "That lock tier does not exist");
  if (action === "stake") {
    const amount = BigInt(b.amount ?? "0");
    if (amount <= 0n) throw new LaunchError("invalid_input", "Enter an amount to stake");
    return ctx.staking.buildStakeTx(b.owner, tier.farm, b.mint, amount);
  }
  const p = await ctx.staking.position(b.owner, tier.farm);
  if (!p) throw new LaunchError("invalid_input", "You have no stake in this tier");
  if (action === "claim") return ctx.staking.buildClaimTx(b.owner, tier.farm);
  if (p.staked === 0n) throw new LaunchError("invalid_input", "Nothing is staked in this tier");
  const locked = p.lastStakeTs + p.lockSeconds > Math.floor(Date.now() / 1000);
  if (action === "exit") {
    if (!locked) throw new LaunchError("invalid_input", "This stake is unlocked. Withdraw it instead.");
    return ctx.staking.buildExitTx(b.owner, tier.farm, b.mint);
  }
  if (locked) throw new LaunchError("invalid_input", "This stake is still locked");
  return ctx.staking.buildWithdrawTx(b.owner, tier.farm, b.mint);
}
