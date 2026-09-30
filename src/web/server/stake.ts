import { z } from "zod";
import type { WebContext } from "./context";
import { LaunchError } from "@/launch/prepare";
import { earlyExitPenalty } from "@/domain/penalty";
import { BPS } from "@/domain/types";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Wallet address is not valid");

export interface PositionView {
  tierId: string; farm: string; multiplierBps: number; lockSeconds: number; staked: string; unlocksAt: number; locked: boolean;
  pending: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
  exitPreview: { back: string; burned: string; penaltyBps: number; daysLeft: number } | null;
}

async function launchStake(ctx: WebContext, mint: string) {
  const [l] = await ctx.sql`select l.id, l.mint, sp.status, sp.max_penalty_bps from launches l left join stake_pools sp on sp.launch_id = l.id where l.mint = ${mint}`;
  if (!l) throw new LaunchError("invalid_input", "No token here");
  const tiers = await ctx.sql`select tier_id, farm, multiplier_bps, lock_seconds from stake_tiers where launch_id = ${l.id} order by lock_seconds`;
  const basket = await ctx.sql`select reward_mint, symbol, decimals from baskets where launch_id = ${l.id}`;
  return { launch: l, tiers, basket };
}

export async function positions(ctx: WebContext, mint: string, ownerRaw: string): Promise<PositionView[]> {
  const owner = addr.parse(ownerRaw);
  const { launch, tiers, basket } = await launchStake(ctx, mint);
  const meta = new Map<string, { symbol: string | null; decimals: number | null }>(basket.map((b: any) => [b.reward_mint, { symbol: b.symbol, decimals: b.decimals }]));
  const now = Math.floor(Date.now() / 1000);
  const out: PositionView[] = [];
  for (const t of tiers) {
    if (!t.farm) continue;
    const p = await ctx.staking.position(owner, t.farm);
    if (!p || (p.staked === 0n && p.pending.every((r) => r.amount === 0n))) continue;
    const unlocksAt = p.lastStakeTs + p.lockSeconds;
    const remaining = unlocksAt - now;
    const locked = remaining > 0 && p.staked > 0n;
    const burned = locked ? earlyExitPenalty(p.staked, launch.max_penalty_bps, p.lockSeconds, remaining) : 0n;
    out.push({
      tierId: t.tier_id, farm: t.farm, multiplierBps: t.multiplier_bps, lockSeconds: p.lockSeconds, staked: p.staked.toString(), unlocksAt, locked,
      pending: p.pending.map((r) => ({ mint: r.mint, symbol: meta.get(r.mint)?.symbol ?? null, decimals: meta.get(r.mint)?.decimals ?? null, amount: r.amount.toString() })),
      exitPreview: locked
        ? { back: (p.staked - burned).toString(), burned: burned.toString(), penaltyBps: Number((BigInt(launch.max_penalty_bps) * BigInt(Math.min(remaining, p.lockSeconds))) / BigInt(p.lockSeconds)), daysLeft: Math.ceil(remaining / 86_400) }
        : null,
    });
  }
  return out;
}

const Body = z.object({ mint: z.string().min(1), tierId: z.string().min(1), owner: addr, amount: z.string().regex(/^\d+$/, "Amount must be a whole number").optional() });
const Action = z.enum(["stake", "claim", "exit", "withdraw"], { message: "Unknown action" });

export async function buildStakeAction(ctx: WebContext, actionRaw: string, raw: unknown): Promise<string> {
  const action = Action.parse(actionRaw);
  const b = Body.parse(raw);
  const { launch, tiers } = await launchStake(ctx, b.mint);
  if (launch.status !== "ready") throw new LaunchError("invalid_input", "Staking opens a few minutes after launch");
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
    if (!locked) throw new LaunchError("invalid_input", "This stake is unlocked, withdraw it instead");
    return ctx.staking.buildExitTx(b.owner, tier.farm, b.mint);
  }
  if (locked) throw new LaunchError("invalid_input", "This stake is still locked");
  return ctx.staking.buildWithdrawTx(b.owner, tier.farm, b.mint);
}
