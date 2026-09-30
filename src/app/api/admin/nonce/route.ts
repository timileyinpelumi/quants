import { getContext } from "@/web/server/context";
import { jsonError } from "@/web/server/http";
import { issueNonce } from "@/web/server/admin";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { message, setCookie } = await issueNonce(getContext());
    return new Response(JSON.stringify({ message }), { headers: { "content-type": "application/json", "set-cookie": setCookie } });
  } catch (e) {
    return jsonError(e);
  }
}
