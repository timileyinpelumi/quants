import { z } from "zod";
import { getContext } from "@/web/server/context";
import { adminJson, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { page, pageParams, queryOf } from "@/web/server/paging";

export const dynamic = "force-dynamic";

const Query = z.object({
  limit: pageParams(50).limit,
  before: z.coerce.number().int().positive().optional(),
});

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "read");
    const o = Query.parse(queryOf(req));
    const before = o.before ?? null;
    const [last] = await c.sql`select max(updated_at) as at from distributions`;
    const failed = page(await c.sql`
      select d.id, l.mint, l.symbol, d.kind, d.error, d.attempts, d.updated_at
      from distributions d join launches l on l.id = d.launch_id
      where d.status = 'failed' and coalesce(d.error, '') <> 'abandoned before send'
        and (${before}::bigint is null or d.id < ${before}::bigint)
      order by d.id desc limit ${o.limit + 1}`, o.limit);
    const inFlight = await c.sql`
      select distinct l.mint, l.symbol from distributions d join launches l on l.id = d.launch_id where d.status = 'sent' limit 50`;
    return adminJson({
      lastActivity: last?.at ? new Date(last.at).toISOString() : null,
      failed: failed.rows.map((f: any) => ({ id: Number(f.id), mint: f.mint, symbol: f.symbol, kind: f.kind, error: f.error, attempts: f.attempts, at: new Date(f.updated_at).toISOString() })),
      failedNext: failed.more ? Number((failed.rows.at(-1) as { id: string }).id) : null,
      inFlight: inFlight.map((r: any) => ({ mint: r.mint, symbol: r.symbol })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
