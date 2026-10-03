import { getContext } from "@/web/server/context";
import { json, jsonError, rateLimit } from "@/web/server/http";
import { waitForSignature } from "@/web/server/settle";
import { LaunchError } from "@/launch/prepare";

export const dynamic = "force-dynamic";

/** One status check through the server's providers, so the browser never needs a public RPC to confirm. */
export async function GET(req: Request) {
  try {
    rateLimit(req, "tx-status", 120);
    const sig = new URL(req.url).searchParams.get("sig") ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(sig)) throw new LaunchError("invalid_input", "Signature is not valid");
    return json({ state: await waitForSignature(getContext().conn, sig, { timeoutMs: 0, pollMs: 0 }) });
  } catch (e) {
    return jsonError(e);
  }
}
