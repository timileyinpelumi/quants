import { readFileSync } from "node:fs";
import { z } from "zod";
import { applyClusterDefaults } from "./cluster";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  RPC_URL: z.string().url(),
  KEEPER_KEYPAIR: z.string(),
  SPILL_KEYPAIR: z.string(),
  TREASURY_ADDRESS: z.string().min(32),
  OURTOKEN_MINT: z.string().min(32),
  KAMINO_GLOBAL_CONFIG: z.string().min(32),
  DAMM_V2_MIGRATION_CONFIG: z.string().min(32),
  JUPITER_BASE_URL: z.string().url().default("https://api.jup.ag/swap/v1"),
  JUPITER_API_KEY: z.string().optional(),
  ALERT_WEBHOOK_URL: z.preprocess((v) => v || undefined, z.string().url().optional()),
});
export type Env = z.infer<typeof Env>;
export const loadEnv = (): Env => {
  applyClusterDefaults(process.env);
  readKeypairFiles(process.env);
  assertNoDevSwitches(process.env);
  return Env.parse(process.env);
};

type RawEnv = Record<string, string | undefined>;

/** KEEPER_KEYPAIR and SPILL_KEYPAIR can come from a file named by KEEPER_KEYPAIR_PATH and SPILL_KEYPAIR_PATH. */
export function readKeypairFiles(env: RawEnv) {
  for (const name of ["KEEPER_KEYPAIR", "SPILL_KEYPAIR"]) {
    const path = env[`${name}_PATH`];
    if (!path) continue;
    if (env[name]) throw new Error(`Set ${name} or ${name}_PATH, not both`);
    env[name] = readFileSync(path, "utf8").trim();
  }
  return env;
}

// The hosted preview runs against a tunnelled local validator and sets ALLOW_DEV_SWITCHES=1 on purpose.
export function assertNoDevSwitches(env: RawEnv) {
  const on = [
    env.PINATA_JWT === "stub" && "PINATA_JWT=stub",
    env.ALLOW_LOCAL_URIS && "ALLOW_LOCAL_URIS",
    env.DEV_UPLOADS_BASE && "DEV_UPLOADS_BASE",
    env.LOCAL_TOKEN_LIST && "LOCAL_TOKEN_LIST",
    env.LOCAL_REWARD_MINTS && "LOCAL_REWARD_MINTS",
    env.LOCAL_STOCKS && "LOCAL_STOCKS",
  ].filter(Boolean);
  if (on.length === 0 || env.ALLOW_DEV_SWITCHES === "1") return;
  let host = "";
  try { host = new URL(env.RPC_URL ?? "").hostname; } catch {}
  if (host === "localhost" || host === "127.0.0.1") return;
  throw new Error(`Refusing to start: dev switches ${on.join(", ")} are set but RPC_URL is not local. Unset them, or set ALLOW_DEV_SWITCHES=1 if this is a preview.`);
}

export function checkWebEnv(env: RawEnv) {
  if (!/^[0-9a-fA-F]{64,}$/.test(env.ADMIN_SESSION_SECRET ?? "")) {
    throw new Error("Refusing to start: ADMIN_SESSION_SECRET must be at least 32 random bytes as hex (64+ hex characters). Generate one with: openssl rand -hex 32");
  }
  assertNoDevSwitches(env);
}
