import { getContext } from "@/web/server/context";
import { jsonError, readJson } from "@/web/server/http";
import { openSession } from "@/web/server/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const cookies = await openSession(getContext(), req, await readJson(req));
    const headers = new Headers({ "content-type": "application/json" });
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e) {
    return jsonError(e);
  }
}
