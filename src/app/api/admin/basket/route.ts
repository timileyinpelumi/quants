import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { LaunchError } from "@/launch/prepare";

export const dynamic = "force-dynamic";

const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const Body = z.object({
  mint: z.string().min(1),
  basket: z.array(z.object({ mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), weightBps: z.number().int().positive(), symbol: z.string().max(20).optional(), decimals: z.number().int().min(0).max(18).optional() }))
    .min(1).max(10)
    .refine((b) => new Set(b.map((x) => x.mint)).size === b.length, "Duplicate basket token")
    .refine((b) => b.reduce((a, x) => a + x.weightBps, 0) === 10_000, "Weights must add up to 100%"),
});

export async function POST(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    const b = Body.parse(await readJson(req));
    const [l] = await c.sql`select l.id from launches l where l.mint = ${b.mint}`;
    if (!l) throw new LaunchError("invalid_input", "No token here");
    for (const t of b.basket) {
      if ((await c.tokenProgramOf(t.mint)) !== CLASSIC) throw new LaunchError("basket_unsupported", `${t.mint} is not a classic SPL token`);
    }
    // One statement, not sql.begin (pooled queries queued behind it can get another caller's rows); a farm or swap freezes the basket.
    const [r] = await c.sql`
      with started as (
        select exists(select 1 from stake_tiers where launch_id = ${l.id} and farm is not null)
          or exists(select 1 from distributions where launch_id = ${l.id} and kind in ('create_farm', 'configure_farm', 'swap')) as yes
      ), next as (
        select x.mint, x."weightBps" as weight_bps, x.symbol, x.decimals
        from jsonb_to_recordset(${JSON.stringify(b.basket)}::text::jsonb) as x(mint text, "weightBps" int, symbol text, decimals int)
      ), del as (
        delete from baskets where launch_id = ${l.id} and not (select yes from started) and reward_mint not in (select mint from next)
      ), ins as (
        insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals)
        select ${l.id}, mint, weight_bps, symbol, decimals from next where not (select yes from started)
        on conflict (launch_id, reward_mint) do update set weight_bps = excluded.weight_bps, symbol = excluded.symbol, decimals = excluded.decimals
      )
      select yes from started`;
    if (r.yes) throw new LaunchError("invalid_input", "Farms already exist for this launch");
    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
