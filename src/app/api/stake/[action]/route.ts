import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { buildStakeAction } from "@/web/server/stake";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const base64 = await buildStakeAction(getContext(), (await params).action, await readJson(req));
    return json({ transaction: { base64, versioned: false } });
  } catch (e) {
    return jsonError(e);
  }
}
