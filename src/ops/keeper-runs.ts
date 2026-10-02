import type { SQL } from "bun";

export const RETENTION_DAYS = 90;
const PRUNE_BATCH = 5_000;

export async function recordKeeperRun(sql: SQL, r: { startedAt: Date; launches?: number; errors?: { error: string }[]; fatal?: string }) {
  const error = r.fatal ?? r.errors?.[0]?.error ?? null;
  await sql`insert into keeper_runs (started_at, launches, errors, error, fatal)
    values (${r.startedAt}, ${r.launches ?? 0}, ${r.errors?.length ?? 0}, ${error === null ? null : error.slice(0, 500)}, ${r.fatal !== undefined})`;
}

/** Drops page views and keeper runs older than the retention window, a bounded batch per call so one pass stays short. */
export async function pruneAnalytics(sql: SQL, now = Date.now()): Promise<{ views: number; runs: number }> {
  const before = new Date(now - RETENTION_DAYS * 86_400_000);
  const [v] = await sql`with d as (delete from page_views where ctid in (select ctid from page_views where at < ${before} limit ${PRUNE_BATCH}) returning 1)
    select count(*)::int as n from d`;
  const [r] = await sql`with d as (delete from keeper_runs where id in (select id from keeper_runs where started_at < ${before} limit ${PRUNE_BATCH}) returning 1)
    select count(*)::int as n from d`;
  return { views: v.n, runs: r.n };
}
