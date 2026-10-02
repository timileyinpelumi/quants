import { SQL } from "bun";
import { loadLatestSettings, saveSettings } from "../src/domain/settings";

const [basket = 0, platform = 0, creator = 0] = process.argv.slice(2).map(Number);
const sql = new SQL(process.env.DATABASE_URL!);
const { version: _v, ...current } = await loadLatestSettings(sql);
const v = await saveSettings(sql, { ...current, split: { basketBps: basket, platformBps: platform, creatorBps: creator } }, "cli");
console.log(`settings version ${v}`);
await sql.close();
