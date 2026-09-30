import { getContext } from "@/web/server/context";
import { json, jsonError } from "@/web/server/http";
import { listLaunches } from "@/web/server/reads";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const g = new URL(req.url).searchParams.get("graduated");
    return json({ launches: await listLaunches(getContext().sql, { graduated: g === "1" ? true : undefined }) });
  } catch (e) {
    return jsonError(e);
  }
}
