import type { SQL } from "bun";

/** Ends a period without paying it and returns what it earned to the reserve. */
export async function returnEarnings(sql: SQL, periodId: number, from: "accruing" | "due", to: "forfeited" | "rejected", by: string | null = null): Promise<boolean> {
  const [r] = await sql`
    with p as (
      update stake_periods set status = ${to}, decided_by = ${by}, decided_at = now(), updated_at = now()
      where id = ${periodId} and status = ${from} returning id, launch_id
    ), e as (
      select se.mint, se.amount from stake_earnings se join p on p.id = se.period_id where se.amount > 0
    ), dec as (
      update escrow es set amount = es.amount - e.amount from e, p
      where es.launch_id = p.launch_id and es.bucket = 'owed' and es.mint = e.mint returning 1
    ), inc as (
      insert into escrow (launch_id, bucket, mint, amount) select p.launch_id, 'reward', e.mint, e.amount from e cross join p
      on conflict (launch_id, bucket, mint) do update set amount = escrow.amount + excluded.amount returning 1
    )
    select (select count(*) from p)::int as n`;
  return r.n === 1;
}
