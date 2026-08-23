/**
 * Two-tier cache: an in-memory map for the lifetime of the tab, backed by
 * `localStorage` so profiles, archives and completed analyses survive reloads.
 *
 * Everything is namespaced and version-stamped, so bumping `version` in a store
 * definition invalidates every previously written entry for that store.
 * Writes degrade gracefully: if storage is unavailable or full, the memory tier
 * keeps working and stale entries in the same namespace are evicted (oldest first).
 */

const PREFIX = 'gambit';

interface Envelope<T> {
  /** Store version. */
  v: number;
  /** Written-at timestamp, ms. */
  t: number;
  /** Time to live, ms. `0` = never expires. */
  ttl: number;
  data: T;
}

export interface CacheOptions {
  version?: number;
  /** Default TTL in milliseconds. */
  ttl?: number;
  /** Persist to localStorage as well as memory. */
  persist?: boolean;
}

function storage(): Storage | null {
  try {
    const probe = `${PREFIX}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export class CacheStore<T> {
  private memory = new Map<string, Envelope<T>>();
  private readonly namespace: string;
  private readonly version: number;
  private readonly ttl: number;
  private readonly persist: boolean;

  constructor(namespace: string, options: CacheOptions = {}) {
    this.namespace = namespace;
    this.version = options.version ?? 1;
    this.ttl = options.ttl ?? 0;
    this.persist = options.persist ?? true;
  }

  private storageKey(key: string): string {
    return `${PREFIX}:${this.namespace}:${key}`;
  }

  private isFresh(entry: Envelope<T>): boolean {
    if (entry.v !== this.version) return false;
    if (!entry.ttl) return true;
    return Date.now() - entry.t < entry.ttl;
  }

  get(key: string): T | null {
    const cached = this.memory.get(key);
    if (cached) {
      if (this.isFresh(cached)) return cached.data;
      this.memory.delete(key);
    }

    if (!this.persist) return null;
    const store = storage();
    if (!store) return null;

    const raw = store.getItem(this.storageKey(key));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Envelope<T>;
      if (!this.isFresh(parsed)) {
        store.removeItem(this.storageKey(key));
        return null;
      }
      this.memory.set(key, parsed);
      return parsed.data;
    } catch {
      store.removeItem(this.storageKey(key));
      return null;
    }
  }

  set(key: string, data: T, ttl = this.ttl): void {
    const entry: Envelope<T> = { v: this.version, t: Date.now(), ttl, data };
    this.memory.set(key, entry);
    if (!this.persist) return;

    const store = storage();
    if (!store) return;
    const serialised = JSON.stringify(entry);
    try {
      store.setItem(this.storageKey(key), serialised);
    } catch {
      // Storage full — drop the oldest half of this namespace and try once more.
      this.evictOldest(store, 0.5);
      try {
        store.setItem(this.storageKey(key), serialised);
      } catch {
        // Still no room: the memory tier alone will have to do.
      }
    }
  }

  delete(key: string): void {
    this.memory.delete(key);
    if (!this.persist) return;
    storage()?.removeItem(this.storageKey(key));
  }

  /** Remove every entry in this namespace. */
  clear(): void {
    this.memory.clear();
    if (!this.persist) return;
    const store = storage();
    if (!store) return;
    const prefix = `${PREFIX}:${this.namespace}:`;
    for (const key of Object.keys(store)) {
      if (key.startsWith(prefix)) store.removeItem(key);
    }
  }

  /** Number of persisted entries in this namespace. */
  size(): number {
    const store = storage();
    if (!store) return this.memory.size;
    const prefix = `${PREFIX}:${this.namespace}:`;
    return Object.keys(store).filter((k) => k.startsWith(prefix)).length;
  }

  private evictOldest(store: Storage, fraction: number): void {
    const prefix = `${PREFIX}:${this.namespace}:`;
    const entries: Array<{ key: string; t: number }> = [];
    for (const key of Object.keys(store)) {
      if (!key.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(store.getItem(key) ?? '{}') as Envelope<T>;
        entries.push({ key, t: parsed.t ?? 0 });
      } catch {
        entries.push({ key, t: 0 });
      }
    }
    entries.sort((a, b) => a.t - b.t);
    const removeCount = Math.max(1, Math.floor(entries.length * fraction));
    for (const entry of entries.slice(0, removeCount)) {
      store.removeItem(entry.key);
      this.memory.delete(entry.key.slice(prefix.length));
    }
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * Chess.com states that published-data endpoints refresh at most every 12 hours,
 * so profile/stats data can be cached aggressively. Archives for the *current*
 * month change as new games are played and get a much shorter TTL.
 */
export const caches = {
  profile: new CacheStore<unknown>('profile', { version: 1, ttl: 6 * HOUR }),
  stats: new CacheStore<unknown>('stats', { version: 1, ttl: 6 * HOUR }),
  archives: new CacheStore<unknown>('archives', { version: 1, ttl: 3 * HOUR }),
  months: new CacheStore<unknown>('months', { version: 2, ttl: 3 * HOUR }),
  analysis: new CacheStore<unknown>('analysis', { version: 3, ttl: 30 * 24 * HOUR }),
};

/** TTL for the archive of the month currently in progress. */
export const CURRENT_MONTH_TTL = 10 * MINUTE;

/** Wipe every cache namespace this app owns. */
export function clearAllCaches(): void {
  for (const store of Object.values(caches)) store.clear();
}
