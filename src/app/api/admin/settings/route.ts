import { getContext } from "@/web/server/context";
import { json, jsonError, readJson } from "@/web/server/http";
import { requireAdmin } from "@/web/server/admin";
import { loadLatestSettings, saveSettings, parseSettings } from "@/domain/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const c = getContext();
    await requireAdmin(c, req);
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return json({ version, settings });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getContext();
    const by = await requireAdmin(c, req);
    await saveSettings(c.sql, parseSettings(await readJson(req)), by);
    const { version, ...settings } = await loadLatestSettings(c.sql);
    return json({ version, settings });
  } catch (e) {
    return jsonError(e);
  }
}
