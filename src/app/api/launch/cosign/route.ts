import { z } from "zod";
import { getContext } from "@/web/server/context";
import { json, jsonError, readJson, rateLimit } from "@/web/server/http";
import { cosignAndSend } from "@/web/server/cosign";

export const dynamic = "force-dynamic";

const Body = z.object({ id: z.string().uuid(), transaction: z.string().min(1).max(2400) });

export async function POST(req: Request) {
  try {
    rateLimit(req, "cosign", 20);
    const c = getContext();
    const b = Body.parse(await readJson(req));
    return json({ signature: await cosignAndSend({ sql: c.sql, conn: c.conn }, b) });
  } catch (e) {
    return jsonError(e);
  }
}
