import type { SQL } from "bun";

export type Vote = -1 | 0 | 1;
export type VoteTotal = { mint: string; symbol: string | null; up: number; down: number; score: number };

/** 0 clears the voter's vote. */
export async function castVote(sql: SQL, mint: string, voter: string, vote: Vote) {
  if (vote === 0) {
    await sql`delete from token_votes where mint = ${mint} and voter = ${voter}`;
    return;
  }
  await sql`insert into token_votes (mint, voter, vote) values (${mint}, ${voter}, ${vote})
    on conflict (mint, voter) do update set vote = excluded.vote, updated_at = now()`;
}

export async function voteOf(sql: SQL, mint: string, voter: string): Promise<Vote> {
  const [r] = await sql`select vote from token_votes where mint = ${mint} and voter = ${voter}`;
  return (r?.vote ?? 0) as Vote;
}

export async function voteTotals(sql: SQL, limit: number): Promise<VoteTotal[]> {
  const rows = await sql`
    select v.mint, l.symbol, count(*) filter (where v.vote = 1)::int as up, count(*) filter (where v.vote = -1)::int as down, sum(v.vote)::int as score
    from token_votes v left join launches l on l.mint = v.mint
    group by v.mint, l.symbol
    order by score desc, up desc, v.mint
    limit ${limit}`;
  return rows.map((r: any) => ({ mint: r.mint, symbol: r.symbol, up: r.up, down: r.down, score: r.score }));
}
