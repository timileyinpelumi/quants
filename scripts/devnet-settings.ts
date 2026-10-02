import { SQL } from "bun";
import { defaultSettings, saveSettings } from "../src/domain/settings";

const DAY = 86_400;
const sql = new SQL(process.env.DATABASE_URL!);
const base = defaultSettings(process.env.OURTOKEN_MINT!);
// Two tiers halve the farm rent a launch must earn before staking opens; small pools need a wider slippage cap.
const v = await saveSettings(sql, {
  ...base,
  tiers: [{ id: "1d", lockSeconds: DAY, multiplierBps: 10_000 }, { id: "7d", lockSeconds: 7 * DAY, multiplierBps: 15_000 }],
  slippageBps: 500,
}, "devnet");
console.log(`settings version ${v}`);
await sql.close();
