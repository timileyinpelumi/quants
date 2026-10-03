import { getContext } from "@/web/server/context";
import { adminJson, jsonError, readJson } from "@/web/server/http";
import { login, logout, requireAdmin } from "@/web/server/admin";

export const dynamic = "force-dynamic";

const withCookie = (setCookie: string) =>
  new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": setCookie, "cache-control": "no-store" } });

export async function GET(req: Request) {
  try {
    const { role } = await requireAdmin(getContext(), req, "read");
    return adminJson({ role });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    return withCookie(await login(getContext(), req, await readJson(req)));
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    return withCookie(await logout(getContext(), req));
  } catch (e) {
    return jsonError(e);
  }
}
