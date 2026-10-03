type Fetch = typeof fetch;

/** Sends RPC requests one at a time with at least gapMs per request between them; a JSON-RPC batch counts as one request per call in it. */
export function pacedFetch(inner: Fetch, gapMs: number, sleep = (ms: number) => Bun.sleep(ms)): Fetch {
  let chain = Promise.resolve();
  return (async (url: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    let calls = 1;
    try { const b = JSON.parse(String(init?.body ?? "")); if (Array.isArray(b)) calls = Math.max(1, b.length); } catch {}
    const turn = chain.then(() => sleep(gapMs * calls));
    chain = turn.catch(() => {});
    await turn;
    return inner(url, init);
  }) as Fetch;
}

// RETRY-LOOP-SAFETY: the pass loop itself is the retry; this only stretches the wait after a throttled pass.
//   bounds: wait doubles per throttled pass up to maxMs, and returns to baseMs after one clean pass.
export function nextWait(current: number, throttled: boolean, baseMs: number, maxMs: number): number {
  return throttled ? Math.min(maxMs, Math.max(baseMs, current) * 2) : baseMs;
}
