import { getContext } from "@/web/server/context";
import { adminJson, jsonError, readJson } from "@/web/server/http";
import { createReadCode, listReadCodes, requireAdmin, revokeReadCode } from "@/web/server/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "full");
    return adminJson({ codes: await listReadCodes(c) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "full");
    return adminJson(await createReadCode(c, await readJson(req)));
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req, "full");
    await revokeReadCode(c, await readJson(req));
    return adminJson({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
