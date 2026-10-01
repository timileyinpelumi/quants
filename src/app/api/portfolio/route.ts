import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { positions, stakedFarms } from "@/web/server/stake";

export const dynamic = "force-dynamic";

const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Wallet address is not valid");

export async function GET(req: Request) {
  try {
    rateLimit(req, "portfolio", 30);
    const c = getContext();
    const owner = addr.parse(new URL(req.url).searchParams.get("owner") ?? "");
    const farms = await stakedFarms(c, owner);
    if (farms.length === 0) return json({ launches: [] });
    const rows = await c.sql`
      select distinct l.mint, l.symbol, l.name, l.image, l.id from stake_tiers st join launches l on l.id = st.launch_id
      where st.farm in ${c.sql(farms)} order by l.id`;
    const launches = [];
    for (const l of rows) {
      const p = await positions(c, l.mint, owner);
      if (p.length) launches.push({ mint: l.mint, symbol: l.symbol, name: l.name, image: l.image, positions: p });
    }
    return json({ launches });
  } catch (e) {
    return jsonError(e);
  }
}
