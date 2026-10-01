// Map with a size cap that evicts the least recently used entry.
export class Lru<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}

  get size() { return this.m.size; }

  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }

  set(k: K, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }

  delete(k: K) { this.m.delete(k); }

  clear() { this.m.clear(); }
}

/** Memoises an async lookup per key for ttlMs, holding at most max keys. */
export function ttlCache<V>(ttlMs: number, max: number) {
  const c = new Lru<string, { at: number; v: Promise<V> }>(max);
  return {
    get(key: string, load: () => Promise<V>): Promise<V> {
      const hit = c.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.v;
      const v = load();
      c.set(key, { at: Date.now(), v });
      v.catch(() => { if (c.get(key)?.v === v) c.delete(key); });
      return v;
    },
    clear: () => c.clear(),
  };
}
