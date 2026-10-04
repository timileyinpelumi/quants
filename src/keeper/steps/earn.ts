import type { SQL } from "bun";
import type { KeeperDeps } from "../deps";
import type { LaunchRow } from "../launch-row";
import type { VersionedSettings } from "../../domain/settings";
import { accrue } from "../../domain/earnings";
import { getBalance, json, type DeltaResolver } from "../../ledger/ledger";
import { runTxStep } from "../../ledger/run-step";
import { returnEarnings } from "../../ledger/stake-earnings";

export { returnEarnings };

const DAY = 86_400;

interface Live { periodId: number; staked: bigint; multiplierBps: number }

async function openPeriod(sql: SQL, launchId: number, tierId: string, owner: string, stake: bigint, startedAt: number, endsAt: number): Promise<number> {
  const [r] = await sql`insert into stake_periods (launch_id, tier_id, owner, stake, started_at, ends_at, status)
    values (${launchId}, ${tierId}, ${owner}, ${stake.toString()}, to_timestamp(${startedAt}), to_timestamp(${endsAt}), 'accruing') returning id`;
  return Number(r.id);
}

/** A period whose lock ran out goes to the payout list; one that earned nothing is dropped. */
async function closePeriod(sql: SQL, periodId: number) {
  const [r] = await sql`update stake_periods set status = 'due', updated_at = now()
    where id = ${periodId} and status = 'accruing' and exists (select 1 from stake_earnings where period_id = ${periodId} and amount > 0) returning id`;
  if (r) return;
  await sql`delete from stake_earnings where period_id = ${periodId}`;
  await sql`delete from stake_periods where id = ${periodId} and status = 'accruing'`;
}

/** Moves the period shares from the reward reserve to owed and records them, all or nothing. */
async function book(sql: SQL, launchId: number, mint: string, shares: Map<string, bigint>) {
  const payload = json([...shares].map(([period, amount]) => ({ period, amount: amount.toString() })));
  await sql`
    with x as (
      select (e->>'period')::bigint as period_id, (e->>'amount')::numeric as amount from jsonb_array_elements(${payload}::text::jsonb) e
    ), tot as (
      select sum(amount) as amount from x
    ), dec as (
      update escrow set amount = amount - (select amount from tot)
      where launch_id = ${launchId} and bucket = 'reward' and mint = ${mint} and amount >= (select amount from tot) returning 1
    ), earn as (
      insert into stake_earnings (period_id, mint, amount) select period_id, ${mint}, amount from x where exists (select 1 from dec)
      on conflict (period_id, mint) do update set amount = stake_earnings.amount + excluded.amount returning 1
    ), owed as (
      insert into escrow (launch_id, bucket, mint, amount) select ${launchId}, 'owed', ${mint}, amount from tot where exists (select 1 from dec)
      on conflict (launch_id, bucket, mint) do update set amount = escrow.amount + excluded.amount returning 1
    )
    select 1`;
}

export async function earnStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings, now = Math.floor(Date.now() / 1000)) {
  const [pool] = await deps.sql`select status, extract(epoch from accrued_at)::bigint as accrued from stake_pools where launch_id = ${launch.id}`;
  if (pool?.status !== "ready") return;
  const tiers = await deps.sql`select tier_id, farm, lock_seconds, multiplier_bps from stake_tiers where launch_id = ${launch.id} and farm is not null order by lock_seconds`;
  const live: Live[] = [];
  for (const t of tiers) {
    const lock = Number(t.lock_seconds);
    const stakers = await deps.staking.farmStakers(t.farm);
    const byOwner = new Map(stakers.map((u) => [u.owner, u]));
    const open = await deps.sql`select id, owner, stake, extract(epoch from started_at)::bigint as started, extract(epoch from ends_at)::bigint as ends
      from stake_periods where launch_id = ${launch.id} and tier_id = ${t.tier_id} and status = 'accruing'`;
    const seen = new Set<string>();
    for (const p of open) {
      seen.add(p.owner);
      const u = byOwner.get(p.owner);
      const staked = u?.staked ?? 0n;
      const id = Number(p.id);
      // Adding to a stake restarts the lock on chain, so the period runs to the new unlock time.
      const ends = u && u.lastStakeTs > Number(p.started) ? Math.max(Number(p.ends), u.lastStakeTs + lock) : Number(p.ends);
      if (now >= ends) {
        await closePeriod(deps.sql, id);
        if (staked > 0n) live.push({ periodId: await openPeriod(deps.sql, launch.id, t.tier_id, p.owner, staked, ends, ends + lock), staked, multiplierBps: t.multiplier_bps });
        continue;
      }
      if (staked < BigInt(p.stake)) {
        await returnEarnings(deps.sql, id, "accruing", "forfeited");
        if (staked > 0n) live.push({ periodId: await openPeriod(deps.sql, launch.id, t.tier_id, p.owner, staked, now, now + lock), staked, multiplierBps: t.multiplier_bps });
        continue;
      }
      if (staked !== BigInt(p.stake) || ends !== Number(p.ends)) {
        await deps.sql`update stake_periods set stake = ${staked.toString()}, ends_at = to_timestamp(${ends}), updated_at = now() where id = ${id}`;
      }
      live.push({ periodId: id, staked, multiplierBps: t.multiplier_bps });
    }
    for (const u of stakers) {
      if (seen.has(u.owner) || u.staked === 0n) continue;
      const start = u.lastStakeTs + lock > now ? u.lastStakeTs : now;
      live.push({ periodId: await openPeriod(deps.sql, launch.id, t.tier_id, u.owner, u.staked, start, start + lock), staked: u.staked, multiplierBps: t.multiplier_bps });
    }
  }

  await deps.sql`update stake_pools set accrued_at = to_timestamp(${now}) where launch_id = ${launch.id}`;
  if (s.rewardFundingPaused || pool.accrued == null) return;
  const dt = now - Number(pool.accrued);
  const mints = (await deps.sql`select reward_mint from baskets where launch_id = ${launch.id} order by reward_mint`).map((r: any) => r.reward_mint as string);
  for (const mint of mints) {
    const reserve = await getBalance(deps.sql, launch.id, "reward", mint);
    const shares = accrue({
      reserve, dtSeconds: dt, periodSeconds: s.earnPeriodDays * DAY, targetBps: s.earnTargetBps,
      stakes: live.map((l) => ({ key: String(l.periodId), staked: l.staked, multiplierBps: l.multiplierBps })),
    });
    if (shares.size) await book(deps.sql, launch.id, mint, shares);
  }
}

export const stakePayoutResolver: DeltaResolver = async (row) => [{ bucket: "owed", mint: row.detail.mint, amount: -BigInt(row.detail.amount) }];

export async function stakePayoutStep(deps: KeeperDeps, launch: LaunchRow, s: VersionedSettings) {
  const periods = await deps.sql`select id, owner from stake_periods where launch_id = ${launch.id} and status = 'approved' order by id`;
  for (const p of periods) {
    const earnings = await deps.sql`select mint, amount from stake_earnings where period_id = ${p.id} and amount > 0 order by mint`;
    let done = true;
    for (const e of earnings) {
      const amount = BigInt(e.amount);
      const key = `stakepay:${p.id}:${e.mint}`;
      const out = await runTxStep(deps.sql, deps.chain, {
        launchId: launch.id, idemKey: key, stepKey: key, kind: "stake_payout", settingsVersion: s.version,
        detail: { periodId: Number(p.id), mint: e.mint, amount: amount.toString(), to: p.owner },
        build: () => deps.chain.buildTransfer(e.mint, p.owner, amount),
        resolve: stakePayoutResolver,
      });
      if (out !== "confirmed") done = false;
    }
    if (done) await deps.sql`update stake_periods set status = 'paid', paid_at = now(), updated_at = now() where id = ${p.id} and status = 'approved'`;
  }
}
