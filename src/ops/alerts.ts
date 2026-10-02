import type { SQL } from "bun";

export interface ThrottleStore {
  /** True when `key` was not sent within `windowMs`; records it as sent now. */
  claim(key: string, windowMs: number): Promise<boolean>;
}

export function memoryThrottle(now: () => number = Date.now): ThrottleStore {
  const last = new Map<string, number>();
  return {
    async claim(key, windowMs) {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < windowMs) return false;
      last.set(key, t);
      return true;
    },
  };
}

// Kept in Postgres so a process that exits and restarts (ReconcileError) does not alert on every restart.
export const sqlThrottle = (sql: SQL): ThrottleStore => ({
  async claim(key, windowMs) {
    const rows = await sql`insert into alerts_sent (key, sent_at) values (${key}, now())
      on conflict (key) do update set sent_at = now()
      where alerts_sent.sent_at <= now() - make_interval(secs => ${windowMs / 1000})
      returning 1`;
    return rows.length > 0;
  },
});

const MAX_TEXT = 1900; // Discord rejects messages over 2000 characters

export interface AlerterOptions {
  /** A function is read on every alert, so a webhook changed on the admin page applies without a restart. */
  url: string | undefined | (() => string | undefined);
  source: string;
  fetch?: typeof fetch;
  store?: ThrottleStore;
  windowMs?: number;
  timeoutMs?: number;
  log?: (e: unknown) => void;
}

export type Alert = (key: string, text: string) => Promise<void>;

/** Never throws and settles within about two timeouts, so callers can await it or fire and forget. */
export function makeAlerter(o: AlerterOptions): Alert {
  const f = o.fetch ?? fetch;
  const windowMs = o.windowMs ?? 3_600_000;
  const timeoutMs = o.timeoutMs ?? 5_000;
  const store = o.store ?? memoryThrottle();
  const fallback = memoryThrottle();
  const log = o.log ?? ((e) => console.error(JSON.stringify({ at: new Date().toISOString(), alertFailed: String(e) })));
  return async (key, text) => {
    const url = typeof o.url === "function" ? o.url() : o.url;
    if (!url) return;
    try {
      let send: boolean;
      try {
        send = await withTimeout(store.claim(key, windowMs), timeoutMs);
      } catch (e) {
        log(e);
        send = await fallback.claim(key, windowMs);
      }
      if (!send) return;
      const res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `quants ${o.source}: ${text}`.slice(0, MAX_TEXT) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) log(new Error(`webhook answered ${res.status}`));
    } catch (e) {
      log(e);
    }
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Counts consecutive failures per key. Without `attempted`, every key that did not fail is reset. */
export class Streaks {
  private counts = new Map<string, number>();
  constructor(private threshold: number) {}

  update(failed: Iterable<string>, attempted?: Iterable<string>): string[] {
    const bad = new Set(failed);
    const reset = attempted ? [...attempted] : [...this.counts.keys()];
    for (const k of reset) if (!bad.has(k)) this.counts.delete(k);
    const hit: string[] = [];
    for (const k of bad) {
      const n = (this.counts.get(k) ?? 0) + 1;
      this.counts.set(k, n);
      if (n >= this.threshold) hit.push(k);
    }
    return hit;
  }

  count(key: string) {
    return this.counts.get(key) ?? 0;
  }
}

export function keeperRunAlerts(alert: Alert, streaks: Streaks, r: { errors: { launchId: number; error: string }[] }) {
  const last = new Map(r.errors.map((e) => [String(e.launchId), e.error]));
  for (const id of streaks.update(last.keys())) {
    void alert(`keeper-launch-${id}`, `launch ${id} failed ${streaks.count(id)} runs in a row: ${last.get(id)}`);
  }
}

export function indexerPassAlerts(alert: Alert, streaks: Streaks, r: { skipped: number; checked: string[]; errors: { address: string; error: string }[] }) {
  const last = new Map(r.errors.map((e) => [e.address, e.error]));
  for (const address of streaks.update(last.keys(), r.checked)) {
    void alert(`indexer-address-${address}`, `${address} failed ${streaks.count(address)} passes in a row: ${last.get(address)}`);
  }
  if (r.skipped) void alert("indexer-skipped", `skipped ${r.skipped} transactions the RPC would not return`);
}
