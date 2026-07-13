interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A minimal in-memory TTL cache used to reduce load on the public CKAN
 * portal for reads that don't need to be perfectly fresh (group/organization
 * lists, dataset lookups, search results). Not shared across processes.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0) {
      return;
    }

    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const value = await load();
    this.set(key, value);
    return value;
  }
}
