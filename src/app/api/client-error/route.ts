import { z } from "zod";
import { json, jsonError, readJson, rateLimit } from "@/web/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  step: z.string().max(40),
  message: z.string().max(500),
  wallet: z.string().max(60).optional(),
});

/** Client side send failures, logged so production shows what a wallet did. Holds no keys and no transaction bytes. */
export async function POST(req: Request) {
  try {
    rateLimit(req, "client-error", 10);
    const b = Body.parse(await readJson(req));
    console.error(JSON.stringify({ at: new Date().toISOString(), clientSendFailed: { step: b.step, message: b.message, wallet: b.wallet ?? null } }));
    return json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
