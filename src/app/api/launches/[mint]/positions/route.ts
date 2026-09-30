import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { positions } from "@/web/server/stake";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ mint: string }> }) {
  try {
    const owner = new URL(req.url).searchParams.get("owner") ?? "";
    return json({ positions: await positions(getContext(), (await params).mint, owner) });
  } catch (e) {
    return jsonError(e);
  }
}
