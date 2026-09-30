import { getContext } from "@/web/server/context";
import { jsonError, readJson } from "@/web/server/http";
import { openSession } from "@/web/server/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const setCookie = await openSession(getContext(), req, await readJson(req));
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": setCookie } });
  } catch (e) {
    return jsonError(e);
  }
}
