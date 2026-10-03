type Fetch = typeof fetch;

const LIMIT_RUN = 3;
const BASE_COOL_MS = 30_000;
const MAX_COOL_MS = 600_000;

type State = { run: number; strikes: number; until: number };

const limitedBody = (text: string) => /"code"\s*:\s*-32005|too many requests|rate limit/i.test(text);

/**
 * Spreads RPC requests over several providers. A provider that answers with a rate limit three times in a row is
 * skipped for 30s, doubling each time it happens again (up to 10 min); one good answer resets it.
 */
// RETRY-LOOP-SAFETY: bounded by design, do not add a sleeping retry here.
//   attempts: each request tries every provider at most once, in order, with no waits.
//   backoff:  a limited provider is skipped for its cool down instead of retried; when all are cooling, the one
//             that recovers first takes the request and its answer (even a 429) goes back to the caller.
export class RpcPool {
  private state: Map<string, State>;
  private inner: Fetch;
  private now: () => number;

  constructor(private urls: string[], opts: { fetch?: Fetch; now?: () => number } = {}) {
    this.state = new Map(urls.map((u) => [u, { run: 0, strikes: 0, until: 0 }]));
    this.inner = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  get primary() { return this.urls[0]!; }

  coolingUntil(url: string) { return this.state.get(url)?.until ?? 0; }

  private order(): string[] {
    const t = this.now();
    const ready = this.urls.filter((u) => this.state.get(u)!.until <= t);
    if (ready.length) return ready;
    return [...this.urls].sort((a, b) => this.state.get(a)!.until - this.state.get(b)!.until).slice(0, 1);
  }

  private limited(url: string) {
    const s = this.state.get(url)!;
    if (++s.run < LIMIT_RUN) return;
    s.until = this.now() + Math.min(MAX_COOL_MS, BASE_COOL_MS * 2 ** s.strikes);
    s.strikes++;
    s.run = 0;
    console.error(JSON.stringify({ at: new Date(this.now()).toISOString(), rpcCooling: new URL(url).host, forMs: s.until - this.now() }));
  }

  private healthy(url: string) {
    const s = this.state.get(url)!;
    s.run = 0;
    s.strikes = 0;
  }

  fetch: Fetch = (async (_url: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    let last: Response | undefined;
    let lastError: unknown;
    for (const url of this.order()) {
      try {
        const res = await this.inner(url, init);
        const text = await res.text();
        const out = new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
        if (res.status === 429 || limitedBody(text)) { this.limited(url); last = out; continue; }
        this.healthy(url);
        return out;
      } catch (e) {
        lastError = e;
      }
    }
    if (last) return last;
    throw lastError;
  }) as Fetch;
}

/** The service's own provider first, then the others; empty and repeated entries dropped. */
export function providerOrder(...urls: (string | undefined)[]): string[] {
  return [...new Set(urls.filter((u): u is string => !!u))];
}
