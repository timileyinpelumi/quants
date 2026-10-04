import { z } from "zod";
import type { WebContext } from "./context";
import { usdPrices } from "./prices";
import { LaunchError } from "@/launch/prepare";

export interface BurnRow { id: number; mint: string; symbol: string | null; amount: string; usd: number | null; status: string; createdAt: string; decidedAt: string | null; burnedAt: string | null }

/** Pending and approved burns first, then the most recent burned ones. */
export async function listBurns(ctx: WebContext, limit = 200): Promise<BurnRow[]> {
  const rows = await ctx.sql`
    select b.id, b.mint, l.symbol, b.amount::text as amount, b.status, b.created_at, b.decided_at, b.burned_at
    from burn_requests b join launches l on l.id = b.launch_id
    order by case b.status when 'pending' then 0 when 'approved' then 1 else 2 end, b.created_at desc
    limit ${limit}`;
  const mints = [...new Set(rows.map((r: any) => r.mint as string))] as string[];
  const prices = mints.length ? await usdPrices(ctx, mints) : {};
  // Every launch has 6 decimals.
  return rows.map((r: any) => ({
    id: Number(r.id), mint: r.mint, symbol: r.symbol, amount: r.amount, status: r.status,
    usd: prices[r.mint] != null ? (Number(r.amount) / 1e6) * prices[r.mint]! : null,
    createdAt: new Date(r.created_at).toISOString(), decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    burnedAt: r.burned_at ? new Date(r.burned_at).toISOString() : null,
  }));
}

const Approve = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

export async function approveBurns(ctx: WebContext, raw: unknown, by: string): Promise<{ changed: number }> {
  const parsed = Approve.safeParse(raw);
  if (!parsed.success) throw new LaunchError("invalid_input", "Pick at least one burn");
  let changed = 0;
  for (const id of parsed.data.ids) {
    const r = await ctx.sql`update burn_requests set status = 'approved', decided_by = ${by}, decided_at = now() where id = ${id} and status = 'pending' returning id`;
    changed += r.length;
  }
  return { changed };
}
