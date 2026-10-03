import type { SQL } from "bun";
import type { BuyRow } from "./landing";

const BASE_UNIT = 1e-6;
type Row = BuyRow & { slot: number; seq: number };

const toRow = (r: any): Row => ({
  id: `${r.signature}:${r.event_index}`, mint: r.mint, symbol: r.symbol, trader: r.trader, amount: Number(r.base) * BASE_UNIT,
  at: new Date(r.block_time).toISOString(), side: r.side, slot: Number(r.slot), seq: Number(r.seq),
});

const COLUMNS = (sql: SQL) => sql`t.signature, t.event_index, l.mint, coalesce(l.symbol, left(l.mint, 4)) as symbol, t.trader,
  t.base_amount::float8 as base, t.block_time, t.side, t.slot, t.seq`;

/** Picks what the home ticker shows next: trades nobody has seen yet first, oldest of them first; otherwise one recent trade per token in turn. */
export class TickerPicker {
  private last: { slot: number; seq: number } | null = null;
  private queue: Row[] = [];
  private pool: { at: number; byToken: Row[][] } | null = null;
  private turn = 0;
  private perToken = new Map<string, number>();

  constructor(private sql: SQL, private now = () => Date.now()) {}

  async next(): Promise<BuyRow | null> {
    if (!this.last) {
      const [top] = await this.sql`select t.slot, t.seq from trades t order by t.slot desc, t.seq desc limit 1`;
      this.last = top ? { slot: Number(top.slot), seq: Number(top.seq) } : { slot: 0, seq: 0 };
    } else {
      const fresh = await this.sql`select ${COLUMNS(this.sql)} from trades t join launches l on l.id = t.launch_id
        where (t.slot, t.seq) > (${this.last.slot}, ${this.last.seq}) order by t.slot, t.seq limit 50`;
      for (const r of fresh) this.queue.push(toRow(r));
      const tail = this.queue.at(-1);
      if (tail) this.last = { slot: tail.slot, seq: tail.seq };
    }
    const queued = this.queue.shift();
    if (queued) return strip(queued);
    return this.roundRobin();
  }

  private async roundRobin(): Promise<BuyRow | null> {
    if (!this.pool || this.now() - this.pool.at > 60_000) {
      const rows = (await this.sql`select ${COLUMNS(this.sql)} from trades t join launches l on l.id = t.launch_id
        order by t.slot desc, t.seq desc limit 400`).map(toRow);
      const groups = new Map<string, Row[]>();
      for (const r of rows) (groups.get(r.mint) ?? groups.set(r.mint, []).get(r.mint)!).push(r);
      this.pool = { at: this.now(), byToken: [...groups.values()] };
    }
    const tokens = this.pool.byToken;
    if (!tokens.length) return null;
    const list = tokens[this.turn++ % tokens.length]!;
    const k = this.perToken.get(list[0]!.mint) ?? 0;
    this.perToken.set(list[0]!.mint, k + 1);
    return strip(list[k % list.length]!);
  }
}

const strip = ({ slot: _s, seq: _q, ...row }: Row): BuyRow => row;

type Listener = (row: BuyRow) => void;
const g = globalThis as { __quantsTicker?: { listeners: Set<Listener>; current: BuyRow | null; timer: ReturnType<typeof setInterval> | null } };

/** One ticker for the whole web process: every open page gets the same item at the same time. */
export function subscribeTicker(sql: SQL, listener: Listener, everyMs = 3_500): () => void {
  const t = (g.__quantsTicker ??= { listeners: new Set(), current: null, timer: null });
  t.listeners.add(listener);
  if (t.current) listener(t.current);
  if (!t.timer) {
    const picker = new TickerPicker(sql);
    const tick = async () => {
      const row = await picker.next().catch(() => null);
      if (!row) return;
      t.current = row;
      for (const l of t.listeners) l(row);
    };
    void tick();
    t.timer = setInterval(tick, everyMs);
  }
  return () => {
    t.listeners.delete(listener);
    if (t.listeners.size === 0 && t.timer) { clearInterval(t.timer); t.timer = null; }
  };
}
