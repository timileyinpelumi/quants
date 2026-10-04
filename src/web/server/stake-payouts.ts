import { z } from "zod";
import type { WebContext } from "./context";
import { usdPrices } from "./prices";
import { returnEarnings } from "@/ledger/stake-earnings";
import { LaunchError } from "@/launch/prepare";

export interface PayoutRow {
  id: number; mint: string; symbol: string | null; tierId: string; owner: string; status: string;
  startedAt: string; endsAt: string; decidedAt: string | null; paidAt: string | null;
  amounts: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
  usd: number | null;
}

/** Due and approved payouts first, then the most recent paid and rejected ones. */
export async function listPayouts(ctx: WebContext, limit = 200): Promise<PayoutRow[]> {
  const rows = await ctx.sql`
    select p.id, l.mint, l.symbol, p.tier_id, p.owner, p.status, p.started_at, p.ends_at, p.decided_at, p.paid_at,
      coalesce(json_agg(json_build_object('mint', e.mint, 'amount', e.amount::text, 'symbol', b.symbol, 'decimals', b.decimals) order by e.mint)
        filter (where e.amount > 0), '[]') as amounts
    from stake_periods p
    join launches l on l.id = p.launch_id
    left join stake_earnings e on e.period_id = p.id
    left join baskets b on b.launch_id = p.launch_id and b.reward_mint = e.mint
    where p.status in ('due', 'approved', 'paid', 'rejected')
    group by p.id, l.mint, l.symbol
    order by case p.status when 'due' then 0 when 'approved' then 1 else 2 end, coalesce(p.decided_at, p.ends_at) desc
    limit ${limit}`;
  const mints = [...new Set(rows.flatMap((r: any) => r.amounts.map((a: any) => a.mint as string)))] as string[];
  const prices = mints.length ? await usdPrices(ctx, mints) : {};
  return rows.map((r: any) => {
    const amounts = r.amounts.map((a: any) => ({ mint: a.mint, symbol: a.symbol ?? null, decimals: a.decimals ?? null, amount: a.amount }));
    const parts = amounts.map((a: any) => (prices[a.mint] != null && a.decimals != null ? (Number(a.amount) / 10 ** a.decimals) * prices[a.mint]! : null));
    return {
      id: Number(r.id), mint: r.mint, symbol: r.symbol, tierId: r.tier_id, owner: r.owner, status: r.status,
      startedAt: new Date(r.started_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
      decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null, paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      amounts, usd: parts.length && parts.every((x: number | null) => x !== null) ? parts.reduce((a: number, b: number) => a + b, 0) : null,
    };
  });
}

const Decision = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500), action: z.enum(["approve", "reject"]) });

export async function decidePayouts(ctx: WebContext, raw: unknown, by: string): Promise<{ changed: number }> {
  const parsed = Decision.safeParse(raw);
  if (!parsed.success) throw new LaunchError("invalid_input", "Pick at least one payout");
  const { ids, action } = parsed.data;
  let changed = 0;
  for (const id of ids) {
    if (action === "approve") {
      const r = await ctx.sql`update stake_periods set status = 'approved', decided_by = ${by}, decided_at = now(), updated_at = now()
        where id = ${id} and status = 'due' returning id`;
      changed += r.length;
    } else if (await returnEarnings(ctx.sql, id, "due", "rejected", by)) {
      changed += 1;
    }
  }
  return { changed };
}
