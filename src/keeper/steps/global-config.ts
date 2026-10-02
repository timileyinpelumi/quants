import type { SQL } from "bun";
import { Keypair } from "@solana/web3.js";
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { beginStep } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export const GLOBAL_CONFIG_ACCOUNT = "kamino_global_config";

/** KAMINO_GLOBAL_CONFIG wins; otherwise the one the keeper created earlier, recorded in platform_accounts. */
export async function loadGlobalConfig(deps: Pick<KeeperDeps, "sql" | "staking">) {
  if (deps.staking.globalConfig()) return;
  const [r] = await deps.sql`select address from platform_accounts where name = ${GLOBAL_CONFIG_ACCOUNT}`;
  if (r) deps.staking.setGlobalConfig(r.address);
}

/** The launch whose rent included the global config: the first one to open staking while none existed. */
async function payer(sql: SQL): Promise<number | null> {
  const [r] = await sql`select launch_id from distributions
    where kind = 'rent' and status = 'confirmed' and detail->>'globalConfig' = 'true' order by id limit 1`;
  return r ? Number(r.launch_id) : null;
}

export async function owesGlobalConfig(deps: Pick<KeeperDeps, "sql" | "staking">, launchId: number): Promise<boolean> {
  await loadGlobalConfig(deps);
  if (deps.staking.globalConfig()) return false;
  const p = await payer(deps.sql);
  return p === null || p === launchId;
}

/**
 * True once a Kamino global config exists. The launch that paid for it creates it (the keypair is stored before
 * sending, so a retry reuses the address); any other launch waits for that.
 */
export async function ensureGlobalConfig(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings): Promise<boolean> {
  await loadGlobalConfig(deps);
  if (deps.staking.globalConfig()) return true;
  if ((await payer(deps.sql)) !== launch.id) return false;
  const kp = Keypair.generate();
  const row = await beginStep(deps.sql, {
    launchId: launch.id, idemKey: GLOBAL_CONFIG_ACCOUNT, kind: "create_farm", settingsVersion: s.version,
    detail: { globalConfig: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) },
  });
  const address = row.detail.globalConfig as string;
  const secret = Uint8Array.from(row.detail.secret as number[]);
  const created = row.status === "confirmed" || (await deps.staking.farmExists(address))
    ? "confirmed"
    : await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: GLOBAL_CONFIG_ACCOUNT, kind: "create_farm", settingsVersion: s.version, detail: row.detail,
        build: () => deps.staking.buildCreateGlobalConfig(secret), resolve: async () => [],
      });
  if (created !== "confirmed") return false;
  await deps.sql`insert into platform_accounts (name, address) values (${GLOBAL_CONFIG_ACCOUNT}, ${address}) on conflict do nothing`;
  deps.staking.setGlobalConfig(address);
  return true;
}
