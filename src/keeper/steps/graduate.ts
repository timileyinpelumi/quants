import { loadLaunches } from "../launch-row";
import { loadLatestSettings } from "../../domain/settings";
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { runTxStep } from "../../ledger/run-step";

// Meteora's keepers migrate SOL curves and leave other quotes to us; migrating every full curve covers both and any delay on theirs.
export async function graduateStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, _runId: string, quotePaused = false): Promise<LaunchRow> {
  if (launch.status === "graduated") return launch;
  const curve = await deps.meteora.curveState(launch.pool);
  if (!curve.migrated) {
    if (curve.complete && !quotePaused) {
      await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: `migrate:${launch.id}`, kind: "migrate", settingsVersion: s.version, detail: { pool: launch.pool },
        build: () => deps.meteora.buildMigrate(launch.pool), resolve: async () => [],
      });
    }
    return launch;
  }
  const pos = await deps.meteora.findGraduatedPosition(launch.configKey, launch.mint, launch.quoteMint);
  if (!pos) return launch;
  await deps.sql`update launches set status = 'graduated', graduated_at = coalesce(graduated_at, now()), damm_pool = ${pos.dammPool}, damm_position = ${pos.position},
    damm_position_nft_account = ${pos.positionNftAccount} where id = ${launch.id}`;
  return { ...launch, status: "graduated", dammPool: pos.dammPool, dammPosition: pos.position, dammPositionNftAccount: pos.positionNftAccount };
}

/**
 * Between a curve filling and its migration nobody can trade it, so this runs every few seconds instead of waiting
 * for the main run. Only launches whose latest trade put the curve at 95% or more are read from chain.
 */
export async function quickGraduate(deps: KeeperDeps) {
  const rows = await deps.sql`
    select l.id from launches l
    join lateral (select curve_reserve, curve_threshold from trades t where t.launch_id = l.id and t.curve_reserve is not null order by t.slot desc, t.seq desc limit 1) t on true
    where l.status = 'live' and t.curve_threshold::numeric > 0 and t.curve_reserve::numeric >= t.curve_threshold::numeric * 0.95
    limit 20`;
  if (!rows.length) return;
  const ids = new Set(rows.map((r: any) => Number(r.id)));
  const s = await loadLatestSettings(deps.sql);
  for (const launch of (await loadLaunches(deps.sql)).filter((l) => ids.has(l.id))) {
    await graduateStep(deps, launch, s, "quick").catch((e) => console.error(JSON.stringify({ at: new Date().toISOString(), quickGraduateFailed: launch.id, error: String(e).slice(0, 200) })));
  }
}
