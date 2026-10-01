import { getContext } from "@/web/server/context";
import { jsonError } from "@/web/server/http";
import { issueNonce } from "@/web/server/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { message, setCookie } = await issueNonce(getContext(), req);
    return new Response(JSON.stringify({ message }), { headers: { "content-type": "application/json", "set-cookie": setCookie } });
  } catch (e) {
    return jsonError(e);
  }
}
