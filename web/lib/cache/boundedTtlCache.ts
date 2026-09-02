type CacheEntry<Value> = {
  expiresAt: number;
  value: Value;
};

type BoundedTtlCacheOptions = {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
};

/**
 * A small in-process LRU cache with a hard entry limit.
 *
 * Expired entries are removed on access/write, and recently read entries are
 * moved to the end of the Map so the oldest entry can be evicted in O(1).
 */
export class BoundedTtlCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: BoundedTtlCacheOptions) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error("ttlMs must be greater than zero");
    }

    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh LRU order without extending the TTL.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value): Value {
    const now = this.now();
    this.removeExpired(now);
    this.entries.delete(key);

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, {
      expiresAt: now + this.ttlMs,
      value,
    });
    return value;
  }

  get size(): number {
    return this.entries.size;
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
