import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore, caches, clearAllCaches } from './cache';

describe('CacheStore', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('stores and reads a value', () => {
    const store = new CacheStore<{ n: number }>('test');
    store.set('a', { n: 1 });
    expect(store.get('a')).toEqual({ n: 1 });
  });

  it('returns null for a key it has never seen', () => {
    expect(new CacheStore('test').get('missing')).toBeNull();
  });

  it('survives a fresh instance by reading localStorage', () => {
    new CacheStore<string>('persisted').set('k', 'value');
    expect(new CacheStore<string>('persisted').get('k')).toBe('value');
  });

  it('expires entries once the TTL has passed', () => {
    const store = new CacheStore<string>('ttl', { ttl: 1000 });
    store.set('k', 'value');
    expect(store.get('k')).toBe('value');

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    expect(store.get('k')).toBeNull();
  });

  it('treats a TTL of zero as "never expires"', () => {
    const store = new CacheStore<string>('forever', { ttl: 0 });
    store.set('k', 'value');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 ** 9);
    expect(store.get('k')).toBe('value');
  });

  it('invalidates everything when the version is bumped', () => {
    new CacheStore<string>('versioned', { version: 1 }).set('k', 'value');
    expect(new CacheStore<string>('versioned', { version: 2 }).get('k')).toBeNull();
  });

  it('keeps namespaces apart', () => {
    new CacheStore<string>('one').set('k', 'from one');
    new CacheStore<string>('two').set('k', 'from two');
    expect(new CacheStore<string>('one').get('k')).toBe('from one');
    expect(new CacheStore<string>('two').get('k')).toBe('from two');
  });

  it('deletes and clears', () => {
    const store = new CacheStore<string>('removable');
    store.set('a', '1');
    store.set('b', '2');

    store.delete('a');
    expect(store.get('a')).toBeNull();
    expect(store.get('b')).toBe('2');

    store.clear();
    expect(store.get('b')).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('discards corrupt persisted entries', () => {
    window.localStorage.setItem('gambit:corrupt:k', 'not json');
    expect(new CacheStore<string>('corrupt').get('k')).toBeNull();
    expect(window.localStorage.getItem('gambit:corrupt:k')).toBeNull();
  });

  it('keeps working when localStorage throws', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const store = new CacheStore<string>('quota');
    expect(() => store.set('k', 'value')).not.toThrow();
    // The memory tier still answers.
    expect(store.get('k')).toBe('value');
    setItem.mockRestore();
  });

  it('evicts the oldest entries and retries when storage fills up', () => {
    const store = new CacheStore<string>('evicting');
    store.set('first', 'a');
    store.set('second', 'b');

    // Reject the first write of the new key, then let everything through, which is
    // how a quota error behaves once room has been made.
    const real = Storage.prototype.setItem;
    let rejections = 1;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === 'gambit:evicting:third' && rejections > 0) {
          rejections -= 1;
          throw new Error('QuotaExceededError');
        }
        real.call(this, key, value);
      });

    expect(() => store.set('third', 'c')).not.toThrow();
    setItem.mockRestore();

    // The retry succeeded and something older was dropped to make room.
    expect(window.localStorage.getItem('gambit:evicting:third')).not.toBeNull();
    expect(new CacheStore<string>('evicting').get('third')).toBe('c');
    expect(window.localStorage.getItem('gambit:evicting:first')).toBeNull();
  });

  it('can be told not to persist at all', () => {
    const store = new CacheStore<string>('memory-only', { persist: false });
    store.set('k', 'value');
    expect(store.get('k')).toBe('value');
    expect(window.localStorage.getItem('gambit:memory-only:k')).toBeNull();
  });

  it('clearAllCaches wipes every namespace the app owns', () => {
    caches.profile.set('hikaru', { username: 'hikaru' });
    caches.analysis.set('some-key', { moves: [] });
    expect(caches.profile.get('hikaru')).not.toBeNull();

    clearAllCaches();

    expect(caches.profile.get('hikaru')).toBeNull();
    expect(caches.analysis.get('some-key')).toBeNull();
    expect(window.localStorage.getItem('gambit:profile:hikaru')).toBeNull();
  });
});
