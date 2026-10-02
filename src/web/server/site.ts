import { sharedDb } from "@/db/client";
import { cachedSettings, defaultSettings, xUrlOf, type VersionedSettings } from "@/domain/settings";

/** Admin settings for page chrome (banner, X link). Falls back to the env seed if the database is unreachable. */
export async function siteSettings(): Promise<VersionedSettings> {
  try {
    return await cachedSettings(sharedDb());
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), settingsFailed: String(e) }));
    return { ...defaultSettings(process.env.OURTOKEN_MINT ?? ""), version: 0 };
  }
}

export const siteXUrl = async () => xUrlOf(await siteSettings());
