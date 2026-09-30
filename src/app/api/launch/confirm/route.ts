import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { confirmLaunch } from "@/launch/confirm";

export const dynamic = "force-dynamic";

const Body = z.object({ signature: z.string().min(32).max(100), mint: z.string().min(32).max(44) });

export async function POST(req: Request) {
  try {
    const c = getContext();
    const b = Body.parse(await readJson(req));
    return json({ launchId: await confirmLaunch({ sql: c.sql, conn: c.conn, meteora: c.meteora, spillWallet: c.spillWallet }, b) });
  } catch (e) {
    return jsonError(e);
  }
}
