import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { getBalance, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";

export const collectResolver = (deps: KeeperDeps): DeltaResolver => async (row, sig) =>
  [{ bucket: "penalty", mint: row.detail.mint, amount: await deps.chain.received(sig, deps.wallets.spill, row.detail.mint) }];

export const burnResolver: DeltaResolver = async (row) => [{ bucket: "penalty", mint: row.detail.mint, amount: -BigInt(row.detail.amount) }];

export async function penaltyStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, runId: string) {
  const [pool] = await deps.sql`select status, spill_account from stake_pools where launch_id = ${launch.id}`;
  if (pool?.status !== "ready") return;
  const tiers = await deps.sql`select tier_id, farm from stake_tiers where launch_id = ${launch.id}`;
  for (const t of tiers) {
    if ((await deps.staking.slashedAmount(t.farm)) === 0n) continue;
    await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: `collect_penalty:${launch.id}:${runId}:${t.tier_id}`, stepKey: `collect_penalty:${launch.id}:${t.tier_id}`, kind: "collect_penalty", settingsVersion: s.version,
      detail: { farm: t.farm, mint: launch.mint },
      build: () => deps.staking.buildCollectPenalty(t.farm, pool.spill_account),
      resolve: collectResolver(deps),
    });
  }
  // Collected penalties are listed for approval; only approved amounts are burned.
  const held = await getBalance(deps.sql, launch.id, "penalty", launch.mint);
  const [listed] = await deps.sql`select coalesce(sum(amount), 0)::text as amount from burn_requests where launch_id = ${launch.id} and mint = ${launch.mint} and status <> 'burned'`;
  const unlisted = held - BigInt(listed.amount);
  if (unlisted > 0n) {
    await deps.sql`insert into burn_requests (launch_id, mint, amount, status) values (${launch.id}, ${launch.mint}, ${unlisted.toString()}, 'pending')`;
  }
  const approved = await deps.sql`select id, amount from burn_requests where launch_id = ${launch.id} and mint = ${launch.mint} and status = 'approved' order by id`;
  for (const r of approved) {
    const amount = BigInt(r.amount);
    const key = `burn:req:${r.id}`;
    const out = await runTxStep(deps.sql, deps.chain, {
      launchId: launch.id, idemKey: key, stepKey: key, kind: "burn", settingsVersion: s.version,
      detail: { mint: launch.mint, amount: amount.toString(), requestId: Number(r.id) },
      build: () => deps.chain.buildBurn(launch.mint, amount),
      resolve: burnResolver,
    });
    if (out === "confirmed") await deps.sql`update burn_requests set status = 'burned', burned_at = now() where id = ${r.id} and status = 'approved'`;
  }
}
