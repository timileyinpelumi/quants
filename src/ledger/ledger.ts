import type { SQL } from "bun";
import type { Bucket } from "../domain/types";

export type StepKind = "claim" | "split" | "payout" | "swap" | "fund" | "collect_penalty" | "burn" | "migrate" | "create_farm" | "configure_farm";
export type StepStatus = "pending" | "sent" | "confirmed" | "failed";
export interface Delta { bucket: Bucket; mint: string; amount: bigint }
export interface StepRow {
  id: number; launchId: number; idemKey: string; kind: StepKind; status: StepStatus;
  signature: string | null; lastValidBlockHeight: bigint | null; attempts: number;
  detail: Record<string, any>; settingsVersion: number | null;
}
export type DeltaResolver = (row: StepRow, signature: string) => Promise<Delta[]>;
// stepKey identifies the same logical step across keeper runs (idemKey minus the run id); defaults to idemKey.
export interface StepInput { launchId: number; idemKey: string; stepKey?: string; kind: StepKind; settingsVersion: number | null; detail: Record<string, any> }

const toRow = (r: any): StepRow => ({
  id: Number(r.id), launchId: Number(r.launch_id), idemKey: r.idem_key, kind: r.kind, status: r.status,
  signature: r.signature, lastValidBlockHeight: r.last_valid_block_height == null ? null : BigInt(r.last_valid_block_height),
  attempts: r.attempts, detail: r.detail, settingsVersion: r.settings_version,
});

export const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export async function beginStep(sql: SQL, a: StepInput): Promise<StepRow> {
  const [r] = await sql`
    insert into distributions (launch_id, idem_key, step_key, kind, status, settings_version, detail)
    values (${a.launchId}, ${a.idemKey}, ${a.stepKey ?? a.idemKey}, ${a.kind}, 'pending', ${a.settingsVersion}, ${json(a.detail)}::text::jsonb)
    on conflict (idem_key) do update set updated_at = now()
    returning *`;
  return toRow(r);
}

export async function markSent(sql: SQL, id: number, signature: string, lastValidBlockHeight: bigint) {
  await sql`update distributions set status = 'sent', signature = ${signature}, last_valid_block_height = ${lastValidBlockHeight.toString()},
    attempts = attempts + 1, updated_at = now() where id = ${id} and status = 'pending'`;
}

export async function resetToPending(sql: SQL, id: number) {
  await sql`update distributions set status = 'pending', signature = null, last_valid_block_height = null, updated_at = now()
    where id = ${id} and status = 'sent'`;
}

export async function failStep(sql: SQL, id: number, error: string, countAttempt = false) {
  await sql`update distributions set status = 'failed', error = ${error}, attempts = attempts + ${countAttempt ? 1 : 0}, updated_at = now()
    where id = ${id} and status in ('pending', 'sent')`;
}

export async function retryFailed(sql: SQL, id: number) {
  await sql`update distributions set status = 'pending', signature = null, last_valid_block_height = null, error = null, updated_at = now()
    where id = ${id} and status = 'failed'`;
}

// Abandoned rows never reached the chain, so they do not count toward the retry cap.
export async function failuresSinceConfirmed(sql: SQL, stepKey: string): Promise<number> {
  const [r] = await sql`select count(*)::int as n from distributions
    where step_key = ${stepKey} and status = 'failed' and coalesce(error, '') <> 'abandoned before send'
      and id > coalesce((select max(id) from distributions where step_key = ${stepKey} and status = 'confirmed'), 0)`;
  return r.n;
}

export async function launchesWithSentSteps(sql: SQL): Promise<Set<number>> {
  const rows = await sql`select distinct launch_id from distributions where status = 'sent'`;
  return new Set(rows.map((r: any) => Number(r.launch_id)));
}

// CHECK (amount >= 0) is evaluated on the proposed row before ON CONFLICT, so debits must go through a plain UPDATE.
export async function confirmStep(sql: SQL, row: StepRow, deltas: Delta[], detail: Record<string, any> = {}): Promise<boolean> {
  const payload = json(deltas.map((d) => ({ bucket: d.bucket, mint: d.mint, amount: d.amount.toString() })));
  const [r] = await sql`
    with s as (
      update distributions set status = 'confirmed', detail = detail || ${json(detail)}::text::jsonb, updated_at = now()
      where id = ${row.id} and status in ('pending', 'sent') returning launch_id
    ), d as (
      select x.bucket, x.mint, sum(x.amount::numeric) as amount
      from jsonb_to_recordset(${payload}::text::jsonb) as x(bucket text, mint text, amount text)
      group by x.bucket, x.mint
    ), upd as (
      update escrow e set amount = e.amount + d.amount
      from s, d where e.launch_id = s.launch_id and e.bucket = d.bucket and e.mint = d.mint
      returning e.bucket, e.mint
    ), ins as (
      insert into escrow (launch_id, bucket, mint, amount)
      select s.launch_id, d.bucket, d.mint, d.amount from s cross join d
      where not exists (select 1 from escrow e where e.launch_id = s.launch_id and e.bucket = d.bucket and e.mint = d.mint)
      returning 1
    )
    select (select count(*) from s)::int as updated`;
  return r.updated === 1;
}

export async function getBalance(sql: SQL, launchId: number, bucket: string, mint: string): Promise<bigint> {
  const [r] = await sql`select amount from escrow where launch_id = ${launchId} and bucket = ${bucket} and mint = ${mint}`;
  return r ? BigInt(r.amount) : 0n;
}

export async function openSentSteps(sql: SQL): Promise<StepRow[]> {
  return (await sql`select * from distributions where status = 'sent' order by id`).map(toRow);
}

export async function abandonUnsent(sql: SQL): Promise<number> {
  const rows = await sql`update distributions set status = 'failed', error = 'abandoned before send', updated_at = now()
    where status = 'pending' and signature is null returning id`;
  return rows.length;
}

export async function ledgerTotals(sql: SQL): Promise<Map<string, bigint>> {
  const rows = await sql`select case when bucket = 'penalty' then 'spill' else 'keeper' end as grp, mint, sum(amount) as total
    from escrow group by 1, 2`;
  return new Map(rows.map((r: any) => [`${r.grp}:${r.mint}`, BigInt(r.total)]));
}
