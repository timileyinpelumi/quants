import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    const [last] = await c.sql`select max(updated_at) as at from distributions`;
    const failed = await c.sql`
      select d.id, l.mint, l.symbol, d.kind, d.error, d.attempts, d.updated_at
      from distributions d join launches l on l.id = d.launch_id
      where d.status = 'failed' and coalesce(d.error, '') <> 'abandoned before send'
      order by d.id desc limit 50`;
    const inFlight = await c.sql`
      select distinct l.mint, l.symbol from distributions d join launches l on l.id = d.launch_id where d.status = 'sent'`;
    return json({
      lastActivity: last?.at ? new Date(last.at).toISOString() : null,
      failed: failed.map((f: any) => ({ id: Number(f.id), mint: f.mint, symbol: f.symbol, kind: f.kind, error: f.error, attempts: f.attempts, at: new Date(f.updated_at).toISOString() })),
      inFlight: inFlight.map((r: any) => ({ mint: r.mint, symbol: r.symbol })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
